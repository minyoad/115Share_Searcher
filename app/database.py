import logging
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
    """Base model for all SQLAlchemy models"""
    pass


# Global Async Engine
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DB_ECHO,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_pre_ping=True,
)

# Async Session Factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI Dependency for database session management.
    Ensures safe session commit/rollback and teardown.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def ensure_database_schema_compatibility() -> None:
    """
    检查并自动补全历史版本 PostgreSQL 数据库的表结构与字段，支持不停机平滑升级。
    如果用户的数据库是在较早版本创建的，防止因缺少 created_at、last_crawled_at 等新增字段
    导致查询崩溃、任务列表变空。
    """
    try:
        async with engine.begin() as conn:
            # 1. 确保 pg_trgm 扩展
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
            
            # 2. 补齐 shares 表可能缺失的字段并清洗数据
            share_migrations = [
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS receive_code VARCHAR(32) DEFAULT '';",
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS title VARCHAR(512) DEFAULT '';",
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS file_count INTEGER DEFAULT 0;",
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS folder_count INTEGER DEFAULT 0;",
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS total_size BIGINT DEFAULT 0;",
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS status SMALLINT DEFAULT 0;",
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ;",
                "ALTER TABLE shares ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();",
                "UPDATE shares SET receive_code = '' WHERE receive_code IS NULL;",
                "UPDATE shares SET file_count = 0 WHERE file_count IS NULL;",
                "UPDATE shares SET folder_count = 0 WHERE folder_count IS NULL;",
                "UPDATE shares SET total_size = 0 WHERE total_size IS NULL;",
                "UPDATE shares SET status = 0 WHERE status IS NULL;",
                "UPDATE shares SET created_at = COALESCE(last_crawled_at, NOW()) WHERE created_at IS NULL;",
                # 优先使用已经抓取到的根目录 (parent_115_id = '0') 名字回填分享任务标题，消除雷同的 '115 分享 (xxxx)' 默认占位
                """
                UPDATE shares s
                SET title = sub.root_name
                FROM (
                    SELECT DISTINCT ON (share_id) 
                        share_id, 
                        name AS root_name
                    FROM files
                    WHERE parent_115_id = '0'
                    ORDER BY share_id, is_dir DESC, id ASC
                ) sub
                WHERE s.id = sub.share_id
                  AND sub.root_name IS NOT NULL 
                  AND TRIM(sub.root_name) != ''
                  AND (s.title IS NULL OR s.title = '' OR s.title LIKE '115 分享 (%)');
                """,
                # 次选：若无 parent_115_id='0' 则按最短路径或顶层文件回填
                """
                UPDATE shares s
                SET title = sub.root_name
                FROM (
                    SELECT DISTINCT ON (share_id) 
                        share_id, 
                        name AS root_name
                    FROM files
                    ORDER BY share_id, is_dir DESC, id ASC
                ) sub
                WHERE s.id = sub.share_id
                  AND sub.root_name IS NOT NULL 
                  AND TRIM(sub.root_name) != ''
                  AND (s.title IS NULL OR s.title = '' OR s.title LIKE '115 分享 (%)');
                """,
                # 若尚未抓取任何文件，则保留规范的默认占位标题
                "UPDATE shares SET title = CONCAT('115 分享 (', share_code, ')') WHERE title IS NULL OR title = '';",
            ]
            for stmt in share_migrations:
                try:
                    await conn.execute(text(stmt))
                except Exception as stmt_err:
                    logger.debug(f"[Migration] Statement skipped or failed: {stmt} -> {stmt_err}")

            # 3. 补齐 files 表可能缺失的字段并清洗数据
            file_migrations = [
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS file_115_id VARCHAR(64);",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS parent_115_id VARCHAR(64) DEFAULT '0';",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS name VARCHAR(512);",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS extension VARCHAR(32) DEFAULT '';",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS size BIGINT DEFAULT 0;",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS is_dir BOOLEAN DEFAULT FALSE;",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS sha1 VARCHAR(40) DEFAULT '';",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS full_path TEXT;",
                "UPDATE files SET parent_115_id = '0' WHERE parent_115_id IS NULL;",
                "UPDATE files SET extension = '' WHERE extension IS NULL;",
                "UPDATE files SET size = 0 WHERE size IS NULL;",
                "UPDATE files SET is_dir = FALSE WHERE is_dir IS NULL;",
                "UPDATE files SET sha1 = '' WHERE sha1 IS NULL;",
            ]
            for stmt in file_migrations:
                try:
                    await conn.execute(text(stmt))
                except Exception as stmt_err:
                    logger.debug(f"[Migration] Statement skipped or failed: {stmt} -> {stmt_err}")

            # 4. 确保 system_settings 配置持久化表存在
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS system_settings (
                    key VARCHAR(64) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            """))

            logger.info("Database schema compatibility verification and migrations completed successfully.")
    except Exception as exc:
        logger.warning(f"Database schema compatibility check encountered non-fatal error: {exc}")


async def init_db() -> None:
    """
    Initializes PostgreSQL database:
    1. Installs 'pg_trgm' extension for high-performance GIN similarity & wildcard search
    2. Creates all tables if not exist
    3. Runs safe auto-migrations for existing databases (adds newly introduced columns)
    4. Auto-seeds initial demo shares if database is completely empty
    """
    # Import models here to ensure they are registered with Base.metadata
    from app.models import File, Share, SystemSetting  # noqa: F401

    async with engine.begin() as conn:
        logger.info("Enabling PostgreSQL pg_trgm extension...")
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        logger.info("Creating database tables...")
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables verified.")

    # 自动执行历史存量数据库平滑迁移 (增补缺失列并清洗 NULL)
    await ensure_database_schema_compatibility()

    # Auto-seed initial demo shares and file tree if empty
    try:
        from app.seed import seed_initial_demo_data
        await seed_initial_demo_data(force=False)
    except Exception as seed_err:
        logger.warning(f"Auto-seed initial demo data skipped or failed: {seed_err}")

    logger.info("Database initialization completed successfully.")
