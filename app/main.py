import logging
import math
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db, init_db
from app.models import File, Share, ShareStatus
from app.schemas import (
    BatchImportRequest,
    BatchImportTaskResult,
    DirectoryListResponse,
    FileTreeNode,
    ReportShareRequest,
    ReportShareResponse,
    SearchResponse,
    SearchResultItem,
    ShareInfo,
    ShareListResponse,
    TriggerCrawlResponse,
    format_size,
)
from app.worker import enqueue_crawl_task

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s"
)
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for DB schema init and clean teardown"""
    logger.info("Application starting up... Initializing DB...")
    await init_db()
    yield
    logger.info("Application shutting down...")


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

# Mount static files directory if exists
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    """Serve the static single-page search web frontend"""
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return HTMLResponse("<h1>115 Share Search Service API is running.</h1><p>Visit /docs for Swagger UI</p>")


@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
    }


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

    # Global Stats
    total_shares_count = (await db.execute(select(func.count(Share.id)))).scalar() or 0
    active_shares_count = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.ACTIVE.value))).scalar() or 0
    pending_shares_count = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.PENDING.value))).scalar() or 0
    expired_shares_count = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.EXPIRED.value))).scalar() or 0
    banned_shares_count = (await db.execute(select(func.count(Share.id)).where(Share.status == ShareStatus.BANNED.value))).scalar() or 0

    total_files_sum = (await db.execute(select(func.coalesce(func.sum(Share.file_count), 0)))).scalar() or 0
    total_size_sum = (await db.execute(select(func.coalesce(func.sum(Share.total_size), 0)))).scalar() or 0

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
    filtered_total = (await db.execute(count_stmt)).scalar() or 0

    # Data query
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

    items = [
        ShareInfo(
            id=s.id,
            share_code=s.share_code,
            receive_code=s.receive_code or "",
            title=s.title or f"115 分享 ({s.share_code})",
            file_count=s.file_count,
            folder_count=s.folder_count,
            total_size=s.total_size,
            status=s.status,
            last_crawled_at=s.last_crawled_at,
            created_at=s.created_at,
        )
        for s in share_rows
    ]

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
    "/api/v1/shares/{share_code}/crawl",
    response_model=TriggerCrawlResponse,
    summary="手动开始或重新抓取指定分享链接",
)
async def trigger_share_crawl(
    share_code: str,
    receive_code: Optional[str] = Query(None, description="可选更新提取码"),
    db: AsyncSession = Depends(get_db),
):
    """
    手动触发或重新开始爬取指定的 115 分享（无论当前是未完成、失败还是需强制刷新）
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
    )

    return TriggerCrawlResponse(
        share_code=clean_code,
        task_id=task_id,
        status="QUEUED",
        message=f"已成功触发爬取任务 (Task ID: {task_id})，Worker 将立即开始遍历抓取！"
    )


@app.post(
    "/api/v1/shares/batch-import",
    response_model=BatchImportTaskResult,
    status_code=status.HTTP_202_ACCEPTED,
    summary="批量提交 115 分享链接进行异步抓取索引",
)
async def batch_import_shares(
    payload: BatchImportRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    接收 115 分享代码/链接列表，自动解析提取码，推入 Redis 队列进行异步 BFS 递归抓取与索引
    """
    task_ids = []
    queued_count = 0
    duplicate_count = 0

    for item in payload.shares:
        if not item.share_code:
            continue

        clean_code = item.share_code.strip()
        pwd = (item.receive_code or "").strip()

        # Check existing share in DB
        stmt = select(Share).where(Share.share_code == clean_code)
        res = await db.execute(stmt)
        existing = res.scalar_one_or_none()

        if existing:
            if existing.status == ShareStatus.ACTIVE.value and existing.file_count > 0 and not payload.force_crawl:
                duplicate_count += 1
                continue
            else:
                existing.status = ShareStatus.PENDING.value
                if pwd:
                    existing.receive_code = pwd
                await db.commit()
        else:
            new_share = Share(
                share_code=clean_code,
                receive_code=pwd,
                title=f"115 分享 ({clean_code})",
                status=ShareStatus.PENDING.value,
            )
            db.add(new_share)
            await db.commit()

        # Enqueue background crawl task
        task_id = await enqueue_crawl_task(
            share_code=clean_code,
            receive_code=pwd,
        )
        task_ids.append(task_id)
        queued_count += 1

    return BatchImportTaskResult(
        total_submitted=len(payload.shares),
        tasks_queued=queued_count,
        ignored_duplicates=duplicate_count,
        task_ids=task_ids,
        message=f"已成功接收 {len(payload.shares)} 条分享链接，已创建/更新并在后台队列开始抓取 {queued_count} 条。"
    )


@app.get(
    "/api/v1/search",
    response_model=SearchResponse,
    summary="全文及多维度检索 115 资源文件",
)
async def search_resources(
    keyword: str = Query(..., min_length=1, max_length=200, description="搜索关键词 (支持模糊检索及文件全路径匹配)"),
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
    clean_kw = keyword.strip()
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
        share_url = f"https://115.com/s/{share_obj.share_code}{pwd_suffix}"

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
                share_url=share_url,
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

    files_stmt = (
        select(File)
        .where(
            File.share_id == share_obj.id,
            File.parent_115_id == parent_115_id
        )
        .order_by(File.is_dir.desc(), File.name.asc())
    )
    file_rows = (await db.execute(files_stmt)).scalars().all()

    items = [
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
        for f in file_rows
    ]

    return DirectoryListResponse(
        share_code=share_code,
        parent_115_id=parent_115_id,
        total=len(items),
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

    return ReportShareResponse(
        share_code=share_code,
        status=new_status,
        message="已成功标记该分享为失效状态，后续检索将自动过滤。"
    )
