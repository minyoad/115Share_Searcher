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
from app.proxy import ProxyManager

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


class GlobalPacer:
    """
    协程安全全局请求速率与 WAF 熔断同步器
    1. 确保多个并行协程在请求 115 API 时，单次请求之间保持严格的最小间隔 (0.4s - 0.85s)，
       彻底消除同一毫秒内的突发并发 (Burst QPS) 触发 115 WAF 405 拦截。
    2. 当任一 worker 遭遇 405 时，触发全局冷却 (3.0s~5.0s)，让所有 worker 暂停发起新请求，
       使 115 服务端 WAF 频率计数器平稳清零。
    """
    def __init__(self, min_delay: float = 0.40, max_delay: float = 0.85):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self._lock = asyncio.Lock()
        self._last_call_time = 0.0
        self._cooldown_until = 0.0

    async def acquire(self):
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()

            # 若处于 405 WAF 熔断冷却期，等待冷却窗口结束
            if now < self._cooldown_until:
                wait_sec = self._cooldown_until - now
                logger.info(f"[WAF Pacer] Pausing for {wait_sec:.2f}s to clear 115 WAF 405 cooldown window...")
                await asyncio.sleep(wait_sec)
                now = loop.time()

            elapsed = now - self._last_call_time
            target_delay = random.uniform(self.min_delay, self.max_delay)
            if elapsed < target_delay:
                await asyncio.sleep(target_delay - elapsed)

            self._last_call_time = loop.time()

    async def trigger_cooldown(self, seconds: float = 3.0):
        """触发全局 WAF 405 冷却阻断"""
        async with self._lock:
            loop = asyncio.get_running_loop()
            self._cooldown_until = max(self._cooldown_until, loop.time() + seconds)


class HttpClientPool:
    """
    自适应 HTTP 客户端连接池管理 (支持直连与多代理节点复用)
    """
    def __init__(self, limits: httpx.Limits, timeout: float):
        self.limits = limits
        self.timeout = timeout
        self._clients: Dict[Optional[str], httpx.AsyncClient] = {}
        self._lock = asyncio.Lock()

    async def get_client(self, proxy_url: Optional[str] = None) -> httpx.AsyncClient:
        async with self._lock:
            key = proxy_url or "__DIRECT__"
            if key not in self._clients or self._clients[key].is_closed:
                client_kwargs: Dict[str, Any] = {
                    "limits": self.limits,
                    "timeout": self.timeout,
                    "verify": False,
                    "follow_redirects": True,
                }
                if proxy_url:
                    client_kwargs["proxy"] = proxy_url
                self._clients[key] = httpx.AsyncClient(**client_kwargs)
            return self._clients[key]

    async def close_all(self):
        async with self._lock:
            for client in self._clients.values():
                if not client.is_closed:
                    try:
                        await client.aclose()
                    except Exception:
                        pass
            self._clients.clear()


class Crawler115Engine:
    """
    115 分享快照递归爬虫引擎 (对齐 115 官方 Web 端 + AList / OpenList 底层驱动)
    - 默认采用 GET (115 官方 Web 端标准)，支持 GET <-> POST 自适应智能 Fallback
    - 严格通过全局 Pacer 调度器平滑 QPS，杜绝突发并发冲击
    - 遭遇 405 WAF 自动触发阶梯式指数退避、智能切换与代理池隔离
    - 自动清理 WAF 脏 Cookie (剔除易触发拦截的 acw_tc / acw_sc__v2)
    - 保留核心鉴权标识 (UID, CID, SEID)
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

    def _get_headers(
        self, share_code: str = "", receive_code: str = "", method: str = "GET"
    ) -> Dict[str, str]:
        """
        根据请求方法构造与 115 官方 Web 前端完全一致的请求头
        """
        if share_code:
            referer = f"https://115.com/s/{share_code}?password={receive_code}" if receive_code else f"https://115.com/s/{share_code}"
        else:
            referer = "https://115.com/"

        headers = {
            "User-Agent": self.user_agent,
            "Referer": referer,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
            "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="128", "Google Chrome";v="128"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        }

        if method.upper() == "POST":
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
            headers["Origin"] = "https://115.com"
            headers["X-Requested-With"] = "XMLHttpRequest"
        
        clean_cookie = self._sanitize_cookie(self.cookie)
        if clean_cookie:
            headers["Cookie"] = clean_cookie
            
        return headers

    async def _fetch_snap_page(
        self,
        http_pool: HttpClientPool,
        proxy_mgr: ProxyManager,
        pacer: GlobalPacer,
        share_code: str,
        receive_code: str,
        cid: str,
        offset: int = 0,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """
        以 115 Web 官方标准规范获取目录快照 (支持多代理池轮换、GET/POST 自适应与 405 WAF 智能隔离)
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
        backoff = settings.CRAWLER_BACKOFF_ON_405
        current_method = settings.CRAWLER_DEFAULT_METHOD.upper()
        force_rotate = False

        while retries <= settings.CRAWLER_MAX_RETRIES:
            current_proxy = None
            try:
                # 严格通过全局调度器，杜绝突发并发冲击
                await pacer.acquire()

                # 从代理管理器分配或轮换代理
                current_proxy = await proxy_mgr.get_proxy(force_rotate=force_rotate)
                client = await http_pool.get_client(current_proxy)
                force_rotate = False

                headers = self._get_headers(share_code, receive_code, method=current_method)
                t_start = asyncio.get_running_loop().time()

                logger.info(
                    f"[{current_method}] Fetching 115 snap for share_code={share_code}, cid={cid}, "
                    f"offset={offset}, limit={limit} (proxy: {current_proxy or 'DIRECT'})"
                )

                if current_method == "POST":
                    response = await client.post(
                        self.SNAP_URL,
                        data=params,
                        headers=headers,
                        timeout=self.timeout,
                    )
                else:
                    response = await client.get(
                        self.SNAP_URL,
                        params=params,
                        headers=headers,
                        timeout=self.timeout,
                    )

                # 405 WAF 防火墙 / 方法限制处理
                if response.status_code == 405:
                    logger.warning(
                        f"115 WAF 405 on {current_method} (proxy: {current_proxy or 'DIRECT'}) "
                        f"for share_code={share_code}, cid={cid}. Attempt {retries + 1}/{settings.CRAWLER_MAX_RETRIES}"
                    )
                    if current_proxy:
                        await proxy_mgr.mark_failure(current_proxy, is_405=True, reason="WAF 405 Blocked")
                        force_rotate = True

                    # 切换请求方法并退避
                    current_method = "POST" if current_method == "GET" else "GET"

                    if proxy_mgr.mode == "OFF":
                        await pacer.trigger_cooldown(backoff)
                        retries += 1
                        await asyncio.sleep(backoff)
                        backoff = min(backoff * 1.6, 10.0)
                    else:
                        retries += 1
                        await asyncio.sleep(0.3)
                    continue

                if response.status_code != 200:
                    logger.warning(
                        f"HTTP {response.status_code} for share_code={share_code}, cid={cid} (proxy: {current_proxy or 'DIRECT'}). "
                        f"Retrying (Attempt {retries + 1}/{settings.CRAWLER_MAX_RETRIES})"
                    )
                    if current_proxy:
                        await proxy_mgr.mark_failure(current_proxy, is_405=False, reason=f"HTTP {response.status_code}")
                        force_rotate = True

                    retries += 1
                    await asyncio.sleep(backoff if proxy_mgr.mode == "OFF" else 0.5)
                    backoff = min(backoff * 1.5, 8.0)
                    continue

                result = response.json()
                state = result.get("state", False)
                msg = str(result.get("msg") or result.get("error") or "")
                err_no = result.get("errNo") or result.get("code")

                # 业务状态码判断
                if not state:
                    logger.warning(
                        f"115 snap returned state=false for share_code={share_code}, cid={cid}: "
                        f"msg='{msg}', errNo={err_no}"
                    )

                    if any(x in msg for x in ["已失效", "不存在", "取消", "提取码错误", "不存在或已删除", "密码错误"]):
                        raise ShareExpiredOrInvalidError(f"Share expired or password invalid: {msg or 'Invalid share'}")
                    if any(x in msg for x in ["违规", "屏蔽", "封禁", "安全", "敏感"]):
                        raise ShareBannedError(f"Share banned or blocked: {msg or 'Banned share'}")

                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 1.5, 8.0)
                    continue

                data_payload = result.get("data", {})
                item_list = data_payload.get("list", [])
                count = data_payload.get("count", len(item_list))
                logger.info(
                    f"Successfully fetched 115 snap page for share={share_code}, cid={cid}, "
                    f"offset={offset}: found {len(item_list)} items (total in dir: {count})"
                )

                # 记录代理成功请求与延迟
                latency_ms = (asyncio.get_running_loop().time() - t_start) * 1000
                if current_proxy:
                    await proxy_mgr.mark_success(current_proxy, latency_ms)

                return result

            except (ShareExpiredOrInvalidError, ShareBannedError):
                raise

            except Exception as exc:
                logger.warning(
                    f"Request error fetching {self.SNAP_URL} for share={share_code}, cid={cid} "
                    f"via {current_proxy or 'DIRECT'}: {exc}"
                )
                if current_proxy:
                    await proxy_mgr.mark_failure(current_proxy, is_405=False, reason=str(exc)[:60])
                    force_rotate = True

                retries += 1
                await asyncio.sleep(backoff if proxy_mgr.mode == "OFF" else 0.3)
                backoff = min(backoff * 1.5, 8.0)

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
                last_crawled_at=datetime.now(timezone.utc),
            )
            db.add(share_obj)
            await db.flush()
        else:
            share_obj.status = ShareStatus.PENDING.value
            share_obj.last_crawled_at = datetime.now(timezone.utc)
            if receive_code and not share_obj.receive_code:
                share_obj.receive_code = receive_code
            await db.flush()

        effective_pwd = receive_code or share_obj.receive_code or ""

        dir_queue: asyncio.Queue[Optional[Tuple[str, str]]] = asyncio.Queue()
        await dir_queue.put(("0", "/"))

        db_write_queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue(maxsize=5000)

        visited_cids: Set[str] = set()
        visited_lock = asyncio.Lock()

        extracted_meta = {"title": None}
        stats = {"files": 0, "folders": 0, "bytes": 0}
        stats_lock = asyncio.Lock()
        fatal_error: List[Optional[Exception]] = [None]
        stop_event = asyncio.Event()

        # 全局限速与熔断器
        pacer = GlobalPacer(
            min_delay=settings.CRAWLER_RATE_MIN,
            max_delay=settings.CRAWLER_RATE_MAX
        )

        proxy_mgr = ProxyManager.get_instance()
        await proxy_mgr.sync_from_storage()
        await proxy_mgr.initialize()

        http_limits = httpx.Limits(
            max_keepalive_connections=50, max_connections=100, keepalive_expiry=30.0
        )
        http_pool = HttpClientPool(limits=http_limits, timeout=self.timeout)

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
            while not stop_event.is_set():
                try:
                    item = await dir_queue.get()
                except asyncio.CancelledError:
                    break

                if item is None:
                    dir_queue.task_done()
                    break

                if fatal_error[0] is not None or stop_event.is_set():
                    dir_queue.task_done()
                    break

                current_cid, current_virtual_path = item

                async with visited_lock:
                    if current_cid in visited_cids:
                        dir_queue.task_done()
                        continue
                    visited_cids.add(current_cid)

                try:
                    offset = 0
                    page_size = settings.CRAWLER_PAGE_SIZE

                    while not stop_event.is_set():
                        snap_data = await self._fetch_snap_page(
                            http_pool=http_pool,
                            proxy_mgr=proxy_mgr,
                            pacer=pacer,
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
                    logger.error(f"[Worker-{worker_id}] Error traversing share_code={share_code}, cid={current_cid}: {exc}")
                    fatal_error[0] = exc
                    stop_event.set()
                    raise
                finally:
                    dir_queue.task_done()

        concurrency = max(1, settings.CRAWLER_CONCURRENCY)
        workers = [
            asyncio.create_task(dir_worker(i))
            for i in range(concurrency)
        ]

        try:
            # 等待所有已加入队列的目录任务处理完成（或者遇到致命错误提前退出）
            queue_join_task = asyncio.create_task(dir_queue.join())
            
            while not queue_join_task.done():
                if fatal_error[0] is not None:
                    # 某个 worker 报错，快速取消其他 worker
                    stop_event.set()
                    queue_join_task.cancel()
                    break
                await asyncio.sleep(0.1)

            # 向所有 worker 发送退出哨兵
            for _ in range(concurrency):
                await dir_queue.put(None)

            worker_results = await asyncio.gather(*workers, return_exceptions=True)

            # 如果记录了致命错误，优先抛出
            if fatal_error[0] is not None:
                raise fatal_error[0]

            for res in worker_results:
                if isinstance(res, Exception) and not isinstance(res, asyncio.CancelledError):
                    raise res

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
            share_obj.last_crawled_at = datetime.now(timezone.utc)
            await db.commit()
            raise

        except ShareBannedError as err:
            logger.error(f"Marking share {share_code} as BANNED: {err}")
            share_obj.status = ShareStatus.BANNED.value
            share_obj.last_crawled_at = datetime.now(timezone.utc)
            await db.commit()
            raise

        except Exception as exc:
            logger.exception(f"Unexpected error crawling {share_code}: {exc}")
            await db.rollback()
            raise ShareCrawlerError(f"Crawl failed: {exc}") from exc

        finally:
            stop_event.set()
            for w in workers:
                if not w.done():
                    w.cancel()
            if db_writer_task and not db_writer_task.done():
                db_writer_task.cancel()
            await http_pool.close_all()

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

