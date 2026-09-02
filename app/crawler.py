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
    115 分享快照递归爬虫引擎 (对齐 AList / OpenList 底层驱动实现)
    - 采用标准 GET 协议
    - 自动清理 WAF 脏 Cookie (剔除易触发拦截的 acw_tc / acw_sc__v2)
    - 保留核心三件套 (UID, CID, SEID)
    - 精简 Headers，去除触发 WAF 阻断的 Origin / X-Requested-With
    """

    SNAP_URL = "https://webapi.115.com/share/snap"

    def __init__(
        self,
        user_agent: Optional[str] = None,
        cookie: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        self.user_agent = user_agent or settings.CRAWLER_USER_AGENT
        self.cookie = cookie or settings.CRAWLER_COOKIE
        self.timeout = timeout or settings.CRAWLER_TIMEOUT

    def _sanitize_cookie(self, raw_cookie: str) -> str:
        """
        过滤并保留核心 115 鉴权项，彻底剔除过期的 WAF 防火墙跟踪 Cookie (如 acw_tc, acw_sc__v2)
        """
        if not raw_cookie:
            return ""
        
        # 允许传递的核心鉴权 Cookie 键
        allowed_keys = {
            "UID", "CID", "SEID", "KID", "USERSESSIONID", 
            "115_lang", "loginType", "PHPSESSID", "GST"
        }
        
        parts = [p.strip() for p in raw_cookie.split(";") if p.strip()]
        clean_parts = []
        for part in parts:
            if "=" in part:
                k, v = part.split("=", 1)
                k = k.strip()
                # 剔除阿里/腾讯 WAF 的临时跟踪标识
                if k.lower().startswith("acw_") or k.lower().startswith("waf_"):
                    continue
                clean_parts.append(f"{k}={v.strip()}")
            else:
                clean_parts.append(part)
        
        return "; ".join(clean_parts)

    def _get_headers(self, share_code: str = "", receive_code: str = "") -> Dict[str, str]:
        """
        100% 对齐 AList/OpenList 的纯净请求头 (决不添加触发 405 WAF 的 Origin 头)
        """
        referer = (
            f"https://115.com/s/{share_code}?password={receive_code}"
            if share_code
            else "https://115.com/"
        )
        headers = {
            "User-Agent": self.user_agent,
            "Referer": referer,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
            "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        }
        
        clean_cookie = self._sanitize_cookie(self.cookie)
        if clean_cookie:
            headers["Cookie"] = clean_cookie
            
        return headers

    async def _fetch_snap_page(
        self,
        client: httpx.AsyncClient,
        share_code: str,
        receive_code: str,
        cid: str,
        offset: int = 0,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """
        以 AList 规范的 GET 请求获取 115 目录快照
        """
        params = {
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

        while retries <= settings.CRAWLER_MAX_RETRIES:
            try:
                delay = random.uniform(settings.CRAWLER_RATE_MIN, settings.CRAWLER_RATE_MAX)
                await asyncio.sleep(delay)

                headers = self._get_headers(share_code, receive_code)
                response = await client.get(
                    self.SNAP_URL,
                    params=params,
                    headers=headers,
                    timeout=self.timeout,
                )

                # 如果返回 405 说明触发了 WAF 拦截或频控，等待后重试
                if response.status_code == 405:
                    logger.warning(
                        f"WAF 405 protection triggered for share_code={share_code}, cid={cid}. "
                        f"Backing off for {backoff:.1f}s (Attempt {retries + 1}/{settings.CRAWLER_MAX_RETRIES})"
                    )
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 1.8
                    continue

                if response.status_code != 200:
                    logger.warning(
                        f"HTTP {response.status_code} for share_code={share_code}, cid={cid}. "
                        f"Retrying in {backoff:.1f}s (Attempt {retries + 1}/{settings.CRAWLER_MAX_RETRIES})"
                    )
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 1.8
                    continue

                result = response.json()

                # 业务状态码判断
                if not result.get("state", False):
                    msg = str(result.get("msg") or result.get("error", "Unknown 115 error"))
                    error_code = result.get("errNo") or result.get("code")

                    if any(x in msg for x in ["已失效", "不存在", "取消", "提取码错误", "不存在或已删除"]):
                        raise ShareExpiredOrInvalidError(f"Share expired or password invalid: {msg}")
                    if any(x in msg for x in ["违规", "屏蔽", "封禁", "安全"]):
                        raise ShareBannedError(f"Share banned: {msg}")

                    logger.warning(f"115 state=false: msg='{msg}', code={error_code}. Retrying...")
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 1.8
                    continue

                return result

            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error on {self.SNAP_URL}: {exc}")
                retries += 1
                await asyncio.sleep(backoff)
                backoff *= 1.8

        raise ShareCrawlerError(
            f"Failed to fetch snap for share_code={share_code}, cid={cid} after {retries} retries"
        )

    async def crawl_and_index(
        self, db: AsyncSession, share_code: str, receive_code: str = ""
    ) -> Share:
        logger.info(f"Starting High-Performance BFS crawl for 115 share: {share_code}")

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

        dir_queue: asyncio.Queue[Tuple[str, str]] = asyncio.Queue()
        await dir_queue.put(("0", "/"))

        db_write_queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue(maxsize=5000)

        visited_cids: Set[str] = set()
        visited_lock = asyncio.Lock()

        extracted_meta = {"title": None}
        stats = {"files": 0, "folders": 0, "bytes": 0}
        stats_lock = asyncio.Lock()

        http_limits = httpx.Limits(
            max_keepalive_connections=30, max_connections=50, keepalive_expiry=30.0
        )

        async with httpx.AsyncClient(limits=http_limits, verify=True, follow_redirects=True) as client:

            async def db_writer():
                buffer: List[Dict[str, Any]] = []
                while True:
                    item = await db_write_queue.get()
                    if item is None:
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

            async def dir_worker(worker_id: int):
                while True:
                    try:
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
                        page_size = settings.CRAWLER_PAGE_SIZE

                        while True:
                            snap_data = await self._fetch_snap_page(
                                client=client,
                                share_code=share_code,
                                receive_code=effective_pwd,
                                cid=current_cid,
                                offset=offset,
                                limit=page_size,
                            )

                            data_payload = snap_data.get("data", {})

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

                                normalized_path = posixpath.normpath(
                                    posixpath.join(current_virtual_path, item_name)
                                )

                                if is_directory:
                                    extension = ""
                                    local_folders += 1
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
                                await db_write_queue.put(file_record)

                            async with stats_lock:
                                stats["files"] += local_files
                                stats["folders"] += local_folders
                                stats["bytes"] += local_bytes

                            offset += len(item_list)
                            if offset >= total_in_dir or not item_list:
                                break

                    except Exception as exc:
                        logger.error(f"[Worker-{worker_id}] Error traversing cid={current_cid}: {exc}")
                        raise
                    finally:
                        dir_queue.task_done()

            try:
                workers = [
                    asyncio.create_task(dir_worker(i))
                    for i in range(settings.CRAWLER_CONCURRENCY)
                ]

                await dir_queue.join()
                await asyncio.gather(*workers, return_exceptions=True)

                await db_write_queue.put(None)
                await db_write_queue.join()
                await db_writer_task

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
            },
        )
        await db.execute(upsert_stmt)
        await db.commit()
