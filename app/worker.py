import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import signal
import uuid
from typing import List, Optional

import redis.asyncio as aioredis
from sqlalchemy import func, select

from app.config import settings
from app.crawler import Crawler115Engine, ShareCrawlerError
from app.database import AsyncSessionLocal, init_db
from app.models import Share, ShareStatus

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s"
)
logger = logging.getLogger("app.worker")

# Shared Redis Client
redis_client: Optional[aioredis.Redis] = None


async def get_redis_client() -> aioredis.Redis:
    global redis_client
    if redis_client is None:
        redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True
        )
    return redis_client


async def enqueue_crawl_task(share_code: str, receive_code: str = "") -> str:
    """
    Push a new crawl task into Redis Queue (FIFO list).
    Returns task_id.
    """
    client = await get_redis_client()
    task_id = str(uuid.uuid4())
    payload = {
        "task_id": task_id,
        "share_code": share_code,
        "receive_code": receive_code,
    }
    await client.lpush(settings.QUEUE_NAME, json.dumps(payload))
    logger.info(f"Enqueued crawl task {task_id} for share_code={share_code}")
    return task_id


async def recover_stuck_pending_shares(timeout_seconds: Optional[int] = None) -> int:
    """
    定期扫描并恢复数据库中状态为 PENDING (status=0) 且 last_crawled_at / created_at 超过超时阈值（默认 5 分钟）的卡死任务，
    自动更新其时间戳并重新加入 Redis 爬取队列，彻底解决因 Worker 异常崩溃、容器重启或网络中断导致的死锁问题。
    """
    effective_timeout = timeout_seconds or settings.STUCK_TASK_TIMEOUT_SECONDS
    cutoff_time = datetime.now(timezone.utc) - timedelta(seconds=effective_timeout)
    recovered_count = 0

    async with AsyncSessionLocal() as session:
        try:
            # 查询 status=0 且 (last_crawled_at < cutoff 或 (last_crawled_at 为空且 created_at < cutoff))
            stmt = (
                select(Share)
                .where(
                    Share.status == ShareStatus.PENDING.value,
                    func.coalesce(Share.last_crawled_at, Share.created_at) < cutoff_time,
                )
                .order_by(Share.id.asc())
                .limit(100)
            )
            result = await session.execute(stmt)
            stuck_shares: List[Share] = list(result.scalars().all())

            if not stuck_shares:
                logger.debug(f"[Deadlock-Scanner] No stuck pending tasks found (threshold: {effective_timeout}s).")
                return 0

            logger.warning(
                f"[Deadlock-Scanner] Detected {len(stuck_shares)} deadlocked pending share(s) "
                f"exceeding {effective_timeout}s timeout. Recovering and re-enqueuing..."
            )

            for share in stuck_shares:
                # 刷新时间戳为当前时间，防止在入队等待被消费期间被下一轮巡检重复捕获
                share.last_crawled_at = datetime.now(timezone.utc)
                share.status = ShareStatus.PENDING.value

                # 重新推入 Redis 爬取队列
                await enqueue_crawl_task(
                    share_code=share.share_code,
                    receive_code=share.receive_code or ""
                )
                recovered_count += 1
                logger.info(
                    f"[Deadlock-Scanner] Recovered stuck share: code={share.share_code}, "
                    f"title='{share.title}', original_created_at={share.created_at}"
                )

            await session.commit()
            logger.info(f"[Deadlock-Scanner] Successfully recovered and re-enqueued {recovered_count} stuck share task(s).")
        except Exception as exc:
            logger.error(f"[Deadlock-Scanner] Error during stuck tasks recovery: {exc}", exc_info=True)
            await session.rollback()

    return recovered_count


async def stuck_task_scanner_loop(stop_event: asyncio.Event) -> None:
    """
    后台定期扫描死锁/超时任务的看门狗协程（默认每 60 秒扫描一次）
    """
    check_interval = max(10, settings.STUCK_TASK_CHECK_INTERVAL)
    logger.info(
        f"[Deadlock-Watchdog] Started background watchdog (interval: {check_interval}s, "
        f"timeout threshold: {settings.STUCK_TASK_TIMEOUT_SECONDS}s)"
    )

    # 启动时稍作等待 5 秒，让系统初始化与常规 Worker 准备完毕
    try:
        await asyncio.sleep(5)
    except asyncio.CancelledError:
        return

    while not stop_event.is_set():
        try:
            await recover_stuck_pending_shares()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"[Deadlock-Watchdog] Unexpected error in scanner loop: {exc}", exc_info=True)

        try:
            # 响应式等待，支持服务快速优雅停止
            for _ in range(check_interval):
                if stop_event.is_set():
                    break
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            break

    logger.info("[Deadlock-Watchdog] Background watchdog shutdown completed.")


async def process_task(task_data: dict, crawler: Crawler115Engine) -> None:
    """
    Execute crawl task with independent database session
    """
    task_id = task_data.get("task_id")
    share_code = task_data.get("share_code")
    receive_code = task_data.get("receive_code", "")

    logger.info(f"Processing task {task_id}: share_code={share_code}")
    async with AsyncSessionLocal() as session:
        try:
            await crawler.crawl_and_index(
                db=session,
                share_code=share_code,
                receive_code=receive_code
            )
            logger.info(f"Task {task_id} completed successfully for {share_code}")
        except ShareCrawlerError as err:
            logger.warning(f"Task {task_id} crawler business error for {share_code}: {err}")
        except Exception as exc:
            logger.error(f"Task {task_id} failed unexpectedly for {share_code}: {exc}", exc_info=True)


async def worker_loop(worker_id: int, stop_event: asyncio.Event) -> None:
    """
    Individual concurrent worker consumer loop
    """
    logger.info(f"Worker {worker_id} started, listening on queue '{settings.QUEUE_NAME}'")
    client = await get_redis_client()
    crawler = Crawler115Engine()

    while not stop_event.is_set():
        try:
            # Pop from Redis queue with 2s timeout
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

    logger.info(f"Worker {worker_id} shutdown completed.")


async def main() -> None:
    """
    Worker process entrypoint. Spawns concurrent consumers and deadlock watchdog.
    """
    logger.info("Initializing database connection...")
    await init_db()

    stop_event = asyncio.Event()

    def handle_signal(*_):
        logger.info("Received termination signal, shutting down workers...")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_signal)
        except NotImplementedError:
            pass  # Windows support fallback

    logger.info(
        f"Starting {settings.CONCURRENCY} background crawler workers and deadlock watchdog scanner..."
    )
    worker_tasks = [
        asyncio.create_task(worker_loop(i + 1, stop_event))
        for i in range(settings.CONCURRENCY)
    ]
    scanner_task = asyncio.create_task(stuck_task_scanner_loop(stop_event))

    all_tasks = worker_tasks + [scanner_task]

    await stop_event.wait()
    for task in all_tasks:
        task.cancel()
    await asyncio.gather(*all_tasks, return_exceptions=True)

    if redis_client:
        await redis_client.close()
    logger.info("All background crawler workers and deadlock watchdog stopped.")


if __name__ == "__main__":
    asyncio.run(main())
