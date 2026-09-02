from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application Configurations
    Loads from environment variables or .env file
    """
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
    CRAWLER_PAGE_SIZE: int = 1000  # 115 Snap API supports up to 1000/1150 items per call (10x faster)
    CRAWLER_CONCURRENCY: int = 6   # Concurrent directory crawlers per share
    CRAWLER_BATCH_UPSERT_SIZE: int = 1000  # Pipeline DB batch write size
    CRAWLER_RATE_MIN: float = 0.15  # seconds (reduced latency with connection pool)
    CRAWLER_RATE_MAX: float = 0.40  # seconds
    CRAWLER_MAX_RETRIES: int = 4
    CRAWLER_TIMEOUT: float = 20.0

    # Worker Settings
    CONCURRENCY: int = 4

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
