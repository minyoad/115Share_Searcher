import asyncio
import json
import logging
import signal
import uuid
from typing import Optional

import redis.asyncio as aioredis

from app.config import settings
from app.crawler import Crawler115Engine, ShareCrawlerError
from app.database import AsyncSessionLocal, init_db

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
    Worker process entrypoint. Spawns concurrent consumers.
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

    logger.info(f"Starting {settings.CONCURRENCY} background crawler workers...")
    tasks = [
        asyncio.create_task(worker_loop(i + 1, stop_event))
        for i in range(settings.CONCURRENCY)
    ]

    await stop_event.wait()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

    if redis_client:
        await redis_client.close()
    logger.info("All background crawler workers stopped.")


if __name__ == "__main__":
    asyncio.run(main())
