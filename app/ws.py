import asyncio
from datetime import date, datetime
from decimal import Decimal
import json
import logging
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import File, Share, ShareStatus
from app.schemas import ShareInfo, format_size

logger = logging.getLogger("app.ws")


def safe_json_default(obj: Any) -> Any:
    """
    通用安全 JSON 序列化器：
    自动处理 Decimal (PostgreSQL sum/numeric 聚合)、datetime、Pydantic 模型等非标准 JSON 类型，
    彻底杜绝 'Object of type Decimal is not JSON serializable' 导致的 WebSocket 异常断开。
    """
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if hasattr(obj, "dict"):
        return obj.dict()
    return str(obj)


class TaskWebSocketManager:
    """
    WebSocket 连接管理器，专为 115 分享任务与爬虫监控设计。
    提供：
    1. 连接生命周期管理与心跳保活
    2. 基于客户端订阅条件 (页码、状态筛选) 的精准实时推送
    3. 全局爬虫任务事件广播 (入队、开始、完成、恢复、失效)
    4. 活跃任务自动感应巡检推送 (有任务时主动推，无任务时休眠，彻底告别前端轮询)
    5. Redis Pub/Sub 跨进程多节点广播解耦
    6. 连接池保护机制：单 SQL 聚合统计、2秒全局统计内存缓存、同过滤条件批量复用、并发广播单例排它锁与平滑防抖
    """

    _instance: Optional["TaskWebSocketManager"] = None

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.subscriptions: Dict[WebSocket, Dict[str, Any]] = {}
        self.locks: Dict[WebSocket, asyncio.Lock] = {}
        self._redis_client: Optional[aioredis.Redis] = None
        self._last_pending_count: Optional[int] = None

        # 数据库连接池与高并发广播保护属性
        self._broadcast_lock: asyncio.Lock = asyncio.Lock()
        self._last_broadcast_time: float = 0.0
        self._broadcast_debounce_task: Optional[asyncio.Task] = None
        self._cached_stats: Optional[Dict[str, Any]] = None
        self._cached_stats_time: float = 0.0

    @classmethod
    def get_instance(cls) -> "TaskWebSocketManager":
        if cls._instance is None:
            cls._instance = TaskWebSocketManager()
        return cls._instance

    async def _get_redis(self) -> Optional[aioredis.Redis]:
        if self._redis_client is None:
            try:
                self._redis_client = aioredis.from_url(
                    settings.REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=2.0,
                )
            except Exception as exc:
                logger.warning(f"[WS-Manager] Redis connection unavailable: {exc}")
                self._redis_client = None
        return self._redis_client

    async def connect(self, websocket: WebSocket) -> None:
        """接受新的 WebSocket 客户端连接并注册默认订阅"""
        await websocket.accept()
        self.active_connections.add(websocket)
        self.locks[websocket] = asyncio.Lock()
        self.subscriptions[websocket] = {
            "page": 1,
            "page_size": 20,
            "status": None,
            "keyword": None,
        }
        logger.info(f"[WS-Manager] Client connected. Total active clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket) -> None:
        """移除断开的 WebSocket 连接并释放资源"""
        self.active_connections.discard(websocket)
        self.subscriptions.pop(websocket, None)
        self.locks.pop(websocket, None)
        logger.info(f"[WS-Manager] Client disconnected. Total active clients: {len(self.active_connections)}")

    def update_subscription(self, websocket: WebSocket, params: Dict[str, Any]) -> None:
        """更新客户端在任务列表中的分页与过滤订阅状态"""
        if websocket not in self.subscriptions:
            self.subscriptions[websocket] = {}

        sub = self.subscriptions[websocket]
        if "page" in params and params["page"] is not None:
            sub["page"] = max(1, int(params["page"]))
        if "page_size" in params and params["page_size"] is not None:
            sub["page_size"] = min(2000, max(1, int(params["page_size"])))
        if "status" in params:
            sub["status"] = params["status"]
        if "keyword" in params:
            sub["keyword"] = params["keyword"]

    async def safe_send_json(self, websocket: WebSocket, message: Dict[str, Any]) -> bool:
        """
        线程/协程安全的 JSON 发送器：
        1. 使用 safe_json_default 彻底解决 Decimal (PostgreSQL sum/numeric 聚合)、datetime 序列化问题
        2. 使用 per-websocket asyncio.Lock 避免并发写竞争导致的 ASGI 协议冲突断开
        3. 异常自动捕获并从连接池清理失效连接
        """
        if websocket not in self.active_connections:
            return False

        lock = self.locks.get(websocket)
        if lock is None:
            lock = asyncio.Lock()
            self.locks[websocket] = lock

        try:
            # 采用自定义序列化器将字典安全序列化为 JSON 字符串发送
            payload_text = json.dumps(message, default=safe_json_default, ensure_ascii=False)
            async with lock:
                await websocket.send_text(payload_text)
            return True
        except Exception as exc:
            logger.warning(f"[WS-Manager] safe_send_json error (will disconnect): {exc}")
            self.disconnect(websocket)
            return False

    async def send_json(self, websocket: WebSocket, message: Dict[str, Any]) -> bool:
        """向指定客户端发送 JSON 消息 (兼容保留)"""
        return await self.safe_send_json(websocket, message)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """向所有连接的客户端安全广播消息"""
        if not self.active_connections:
            return

        for ws in list(self.active_connections):
            await self.safe_send_json(ws, message)

    async def get_global_stats(self, db: Optional[AsyncSession] = None, max_age: float = 2.5) -> Dict[str, Any]:
        """
        获取系统全局分享与文件统计指标。
        单条聚合 SQL 替代原本 7 次往返全表扫描，并在内存中短时间 (默认 2.5s) 缓存复用，
        在高频 WebSocket 广播与 API 列表拉取时彻底杜绝数据库连接池耗尽。
        """
        now = time.time()
        if self._cached_stats is not None and (now - self._cached_stats_time) < max_age:
            return self._cached_stats

        async def _run_stats_query(session: AsyncSession) -> Dict[str, Any]:
            stats_stmt = select(
                func.count(Share.id),
                func.count(Share.id).filter(Share.status == ShareStatus.ACTIVE.value),
                func.count(Share.id).filter(Share.status == ShareStatus.PENDING.value),
                func.count(Share.id).filter(Share.status == ShareStatus.EXPIRED.value),
                func.count(Share.id).filter(Share.status == ShareStatus.BANNED.value),
                func.coalesce(func.sum(Share.file_count), 0),
                func.coalesce(func.sum(Share.total_size), 0),
            )
            res = (await session.execute(stats_stmt)).first()
            if not res:
                return {
                    "total_shares": 0, "active_shares": 0, "pending_shares": 0,
                    "expired_shares": 0, "banned_shares": 0, "total_files": 0,
                    "total_size": 0, "total_size_formatted": "0 B"
                }

            t_shares = int(res[0] or 0)
            a_shares = int(res[1] or 0)
            p_shares = int(res[2] or 0)
            e_shares = int(res[3] or 0)
            b_shares = int(res[4] or 0)
            t_files = int(res[5] or 0)
            t_size = int(res[6] or 0)

            return {
                "total_shares": t_shares,
                "active_shares": a_shares,
                "pending_shares": p_shares,
                "expired_shares": e_shares,
                "banned_shares": b_shares,
                "total_files": t_files,
                "total_size": t_size,
                "total_size_formatted": format_size(t_size),
            }

        if db is not None:
            stats = await _run_stats_query(db)
        else:
            async with AsyncSessionLocal() as session:
                stats = await _run_stats_query(session)

        self._cached_stats = stats
        self._cached_stats_time = now
        return stats

    async def fetch_shares_snapshot(
        self,
        page: int = 1,
        page_size: int = 20,
        status_filter: Optional[int] = None,
        keyword: Optional[str] = None,
        db: Optional[AsyncSession] = None,
        stats_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        从数据库查询当前指定筛选条件下的分享列表快照与全局统计信息。
        支持复用外部传入的 db 会话与已计算好的 stats_payload，杜绝重复申请连接与聚合运算。
        """
        async def _query_with_session(session: AsyncSession) -> Dict[str, Any]:
            nonlocal stats_payload
            conditions = []
            if keyword and str(keyword).strip():
                kw = str(keyword).strip()
                conditions.append((Share.share_code.ilike(f"%{kw}%")) | (Share.title.ilike(f"%{kw}%")))
            if status_filter is not None and str(status_filter).strip() != "":
                try:
                    conditions.append(Share.status == int(status_filter))
                except (ValueError, TypeError):
                    pass

            # 1. 全局统计
            if stats_payload is None:
                stats_payload = await self.get_global_stats(db=session)

            # 2. 当前筛选结果总数与分页数据
            count_stmt = select(func.count(Share.id))
            if conditions:
                count_stmt = count_stmt.where(*conditions)
            filtered_total = int((await session.execute(count_stmt)).scalar() or 0)

            offset = (page - 1) * page_size
            data_stmt = (
                select(Share)
                .order_by(Share.id.desc())
                .offset(offset)
                .limit(page_size)
            )
            if conditions:
                data_stmt = data_stmt.where(*conditions)

            try:
                share_rows = (await session.execute(data_stmt)).scalars().all()
            except Exception as q_exc:
                logger.warning(f"[WS-Manager] fetch_shares_snapshot query failed ({q_exc}), running schema compatibility migration...")
                from app.database import ensure_database_schema_compatibility
                await ensure_database_schema_compatibility()
                share_rows = (await session.execute(data_stmt)).scalars().all()

            # 自动提取根目录作为任务标题，消除雷同标题
            needs_patch_ids = [
                row.id for row in share_rows
                if (not getattr(row, "title", None) or str(row.title).strip().startswith("115 分享 (") or str(row.title).strip() == "115 分享")
                and (getattr(row, "file_count", 0) > 0 or getattr(row, "folder_count", 0) > 0)
            ]
            root_map: Dict[int, str] = {}
            if needs_patch_ids:
                try:
                    stmt1 = (
                        select(File.share_id, File.name)
                        .distinct(File.share_id)
                        .where(File.share_id.in_(needs_patch_ids), File.parent_115_id == "0")
                        .order_by(File.share_id, File.is_dir.desc(), File.id.asc())
                    )
                    for sid, name in (await session.execute(stmt1)).all():
                        if name and str(name).strip():
                            root_map[sid] = str(name).strip()

                    unresolved = [sid for sid in needs_patch_ids if sid not in root_map]
                    if unresolved:
                        stmt2 = (
                            select(File.share_id, File.name)
                            .distinct(File.share_id)
                            .where(File.share_id.in_(unresolved))
                            .order_by(File.share_id, File.is_dir.desc(), File.id.asc())
                        )
                        for sid, name in (await session.execute(stmt2)).all():
                            if name and str(name).strip():
                                root_map[sid] = str(name).strip()
                except Exception as map_err:
                    logger.debug(f"[WS-Manager] Error resolving root title map: {map_err}")

            items = []
            for row in share_rows:
                try:
                    effective_title = (
                        root_map.get(row.id)
                        or getattr(row, "title", "")
                        or f"115 分享 ({row.share_code})"
                    )
                    items.append(
                        ShareInfo(
                            id=int(row.id),
                            share_code=row.share_code or "",
                            receive_code=getattr(row, "receive_code", "") or "",
                            title=effective_title,
                            file_count=int(getattr(row, "file_count", 0) or 0),
                            folder_count=int(getattr(row, "folder_count", 0) or 0),
                            total_size=int(getattr(row, "total_size", 0) or 0),
                            status=int(getattr(row, "status", 0)) if getattr(row, "status", None) is not None else 0,
                            last_crawled_at=getattr(row, "last_crawled_at", None),
                            created_at=getattr(row, "created_at", None),
                        ).model_dump(mode="json")
                    )
                except Exception as row_exc:
                    logger.warning(f"[WS-Manager] Error serializing share row {getattr(row, 'id', None)}: {row_exc}")

            total_pages = (filtered_total + page_size - 1) // page_size if page_size > 0 else 1

            return {
                "items": items,
                "total": filtered_total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "stats": stats_payload,
            }

        if db is not None:
            return await _query_with_session(db)
        else:
            async with AsyncSessionLocal() as session:
                return await _query_with_session(session)

    async def broadcast_full_update(self) -> None:
        """
        向每一个活跃连接的客户端分别推送其当前所在页面与状态筛选的数据快照。
        具备单例排它互斥锁、单会话全流程复用、单 SQL 聚合统计、同过滤条件去重缓存，
        彻底杜绝数据库连接池耗尽！
        """
        if not self.active_connections:
            return

        if self._broadcast_lock.locked():
            # 已有全量广播在执行中，由排队任务或防抖机制兜底，直接返回
            return

        async with self._broadcast_lock:
            self._last_broadcast_time = time.time()
            try:
                # 开启单个数据库会话处理本轮所有客户端推送，避免多次 checkout 争抢连接
                async with AsyncSessionLocal() as db:
                    # 1. 预先计算一次全局统计（单 SQL 聚合）
                    stats_payload = await self.get_global_stats(db=db)

                    # 2. 对所有在线客户端的筛选条件做去重分组
                    # 多个用户查看相同页码/状态时只向数据库查询 1 次
                    unique_snapshots: Dict[Tuple[int, int, Optional[int], Optional[str]], Dict[str, Any]] = {}
                    client_tasks = []

                    for ws in list(self.active_connections):
                        sub = self.subscriptions.get(ws, {})
                        p = sub.get("page", 1)
                        ps = sub.get("page_size", 20)
                        st = sub.get("status", None)
                        kw = sub.get("keyword", None)
                        query_key = (p, ps, st, kw)

                        if query_key not in unique_snapshots:
                            unique_snapshots[query_key] = await self.fetch_shares_snapshot(
                                page=p,
                                page_size=ps,
                                status_filter=st,
                                keyword=kw,
                                db=db,
                                stats_payload=stats_payload,
                            )

                        snapshot = unique_snapshots[query_key]
                        client_tasks.append(
                            self.safe_send_json(ws, {
                                "type": "shares_data",
                                "data": snapshot,
                            })
                        )

                    if client_tasks:
                        await asyncio.gather(*client_tasks, return_exceptions=True)

            except Exception as broadcast_err:
                logger.warning(f"[WS-Manager] Error in broadcast_full_update: {broadcast_err}")

    def schedule_debounced_broadcast(self, delay: float = 0.8) -> None:
        """
        防抖平滑触发全量广播：将高频涌入的多个任务状态事件合并在指定时间窗口内执行一次，
        杜绝爬虫瞬时写入产生的高频广播轰炸连接池。
        """
        if self._broadcast_debounce_task and not self._broadcast_debounce_task.done():
            return

        async def _debounced_runner():
            try:
                await asyncio.sleep(delay)
                await self.broadcast_full_update()
            except Exception as e:
                logger.debug(f"[WS-Manager] Debounced broadcast error: {e}")

        self._broadcast_debounce_task = asyncio.create_task(_debounced_runner())

    async def notify_task_event(self, event_type: str, data: Optional[Dict[str, Any]] = None) -> None:
        """
        发布任务变更事件（本地广播 + Redis PubSub 发布）
        """
        payload = {
            "type": "task_event",
            "event": event_type,
            "data": data or {},
        }

        # 1. 本地广播轻量事件通知
        await self.broadcast(payload)
        # 2. 防抖平滑调度列表快照更新，避免并发阻塞
        self.schedule_debounced_broadcast(delay=0.8)

        # 3. Redis PubSub 发布
        try:
            r = await self._get_redis()
            if r:
                await r.publish(
                    settings.WS_CHANNEL_NAME,
                    json.dumps({"event_type": event_type, "data": data or {}})
                )
        except Exception as exc:
            logger.debug(f"[WS-Manager] Failed to publish event to Redis: {exc}")

    async def start_redis_listener(self, stop_event: asyncio.Event) -> None:
        """
        后台协程：监听 Redis 频道接收来自其他 Worker 或 API 实例的任务进度广播
        """
        logger.info(f"[WS-Manager] Starting Redis Pub/Sub listener on channel: {settings.WS_CHANNEL_NAME}")
        while not stop_event.is_set():
            pubsub = None
            try:
                r = await self._get_redis()
                if not r:
                    await asyncio.sleep(3)
                    continue

                pubsub = r.pubsub()
                await pubsub.subscribe(settings.WS_CHANNEL_NAME)

                while not stop_event.is_set():
                    msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if msg and msg.get("type") == "message":
                        raw_data = msg.get("data")
                        if raw_data:
                            try:
                                parsed = json.loads(raw_data)
                                event_type = parsed.get("event_type", "task_updated")
                                data = parsed.get("data", {})
                                await self.broadcast({
                                    "type": "task_event",
                                    "event": event_type,
                                    "data": data,
                                })
                                self.schedule_debounced_broadcast(delay=1.0)
                            except Exception as parse_err:
                                logger.warning(f"[WS-Manager] Failed to parse pubsub message: {parse_err}")

                    await asyncio.sleep(0.1)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning(f"[WS-Manager] Redis listener loop error: {exc}. Retrying in 3s...")
                await asyncio.sleep(3)
            finally:
                if pubsub:
                    try:
                        await pubsub.unsubscribe(settings.WS_CHANNEL_NAME)
                        await pubsub.close()
                    except Exception:
                        pass

    async def start_active_monitor_loop(self, stop_event: asyncio.Event) -> None:
        """
        后台看门狗监控协程：
        只有当有客户端在线且系统中存在 PENDING 状态任务时，才每隔 3 秒主动广播最新进度；
        任务全部完成时，推送一次完成事件后进入休眠，彻底杜绝前端定时对 `/api/v1/shares` 的轮询！
        """
        logger.info("[WS-Manager] Starting active task monitor loop...")
        while not stop_event.is_set():
            try:
                if not self.active_connections:
                    # 没有客户端在线，休眠 3 秒
                    await asyncio.sleep(3)
                    continue

                # 查询当前是否有抓取中的任务 (status=0)
                async with AsyncSessionLocal() as db:
                    pending_count = (
                        await db.execute(
                            select(func.count(Share.id)).where(Share.status == ShareStatus.PENDING.value)
                        )
                    ).scalar() or 0

                if pending_count > 0:
                    # 系统中有任务在抓取，主动推送当前进度到所有客户端
                    await self.broadcast_full_update()
                    self._last_pending_count = pending_count
                    await asyncio.sleep(3.0)
                else:
                    # 如果之前有任务，现在变成了 0，推送最后一次完成通知
                    if self._last_pending_count and self._last_pending_count > 0:
                        logger.info("[WS-Manager] All pending crawl tasks completed. Broadcasting final state.")
                        await self.broadcast_full_update()
                        await self.broadcast({
                            "type": "task_event",
                            "event": "all_tasks_completed",
                            "data": {"message": "所有后台抓取任务已全部完成！"}
                        })
                        self._last_pending_count = 0

                    # 无任务运行，休眠 4 秒
                    await asyncio.sleep(4)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"[WS-Manager] Error in active monitor loop: {exc}", exc_info=True)
                await asyncio.sleep(3)

        logger.info("[WS-Manager] Active task monitor loop stopped.")
