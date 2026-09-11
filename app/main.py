import asyncio
import json
import logging
import math
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    DEFAULT_INITIAL_PASSWORD,
    is_admin_initialized,
    set_admin_password,
    verify_admin_token,
)
from app.config import settings
from app.database import AsyncSessionLocal, get_db, init_db
from app.models import File, Share, ShareStatus
from app.proxy import ProxyManager
from app.schemas import (
    AdminChangePasswordRequest,
    AdminInitPasswordRequest,
    AdminStatusResponse,
    AdminVerifyRequest,
    AdminVerifyResponse,
    BatchCrawlRequest,
    BatchCrawlResponse,
    BatchDeleteSharesRequest,
    BatchDeleteSharesResponse,
    BatchImportRequest,
    BatchImportTaskResult,
    DeleteShareResponse,
    DirectoryListResponse,
    ExportSharesRequest,
    ExportSharesResponse,
    FileTreeNode,
    ProxyConfigUpdateRequest,
    ProxyTestRequest,
    ReportShareRequest,
    ReportShareResponse,
    SearchResponse,
    SearchResultItem,
    ShareInfo,
    ShareListResponse,
    SystemSettingsGroupResponse,
    SystemSettingsResetRequest,
    SystemSettingsUpdateRequest,
    TriggerCrawlResponse,
    format_size,
)
from app.settings_manager import DatabaseSettingsManager, load_and_sync_all_settings
from app.worker import enqueue_crawl_task
from app.ws import TaskWebSocketManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s"
)
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for DB schema init, Dynamic Settings, Proxy subsystem, and WebSocket task workers"""
    logger.info("Application starting up... Initializing DB...")
    await init_db()

    # 1. 从 PostgreSQL 数据库持久化载入并同步所有系统配置项（免 .env 部署核心机制）
    try:
        async with AsyncSessionLocal() as session:
            await load_and_sync_all_settings(session)
        logger.info("Dynamic system settings loaded from PostgreSQL successfully.")
    except Exception as set_err:
        logger.warning(f"Failed to load dynamic settings from DB: {set_err}", exc_info=True)

    # 2. 初始化代理子系统
    proxy_mgr = ProxyManager.get_instance()
    await proxy_mgr.sync_from_storage()
    await proxy_mgr.initialize()

    # 3. 初始化 WebSocket 管理器后台订阅
    stop_event = asyncio.Event()
    ws_manager = TaskWebSocketManager.get_instance()
    redis_listener_task = asyncio.create_task(ws_manager.start_redis_listener(stop_event))
    active_monitor_task = asyncio.create_task(ws_manager.start_active_monitor_loop(stop_event))

    yield

    logger.info("Application shutting down... Cleaning up background tasks...")
    stop_event.set()
    redis_listener_task.cancel()
    active_monitor_task.cancel()
    await asyncio.gather(redis_listener_task, active_monitor_task, return_exceptions=True)
    logger.info("WebSocket and background workers shut down cleanly.")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="115 网盘分享资源递归爬取、全文检索与索引服务 API",
    lifespan=lifespan,
)

# Enable CORS for cross-origin search queries
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# Frontend SPA & Static Files Serving
# Prioritizes modern React 18 + Tailwind + Lucide frontend (dist), identical to AI Studio preview
# ------------------------------------------------------------------------------
def _locate_frontend_dist() -> Optional[str]:
    """Search for compiled React frontend dist directory across common paths"""
    search_paths = [
        os.path.join(os.path.dirname(__file__), "dist"),                      # app/dist
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist"),     # <root>/dist
        os.path.join(os.getcwd(), "dist"),                                    # ./dist
        "/app/dist",                                                          # Docker container /app/dist
    ]
    for path in search_paths:
        if os.path.isdir(path) and os.path.isfile(os.path.join(path, "index.html")):
            return path
    return None

frontend_dist = _locate_frontend_dist()
static_dir = os.path.join(os.path.dirname(__file__), "static")

# Mount React compiled assets (/assets)
if frontend_dist:
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="react_assets")
        logger.info(f"Mounted React production assets from: {assets_dir}")

# Mount static files directory if exists (for backwards compatibility & userscripts)
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    """
    Serve the production single-page search web frontend.
    Prioritizes modern React SPA frontend (dist/index.html), falling back to static/index.html.
    """
    if frontend_dist:
        react_index = os.path.join(frontend_dist, "index.html")
        if os.path.isfile(react_index):
            return FileResponse(react_index)

    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)

    return HTMLResponse("<h1>115 Share Search Service API is running.</h1><p>Visit /docs for Swagger UI</p>")


@app.get("/115-cid-helper.user.js")
async def serve_cid_helper_script():
    """Direct install route for the Tampermonkey CID helper userscript"""
    if frontend_dist:
        dist_script = os.path.join(frontend_dist, "115-cid-helper.user.js")
        if os.path.exists(dist_script):
            return FileResponse(dist_script, media_type="application/javascript; charset=utf-8")
    script_file = os.path.join(static_dir, "115-cid-helper.user.js")
    if os.path.exists(script_file):
        return FileResponse(script_file, media_type="application/javascript; charset=utf-8")
    public_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "115-cid-helper.user.js")
    if os.path.exists(public_file):
        return FileResponse(public_file, media_type="application/javascript; charset=utf-8")
    return HTMLResponse("// Userscript not found", status_code=404)


@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
    }


@app.websocket("/ws/tasks")
@app.websocket("/ws/shares")
async def websocket_tasks_endpoint(websocket: WebSocket):
    """
    WebSocket 实时任务与抓取状态监控长连接：
    - 连接建立后立即推送当前任务列表与全局统计数据快照
    - 客户端可通过 JSON 消息动态调整分页与状态筛选 ({"type": "subscribe", "page": 1, "page_size": 20, "status": 0})
    - 客户端可发送 {"type": "refresh"} 立即请求当前页面快照刷新
    - 客户端可发送心跳 {"type": "ping"}，服务端回复 {"type": "pong"}
    - 彻底避免客户端以短轮询 (polling) 方式高频访问 /api/v1/shares
    """
    ws_manager = TaskWebSocketManager.get_instance()
    await ws_manager.connect(websocket)
    try:
        # 连接成功后立即向该客户端推送第 1 页快照
        initial_data = await ws_manager.fetch_shares_snapshot(page=1, page_size=20)
        await ws_manager.safe_send_json(websocket, {
            "type": "connected",
            "message": "Connected to 115 Share Task Monitor WebSocket",
            "data": initial_data,
        })

        while True:
            raw_text = await websocket.receive_text()
            if not raw_text:
                continue

            try:
                msg = json.loads(raw_text)
                msg_type = msg.get("type", "")

                if msg_type == "subscribe":
                    # 客户端切换了页码、每页数量或状态筛选
                    ws_manager.update_subscription(websocket, msg)
                    p = msg.get("page", 1)
                    ps = msg.get("page_size", 20)
                    st = msg.get("status", None)
                    kw = msg.get("keyword", None)
                    snapshot = await ws_manager.fetch_shares_snapshot(page=p, page_size=ps, status_filter=st, keyword=kw)
                    await ws_manager.safe_send_json(websocket, {
                        "type": "shares_data",
                        "data": snapshot,
                    })

                elif msg_type == "refresh":
                    # 客户端主动请求刷新当前订阅页面
                    sub = ws_manager.subscriptions.get(websocket, {})
                    snapshot = await ws_manager.fetch_shares_snapshot(
                        page=sub.get("page", 1),
                        page_size=sub.get("page_size", 20),
                        status_filter=sub.get("status", None),
                        keyword=sub.get("keyword", None),
                    )
                    await ws_manager.safe_send_json(websocket, {
                        "type": "shares_data",
                        "data": snapshot,
                    })

                elif msg_type == "ping":
                    await ws_manager.safe_send_json(websocket, {"type": "pong"})

            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect as disc:
        logger.info(f"[WS-Endpoint] WebSocket disconnected cleanly (code={disc.code})")
        ws_manager.disconnect(websocket)
    except Exception as exc:
        logger.error(f"[WS-Endpoint] WebSocket unhandled error: {exc}", exc_info=True)
        ws_manager.disconnect(websocket)


async def resolve_and_patch_root_titles(db: AsyncSession, share_rows: List[Share]) -> Dict[int, str]:
    """
    针对已抓取到文件/目录但标题仍为默认占位符 '115 分享 (xxxx)' 的分享，
    自动从 files 表提取其根目录或根文件名称，并即时回填至 Share 对象和数据库持久化。
    """
    needs_patch_shares = [
        s for s in share_rows
        if (not getattr(s, "title", None) or str(s.title).strip().startswith("115 分享 (") or str(s.title).strip() == "115 分享" or not str(s.title).strip())
        and (getattr(s, "file_count", 0) > 0 or getattr(s, "folder_count", 0) > 0)
    ]
    if not needs_patch_shares:
        return {}

    share_ids = [s.id for s in needs_patch_shares]
    title_map: Dict[int, str] = {}

    try:
        # 1. 优先从 parent_115_id == '0' 查找根目录（文件夹优先排序）
        stmt1 = (
            select(File.share_id, File.name)
            .distinct(File.share_id)
            .where(File.share_id.in_(share_ids), File.parent_115_id == "0")
            .order_by(File.share_id, File.is_dir.desc(), File.id.asc())
        )
        res1 = await db.execute(stmt1)
        for sid, name in res1.all():
            if name and str(name).strip():
                title_map[sid] = str(name).strip()

        # 2. 对未命中的记录兜底查找最浅层级的文件/目录
        unresolved_ids = [sid for sid in share_ids if sid not in title_map]
        if unresolved_ids:
            stmt2 = (
                select(File.share_id, File.name)
                .distinct(File.share_id)
                .where(File.share_id.in_(unresolved_ids))
                .order_by(File.share_id, File.is_dir.desc(), File.id.asc())
            )
            res2 = await db.execute(stmt2)
            for sid, name in res2.all():
                if name and str(name).strip():
                    title_map[sid] = str(name).strip()

        # 3. 回写对象属性并异步持久化至数据库
        dirty = False
        for s in needs_patch_shares:
            if s.id in title_map:
                s.title = title_map[s.id]
                dirty = True

        if dirty:
            try:
                await db.commit()
            except Exception as commit_err:
                logger.warning(f"[resolve_and_patch_root_titles] Commit failed: {commit_err}")
                await db.rollback()

    except Exception as exc:
        logger.warning(f"[resolve_and_patch_root_titles] Error resolving root titles: {exc}")

    return title_map


@app.get(
    "/api/v1/shares",
    response_model=ShareListResponse,
    summary="获取已提交分享列表及抓取状态监控",
)
async def list_shares(
    keyword: Optional[str] = Query(None, description="搜索分享代码或标题"),
    status: Optional[int] = Query(None, description="状态筛选: 0=PENDING(抓取中), 1=ACTIVE(完成), 2=EXPIRED(失效), 3=BANNED(封禁)"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
    db: AsyncSession = Depends(get_db),
):
    """
    获取系统中所有收录的 115 分享链接、抓取进度状态、文件统计及全局概览
    """
    conditions = []
    if keyword and keyword.strip():
        kw = keyword.strip()
        conditions.append((Share.share_code.ilike(f"%{kw}%")) | (Share.title.ilike(f"%{kw}%")))
    if status is not None:
        conditions.append(Share.status == status)

    # Global Stats (cast to int to avoid PostgreSQL Decimal/numeric non-serializable objects)
    total_shares_count = int((await db.execute(select(func.count(Share.id)))).scalar() or 0)
    active_shares_count = int((await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.ACTIVE.value))).scalar() or 0)
    pending_shares_count = int((await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.PENDING.value))).scalar() or 0)
    expired_shares_count = int((await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.EXPIRED.value))).scalar() or 0)
    banned_shares_count = int((await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.BANNED.value))).scalar() or 0)

    total_files_sum = int((await db.execute(select(func.coalesce(func.sum(Share.file_count), 0)))).scalar() or 0)
    total_size_sum = int((await db.execute(select(func.coalesce(func.sum(Share.total_size), 0)))).scalar() or 0)

    stats_payload = {
        "total_shares": total_shares_count,
        "active_shares": active_shares_count,
        "pending_shares": pending_shares_count,
        "expired_shares": expired_shares_count,
        "banned_shares": banned_shares_count,
        "total_files": total_files_sum,
        "total_size": total_size_sum,
        "total_size_formatted": format_size(total_size_sum),
    }

    # Count query for current filter
    count_stmt = select(func.count(Share.id))
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    filtered_total = int((await db.execute(count_stmt)).scalar() or 0)

    # Data query with auto-migration retry if columns were missing in legacy DB
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
        share_rows = (await db.execute(data_stmt)).scalars().all()
    except Exception as query_exc:
        logger.warning(f"[list_shares] Initial query failed ({query_exc}), running schema compatibility migration...")
        from app.database import ensure_database_schema_compatibility
        await ensure_database_schema_compatibility()
        # Retry query after migration
        share_rows = (await db.execute(data_stmt)).scalars().all()

    # 自动将已经抓取到目录信息的分享标题从默认的 '115 分享 (xxxx)' 修复为真实的根目录名
    await resolve_and_patch_root_titles(db, share_rows)

    items = []
    for s in share_rows:
        try:
            effective_title = getattr(s, "title", "") or f"115 分享 ({s.share_code})"
            items.append(
                ShareInfo(
                    id=s.id,
                    share_code=s.share_code or "",
                    receive_code=getattr(s, "receive_code", "") or "",
                    title=effective_title,
                    file_count=getattr(s, "file_count", 0) or 0,
                    folder_count=getattr(s, "folder_count", 0) or 0,
                    total_size=getattr(s, "total_size", 0) or 0,
                    status=getattr(s, "status", 0) if getattr(s, "status", None) is not None else 0,
                    last_crawled_at=getattr(s, "last_crawled_at", None),
                    created_at=getattr(s, "created_at", None),
                )
            )
        except Exception as row_exc:
            logger.warning(f"[list_shares] Error parsing share row {getattr(s, 'id', None)}: {row_exc}")

    total_pages = math.ceil(filtered_total / page_size) if filtered_total > 0 else 0

    return ShareListResponse(
        total=filtered_total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        stats=stats_payload,
        items=items,
    )


@app.post(
    "/api/v1/shares/sync-root-titles",
    summary="一键同步并更新所有分享任务标题为根目录名",
)
async def sync_all_share_root_titles(db: AsyncSession = Depends(get_db)):
    """
    全量扫描数据库中所有已抓取到文件/目录但标题仍为 '115 分享 (xxxx)' 或默认占位的分享，
    自动使用其在 files 表中的顶层根目录或文件名进行回填，并在 WebSocket 中广播刷新。
    """
    stmt = (
        select(Share)
        .where(
            (Share.file_count > 0) | (Share.folder_count > 0),
            (Share.title.is_(None)) | (Share.title == "") | (Share.title.like("115 分享 (%)"))
        )
    )
    rows = (await db.execute(stmt)).scalars().all()
    patched_map = await resolve_and_patch_root_titles(db, list(rows))

    if patched_map:
        await TaskWebSocketManager.get_instance().notify_task_event(
            "titles_synced",
            {"synced_count": len(patched_map)}
        )

    return {
        "status": "success",
        "synced_count": len(patched_map),
        "message": f"成功识别并更新 {len(patched_map)} 条分享任务标题为根目录名！",
    }


@app.post(
    "/api/v1/shares/{share_code}/crawl",
    response_model=TriggerCrawlResponse,
    summary="手动开始或重新抓取指定分享链接（支持智能断点续传）",
)
async def trigger_share_crawl(
    share_code: str,
    receive_code: Optional[str] = Query(None, description="可选更新提取码"),
    resume: bool = Query(True, description="是否开启断点续传（默认True，自动识别并跳过已抓取目录，秒级恢复断点）"),
    db: AsyncSession = Depends(get_db),
):
    """
    手动触发或重新开始爬取指定的 115 分享（支持智能断点续传，不重复抓取已入库目录）
    """
    clean_code = share_code.strip()
    stmt = select(Share).where(Share.share_code == clean_code)
    res = await db.execute(stmt)
    share_obj = res.scalar_one_or_none()

    effective_pwd = receive_code or ""
    if share_obj:
        if receive_code:
            share_obj.receive_code = receive_code
        effective_pwd = share_obj.receive_code or ""
        share_obj.status = ShareStatus.PENDING.value
        await db.commit()
    else:
        # Create new record in PENDING status
        share_obj = Share(
            share_code=clean_code,
            receive_code=effective_pwd,
            title=f"115 分享 ({clean_code})",
            status=ShareStatus.PENDING.value,
        )
        db.add(share_obj)
        await db.commit()
        await db.refresh(share_obj)

    task_id = await enqueue_crawl_task(
        share_code=clean_code,
        receive_code=effective_pwd,
        resume=resume,
    )

    # Notify WebSocket clients in real-time
    await TaskWebSocketManager.get_instance().notify_task_event(
        "task_enqueued",
        {"share_code": clean_code, "task_id": task_id, "status": 0, "resume": resume}
    )

    return TriggerCrawlResponse(
        share_code=clean_code,
        task_id=task_id,
        status="QUEUED",
        message=f"已成功加入爬取队列 (Task ID: {task_id}, 断点续传: {'已开启' if resume else '关闭-重新抓取'})，Worker 将立即恢复执行！"
    )


@app.post(
    "/api/v1/shares/batch-crawl",
    response_model=BatchCrawlResponse,
    summary="批量选中一键重新抓取分享资源",
)
async def batch_crawl_shares(
    payload: BatchCrawlRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    接收一组选中的分享代码，批量将其状态重置为待抓取 (PENDING)，推入 Redis 爬虫任务队列，
    并通过 WebSocket 实时向客户端推送状态更新。
    """
    clean_codes = list(dict.fromkeys(c.strip() for c in payload.share_codes if c.strip()))
    if not clean_codes:
        raise HTTPException(status_code=400, detail="未提供有效的分享代码列表")

    # 查询现有记录
    stmt = select(Share).where(Share.share_code.in_(clean_codes))
    shares = (await db.execute(stmt)).scalars().all()
    share_map = {s.share_code: s for s in shares}

    task_ids = []
    queued_codes = []

    for code in clean_codes:
        s = share_map.get(code)
        if s:
            s.status = ShareStatus.PENDING.value
            pwd = s.receive_code or ""
        else:
            pwd = ""
            s = Share(
                share_code=code,
                receive_code="",
                title=f"115 分享 ({code})",
                status=ShareStatus.PENDING.value,
            )
            db.add(s)

        queued_codes.append(code)
        task_id = await enqueue_crawl_task(share_code=code, receive_code=pwd, resume=True)
        task_ids.append(task_id)

        # Notify WebSocket
        await TaskWebSocketManager.get_instance().notify_task_event(
            "task_enqueued",
            {"share_code": code, "task_id": task_id, "status": 0, "resume": True}
        )

    await db.commit()
    await TaskWebSocketManager.get_instance().broadcast_full_update()

    return BatchCrawlResponse(
        total_requested=len(clean_codes),
        tasks_queued=len(task_ids),
        share_codes=queued_codes,
        task_ids=task_ids,
        message=f"已成功为 {len(task_ids)} 个分享链接触发重新抓取任务，后台 Worker 将并发解析！",
    )


@app.api_route(
    "/api/v1/shares/export",
    methods=["GET", "POST"],
    response_model=ExportSharesResponse,
    summary="导出分享配置（支持指定选中的 share_codes 或全量导出）",
)
async def export_shares_config(
    payload: Optional[ExportSharesRequest] = None,
    share_codes: Optional[str] = Query(None, description="逗号分隔的分享代码（GET请求时使用）"),
    db: AsyncSession = Depends(get_db),
):
    """
    导出分享配置数据为标准化 JSON 格式，可用于数据备份、迁移或重新导入。
    """
    from datetime import datetime, timezone

    selected_codes = []
    if payload and payload.share_codes:
        selected_codes = [c.strip() for c in payload.share_codes if c.strip()]
    elif share_codes:
        selected_codes = [c.strip() for c in share_codes.split(",") if c.strip()]

    stmt = select(Share).order_by(Share.id.desc())
    if selected_codes:
        stmt = stmt.where(Share.share_code.in_(selected_codes))

    rows = (await db.execute(stmt)).scalars().all()

    status_map = {
        0: "PENDING (抓取中/待开始)",
        1: "ACTIVE (抓取完成)",
        2: "EXPIRED (密码错误/失效)",
        3: "BANNED (违规封禁)",
    }

    shares_data = []
    for s in rows:
        pwd = s.receive_code or ""
        pwd_param = f"?password={pwd}" if pwd else ""
        url = f"https://115.com/s/{s.share_code}{pwd_param}"
        shares_data.append({
            "share_code": s.share_code,
            "receive_code": pwd,
            "title": s.title or f"115 分享 ({s.share_code})",
            "share_url": url,
            "file_count": int(s.file_count or 0),
            "folder_count": int(s.folder_count or 0),
            "total_size": int(s.total_size or 0),
            "total_size_formatted": format_size(s.total_size or 0),
            "status": int(s.status) if s.status is not None else 0,
            "status_desc": status_map.get(s.status, "UNKNOWN"),
            "last_crawled_at": s.last_crawled_at.isoformat() if s.last_crawled_at else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    return ExportSharesResponse(
        version="1.0",
        export_time=datetime.now(timezone.utc).isoformat(),
        total_count=len(shares_data),
        shares=shares_data,
    )


@app.post(
    "/api/v1/shares/seed-demo",
    summary="一键初始化/载入示例分享与文件树数据",
)
async def seed_demo_shares():
    """
    一键载入初始示例 115 分享资源（4K 原盘、计算机经典图书、无损音乐精选），
    快速恢复/初始化任务列表与搜索索引。
    """
    from app.seed import seed_initial_demo_data
    res = await seed_initial_demo_data(force=True)
    await TaskWebSocketManager.get_instance().broadcast_full_update()
    return res


@app.post(
    "/api/v1/shares/batch-import",
    response_model=BatchImportTaskResult,
    status_code=status.HTTP_202_ACCEPTED,
    summary="批量提交 115 分享链接进行异步抓取索引 (支持大批量多批次处理)",
)
async def batch_import_shares(
    payload: BatchImportRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    接收 115 分享代码/链接列表，自动解析提取码，推入 Redis 队列进行异步 BFS 递归抓取与索引。
    全面支持上千甚至上万条链接大批量提交，内部采用高吞吐分批事务（每批 150 条）与批量查询，
    杜绝单条逐个 commit 导致的数据库锁争用与超时中断。
    """
    if not payload.shares:
        raise HTTPException(status_code=400, detail="未提供任何分享链接")

    # 1. 规范化并清洗输入列表，自动按 share_code 去重
    clean_items_map: Dict[str, str] = {}
    invalid_count = 0

    for item in payload.shares:
        if not item.share_code or not str(item.share_code).strip():
            invalid_count += 1
            continue
        sc = str(item.share_code).strip()
        rc = str(item.receive_code or "").strip()
        # 若重复出现，优先保留有提取码的记录
        if sc not in clean_items_map or (rc and not clean_items_map[sc]):
            clean_items_map[sc] = rc

    total_submitted = len(payload.shares)
    distinct_codes = list(clean_items_map.keys())

    if not distinct_codes:
        raise HTTPException(
            status_code=400,
            detail=f"提交的 {total_submitted} 条数据中均未识别出合法的 115 分享代码，请检查链接格式"
        )

    task_ids: List[str] = []
    queued_count = 0
    duplicate_count = 0
    failed_count = 0
    batches_processed = 0

    # 2. 按 150 条为一个批次进行分批处理，兼顾事务响应性与吞吐量
    CHUNK_SIZE = 150
    for i in range(0, len(distinct_codes), CHUNK_SIZE):
        chunk_codes = distinct_codes[i : i + CHUNK_SIZE]
        batches_processed += 1

        try:
            # 批量查询该批次中已存在的记录
            stmt = select(Share).where(Share.share_code.in_(chunk_codes))
            res = await db.execute(stmt)
            existing_shares = {s.share_code: s for s in res.scalars().all()}

            new_share_objects = []
            chunk_queue_tasks = []

            for code in chunk_codes:
                pwd = clean_items_map.get(code, "")
                existing = existing_shares.get(code)

                if existing:
                    if (
                        existing.status == ShareStatus.ACTIVE.value
                        and (existing.file_count or 0) > 0
                        and not payload.force_crawl
                    ):
                        duplicate_count += 1
                        continue
                    else:
                        existing.status = ShareStatus.PENDING.value
                        if pwd:
                            existing.receive_code = pwd
                else:
                    new_share = Share(
                        share_code=code,
                        receive_code=pwd,
                        title=f"115 分享 ({code})",
                        status=ShareStatus.PENDING.value,
                    )
                    new_share_objects.append(new_share)

                chunk_queue_tasks.append((code, pwd))

            if new_share_objects:
                db.add_all(new_share_objects)

            await db.commit()

            # 推入 Redis 任务队列
            for code, pwd in chunk_queue_tasks:
                try:
                    task_id = await enqueue_crawl_task(
                        share_code=code,
                        receive_code=pwd,
                        resume=True,
                    )
                    task_ids.append(task_id)
                    queued_count += 1
                except Exception as q_err:
                    logger.warning(f"[batch_import_shares] Failed to enqueue {code}: {q_err}")
                    failed_count += 1

        except Exception as chunk_exc:
            logger.error(f"[batch_import_shares] Error processing batch {batches_processed}: {chunk_exc}", exc_info=True)
            await db.rollback()
            failed_count += len(chunk_codes)

    # 3. WebSocket 实时广播
    if queued_count > 0:
        await TaskWebSocketManager.get_instance().notify_task_event(
            "batch_imported",
            {
                "queued_count": queued_count,
                "total_submitted": total_submitted,
                "task_ids": task_ids[:100],  # 截断避免报文过大
            }
        )

    msg_parts = [f"已成功接收处理 {total_submitted} 条链接（含 {len(distinct_codes)} 条唯一分享），已成功推入后台抓取队列 {queued_count} 条（共处理 {batches_processed} 个批次）。"]
    if duplicate_count > 0:
        msg_parts.append(f"智能去重跳过了 {duplicate_count} 条已完成收录的分享链接。")
    if invalid_count > 0:
        msg_parts.append(f"跳过 {invalid_count} 条无效或无法解析的空白行。")
    if failed_count > 0:
        msg_parts.append(f"⚠️ 另有 {failed_count} 条入队异常，请稍后重试。")

    return BatchImportTaskResult(
        total_submitted=total_submitted,
        tasks_queued=queued_count,
        ignored_duplicates=duplicate_count,
        failed_count=failed_count,
        batches_processed=batches_processed,
        task_ids=task_ids,
        message=" ".join(msg_parts)
    )


@app.get(
    "/api/v1/search",
    response_model=SearchResponse,
    summary="全文及多维度检索 115 资源文件",
)
async def search_resources(
    keyword: Optional[str] = Query("", max_length=200, description="搜索关键词 (支持模糊检索及文件全路径匹配)"),
    extension: Optional[str] = Query(None, description="文件扩展名筛选 (如 mkv, mp4, pdf, zip, iso)"),
    is_dir: Optional[bool] = Query(False, description="是否仅检索目录 (默认 false 仅检索文件)"),
    min_size: Optional[int] = Query(None, ge=0, description="最小文件大小 (Bytes)"),
    max_size: Optional[int] = Query(None, ge=0, description="最大文件大小 (Bytes)"),
    page: int = Query(1, ge=1, description="分页页码 (从1开始)"),
    page_size: int = Query(20, ge=1, le=100, description="每页结果条数 (1-100)"),
    db: AsyncSession = Depends(get_db),
):
    """
    通过 PostgreSQL GIN / pg_trgm 全文模糊索引快速检索 115 资源，
    返回文件全路径、分享者信息、直达提取链接与 OpenList/AList 挂载节点 ID。
    """
    # Allow searching both fully completed (ACTIVE=1) and currently crawling (PENDING=0) shares
    # Exclude only EXPIRED (2) and BANNED (3) shares
    base_conditions = [
        Share.status.in_([ShareStatus.ACTIVE.value, ShareStatus.PENDING.value]),
        File.is_dir == is_dir,
    ]

    # Clean keyword
    clean_kw = (keyword or "").strip()
    if clean_kw:
        # PostgreSQL trigram / ILIKE path search
        base_conditions.append(File.full_path.ilike(f"%{clean_kw}%"))

    # Extension filter
    if extension:
        clean_ext = extension.strip().lstrip(".").lower()
        base_conditions.append(File.extension == clean_ext)

    # Size range filters
    if min_size is not None:
        base_conditions.append(File.size >= min_size)
    if max_size is not None:
        base_conditions.append(File.size <= max_size)

    # Count query
    count_query = (
        select(func.count(File.id))
        .join(Share, File.share_id == Share.id)
        .where(*base_conditions)
    )
    total_records = (await db.execute(count_query)).scalar() or 0

    # Data query with pagination
    offset = (page - 1) * page_size
    data_query = (
        select(File, Share)
        .join(Share, File.share_id == Share.id)
        .where(*base_conditions)
        .order_by(File.id.desc())
        .offset(offset)
        .limit(page_size)
    )

    rows = (await db.execute(data_query)).all()

    items = []
    for file_obj, share_obj in rows:
        pwd_suffix = f"?password={share_obj.receive_code}" if share_obj.receive_code else ""
        root_share_url = f"https://115.com/s/{share_obj.share_code}{pwd_suffix}"
        
        # 精确计算目标目录 CID：若为文件夹，则为其自身 CID；若为文件，则为其所在父目录 CID
        target_cid = file_obj.file_115_id if file_obj.is_dir else (file_obj.parent_115_id or "0")
        is_root = not target_cid or target_cid == "0"
        cid_query = (f"&cid={target_cid}" if pwd_suffix else f"?cid={target_cid}") if not is_root else ""
        cid_hash = f"#cid={target_cid}" if not is_root else ""
        cid_share_url = f"https://115.com/s/{share_obj.share_code}{pwd_suffix}{cid_query}{cid_hash}"

        items.append(
            SearchResultItem(
                id=file_obj.id,
                file_115_id=file_obj.file_115_id,
                parent_115_id=file_obj.parent_115_id,
                name=file_obj.name,
                extension=file_obj.extension,
                size=file_obj.size,
                formatted_size=format_size(file_obj.size),
                is_dir=file_obj.is_dir,
                sha1=file_obj.sha1,
                full_path=file_obj.full_path,
                share_id=share_obj.id,
                share_code=share_obj.share_code,
                receive_code=share_obj.receive_code,
                share_title=share_obj.title or f"115 分享 ({share_obj.share_code})",
                share_status=share_obj.status,
                share_url=cid_share_url,
                target_cid=target_cid,
                cid_share_url=cid_share_url,
                openlist_mount_cid=file_obj.file_115_id,
            )
        )

    total_pages = math.ceil(total_records / page_size) if total_records > 0 else 0

    return SearchResponse(
        keyword=clean_kw,
        total=total_records,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=items,
    )


@app.get(
    "/api/v1/shares/{share_code}/files",
    response_model=DirectoryListResponse,
    summary="层级浏览指定分享目录树结构",
)
async def list_share_directory(
    share_code: str,
    parent_115_id: str = Query("0", description="父级目录 115 CID (根目录为 0)"),
    db: AsyncSession = Depends(get_db),
):
    """
    按目录层级 (CID) 浏览指定 115 分享内的子文件夹与文件
    """
    stmt = select(Share).where(Share.share_code == share_code)
    share_res = await db.execute(stmt)
    share_obj = share_res.scalar_one_or_none()

    if not share_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未找到分享代码 {share_code}"
        )

    # Find parent folder info if not root
    parent_path = "/"
    parent_cid = "0"
    breadcrumbs = [{"name": "根目录", "cid": "0", "path": "/"}]
    
    if parent_115_id != "0":
        parent_stmt = select(File).where(
            File.share_id == share_obj.id,
            File.file_115_id == parent_115_id,
            File.is_dir.is_(True)
        )
        parent_rec = (await db.execute(parent_stmt)).scalar_one_or_none()
        if parent_rec:
            parent_path = parent_rec.full_path
            parent_cid = parent_rec.parent_115_id or "0"
            
            # Recursively or iteratively find all ancestor folder records by following parent_115_id
            chain = []
            curr_rec = parent_rec
            visited_ids = set()
            while curr_rec and curr_rec.file_115_id not in visited_ids:
                visited_ids.add(curr_rec.file_115_id)
                chain.append({
                    "name": curr_rec.name,
                    "cid": curr_rec.file_115_id,
                    "path": curr_rec.full_path
                })
                if not curr_rec.parent_115_id or curr_rec.parent_115_id == "0":
                    break
                
                # Fetch immediate ancestor
                ancestor_stmt = select(File).where(
                    File.share_id == share_obj.id,
                    File.file_115_id == curr_rec.parent_115_id,
                    File.is_dir.is_(True)
                )
                curr_rec = (await db.execute(ancestor_stmt)).scalar_one_or_none()

            # Chain was collected from leaf to root; reverse it for breadcrumb display
            for ancestor in reversed(chain):
                breadcrumbs.append(ancestor)

    files_stmt = (
        select(File)
        .where(
            File.share_id == share_obj.id,
            File.parent_115_id == parent_115_id
        )
        .order_by(File.is_dir.desc(), File.name.asc())
    )
    file_rows = (await db.execute(files_stmt)).scalars().all()

    folder_count = 0
    file_count = 0
    total_folder_size = 0

    items = []
    for f in file_rows:
        if f.is_dir:
            folder_count += 1
        else:
            file_count += 1
            total_folder_size += f.size

        items.append(
            FileTreeNode(
                id=f.id,
                file_115_id=f.file_115_id,
                parent_115_id=f.parent_115_id,
                name=f.name,
                extension=f.extension,
                size=f.size,
                formatted_size=format_size(f.size),
                is_dir=f.is_dir,
                sha1=f.sha1,
                full_path=f.full_path,
            )
        )

    pwd_suffix = f"?password={share_obj.receive_code}" if share_obj.receive_code else ""
    root_share_url = f"https://115.com/s/{share_obj.share_code}{pwd_suffix}"
    cid_hash = f"#cid={parent_115_id}" if parent_115_id and parent_115_id != "0" else ""
    cid_share_url = f"https://115.com/s/{share_obj.share_code}{pwd_suffix}{cid_hash}"

    return DirectoryListResponse(
        share_code=share_code,
        share_title=share_obj.title or f"115 分享 ({share_obj.share_code})",
        receive_code=share_obj.receive_code or "",
        share_status=share_obj.status,
        share_url=cid_share_url,
        root_share_url=root_share_url,
        cid_share_url=cid_share_url,
        parent_115_id=parent_115_id,
        parent_cid=parent_cid,
        parent_path=parent_path,
        total=len(items),
        folder_count=folder_count,
        file_count=file_count,
        total_size=total_folder_size,
        total_size_formatted=format_size(total_folder_size),
        breadcrumbs=breadcrumbs,
        items=items,
    )


@app.post(
    "/api/v1/shares/{share_code}/report",
    response_model=ReportShareResponse,
    summary="上报失效或违规 115 分享链接",
)
async def report_invalid_share(
    share_code: str,
    payload: ReportShareRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    用户或巡检系统上报已失效、密码错误或被 115 封禁的分享链接
    """
    stmt = select(Share).where(Share.share_code == share_code)
    res = await db.execute(stmt)
    share_obj = res.scalar_one_or_none()

    if not share_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未找到分享代码 {share_code}"
        )

    new_status = ShareStatus.BANNED.value if payload.reason == "banned" else ShareStatus.EXPIRED.value
    share_obj.status = new_status
    await db.commit()

    # Notify WebSocket clients in real-time
    await TaskWebSocketManager.get_instance().notify_task_event(
        "share_reported",
        {"share_code": share_code, "status": new_status}
    )

    return ReportShareResponse(
        share_code=share_code,
        status=new_status,
        message="已成功标记该分享为失效状态，后续检索将自动过滤。"
    )


@app.delete(
    "/api/v1/shares/{share_code}",
    response_model=DeleteShareResponse,
    summary="彻底移除单个 115 分享链接并级联清理名下全部文件记录",
)
async def delete_share(
    share_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    根据 share_code 彻底移除分享链接，并在数据库事务中强力级联删除名下所有已收录的文件与文件夹记录，
    彻底防止链接失效后脏数据继续在搜索中被检索出。
    """
    clean_code = share_code.strip()
    stmt = select(Share).where(Share.share_code == clean_code)
    share_obj = (await db.execute(stmt)).scalar_one_or_none()

    if not share_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未找到分享代码为 {clean_code} 的记录"
        )

    # 统计并显式删除关联文件记录（确保即使级联约束缺失也能彻底清空）
    count_stmt = select(func.count(File.id)).where(File.share_id == share_obj.id)
    file_count = (await db.execute(count_stmt)).scalar() or 0

    await db.execute(delete(File).where(File.share_id == share_obj.id))
    await db.delete(share_obj)
    await db.commit()

    logger.info(f"[delete_share] Deleted share {clean_code} and cascade removed {file_count} files.")

    # 触发 WebSocket 实时广播，通知全量前端页面更新状态与统计
    await TaskWebSocketManager.get_instance().notify_task_event(
        "share_deleted",
        {"share_code": clean_code, "deleted_files": file_count}
    )
    await TaskWebSocketManager.get_instance().broadcast_full_update()

    return DeleteShareResponse(
        status="success",
        share_code=clean_code,
        deleted_files=file_count,
        message=f"已彻底移除分享 {clean_code}，并同步清除了名下的 {file_count} 个文件记录！"
    )


@app.post(
    "/api/v1/shares/batch-delete",
    response_model=BatchDeleteSharesResponse,
    summary="批量彻底移除选中的分享链接及其名下的全部文件记录",
)
async def batch_delete_shares(
    payload: BatchDeleteSharesRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    批量删除指定的分享链接列表，并在事务内级联清空其全部关联文件
    """
    clean_codes = [c.strip() for c in payload.share_codes if c and c.strip()]
    if not clean_codes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请提供至少一个有效的分享代码"
        )

    stmt = select(Share).where(Share.share_code.in_(clean_codes))
    shares = (await db.execute(stmt)).scalars().all()

    if not shares:
        return BatchDeleteSharesResponse(
            status="success",
            deleted_shares=0,
            deleted_files=0,
            message="未在数据库中找到匹配的分享链接记录"
        )

    share_ids = [s.id for s in shares]
    count_stmt = select(func.count(File.id)).where(File.share_id.in_(share_ids))
    file_count = (await db.execute(count_stmt)).scalar() or 0

    await db.execute(delete(File).where(File.share_id.in_(share_ids)))
    for s in shares:
        await db.delete(s)
    await db.commit()

    deleted_count = len(shares)
    logger.info(f"[batch_delete_shares] Batch deleted {deleted_count} shares and {file_count} files.")

    await TaskWebSocketManager.get_instance().notify_task_event(
        "shares_batch_deleted",
        {
            "share_codes": [s.share_code for s in shares],
            "deleted_shares": deleted_count,
            "deleted_files": file_count,
        }
    )
    await TaskWebSocketManager.get_instance().broadcast_full_update()

    return BatchDeleteSharesResponse(
        status="success",
        deleted_shares=deleted_count,
        deleted_files=file_count,
        message=f"已成功批量移除 {deleted_count} 个分享链接，并级联删除了名下的 {file_count} 个文件记录！"
    )



# ---------------------------------------------------------
# Proxy Pool Management & Diagnostic Endpoints
# ---------------------------------------------------------

@app.get(
    "/api/v1/system/proxy",
    summary="获取当前代理池状态与诊断指标",
)
async def get_proxy_status():
    """
    获取代理池当前工作模式、节点总数、可用数、405封禁隔离数、成功/失败指标及样例节点
    """
    proxy_mgr = ProxyManager.get_instance()
    await proxy_mgr.sync_from_storage()
    await proxy_mgr.initialize()
    await proxy_mgr.load_runtime_state_from_db()
    return proxy_mgr.get_status()


@app.post(
    "/api/v1/system/proxy/test",
    summary="测试指定代理或当前可用代理连通性",
)
async def test_proxy_connectivity(payload: Optional[ProxyTestRequest] = None):
    """
    向 115 端点发起探测请求，评估延迟、HTTP状态码及是否被 115 WAF 405 拦截
    """
    proxy_mgr = ProxyManager.get_instance()
    await proxy_mgr.sync_from_storage()
    await proxy_mgr.initialize()
    test_target = payload.proxy_url if payload else None
    return await proxy_mgr.test_proxy(test_target)


@app.post(
    "/api/v1/system/proxy/refresh",
    summary="手动触发刷新动态代理池 API",
)
async def refresh_proxy_pool():
    """
    强制立即从配置的代理池 API 拉取最新 IP 节点
    """
    proxy_mgr = ProxyManager.get_instance()
    await proxy_mgr.sync_from_storage()
    await proxy_mgr.initialize()
    count = await proxy_mgr.refresh_pool(force=True)
    return {
        "status": "success",
        "message": f"代理池已刷新，当前可用节点总数: {count}",
        "total_proxies": count,
    }


@app.post(
    "/api/v1/system/proxy/health-check",
    summary="手动触发对代理池全量节点进行 115 API 防封与健康度轮询探测",
)
async def trigger_proxy_health_check():
    """
    并发主动测试代理池中所有节点对 115 Snap API 的连通性与 WAF 405 拦截状态，
    自动隔离已知被封锁的 IP，并将检测指标与状态实时更新持久化至数据库。
    """
    proxy_mgr = ProxyManager.get_instance()
    await proxy_mgr.sync_from_storage()
    await proxy_mgr.initialize()
    result = await proxy_mgr.health_check_all_proxies()
    return {
        "status": "success",
        "message": "全量代理 115 API 健康巡检与数据库状态更新完成",
        "result": result,
        "current_status": proxy_mgr.get_status(),
    }


@app.post(
    "/api/v1/system/proxy/config",
    summary="热更新代理池运行配置",
)
async def update_proxy_config(payload: ProxyConfigUpdateRequest):
    """
    动态修改代理模式 (OFF, STATIC, POOL_API, CUSTOM_LIST) 与 API 地址，持久化至数据库，跨容器与重启均不丢失
    """
    proxy_mgr = ProxyManager.get_instance()

    config_dict = {}
    if payload.mode is not None:
        config_dict["mode"] = payload.mode
    if payload.proxy_url is not None:
        config_dict["proxy_url"] = payload.proxy_url
    if payload.proxy_pool_api is not None:
        config_dict["proxy_pool_api"] = payload.proxy_pool_api
    if payload.proxy_pool_list is not None:
        config_dict["proxy_pool_list"] = payload.proxy_pool_list
    if payload.rotation_strategy is not None:
        config_dict["rotation_strategy"] = payload.rotation_strategy
    if payload.refresh_interval is not None:
        config_dict["refresh_interval"] = payload.refresh_interval
    if payload.crawler_concurrency is not None:
        config_dict["crawler_concurrency"] = payload.crawler_concurrency
    if payload.crawler_rate_min is not None:
        config_dict["crawler_rate_min"] = payload.crawler_rate_min
    if payload.crawler_rate_max is not None:
        config_dict["crawler_rate_max"] = payload.crawler_rate_max

    await proxy_mgr.save_config(config_dict)

    return {
        "status": "success",
        "message": "代理配置已保存到数据库并实时生效（跨容器与重启均自动保持）",
        "current_status": proxy_mgr.get_status(),
    }


@app.post(
    "/api/v1/tasks/recover-stuck",
    summary="手动扫描并恢复死锁/超时的抓取任务",
)
async def manual_recover_stuck_tasks(
    timeout_seconds: Optional[int] = Query(None, description="自定义死锁超时秒数（默认 300 秒 / 5 分钟）"),
):
    """
    检查并恢复数据库中 status=0 且超过 5 分钟（或指定秒数）未更新的卡死分享任务，重置时间戳并重新推入爬取队列。
    """
    from app.worker import recover_stuck_pending_shares
    count = await recover_stuck_pending_shares(timeout_seconds=timeout_seconds)

    if count > 0:
        await TaskWebSocketManager.get_instance().notify_task_event(
            "tasks_recovered",
            {"recovered_count": count}
        )

    return {
        "status": "success",
        "recovered_count": count,
        "message": f"死锁扫描与恢复完成，已成功恢复并重新入队 {count} 个卡死分享任务。"
    }


# ==============================================================================
# Admin Portal & Authorization Endpoints (管理入口与鉴权)
# ==============================================================================

@app.post(
    "/api/v1/admin/verify",
    response_model=AdminVerifyResponse,
    summary="验证管理员授权口令或密钥",
)
async def verify_admin_auth(
    payload: AdminVerifyRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    验证管理员口令或 Token。完全从 PostgreSQL 数据库中验证，不依赖 .env 配置。
    """
    if not settings.ADMIN_AUTH_ENABLED:
        return AdminVerifyResponse(
            authenticated=True,
            message="系统未开启口令保护，已直接开放管理权限",
            token=payload.token or "unprotected",
            is_initialized=True
        )

    is_init = await is_admin_initialized(db)
    is_valid = await verify_admin_token(db, payload.token)

    if is_valid:
        msg = "管理员授权验证通过，已解锁管理入口"
        if not is_init:
            msg = "使用初始默认口令 (admin115) 验证通过，建议在管理控制台及时修改为您自己的专属密码"
        return AdminVerifyResponse(
            authenticated=True,
            message=msg,
            token=payload.token.strip(),
            is_initialized=is_init
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员凭证口令不正确，请重新输入"
        )


@app.get(
    "/api/v1/admin/status",
    response_model=AdminStatusResponse,
    summary="查询管理入口鉴权状态",
)
async def get_admin_status(
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token"),
    admin_token: Optional[str] = Query(None, alias="admin_token"),
    db: AsyncSession = Depends(get_db)
):
    """
    检查当前客户端是否已具备管理员授权状态，并反馈密码是否已在数据库完成个性化设定
    """
    is_init = await is_admin_initialized(db)
    provided = x_admin_token or admin_token

    if not settings.ADMIN_AUTH_ENABLED:
        return AdminStatusResponse(
            auth_enabled=False,
            authenticated=True,
            is_initialized=is_init,
            message="系统未开启口令保护，已直接开放管理权限"
        )

    is_auth = False
    if provided:
        is_auth = await verify_admin_token(db, provided)

    return AdminStatusResponse(
        auth_enabled=settings.ADMIN_AUTH_ENABLED,
        authenticated=is_auth,
        is_initialized=is_init,
        message="已授权访问管理控制台" if is_auth else "未授权，需在管理入口验证口令"
    )


@app.post(
    "/api/v1/admin/init",
    response_model=AdminVerifyResponse,
    summary="首次设置管理员密码 (免配置 .env)",
)
async def init_admin_password(
    payload: AdminInitPasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    初次使用部署时，直接在 Web 界面设定专属管理密码并持久化存入 PostgreSQL 数据库，彻底告别 .env 配置
    """
    is_init = await is_admin_initialized(db)
    if is_init:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="管理员密码已经完成初始化，若需修改请使用修改密码功能"
        )

    new_pwd = payload.new_password.strip()
    if len(new_pwd) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新管理密码长度不得少于 4 个字符"
        )

    await set_admin_password(db, new_pwd)
    return AdminVerifyResponse(
        authenticated=True,
        message="管理密码初始化成功！已安全保存在数据库持久化存储中，重启不受影响",
        token=new_pwd,
        is_initialized=True
    )


@app.post(
    "/api/v1/admin/change-password",
    response_model=Dict[str, Any],
    summary="在线修改管理员密码 (直接保存至数据库)",
)
async def change_admin_password(
    payload: AdminChangePasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    在线修改管理员密码。验证原密码通过后将新密码安全加盐写入数据库 system_settings 表，无需修改任何服务器文件。
    """
    is_valid_old = await verify_admin_token(db, payload.old_password)
    if not is_valid_old:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="原管理员口令不正确，无法修改密码"
        )

    new_pwd = payload.new_password.strip()
    if len(new_pwd) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新管理密码长度不得少于 4 个字符"
        )

    await set_admin_password(db, new_pwd)
    return {
        "success": True,
        "message": "管理员密码已成功更新并持久化保存至数据库！",
        "new_token": new_pwd
    }


@app.get(
    "/api/v1/admin/settings",
    response_model=SystemSettingsGroupResponse,
    summary="获取全量动态系统配置项 (来自 PostgreSQL 数据库)",
)
async def get_system_settings(
    db: AsyncSession = Depends(get_db)
):
    """
    获取系统中所有分类的配置项（爬虫引擎、任务调度、代理池、通用配置）。
    所有配置项均已迁移到 PostgreSQL 数据库持久化存储，不依赖 .env 文件。
    """
    mgr = DatabaseSettingsManager.get_instance()
    grouped_data = await mgr.get_grouped_settings(db)
    return SystemSettingsGroupResponse(**grouped_data)


@app.post(
    "/api/v1/admin/settings",
    summary="批量更新系统配置项至 PostgreSQL 数据库 (热生效，免重启)",
)
async def update_system_settings(
    payload: SystemSettingsUpdateRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    修改配置项并直接持久化写入 PostgreSQL system_settings 表，
    同时在内存中即刻热生效，彻底告别重启容器或手动编辑 .env 文件。
    """
    if not payload.settings:
        raise HTTPException(status_code=400, detail="未提供任何待更新的配置项")

    mgr = DatabaseSettingsManager.get_instance()
    applied = await mgr.update_settings(payload.settings, db)
    return {
        "success": True,
        "updated_count": len(applied),
        "applied_settings": applied,
        "message": f"成功保存并应用 {len(applied)} 项系统配置至 PostgreSQL 数据库，已即刻生效！"
    }


@app.post(
    "/api/v1/admin/settings/reset",
    summary="恢复配置项至出厂默认值 (同步重置数据库)",
)
async def reset_system_settings(
    payload: Optional[SystemSettingsResetRequest] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    将指定（或全部）配置项在 PostgreSQL 中重置为系统出厂预设值
    """
    keys = payload.keys if payload else None
    mgr = DatabaseSettingsManager.get_instance()
    applied = await mgr.reset_settings(keys, db)
    return {
        "success": True,
        "reset_count": len(applied),
        "applied_settings": applied,
        "message": f"成功将 {len(applied)} 项配置恢复为系统出厂默认值！"
    }


@app.get(
    "/api/v1/public/adsense-config",
    summary="获取公共 Google AdSense 商业化广告配置",
)
async def get_public_adsense_config(
    db: AsyncSession = Depends(get_db)
):
    """
    提供给前端公共页面（搜索页、目录树、详情页）加载 Google AdSense 脚本与广告单元。
    无需管理员权限，仅返回非敏感的广告发布商 ID 及广告位配置。
    """
    mgr = DatabaseSettingsManager.get_instance()
    # Ensure in-memory cache is populated from DB
    await mgr.load_from_db(db)

    return {
        "enabled": bool(mgr.get("ADSENSE_ENABLED", settings.ADSENSE_ENABLED)),
        "client_id": str(mgr.get("ADSENSE_CLIENT_ID", settings.ADSENSE_CLIENT_ID) or "").strip(),
        "slot_id": str(mgr.get("ADSENSE_SLOT_ID", settings.ADSENSE_SLOT_ID) or "").strip(),
        "auto_ads": bool(mgr.get("ADSENSE_AUTO_ADS", settings.ADSENSE_AUTO_ADS)),
        "test_mode": bool(mgr.get("ADSENSE_TEST_MODE", settings.ADSENSE_TEST_MODE)),
    }


# ------------------------------------------------------------------------------
# SPA Catch-all Route for client-side routing & static asset fallback
# ------------------------------------------------------------------------------
@app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
async def serve_spa_fallback(full_path: str):
    """
    Catch-all route to serve the React SPA for client-side routing.
    Excludes API (/api/), WebSocket (/ws/), OpenAPI documentation, and assets.
    """
    reserved_prefixes = ("api/", "ws/", "docs", "redoc", "openapi.json", "static/", "assets/")
    if any(full_path.startswith(prefix) for prefix in reserved_prefixes):
        raise HTTPException(status_code=404, detail="Not Found")

    # If it's a specific static file inside dist, return it directly
    if frontend_dist:
        direct_file = os.path.join(frontend_dist, full_path)
        if os.path.isfile(direct_file):
            return FileResponse(direct_file)

        # Fallback to SPA root HTML
        spa_index = os.path.join(frontend_dist, "index.html")
        if os.path.isfile(spa_index):
            return FileResponse(spa_index)

    # Secondary fallback to app/static
    fallback_index = os.path.join(static_dir, "index.html")
    if os.path.isfile(fallback_index):
        return FileResponse(fallback_index)

    raise HTTPException(status_code=404, detail="Frontend Not Found")




