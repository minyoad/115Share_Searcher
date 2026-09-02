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


async def init_db() -> None:
    """
    Initializes PostgreSQL database:
    1. Installs 'pg_trgm' extension for high-performance GIN similarity & wildcard search
    2. Creates all tables if not exist
    """
    async with engine.begin() as conn:
        logger.info("Enabling PostgreSQL pg_trgm extension...")
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        logger.info("Creating database tables...")
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialization completed successfully.")
