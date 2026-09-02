import asyncio
import logging
import posixpath
import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import File, Share, ShareStatus

logger = logging.getLogger("app.crawler")


class ShareCrawlerError(Exception):
    """Base crawler exception"""
    pass


class ShareExpiredOrInvalidError(ShareCrawlerError):
    """Share expired, deleted or wrong receive_code"""
    pass


class ShareBannedError(ShareCrawlerError):
    """Share banned due to compliance violation"""
    pass


class Crawler115Engine:
    """
    High-Performance 115 Cloud Drive Share Recursive Crawler Engine
    
    Optimizations for 10,000+ Files & Multi-TB Datasets:
    1. Max Page Size (limit=1000): Cuts HTTP roundtrips by 90% vs default 100.
    2. Concurrent Multi-Worker BFS: Crawls multiple directory trees in parallel with asyncio.Queue.
    3. HTTP Connection Pool & Keep-Alive: Reuses TCP/TLS connections via httpx.Limits.
    4. Decoupled Pipeline DB Batch Upsert: Non-blocking background worker flushes batches (1000/batch).
    5. Jitter Rate-Limiter & Exponential Backoff: Protects against 115 API rate-limits.
    """

    def __init__(
        self,
        user_agent: Optional[str] = None,
        cookie: Optional[str] = None,
        timeout: Optional[float] = None
    ):
        self.user_agent = user_agent or settings.CRAWLER_USER_AGENT
        self.cookie = cookie or settings.CRAWLER_COOKIE
        self.timeout = timeout or settings.CRAWLER_TIMEOUT
        self.snap_url = settings.CRAWLER_SNAP_URL

    def _get_headers(self, share_code: str = "", receive_code: str = "") -> Dict[str, str]:
        referer = (
            f"https://115.com/s/{share_code}?password={receive_code}"
            if share_code
            else settings.CRAWLER_REFERER
        )
        headers = {
            "User-Agent": self.user_agent,
            "Referer": referer,
            "Origin": "https://115.com",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Connection": "keep-alive",
        }
        if self.cookie:
            headers["Cookie"] = self.cookie
        return headers

    async def _fetch_snap_page(
        self,
        client: httpx.AsyncClient,
        share_code: str,
        receive_code: str,
        cid: str,
        offset: int = 0,
        limit: int = 100
    ) -> Dict[str, Any]:
        """
        Request a single page of directory snapshot from 115 API via POST with exponential backoff retry.
        Uses POST with form-data payload (the standard web endpoint method).
        """
        data_payload = {
            "share_code": share_code,
            "receive_code": receive_code,
            "cid": str(cid),
            "offset": str(offset),
            "limit": str(limit),
            "asc": "1",
            "order": "user_ptime",
        }

        retries = 0
        backoff = 0.8
        req_method = settings.CRAWLER_METHOD.upper()

        while retries <= settings.CRAWLER_MAX_RETRIES:
            try:
                # Controlled jitter to simulate natural client traffic
                delay = random.uniform(settings.CRAWLER_RATE_MIN, settings.CRAWLER_RATE_MAX)
                await asyncio.sleep(delay)

                headers = self._get_headers(share_code, receive_code)

                # 115 webapi.115.com/share/snap supports POST form-data (and switches on 405)
                if req_method == "POST":
                    response = await client.post(
                        self.snap_url,
                        data=data_payload,
                        headers=headers,
                        timeout=self.timeout
                    )
                else:
                    response = await client.get(
                        self.snap_url,
                        params=data_payload,
                        headers=headers,
                        timeout=self.timeout
                    )

                if response.status_code == 405:
                    # Switch HTTP method on 405 (e.g. GET -> POST or POST -> GET)
                    logger.warning(
                        f"115 API returned 405 for {req_method} share_code={share_code}, cid={cid}. Switching method."
                    )
                    req_method = "GET" if req_method == "POST" else "POST"
                    retries += 1
                    await asyncio.sleep(0.5)
                    continue

                if response.status_code != 200:
                    logger.warning(
                        f"115 API HTTP {response.status_code} for share_code={share_code}, cid={cid}. "
                        f"Retrying in {backoff:.1f}s (Attempt {retries + 1}/{settings.CRAWLER_MAX_RETRIES})"
                    )
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 1.8
                    continue

                result = response.json()

                # Handle 115 Business error responses
                if not result.get("state", False):
                    msg = str(result.get("msg") or result.get("error", "Unknown 115 error"))
                    error_code = result.get("errNo") or result.get("code")

                    logger.warning(
                        f"115 API returned state=false for share_code={share_code}, cid={cid}: "
                        f"msg='{msg}', code={error_code}"
                    )

                    # Determine specific error types
                    if any(x in msg for x in ["已失效", "不存在", "取消", "提取码错误", "不存在或已删除"]):
                        raise ShareExpiredOrInvalidError(f"Share expired or password invalid: {msg}")
                    if any(x in msg for x in ["违规", "屏蔽", "封禁", "安全"]):
                        raise ShareBannedError(f"Share banned: {msg}")

                    # Transient business error or frequency limit, retry with backoff
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 2.0
                    continue

                return result

            except (httpx.RequestError, httpx.TimeoutException) as exc:
                retries += 1
                logger.warning(
                    f"Network error requesting 115 snap API for share_code={share_code}: {exc}. "
                    f"Retry {retries}/{settings.CRAWLER_MAX_RETRIES} in {backoff:.1f}s"
                )
                if retries > settings.CRAWLER_MAX_RETRIES:
                    raise ShareCrawlerError(f"Network error after {retries} attempts: {exc}") from exc
                await asyncio.sleep(backoff)
                backoff *= 1.8

        raise ShareCrawlerError(f"Failed to fetch snap for share_code={share_code}, cid={cid} after {retries} retries")

    async def crawl_and_index(
        self,
        db: AsyncSession,
        share_code: str,
        receive_code: str = ""
    ) -> Share:
        """
        High-Throughput Concurrent BFS Crawl Engine:
        1. Initialize Share record & HTTP connection pool.
        2. Launch concurrent workers traversing directory queue in parallel.
        3. Launch pipeline DB writer buffering and upserting 1000 items/batch.
        4. Complete full-tree indexing with accurate aggregated counts and timestamps.
        """
        logger.info(f"Starting High-Performance BFS crawl for 115 share: {share_code}")

        # 1. Ensure share record exists
        stmt = select(Share).where(Share.share_code == share_code)
        res = await db.execute(stmt)
        share_obj = res.scalar_one_or_none()

        if not share_obj:
            share_obj = Share(
                share_code=share_code,
                receive_code=receive_code,
                status=ShareStatus.PENDING.value,
                title="",
            )
            db.add(share_obj)
            await db.flush()
        else:
            share_obj.status = ShareStatus.PENDING.value
            if receive_code and not share_obj.receive_code:
                share_obj.receive_code = receive_code
            await db.flush()

        effective_pwd = receive_code or share_obj.receive_code or ""

        # Shared states
        dir_queue: asyncio.Queue[Tuple[str, str]] = asyncio.Queue()
        await dir_queue.put(("0", "/"))  # Start at Root CID="0", path="/"

        db_write_queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue(maxsize=5000)

        visited_cids: Set[str] = set()
        visited_lock = asyncio.Lock()

        extracted_meta = {"title": None}
        stats = {
            "files": 0,
            "folders": 0,
            "bytes": 0
        }
        stats_lock = asyncio.Lock()

        # HTTP Client with connection pooling
        http_limits = httpx.Limits(
            max_keepalive_connections=30,
            max_connections=50,
            keepalive_expiry=30.0
        )

        async with httpx.AsyncClient(limits=http_limits, verify=True) as client:
            # 2. Database Pipeline Background Writer
            async def db_writer():
                buffer: List[Dict[str, Any]] = []
                while True:
                    item = await db_write_queue.get()
                    if item is None:  # Sentinel value indicating end of crawl
                        if buffer:
                            await self._bulk_upsert_files(db, buffer)
                            buffer.clear()
                        db_write_queue.task_done()
                        break

                    buffer.append(item)
                    if len(buffer) >= settings.CRAWLER_BATCH_UPSERT_SIZE:
                        await self._bulk_upsert_files(db, buffer)
                        buffer.clear()
                    db_write_queue.task_done()

            db_writer_task = asyncio.create_task(db_writer())

            # 3. Concurrent Directory Worker
            async def dir_worker(worker_id: int):
                while True:
                    try:
                        # Timeout allows workers to notice when all tasks are complete
                        current_cid, current_virtual_path = await asyncio.wait_for(
                            dir_queue.get(), timeout=2.5
                        )
                    except asyncio.TimeoutError:
                        break

                    async with visited_lock:
                        if current_cid in visited_cids:
                            dir_queue.task_done()
                            continue
                        visited_cids.add(current_cid)

                    try:
                        offset = 0
                        page_size = settings.CRAWLER_PAGE_SIZE  # 1000 items per page

                        while True:
                            snap_data = await self._fetch_snap_page(
                                client=client,
                                share_code=share_code,
                                receive_code=effective_pwd,
                                cid=current_cid,
                                offset=offset,
                                limit=page_size
                            )

                            data_payload = snap_data.get("data", {})

                            # Extract share title once
                            if not extracted_meta["title"]:
                                share_info = data_payload.get("share_info", {})
                                title = (
                                    share_info.get("share_title")
                                    or share_info.get("title")
                                    or data_payload.get("share_title")
                                    or data_payload.get("user_name")
                                    or f"115 分享 ({share_code})"
                                )
                                extracted_meta["title"] = title
                                share_obj.title = title

                            item_list = data_payload.get("list", [])
                            total_in_dir = data_payload.get("count", len(item_list))

                            local_files = 0
                            local_folders = 0
                            local_bytes = 0

                            for item in item_list:
                                raw_fid = item.get("fid")
                                raw_cid = item.get("cid")
                                item_name = str(item.get("n", "")).strip()
                                if not item_name:
                                    continue

                                is_directory = raw_fid is None or (raw_cid is not None and not raw_fid)
                                node_id = str(raw_cid if is_directory else raw_fid)
                                item_size = int(item.get("s", 0) or 0)
                                item_sha1 = str(item.get("sha1", "") or "").lower()

                                # Compute normalized absolute virtual path
                                normalized_path = posixpath.normpath(
                                    posixpath.join(current_virtual_path, item_name)
                                )

                                if is_directory:
                                    extension = ""
                                    local_folders += 1
                                    # Push new subdirectory to parallel BFS queue
                                    await dir_queue.put((node_id, normalized_path))
                                else:
                                    _, ext = posixpath.splitext(item_name)
                                    extension = ext.lstrip(".").lower()
                                    local_files += 1
                                    local_bytes += item_size

                                file_record = {
                                    "share_id": share_obj.id,
                                    "file_115_id": node_id,
                                    "parent_115_id": current_cid,
                                    "name": item_name,
                                    "extension": extension,
                                    "size": item_size,
                                    "is_dir": is_directory,
                                    "sha1": item_sha1,
                                    "full_path": normalized_path,
                                }
                                # Push to database pipeline queue
                                await db_write_queue.put(file_record)

                            async with stats_lock:
                                stats["files"] += local_files
                                stats["folders"] += local_folders
                                stats["bytes"] += local_bytes

                            # Pagination
                            offset += len(item_list)
                            if offset >= total_in_dir or not item_list:
                                break

                    except Exception as exc:
                        logger.error(f"[Worker-{worker_id}] Error traversing cid={current_cid}: {exc}")
                        raise
                    finally:
                        dir_queue.task_done()

            try:
                # Spawn concurrent directory crawlers
                workers = [
                    asyncio.create_task(dir_worker(i))
                    for i in range(settings.CRAWLER_CONCURRENCY)
                ]

                # Wait until all directories in queue are processed
                await dir_queue.join()
                await asyncio.gather(*workers, return_exceptions=True)

                # Signal DB writer to complete and flush
                await db_write_queue.put(None)
                await db_write_queue.join()
                await db_writer_task

                # Update Share record status
                share_obj.status = ShareStatus.ACTIVE.value
                share_obj.file_count = stats["files"]
                share_obj.folder_count = stats["folders"]
                share_obj.total_size = stats["bytes"]
                share_obj.last_crawled_at = datetime.now(timezone.utc)
                await db.commit()
                await db.refresh(share_obj)

                logger.info(
                    f"Successfully finished crawl for {share_code}: "
                    f"files={stats['files']}, folders={stats['folders']}, "
                    f"size={stats['bytes'] / (1024**3):.2f} GB"
                )
                return share_obj

            except ShareExpiredOrInvalidError as err:
                logger.error(f"Marking share {share_code} as EXPIRED: {err}")
                share_obj.status = ShareStatus.EXPIRED.value
                await db.commit()
                raise

            except ShareBannedError as err:
                logger.error(f"Marking share {share_code} as BANNED: {err}")
                share_obj.status = ShareStatus.BANNED.value
                await db.commit()
                raise

            except Exception as exc:
                logger.exception(f"Unexpected error crawling {share_code}: {exc}")
                await db.rollback()
                raise ShareCrawlerError(f"Crawl failed: {exc}") from exc

    async def _bulk_upsert_files(self, db: AsyncSession, records: List[Dict[str, Any]]) -> None:
        """
        High performance bulk upsert into PostgreSQL using ON CONFLICT DO UPDATE
        """
        if not records:
            return

        insert_stmt = insert(File).values(records)
        upsert_stmt = insert_stmt.on_conflict_do_update(
            constraint="uq_share_file_115_id",
            set_={
                "parent_115_id": insert_stmt.excluded.parent_115_id,
                "name": insert_stmt.excluded.name,
                "extension": insert_stmt.excluded.extension,
                "size": insert_stmt.excluded.size,
                "is_dir": insert_stmt.excluded.is_dir,
                "sha1": insert_stmt.excluded.sha1,
                "full_path": insert_stmt.excluded.full_path,
            }
        )
        await db.execute(upsert_stmt)
        await db.commit()
