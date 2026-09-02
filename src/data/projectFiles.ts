import { ProjectFile } from '../types';

export const PROJECT_FILES: ProjectFile[] = [
  {
    name: 'docker-compose.yml',
    path: 'docker-compose.yml',
    language: 'yaml',
    description: 'PostgreSQL 15 (pg_trgm) + Redis 7 + FastAPI API + Async Worker 容器编排',
    content: `version: "3.9"

services:
  postgres:
    image: postgres:15-alpine
    container_name: 115_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres123}
      POSTGRES_DB: \${POSTGRES_DB:-db_115share}
      TZ: Asia/Shanghai
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d db_115share"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: 115_redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass \${REDIS_PASSWORD:-redis123}
    ports:
      - "\${REDIS_PORT:-6379}:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "\${REDIS_PASSWORD:-redis123}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: 115_api
    restart: unless-stopped
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    ports:
      - "\${API_PORT:-8000}:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres123}@postgres:5432/\${POSTGRES_DB:-db_115share}
      - REDIS_URL=redis://:\${REDIS_PASSWORD:-redis123}@redis:6379/0
      - CRAWLER_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
      - CRAWLER_COOKIE=\${CRAWLER_COOKIE:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: 115_worker
    restart: unless-stopped
    command: python -m app.worker
    environment:
      - DATABASE_URL=postgresql+asyncpg://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres123}@postgres:5432/\${POSTGRES_DB:-db_115share}
      - REDIS_URL=redis://:\${REDIS_PASSWORD:-redis123}@redis:6379/0
      - CONCURRENCY=4
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  pgdata:
    driver: local
  redisdata:
    driver: local`
  },
  {
    name: 'Dockerfile',
    path: 'Dockerfile',
    language: 'dockerfile',
    description: 'Python 3.11-slim 基础镜像与生产环境依赖打包',
    content: `FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    TZ=Asia/Shanghai

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential \\
    libpq-dev \\
    curl \\
    tzdata \\
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]`
  },
  {
    name: 'requirements.txt',
    path: 'requirements.txt',
    language: 'plaintext',
    description: 'Python 依赖库 (FastAPI, SQLAlchemy 2.0 Async, asyncpg, Redis, httpx)',
    content: `fastapi>=0.111.0
uvicorn[standard]>=0.30.0
pydantic>=2.7.0
pydantic-settings>=2.2.0
sqlalchemy[asyncio]>=2.0.30
asyncpg>=0.29.0
psycopg2-binary>=2.9.9
httpx>=0.27.0
redis>=5.0.4
arq>=0.26.0
jinja2>=3.1.4
python-multipart>=0.0.9
aiofiles>=23.2.1`
  },
  {
    name: 'config.py',
    path: 'app/config.py',
    language: 'python',
    description: 'Pydantic Settings v2 配置管理与并发爬取速率限制',
    content: `from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "115 Share Search Service"
    PROJECT_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Database Settings (PostgreSQL 15+ with pg_trgm)
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://postgres:postgres123@localhost:5432/db_115share",
        description="Async PostgreSQL connection string"
    )
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_ECHO: bool = False

    # Redis Settings
    REDIS_URL: str = Field(
        default="redis://:redis123@localhost:6379/0",
        description="Redis connection URL for task queue & caching"
    )
    QUEUE_NAME: str = "115_share_crawl_queue"

    # 115 Crawler Engine Settings (Optimized for 10k+ Files / Deep Trees)
    CRAWLER_USER_AGENT: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
    CRAWLER_COOKIE: str = Field(default="", description="Optional 115 VIP/User Cookie to bypass rate limits")
    CRAWLER_REFERER: str = "https://115.com/"
    CRAWLER_SNAP_URL: str = "https://webapi.115.com/share/snap"
    CRAWLER_METHOD: str = "POST"  # 115 webapi.115.com/share/snap prefers POST to prevent HTTP 405
    CRAWLER_PAGE_SIZE: int = 100   # 115 Snap API standard safe batch size
    CRAWLER_CONCURRENCY: int = 4   # Concurrent directory crawlers per share
    CRAWLER_BATCH_UPSERT_SIZE: int = 500  # Pipeline DB batch write size
    CRAWLER_RATE_MIN: float = 0.25  # seconds
    CRAWLER_RATE_MAX: float = 0.60  # seconds
    CRAWLER_MAX_RETRIES: int = 4
    CRAWLER_TIMEOUT: float = 20.0

    # Worker Settings
    CONCURRENCY: int = 4

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()`
  },
  {
    name: 'database.py',
    path: 'app/database.py',
    language: 'python',
    description: 'SQLAlchemy 2.0 Async 引擎、Session 生成器与 pg_trgm 自动创建扩展',
    content: `import logging
from typing import AsyncGenerator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

logger = logging.getLogger("app.database")


class Base(DeclarativeBase):
    pass


engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DB_ECHO,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    async with engine.begin() as conn:
        logger.info("Enabling PostgreSQL pg_trgm extension...")
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        logger.info("Creating database tables...")
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialization completed successfully.")`
  },
  {
    name: 'models.py',
    path: 'app/models.py',
    language: 'python',
    description: 'ORM 数据模型 (shares, files) 与 GIN 三元倒排索引定义',
    content: `import enum
from datetime import datetime
from typing import List, Optional
from sqlalchemy import (
    BigInteger, Boolean, DateTime, ForeignKey, Index,
    Integer, SmallInteger, String, Text, UniqueConstraint, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ShareStatus(int, enum.Enum):
    PENDING = 0      # 待抓取 / 抓取中
    ACTIVE = 1       # 抓取完成，有效
    EXPIRED = 2      # 已过期 / 提取码错误 / 资源不存在
    BANNED = 3       # 违规屏蔽 / 违规分享


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    share_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    receive_code: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    title: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    file_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    folder_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    status: Mapped[int] = mapped_column(SmallInteger, default=ShareStatus.PENDING.value, nullable=False, index=True)
    last_crawled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    files: Mapped[List["File"]] = relationship(
        "File",
        back_populates="share",
        cascade="all, delete-orphan",
        passive_deletes=True
    )


class File(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    share_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("shares.id", ondelete="CASCADE"), nullable=False, index=True)
    file_115_id: Mapped[str] = mapped_column(String(64), nullable=False)
    parent_115_id: Mapped[str] = mapped_column(String(64), default="0", nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    extension: Mapped[str] = mapped_column(String(32), default="", nullable=False, index=True)
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False, index=True)
    is_dir: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    sha1: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    full_path: Mapped[str] = mapped_column(Text, nullable=False)

    share: Mapped["Share"] = relationship("Share", back_populates="files")

    __table_args__ = (
        UniqueConstraint("share_id", "file_115_id", name="uq_share_file_115_id"),
        Index("ix_files_full_path_trgm", "full_path", postgresql_using="gin", postgresql_ops={"full_path": "gin_trgm_ops"}),
        Index("ix_files_ext_size", "extension", "size"),
    )`
  },
  {
    name: 'schemas.py',
    path: 'app/schemas.py',
    language: 'python',
    description: 'Pydantic v2 请求/响应模型与 115 分享链接 URL 正则解析',
    content: `import re
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field, model_validator


def format_size(size_bytes: int) -> str:
    if size_bytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    idx = 0
    size = float(size_bytes)
    while size >= 1024.0 and idx < len(units) - 1:
        size /= 1024.0
        idx += 1
    return f"{size:.2f} {units[idx]}" if idx > 0 else f"{int(size)} B"


URL_REGEX = re.compile(
    r"(?:https?://)?(?:115\\.com/s/|anxia\\.com/s/)?([a-zA-Z0-9_-]{8,64})(?:[?&]password=([a-zA-Z0-9]{4,32})|#([a-zA-Z0-9]{4,32}))?",
    re.IGNORECASE
)


class ShareImportItem(BaseModel):
    share_code: Optional[str] = Field(default=None, description="115 分享代码")
    receive_code: Optional[str] = Field(default="", description="115 提取码")
    raw_url: Optional[str] = Field(default=None, description="原始分享链接")

    @model_validator(mode="before")
    @classmethod
    def parse_raw_url_if_provided(cls, data: Any) -> Any:
        if isinstance(data, dict):
            raw = data.get("raw_url")
            if raw and not data.get("share_code"):
                match = URL_REGEX.search(raw.strip())
                if match:
                    data["share_code"] = match.group(1)
                    pwd = match.group(2) or match.group(3) or ""
                    if not data.get("receive_code"):
                        data["receive_code"] = pwd
            if data.get("share_code"):
                data["share_code"] = data["share_code"].strip()
            if data.get("receive_code") is None:
                data["receive_code"] = ""
            elif isinstance(data["receive_code"], str):
                data["receive_code"] = data["receive_code"].strip()
        return data


class BatchImportRequest(BaseModel):
    shares: List[ShareImportItem] = Field(..., min_length=1, max_length=200)


class BatchImportTaskResult(BaseModel):
    total_submitted: int
    tasks_queued: int
    ignored_duplicates: int
    task_ids: List[str]
    message: str


class SearchResultItem(BaseModel):
    id: int
    file_115_id: str
    parent_115_id: str
    name: str
    extension: str
    size: int
    formatted_size: str
    is_dir: bool
    sha1: str
    full_path: str
    share_id: int
    share_code: str
    receive_code: str
    share_title: str
    share_status: int
    share_url: str
    openlist_mount_cid: str


class SearchResponse(BaseModel):
    keyword: str
    total: int
    page: int
    page_size: int
    total_pages: int
    items: List[SearchResultItem]


class FileTreeNode(BaseModel):
    id: int
    file_115_id: str
    parent_115_id: str
    name: str
    extension: str
    size: int
    formatted_size: str
    is_dir: bool
    sha1: str
    full_path: str


class DirectoryListResponse(BaseModel):
    share_code: str
    parent_115_id: str
    total: int
    items: List[FileTreeNode]


class ReportShareRequest(BaseModel):
    reason: Optional[str] = Field(default="expired")


class ReportShareResponse(BaseModel):
    share_code: str
    status: int
    message: str`
  },
  {
    name: 'crawler.py',
    path: 'app/crawler.py',
    language: 'python',
    description: '115 高性能多协程 BFS 爬虫引擎 (并发遍历、1000条/页、解耦批量入库流水线)',
    content: `import asyncio
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
    pass


class ShareExpiredOrInvalidError(ShareCrawlerError):
    pass


class ShareBannedError(ShareCrawlerError):
    pass


class Crawler115Engine:
    def __init__(self, user_agent: Optional[str] = None, cookie: Optional[str] = None, timeout: Optional[float] = None):
        self.user_agent = user_agent or settings.CRAWLER_USER_AGENT
        self.cookie = cookie or settings.CRAWLER_COOKIE
        self.timeout = timeout or settings.CRAWLER_TIMEOUT
        self.snap_url = settings.CRAWLER_SNAP_URL

    def _get_headers(self, share_code: str = "", receive_code: str = "") -> Dict[str, str]:
        referer = f"https://115.com/s/{share_code}?password={receive_code}" if share_code else settings.CRAWLER_REFERER
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
        self, client: httpx.AsyncClient, share_code: str, receive_code: str, cid: str, offset: int = 0, limit: int = 100
    ) -> Dict[str, Any]:
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
                delay = random.uniform(settings.CRAWLER_RATE_MIN, settings.CRAWLER_RATE_MAX)
                await asyncio.sleep(delay)
                headers = self._get_headers(share_code, receive_code)

                if req_method == "POST":
                    response = await client.post(self.snap_url, data=data_payload, headers=headers, timeout=self.timeout)
                else:
                    response = await client.get(self.snap_url, params=data_payload, headers=headers, timeout=self.timeout)

                if response.status_code == 405:
                    req_method = "GET" if req_method == "POST" else "POST"
                    retries += 1
                    await asyncio.sleep(0.5)
                    continue

                if response.status_code != 200:
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 1.8
                    continue

                result = response.json()
                if not result.get("state", False):
                    msg = str(result.get("msg") or result.get("error", "Unknown 115 error"))
                    if any(x in msg for x in ["已失效", "不存在", "取消", "提取码错误"]):
                        raise ShareExpiredOrInvalidError(f"Share expired or invalid: {msg}")
                    if any(x in msg for x in ["违规", "屏蔽", "封禁"]):
                        raise ShareBannedError(f"Share banned: {msg}")
                    retries += 1
                    await asyncio.sleep(backoff)
                    backoff *= 2.0
                    continue
                return result

            except (httpx.RequestError, httpx.TimeoutException) as exc:
                retries += 1
                if retries > settings.CRAWLER_MAX_RETRIES:
                    raise ShareCrawlerError(f"Network error after {retries} attempts: {exc}") from exc
                await asyncio.sleep(backoff)
                backoff *= 1.8

        raise ShareCrawlerError(f"Failed to fetch snap for {share_code} cid={cid}")

    async def crawl_and_index(self, db: AsyncSession, share_code: str, receive_code: str = "") -> Share:
        stmt = select(Share).where(Share.share_code == share_code)
        res = await db.execute(stmt)
        share_obj = res.scalar_one_or_none()

        if not share_obj:
            share_obj = Share(share_code=share_code, receive_code=receive_code, status=ShareStatus.PENDING.value)
            db.add(share_obj)
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

        http_limits = httpx.Limits(max_keepalive_connections=30, max_connections=50, keepalive_expiry=30.0)

        async with httpx.AsyncClient(limits=http_limits, verify=True) as client:
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
                        current_cid, current_virtual_path = await asyncio.wait_for(dir_queue.get(), timeout=2.5)
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
                                client, share_code, effective_pwd, current_cid, offset, page_size
                            )
                            payload = snap_data.get("data", {})
                            if not extracted_meta["title"]:
                                s_info = payload.get("share_info", {})
                                title = s_info.get("share_title") or payload.get("share_title") or f"115 分享 ({share_code})"
                                extracted_meta["title"] = title
                                share_obj.title = title

                            item_list = payload.get("list", [])
                            total_in_dir = payload.get("count", len(item_list))
                            local_files = 0
                            local_folders = 0
                            local_bytes = 0

                            for item in item_list:
                                raw_fid = item.get("fid")
                                raw_cid = item.get("cid")
                                item_name = str(item.get("n", "")).strip()
                                if not item_name:
                                    continue

                                is_dir = raw_fid is None or (raw_cid is not None and not raw_fid)
                                node_id = str(raw_cid if is_dir else raw_fid)
                                item_size = int(item.get("s", 0) or 0)
                                item_sha1 = str(item.get("sha1", "") or "").lower()
                                norm_path = posixpath.normpath(posixpath.join(current_virtual_path, item_name))

                                if is_dir:
                                    extension = ""
                                    local_folders += 1
                                    await dir_queue.put((node_id, norm_path))
                                else:
                                    _, ext = posixpath.splitext(item_name)
                                    extension = ext.lstrip(".").lower()
                                    local_files += 1
                                    local_bytes += item_size

                                await db_write_queue.put({
                                    "share_id": share_obj.id,
                                    "file_115_id": node_id,
                                    "parent_115_id": current_cid,
                                    "name": item_name,
                                    "extension": extension,
                                    "size": item_size,
                                    "is_dir": is_dir,
                                    "sha1": item_sha1,
                                    "full_path": norm_path,
                                })

                            async with stats_lock:
                                stats["files"] += local_files
                                stats["folders"] += local_folders
                                stats["bytes"] += local_bytes

                            offset += len(item_list)
                            if offset >= total_in_dir or not item_list:
                                break
                    finally:
                        dir_queue.task_done()

            try:
                workers = [asyncio.create_task(dir_worker(i)) for i in range(settings.CRAWLER_CONCURRENCY)]
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
                return share_obj
            except Exception as exc:
                await db.rollback()
                raise

    async def _bulk_upsert_files(self, db: AsyncSession, records: List[Dict[str, Any]]) -> None:
        if not records:
            return
        stmt = insert(File).values(records)
        upsert = stmt.on_conflict_do_update(
            constraint="uq_share_file_115_id",
            set_={
                "parent_115_id": stmt.excluded.parent_115_id,
                "name": stmt.excluded.name,
                "extension": stmt.excluded.extension,
                "size": stmt.excluded.size,
                "is_dir": stmt.excluded.is_dir,
                "sha1": stmt.excluded.sha1,
                "full_path": stmt.excluded.full_path,
            }
        )
        await db.execute(upsert)
        await db.commit()`
  },
  {
    name: 'worker.py',
    path: 'app/worker.py',
    language: 'python',
    description: 'Redis 任务队列异步消费者 Worker',
    content: `import asyncio
import json
import logging
import signal
import uuid
from typing import Optional
import redis.asyncio as aioredis
from app.config import settings
from app.crawler import Crawler115Engine, ShareCrawlerError
from app.database import AsyncSessionLocal, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s")
logger = logging.getLogger("app.worker")

redis_client: Optional[aioredis.Redis] = None


async def get_redis_client() -> aioredis.Redis:
    global redis_client
    if redis_client is None:
        redis_client = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    return redis_client


async def enqueue_crawl_task(share_code: str, receive_code: str = "") -> str:
    client = await get_redis_client()
    task_id = str(uuid.uuid4())
    payload = {"task_id": task_id, "share_code": share_code, "receive_code": receive_code}
    await client.lpush(settings.QUEUE_NAME, json.dumps(payload))
    logger.info(f"Enqueued crawl task {task_id} for {share_code}")
    return task_id


async def process_task(task_data: dict, crawler: Crawler115Engine) -> None:
    task_id = task_data.get("task_id")
    share_code = task_data.get("share_code")
    receive_code = task_data.get("receive_code", "")

    async with AsyncSessionLocal() as session:
        try:
            await crawler.crawl_and_index(session, share_code, receive_code)
            logger.info(f"Task {task_id} completed successfully for {share_code}")
        except ShareCrawlerError as err:
            logger.warning(f"Task {task_id} business error: {err}")
        except Exception as exc:
            logger.error(f"Task {task_id} failed: {exc}", exc_info=True)


async def worker_loop(worker_id: int, stop_event: asyncio.Event) -> None:
    client = await get_redis_client()
    crawler = Crawler115Engine()
    while not stop_event.is_set():
        try:
            result = await client.brpop(settings.QUEUE_NAME, timeout=2)
            if not result:
                continue
            _, raw_payload = result
            task_data = json.loads(raw_payload)
            await process_task(task_data, crawler)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"Worker {worker_id} error: {exc}", exc_info=True)
            await asyncio.sleep(1)


async def main() -> None:
    await init_db()
    stop_event = asyncio.Event()

    def handle_signal(*_):
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_signal)
        except NotImplementedError:
            pass

    tasks = [asyncio.create_task(worker_loop(i + 1, stop_event)) for i in range(settings.CONCURRENCY)]
    await stop_event.wait()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    if redis_client:
        await redis_client.close()


if __name__ == "__main__":
    asyncio.run(main())`
  },
  {
    name: 'main.py',
    path: 'app/main.py',
    language: 'python',
    description: 'FastAPI 应用挂载、REST API 路由与三元全文搜索查询构建',
    content: `import logging
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
    BatchImportRequest, BatchImportTaskResult, DirectoryListResponse,
    FileTreeNode, ReportShareRequest, ReportShareResponse, SearchResponse,
    SearchResultItem, format_size
)
from app.worker import enqueue_crawl_task

logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title=settings.PROJECT_NAME, version=settings.PROJECT_VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return HTMLResponse("<h1>115 Share Search API</h1><p>Visit /docs for Swagger</p>")


@app.get("/api/v1/health")
async def health_check():
    return {"status": "healthy", "service": settings.PROJECT_NAME, "version": settings.PROJECT_VERSION}


@app.post("/api/v1/shares/batch-import", response_model=BatchImportTaskResult, status_code=status.HTTP_202_ACCEPTED)
async def batch_import_shares(payload: BatchImportRequest, db: AsyncSession = Depends(get_db)):
    task_ids = []
    queued_count = 0
    duplicate_count = 0
    for item in payload.shares:
        if not item.share_code:
            continue
        stmt = select(Share).where(Share.share_code == item.share_code)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing and existing.status == ShareStatus.ACTIVE.value:
            duplicate_count += 1
            continue
        task_id = await enqueue_crawl_task(item.share_code, item.receive_code or "")
        task_ids.append(task_id)
        queued_count += 1
    return BatchImportTaskResult(
        total_submitted=len(payload.shares),
        tasks_queued=queued_count,
        ignored_duplicates=duplicate_count,
        task_ids=task_ids,
        message=f"已成功接收 {len(payload.shares)} 条分享链接，推入队列 {queued_count} 条。"
    )


@app.get("/api/v1/search", response_model=SearchResponse)
async def search_resources(
    keyword: str = Query(..., min_length=1, max_length=200),
    extension: Optional[str] = Query(None),
    is_dir: Optional[bool] = Query(False),
    min_size: Optional[int] = Query(None, ge=0),
    max_size: Optional[int] = Query(None, ge=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    # 支持已完成 (ACTIVE) 及正在爬取中 (PENDING) 的实时检索，过滤失效/封禁链接
    base_conditions = [Share.status.in_([ShareStatus.ACTIVE.value, ShareStatus.PENDING.value]), File.is_dir == is_dir]
    clean_kw = keyword.strip()
    base_conditions.append(File.full_path.ilike(f"%{clean_kw}%"))
    if extension:
        base_conditions.append(File.extension == extension.strip().lstrip(".").lower())
    if min_size is not None:
        base_conditions.append(File.size >= min_size)
    if max_size is not None:
        base_conditions.append(File.size <= max_size)

    count_q = select(func.count(File.id)).join(Share, File.share_id == Share.id).where(*base_conditions)
    total_records = (await db.execute(count_q)).scalar() or 0

    offset = (page - 1) * page_size
    data_q = (
        select(File, Share)
        .join(Share, File.share_id == Share.id)
        .where(*base_conditions)
        .order_by(File.id.desc())
        .offset(offset)
        .limit(page_size)
    )
    rows = (await db.execute(data_q)).all()

    items = []
    for file_obj, share_obj in rows:
        pwd_suffix = f"?password={share_obj.receive_code}" if share_obj.receive_code else ""
        items.append(SearchResultItem(
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
            share_url=f"https://115.com/s/{share_obj.share_code}{pwd_suffix}",
            openlist_mount_cid=file_obj.file_115_id,
        ))

    total_pages = math.ceil(total_records / page_size) if total_records > 0 else 0
    return SearchResponse(
        keyword=clean_kw, total=total_records, page=page, page_size=page_size, total_pages=total_pages, items=items
    )


@app.get("/api/v1/shares/{share_code}/files", response_model=DirectoryListResponse)
async def list_share_directory(share_code: str, parent_115_id: str = Query("0"), db: AsyncSession = Depends(get_db)):
    stmt = select(Share).where(Share.share_code == share_code)
    share_obj = (await db.execute(stmt)).scalar_one_or_none()
    if not share_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")

    files_stmt = (
        select(File)
        .where(File.share_id == share_obj.id, File.parent_115_id == parent_115_id)
        .order_by(File.is_dir.desc(), File.name.asc())
    )
    rows = (await db.execute(files_stmt)).scalars().all()
    items = [
        FileTreeNode(
            id=f.id, file_115_id=f.file_115_id, parent_115_id=f.parent_115_id,
            name=f.name, extension=f.extension, size=f.size,
            formatted_size=format_size(f.size), is_dir=f.is_dir, sha1=f.sha1, full_path=f.full_path
        )
        for f in rows
    ]
    return DirectoryListResponse(share_code=share_code, parent_115_id=parent_115_id, total=len(items), items=items)


@app.post("/api/v1/shares/{share_code}/report", response_model=ReportShareResponse)
async def report_invalid_share(share_code: str, payload: ReportShareRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(Share).where(Share.share_code == share_code)
    share_obj = (await db.execute(stmt)).scalar_one_or_none()
    if not share_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")

    new_status = ShareStatus.BANNED.value if payload.reason == "banned" else ShareStatus.EXPIRED.value
    share_obj.status = new_status
    await db.commit()
    return ReportShareResponse(share_code=share_code, status=new_status, message="已成功标记该分享为失效状态。")`
  }
];
