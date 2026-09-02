import asyncio
import logging
import posixpath
import random
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import select, update
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
    115 Cloud Drive Share Recursive Crawler Engine
    Implements high-throughput Breadth-First Search (BFS) directory traversal
    via 115 Share Snapshot API (https://webapi.115.com/share/snap).
    """

    def __init__(
        self,
        user_agent: Optional[str] = None,
        cookie: Optional[str] = None,
        timeout: float = 15.0
    ):
        self.user_agent = user_agent or settings.CRAWLER_USER_AGENT
        self.cookie = cookie or settings.CRAWLER_COOKIE
        self.timeout = timeout
        self.snap_url = settings.CRAWLER_SNAP_URL

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "User-Agent": self.user_agent,
            "Referer": settings.CRAWLER_REFERER,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
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
        Request a single page of directory snapshot from 115 API with exponential backoff retry
        """
        params = {
            "share_code": share_code,
            "receive_code": receive_code,
            "cid": cid,
            "offset": offset,
            "limit": limit,
            "asc": 1,
            "order": "user_ptime",
        }

        retries = 0
        backoff = 1.0

        while retries <= settings.CRAWLER_MAX_RETRIES:
            try:
                # Jitter delay to simulate organic client requests & prevent rate limiting
                delay = random.uniform(settings.CRAWLER_RATE_MIN, settings.CRAWLER_RATE_MAX)
                await asyncio.sleep(delay)

                response = await client.get(
                    self.snap_url,
                    params=params,
                    headers=self._get_headers(),
                    timeout=self.timeout
                )

                if response.status_code != 200:
                    logger.warning(
                        f"115 API HTTP {response.status_code} for share_code={share_code}, cid={cid}. "
                        f"Retrying in {backoff:.1f}s (Attempt {retries + 1}/{settings.CRAWLER_MAX_RETRIES})"
                    )
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 2.0
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

                    # Transient business error, retry
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
                backoff *= 2.0

        raise ShareCrawlerError(f"Failed to fetch snap for share_code={share_code}, cid={cid} after {retries} retries")

    async def crawl_and_index(
        self,
        db: AsyncSession,
        share_code: str,
        receive_code: str = ""
    ) -> Share:
        """
        Main BFS Crawl Engine:
        1. Fetch root node, extract share title & metadata
        2. Traverse directory hierarchy using collections.deque BFS queue
        3. Extract absolute paths, size, sha1, node IDs
        4. Batch upsert files into PostgreSQL
        5. Update Share status and aggregate counts
        """
        logger.info(f"Starting BFS crawl for 115 share: {share_code} (receive_code='{receive_code}')")

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

        async with httpx.AsyncClient(verify=True) as client:
            # BFS Queue holds tuples of: (cid, virtual_parent_path)
            # Root directory starts at cid="0", virtual_path="/"
            queue: deque[Tuple[str, str]] = deque([("0", "/")])
            visited_cids = set()

            extracted_title: Optional[str] = None
            total_files_count = 0
            total_folders_count = 0
            total_size_bytes = 0

            pending_files_buffer: List[Dict[str, Any]] = []
            BATCH_UPSERT_SIZE = 500

            try:
                while queue:
                    current_cid, current_virtual_path = queue.popleft()
                    if current_cid in visited_cids:
                        continue
                    visited_cids.add(current_cid)

                    offset = 0
                    limit = settings.CRAWLER_PAGE_SIZE

                    while True:
                        snap_data = await self._fetch_snap_page(
                            client=client,
                            share_code=share_code,
                            receive_code=receive_code or share_obj.receive_code,
                            cid=current_cid,
                            offset=offset,
                            limit=limit
                        )

                        data_payload = snap_data.get("data", {})
                        
                        # Extract share title on first successful response
                        if not extracted_title:
                            share_info = data_payload.get("share_info", {})
                            extracted_title = (
                                share_info.get("share_title")
                                or share_info.get("title")
                                or data_payload.get("share_title")
                                or data_payload.get("user_name")
                                or f"115 Share {share_code}"
                            )
                            share_obj.title = extracted_title

                        item_list = data_payload.get("list", [])
                        total_in_dir = data_payload.get("count", len(item_list))

                        for item in item_list:
                            # In 115 Snap API:
                            # - Directories have "cid" and NO "fid" (or fc: "1")
                            # - Files have "fid" and "sha1", and "s" (size)
                            raw_fid = item.get("fid")
                            raw_cid = item.get("cid")
                            item_name = str(item.get("n", "")).strip()
                            if not item_name:
                                continue

                            is_directory = raw_fid is None or raw_cid is not None and not raw_fid
                            node_id = str(raw_cid if is_directory else raw_fid)
                            item_size = int(item.get("s", 0) or 0)
                            item_sha1 = str(item.get("sha1", "") or "").lower()

                            # Compute full absolute path
                            normalized_path = posixpath.normpath(
                                posixpath.join(current_virtual_path, item_name)
                            )

                            # Extract file extension
                            if is_directory:
                                extension = ""
                                total_folders_count += 1
                                # Enqueue directory for deeper traversal
                                queue.append((node_id, normalized_path))
                            else:
                                _, ext = posixpath.splitext(item_name)
                                extension = ext.lstrip(".").lower()
                                total_files_count += 1
                                total_size_bytes += item_size

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
                            pending_files_buffer.append(file_record)

                            # Bulk flush buffer when full
                            if len(pending_files_buffer) >= BATCH_UPSERT_SIZE:
                                await self._bulk_upsert_files(db, pending_files_buffer)
                                pending_files_buffer.clear()

                        # Check pagination for current directory
                        offset += len(item_list)
                        if offset >= total_in_dir or not item_list:
                            break

                # Flush remaining buffered items
                if pending_files_buffer:
                    await self._bulk_upsert_files(db, pending_files_buffer)
                    pending_files_buffer.clear()

                # Update share record to ACTIVE
                share_obj.status = ShareStatus.ACTIVE.value
                share_obj.file_count = total_files_count
                share_obj.folder_count = total_folders_count
                share_obj.total_size = total_size_bytes
                share_obj.last_crawled_at = datetime.now(timezone.utc)
                await db.commit()
                await db.refresh(share_obj)

                logger.info(
                    f"Successfully finished crawl for {share_code}: "
                    f"files={total_files_count}, folders={total_folders_count}, size={total_size_bytes} bytes"
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
        await db.flush()
