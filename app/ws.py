import asyncio
import json
import logging
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis
from sqlalchemy import func, select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Share, ShareStatus
from app.schemas import ShareInfo, format_size

logger = logging.getLogger("app.ws")


class TaskWebSocketManager:
    """
    WebSocket 连接管理器，专为 115 分享任务与爬虫监控设计。
    提供：
    1. 连接生命周期管理与心跳保活
    2. 基于客户端订阅条件 (页码、状态筛选) 的精准实时推送
    3. 全局爬虫任务事件广播 (入队、开始、完成、恢复、失效)
    4. 活跃任务自动感应巡检推送 (有任务时主动推，无任务时休眠，彻底告别前端轮询)
    5. Redis Pub/Sub 跨进程多节点广播解耦
    """

    _instance: Optional["TaskWebSocketManager"] = None

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.subscriptions: Dict[WebSocket, Dict[str, Any]] = {}
        self.locks: Dict[WebSocket, asyncio.Lock] = {}
        self._redis_client: Optional[aioredis.Redis] = None
        self._last_pending_count: Optional[int] = None

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
            sub["page_size"] = min(100, max(1, int(params["page_size"])))
        if "status" in params:
            sub["status"] = params["status"]
        if "keyword" in params:
            sub["keyword"] = params["keyword"]

    async def safe_send_json(self, websocket: WebSocket, message: Dict[str, Any]) -> bool:
        """
        线程/协程安全的 JSON 发送器：
        1. 使用 per-websocket asyncio.Lock 避免并发写竞争导致的 ASGI 协议冲突断开
        2. 异常自动捕获并从连接池清理失效连接
        """
        if websocket not in self.active_connections:
            return False

        lock = self.locks.get(websocket)
        if lock is None:
            lock = asyncio.Lock()
            self.locks[websocket] = lock

        try:
            async with lock:
                await websocket.send_json(message)
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

    async def fetch_shares_snapshot(
        self,
        page: int = 1,
        page_size: int = 20,
        status_filter: Optional[int] = None,
        keyword: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        从数据库查询当前指定筛选条件下的分享列表快照与全局统计信息
        具备全字段防 None 空指针容错保护与异常安全
        """
        async with AsyncSessionLocal() as db:
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
            total_shares = (await db.execute(select(func.count(Share.id)))).scalar() or 0
            active_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.ACTIVE.value))).scalar() or 0
            pending_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.PENDING.value))).scalar() or 0
            expired_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.EXPIRED.value))).scalar() or 0
            banned_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.BANNED.value))).scalar() or 0

            total_files = (await db.execute(select(func.coalesce(func.sum(Share.file_count), 0)))).scalar() or 0
            total_size = (await db.execute(select(func.coalesce(func.sum(Share.total_size), 0)))).scalar() or 0

            stats_payload = {
                "total_shares": total_shares,
                "active_shares": active_shares,
                "pending_shares": pending_shares,
                "expired_shares": expired_shares,
                "banned_shares": banned_shares,
                "total_files": total_files,
                "total_size": total_size,
                "total_size_formatted": format_size(total_size),
            }

            # 2. 当前筛选结果总数与分页
            count_stmt = select(func.count(Share.id))
            if conditions:
                count_stmt = count_stmt.where(*conditions)
            filtered_total = (await db.execute(count_stmt)).scalar() or 0

            offset = (page - 1) * page_size
            data_stmt = (
                select(Share)
                .order_by(Share.id.desc())
                .offset(offset)
                .limit(page_size)
            )
            if conditions:
                data_stmt = data_stmt.where(*conditions)

            share_rows = (await db.execute(data_stmt)).scalars().all()
            items = []
            for row in share_rows:
                try:
                    items.append(
                        ShareInfo(
                            id=row.id,
                            share_code=row.share_code or "",
                            receive_code=row.receive_code or "",
                            title=row.title or "",
                            file_count=row.file_count or 0,
                            folder_count=row.folder_count or 0,
                            total_size=row.total_size or 0,
                            status=row.status if row.status is not None else 0,
                            last_crawled_at=row.last_crawled_at,
                            created_at=row.created_at,
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

    async def broadcast_full_update(self) -> None:
        """
        向每一个活跃连接的客户端分别推送其当前所在页面与状态筛选的数据快照，
        完全替代前端定时 HTTP 轮询！
        """
        if not self.active_connections:
            return

        # 获取全局统计
        async with AsyncSessionLocal() as db:
            total_shares = (await db.execute(select(func.count(Share.id)))).scalar() or 0
            active_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.ACTIVE.value))).scalar() or 0
            pending_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.PENDING.value))).scalar() or 0
            expired_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.EXPIRED.value))).scalar() or 0
            banned_shares = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.BANNED.value))).scalar() or 0
            total_files = (await db.execute(select(func.coalesce(func.sum(Share.file_count), 0)))).scalar() or 0
            total_size = (await db.execute(select(func.coalesce(func.sum(Share.total_size), 0)))).scalar() or 0

            stats_payload = {
                "total_shares": total_shares,
                "active_shares": active_shares,
                "pending_shares": pending_shares,
                "expired_shares": expired_shares,
                "banned_shares": banned_shares,
                "total_files": total_files,
                "total_size": total_size,
                "total_size_formatted": format_size(total_size),
            }

        # 针对每个客户端的特定过滤条件生成数据并推送
        for ws in list(self.active_connections):
            sub = self.subscriptions.get(ws, {})
            p = sub.get("page", 1)
            ps = sub.get("page_size", 20)
            st = sub.get("status", None)
            kw = sub.get("keyword", None)

            try:
                snapshot = await self.fetch_shares_snapshot(
                    page=p, page_size=ps, status_filter=st, keyword=kw
                )
                # 覆盖最新全局 stats
                snapshot["stats"] = stats_payload

                await self.safe_send_json(ws, {
                    "type": "shares_data",
                    "data": snapshot,
                })
            except Exception as broadcast_err:
                logger.warning(f"[WS-Manager] Error preparing update for client: {broadcast_err}")
                self.disconnect(ws)

    async def notify_task_event(self, event_type: str, data: Optional[Dict[str, Any]] = None) -> None:
        """
        发布任务变更事件（本地广播 + Redis PubSub 发布）
        """
        payload = {
            "type": "task_event",
            "event": event_type,
            "data": data or {},
        }

        # 1. 本地广播
        await self.broadcast(payload)
        # 触发一次最新的列表与统计数据推送到每个连接
        await self.broadcast_full_update()

        # 2. Redis PubSub 发布
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
                                await self.broadcast_full_update()
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
        只有当有客户端连接且系统中存在 PENDING 状态任务时，才每隔 1.5 秒主动广播最新进度；
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
                    await asyncio.sleep(1.5)
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
