from typing import Optional
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
    WS_CHANNEL_NAME: str = "115_share_ws_events"

    # 115 Crawler Engine Settings (Optimized for High Throughput & Proxy Pool Rotation)
    CRAWLER_USER_AGENT: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    )
    CRAWLER_COOKIE: str = Field(default="", description="Optional 115 VIP/User Cookie to bypass rate limits")
    CRAWLER_REFERER: str = "https://115.com/"
    CRAWLER_SNAP_URL: str = "https://webapi.115.com/share/snap"
    CRAWLER_DEFAULT_METHOD: str = "GET"  # 115 web client uses GET for /share/snap (with automatic fallback to POST)
    CRAWLER_PAGE_SIZE: int = 100   # 115 Snap API standard safe batch size (100 or 115)
    CRAWLER_CONCURRENCY: int = 16  # Parallel directory worker tasks per share (boosted for multi-proxy traversal)
    CRAWLER_BATCH_UPSERT_SIZE: int = 1000  # Pipeline DB batch write size
    CRAWLER_RATE_MIN: float = 0.15  # Minimum delay between requests per proxy node (seconds)
    CRAWLER_RATE_MAX: float = 0.35  # Maximum delay between requests per proxy node (seconds)
    CRAWLER_BACKOFF_ON_405: float = 3.0  # Cooldown seconds when 115 WAF returns 405
    CRAWLER_MAX_RETRIES: int = 5
    CRAWLER_TIMEOUT: float = 25.0

    # Worker Settings
    CONCURRENCY: int = 4
    STUCK_TASK_CHECK_INTERVAL: int = Field(
        default=60,
        description="Interval in seconds for background periodic scanning of stuck pending tasks"
    )
    STUCK_TASK_TIMEOUT_SECONDS: int = Field(
        default=300,
        description="Threshold in seconds (e.g. 5 minutes = 300s) to consider a PENDING task deadlocked and re-enqueue"
    )

    # Proxy Pool Settings (代理池与防封禁中继)
    PROXY_MODE: str = Field(
        default="OFF", 
        description="Proxy mode: 'OFF' (direct), 'STATIC' (single proxy), 'POOL_API' (dynamic HTTP API), 'CUSTOM_LIST' (multi static)"
    )
    PROXY_URL: Optional[str] = Field(
        default=None, 
        description="Single proxy URL (e.g. http://127.0.0.1:7890 or socks5://127.0.0.1:1080)"
    )
    PROXY_POOL_API: Optional[str] = Field(
        default=None, 
        description="Dynamic proxy pool API endpoint (e.g. http://127.0.0.1:5010/get_all/ or http://api.proxy.com/get?num=20)"
    )
    PROXY_POOL_LIST: Optional[str] = Field(
        default=None, 
        description="Comma or newline separated list of proxy URLs (for CUSTOM_LIST mode)"
    )
    PROXY_ROTATION_STRATEGY: str = Field(
        default="least_busy", 
        description="Rotation strategy: 'least_busy' (optimal for multi-proxy), 'rotate_per_request', 'round_robin', 'rotate_on_error'"
    )
    PROXY_POOL_REFRESH_INTERVAL: int = Field(
        default=600, 
        description="Interval in seconds to auto-refresh proxy pool from API (e.g. 600s = 10 mins)"
    )
    PROXY_POOL_MIN_AVAILABLE_THRESHOLD: int = Field(
        default=3,
        description="Minimum number of healthy available proxies; if available count drops below this, fetch from API on demand"
    )
    PROXY_POOL_FETCH_COOLDOWN: float = Field(
        default=15.0,
        description="Minimum interval in seconds between consecutive API fetches to prevent hitting provider rate limits"
    )
    PROXY_MAX_CONSECUTIVE_FAILURES: int = Field(
        default=3, 
        description="Max consecutive errors before temporary blacklisting a proxy"
    )
    PROXY_BAN_DURATION_405: float = Field(
        default=60.0, 
        description="Seconds to quarantine a proxy that triggered 115 WAF 405"
    )
    PROXY_HEALTH_CHECK_INTERVAL: int = Field(
        default=60,
        description="Interval in seconds for background periodic health check of all proxies in pool against 115 API"
    )
    PROXY_HEALTH_CHECK_CONCURRENCY: int = Field(
        default=5,
        description="Max concurrent probe requests during background proxy health checks"
    )
    PROXY_TIMEOUT: float = Field(
        default=12.0, 
        description="Proxy connection timeout in seconds"
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
