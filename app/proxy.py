import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import SystemSetting

logger = logging.getLogger("app.proxy")

CONFIG_KEY_PROXY = "proxy_config"


@dataclass
class ProxyNode:
    """单个代理节点元数据"""
    url: str
    protocol: str = "http"  # http, https, socks5, socks5h
    success_count: int = 0
    failure_count: int = 0
    consecutive_failures: int = 0
    is_banned_405: bool = False
    banned_until: float = 0.0
    last_used_at: float = 0.0
    last_latency_ms: float = 0.0
    error_reasons: List[str] = field(default_factory=list)

    @property
    def is_available(self) -> bool:
        now = time.time()
        if self.is_banned_405 and now < self.banned_until:
            return False
        if self.consecutive_failures >= settings.PROXY_MAX_CONSECUTIVE_FAILURES:
            # 连续失败过多且未到冷却重试期（2分钟重试一次）
            if now - self.last_used_at < 120.0:
                return False
        return True

    def mark_success(self, latency_ms: float = 0.0):
        self.success_count += 1
        self.consecutive_failures = 0
        self.is_banned_405 = False
        self.banned_until = 0.0
        self.last_used_at = time.time()
        self.last_latency_ms = latency_ms

    def mark_failure(self, is_405: bool = False, reason: str = ""):
        self.failure_count += 1
        self.consecutive_failures += 1
        self.last_used_at = time.time()
        if is_405:
            self.is_banned_405 = True
            self.banned_until = time.time() + settings.PROXY_BAN_DURATION_405
            logger.warning(
                f"[ProxyPool] Proxy {self.url} triggered 115 WAF 405. "
                f"Quarantined for {settings.PROXY_BAN_DURATION_405}s."
            )
        if reason:
            if len(self.error_reasons) > 5:
                self.error_reasons.pop(0)
            self.error_reasons.append(f"{time.strftime('%H:%M:%S')}: {reason}")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "url": self.url,
            "protocol": self.protocol,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "consecutive_failures": self.consecutive_failures,
            "is_available": self.is_available,
            "is_banned_405": self.is_banned_405,
            "banned_remaining_sec": max(0, int(self.banned_until - time.time())) if self.is_banned_405 else 0,
            "last_latency_ms": round(self.last_latency_ms, 1),
            "recent_errors": self.error_reasons[-3:],
        }


class ProxyManager:
    """
    生产级 115 爬虫代理池与智能调度管理器
    - 支持 直连 / 单静态代理 / 多静态代理列表 / 动态 HTTP 代理池 API
    - 支持 自动轮询 (Round-Robin)、遇错切换 (Rotate-on-Error)、单请求单IP (Rotate-per-Request)
    - 针对 115 405 封禁自动触发 IP 熔断隔离，防止死磕同个被封 IP
    - 后台定时异步自动同步最新代理列表
    """
    _instance: Optional["ProxyManager"] = None

    def __init__(self):
        self.mode = settings.PROXY_MODE.upper()  # OFF, STATIC, POOL_API, CUSTOM_LIST
        self.pool: Dict[str, ProxyNode] = {}
        self.lock = asyncio.Lock()
        self.current_index = 0
        self.last_refresh_time: float = 0.0
        self.refresh_task: Optional[asyncio.Task] = None
        self._current_sticky_proxy: Optional[str] = None
        self._initialized = False

    @classmethod
    def get_instance(cls) -> "ProxyManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @staticmethod
    def _normalize_proxy_url(raw_proxy: str) -> str:
        raw = raw_proxy.strip()
        if not raw:
            return ""
        if "://" not in raw:
            return f"http://{raw}"
        return raw

    async def sync_from_storage(self, force: bool = False) -> bool:
        """
        从数据库持久化存储 (system_settings 表) 同步最新的代理配置
        实现跨进程 (API 与 Worker 容器) 实时配置同步以及重启后持久化
        """
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SystemSetting).where(SystemSetting.key == CONFIG_KEY_PROXY)
                )
                setting_obj = result.scalar_one_or_none()
                if setting_obj and setting_obj.value:
                    data = json.loads(setting_obj.value)
                    
                    changed = False
                    new_mode = str(data.get("mode") or settings.PROXY_MODE).upper()
                    new_proxy_url = str(data.get("proxy_url") or "")
                    new_pool_api = str(data.get("proxy_pool_api") or "")
                    new_pool_list = str(data.get("proxy_pool_list") or "")
                    new_strategy = str(data.get("rotation_strategy") or settings.PROXY_ROTATION_STRATEGY)
                    new_interval = int(data.get("refresh_interval") or settings.PROXY_POOL_REFRESH_INTERVAL)

                    if (
                        new_mode != settings.PROXY_MODE
                        or new_proxy_url != settings.PROXY_URL
                        or new_pool_api != settings.PROXY_POOL_API
                        or new_pool_list != settings.PROXY_POOL_LIST
                        or new_strategy != settings.PROXY_ROTATION_STRATEGY
                        or new_interval != settings.PROXY_POOL_REFRESH_INTERVAL
                    ):
                        changed = True

                    settings.PROXY_MODE = new_mode
                    settings.PROXY_URL = new_proxy_url
                    settings.PROXY_POOL_API = new_pool_api
                    settings.PROXY_POOL_LIST = new_pool_list
                    settings.PROXY_ROTATION_STRATEGY = new_strategy
                    settings.PROXY_POOL_REFRESH_INTERVAL = new_interval
                    self.mode = new_mode

                    if changed or force or not self._initialized:
                        logger.info(
                            f"[ProxyManager] Applied persistent proxy config from DB: "
                            f"mode={self.mode}, strategy={settings.PROXY_ROTATION_STRATEGY}, "
                            f"api={settings.PROXY_POOL_API[:30] if settings.PROXY_POOL_API else 'none'}"
                        )
                        self._initialized = False
                        self.pool.clear()
                        self._current_sticky_proxy = None
                        await self.initialize()
                        return True
        except Exception as exc:
            logger.warning(f"[ProxyManager] Failed to sync proxy config from DB: {exc}")
        return False

    async def save_config(self, config_data: Dict[str, Any]):
        """
        保存代理配置到数据库 (跨容器持久化)，并即刻热更新当前进程
        """
        # 1. 提取或回退
        mode = config_data.get("mode")
        if mode is not None:
            settings.PROXY_MODE = str(mode).upper()
            self.mode = settings.PROXY_MODE

        if config_data.get("proxy_url") is not None:
            settings.PROXY_URL = str(config_data["proxy_url"]).strip()

        if config_data.get("proxy_pool_api") is not None:
            settings.PROXY_POOL_API = str(config_data["proxy_pool_api"]).strip()

        if config_data.get("proxy_pool_list") is not None:
            settings.PROXY_POOL_LIST = str(config_data["proxy_pool_list"]).strip()

        if config_data.get("rotation_strategy") is not None:
            settings.PROXY_ROTATION_STRATEGY = str(config_data["rotation_strategy"]).strip()

        if config_data.get("refresh_interval") is not None:
            settings.PROXY_POOL_REFRESH_INTERVAL = int(config_data["refresh_interval"])

        # 2. 持久化到 PostgreSQL
        save_payload = {
            "mode": settings.PROXY_MODE,
            "proxy_url": settings.PROXY_URL,
            "proxy_pool_api": settings.PROXY_POOL_API,
            "proxy_pool_list": settings.PROXY_POOL_LIST,
            "rotation_strategy": settings.PROXY_ROTATION_STRATEGY,
            "refresh_interval": settings.PROXY_POOL_REFRESH_INTERVAL,
        }

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SystemSetting).where(SystemSetting.key == CONFIG_KEY_PROXY)
                )
                setting_obj = result.scalar_one_or_none()
                if setting_obj is None:
                    setting_obj = SystemSetting(
                        key=CONFIG_KEY_PROXY,
                        value=json.dumps(save_payload, ensure_ascii=False)
                    )
                    db.add(setting_obj)
                else:
                    setting_obj.value = json.dumps(save_payload, ensure_ascii=False)
                await db.commit()
                logger.info("[ProxyManager] Successfully persisted proxy configuration to PostgreSQL database!")
        except Exception as exc:
            logger.error(f"[ProxyManager] Failed to persist proxy config to DB: {exc}")

        # 3. 重新初始化当前实例
        self._initialized = False
        self.pool.clear()
        self._current_sticky_proxy = None
        if self.refresh_task and not self.refresh_task.done():
            self.refresh_task.cancel()
            self.refresh_task = None
        await self.initialize()

    async def initialize(self):
        """初始化代理池并启动后台刷新定时任务"""
        if self._initialized:
            return
        async with self.lock:
            if self._initialized:
                return
            
            logger.info(f"[ProxyManager] Initializing proxy subsystem in mode='{self.mode}'...")

            if self.mode == "STATIC" and settings.PROXY_URL:
                url = self._normalize_proxy_url(settings.PROXY_URL)
                self.pool[url] = ProxyNode(url=url)
                self._current_sticky_proxy = url
                logger.info(f"[ProxyManager] Loaded static upstream proxy: {url}")

            elif self.mode == "CUSTOM_LIST" and settings.PROXY_POOL_LIST:
                raw_list = [
                    p.strip()
                    for p in settings.PROXY_POOL_LIST.replace("\n", ",").split(",")
                    if p.strip()
                ]
                for raw in raw_list:
                    url = self._normalize_proxy_url(raw)
                    self.pool[url] = ProxyNode(url=url)
                logger.info(f"[ProxyManager] Loaded {len(self.pool)} static custom proxies.")

            elif self.mode == "POOL_API" and settings.PROXY_POOL_API:
                await self._fetch_from_api_unlocked()
                logger.info(f"[ProxyManager] Initial pool API sync loaded {len(self.pool)} proxies.")

            self._initialized = True

            # 启动后台守护定时刷新任务
            if self.mode == "POOL_API" and settings.PROXY_POOL_API:
                if self.refresh_task is None or self.refresh_task.done():
                    self.refresh_task = asyncio.create_task(self._auto_refresh_loop())

    async def _auto_refresh_loop(self):
        """后台定时维护动态代理池 (仅当可用代理不足或长期未更新时温和补充)"""
        while True:
            try:
                await asyncio.sleep(settings.PROXY_POOL_REFRESH_INTERVAL)
                # 只有当可用节点不足阈值时才进行定时拉取，避免无谓消耗 API 次数
                available_count = sum(1 for p in self.pool.values() if p.is_available)
                if available_count < settings.PROXY_POOL_MIN_AVAILABLE_THRESHOLD:
                    logger.info(
                        f"[ProxyManager] Available proxies ({available_count}) below threshold "
                        f"({settings.PROXY_POOL_MIN_AVAILABLE_THRESHOLD}), performing routine API refresh..."
                    )
                    await self.refresh_pool(force=False)
                else:
                    logger.debug(
                        f"[ProxyManager] Routine check skipped: healthy proxies available ({available_count} >= {settings.PROXY_POOL_MIN_AVAILABLE_THRESHOLD})"
                    )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"[ProxyManager] Auto-refresh loop error: {exc}")

    async def _fetch_from_api_unlocked(self, force: bool = False) -> int:
        """从配置的代理池 API 拉取 IP 列表 (带请求冷却保护)"""
        api_url = settings.PROXY_POOL_API
        if not api_url:
            return 0

        now = time.time()
        # 频率冷却保护：防止短时间内多次并发请求打满上游代理商 API 限频
        if not force and (now - self.last_refresh_time) < settings.PROXY_POOL_FETCH_COOLDOWN:
            logger.debug(
                f"[ProxyManager] Fetch skipped due to cooldown "
                f"({now - self.last_refresh_time:.1f}s < {settings.PROXY_POOL_FETCH_COOLDOWN}s)"
            )
            return len(self.pool)

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                res = await client.get(api_url)
                if res.status_code != 200:
                    logger.warning(f"[ProxyManager] Proxy pool API returned HTTP {res.status_code}: {res.text[:100]}")
                    return 0

                new_proxies: List[str] = []
                content_type = res.headers.get("content-type", "")

                # 1. 尝试解析 JSON 格式
                try:
                    data = res.json()
                    if isinstance(data, list):
                        for item in data:
                            if isinstance(item, str):
                                new_proxies.append(item)
                            elif isinstance(item, dict):
                                proxy_str = item.get("proxy") or item.get("ip_port") or item.get("url") or f"{item.get('ip')}:{item.get('port')}"
                                if proxy_str and ":" in proxy_str:
                                    new_proxies.append(proxy_str)
                    elif isinstance(data, dict):
                        # 处理 standard proxy_pool 格式: {"proxy": "1.2.3.4:8080"} or {"data": [...]}
                        if "proxy" in data:
                            new_proxies.append(str(data["proxy"]))
                        elif "data" in data and isinstance(data["data"], list):
                            for item in data["data"]:
                                if isinstance(item, str):
                                    new_proxies.append(item)
                                elif isinstance(item, dict):
                                    proxy_str = item.get("proxy") or f"{item.get('ip')}:{item.get('port')}"
                                    if proxy_str:
                                        new_proxies.append(proxy_str)
                except Exception:
                    # 2. 回退解析换行文本格式 (例如: 1.2.3.4:8080\n2.3.4.5:8080)
                    lines = [line.strip() for line in res.text.splitlines() if line.strip()]
                    for line in lines:
                        if ":" in line and not line.startswith("{") and not line.startswith("<"):
                            new_proxies.append(line)

                # 更新入池
                added_count = 0
                for raw in new_proxies:
                    normalized = self._normalize_proxy_url(raw)
                    if normalized and normalized not in self.pool:
                        self.pool[normalized] = ProxyNode(url=normalized)
                        added_count += 1

                self.last_refresh_time = time.time()
                logger.info(
                    f"[ProxyManager] Fetched from API: total received={len(new_proxies)}, "
                    f"new added={added_count}, current pool size={len(self.pool)}"
                )
                return len(self.pool)

        except Exception as exc:
            logger.error(f"[ProxyManager] Failed to fetch proxies from API ({api_url}): {exc}")
            return 0

    async def refresh_pool(self, force: bool = True) -> int:
        """手动或定时触发刷新"""
        async with self.lock:
            if self.mode != "POOL_API":
                return len(self.pool)
            return await self._fetch_from_api_unlocked(force=force)

    async def get_proxy(self, force_rotate: bool = False) -> Optional[str]:
        """
        获取一个可用代理 URL
        若代理模式为 OFF 则直接返回 None (直连)
        """
        if self.mode == "OFF":
            return None

        if not self._initialized:
            await self.initialize()

        async with self.lock:
            if not self.pool:
                if self.mode == "POOL_API":
                    await self._fetch_from_api_unlocked()
                if not self.pool:
                    logger.warning("[ProxyManager] No proxy configured or pool is empty. Falling back to direct connection.")
                    return None

            available_nodes = [node for node in self.pool.values() if node.is_available]
            if not available_nodes:
                logger.warning("[ProxyManager] All proxies in pool are quarantined or failed. Attempting force refresh...")
                if self.mode == "POOL_API":
                    await self._fetch_from_api_unlocked()
                    available_nodes = [node for node in self.pool.values() if node.is_available]

                if not available_nodes:
                    # 如果仍然没有，解封一些非 405 节点
                    available_nodes = list(self.pool.values())

            strategy = settings.PROXY_ROTATION_STRATEGY

            if strategy == "rotate_per_request" or force_rotate:
                chosen = random.choice(available_nodes)
                self._current_sticky_proxy = chosen.url
                return chosen.url

            elif strategy == "round_robin":
                self.current_index = (self.current_index + 1) % len(available_nodes)
                chosen = available_nodes[self.current_index]
                self._current_sticky_proxy = chosen.url
                return chosen.url

            else:  # rotate_on_error / sticky
                if self._current_sticky_proxy and self._current_sticky_proxy in self.pool:
                    sticky_node = self.pool[self._current_sticky_proxy]
                    if sticky_node.is_available and not force_rotate:
                        return self._current_sticky_proxy

                chosen = random.choice(available_nodes)
                self._current_sticky_proxy = chosen.url
                return chosen.url

    async def mark_success(self, proxy_url: Optional[str], latency_ms: float = 0.0):
        if not proxy_url:
            return
        async with self.lock:
            if proxy_url in self.pool:
                self.pool[proxy_url].mark_success(latency_ms)

    async def mark_failure(self, proxy_url: Optional[str], is_405: bool = False, reason: str = ""):
        if not proxy_url:
            return
        async with self.lock:
            if proxy_url in self.pool:
                self.pool[proxy_url].mark_failure(is_405=is_405, reason=reason)
                # 如果当前 sticky 代理失败，清空 sticky 促使下次换新 IP
                if self._current_sticky_proxy == proxy_url:
                    self._current_sticky_proxy = None

    async def test_proxy(self, proxy_url: Optional[str] = None) -> Dict[str, Any]:
        """测试指定代理或当前可用代理对 115 的连通性"""
        target_proxy = proxy_url or await self.get_proxy()
        start_time = time.time()

        test_target = "https://webapi.115.com/share/snap"

        headers = {
            "User-Agent": settings.CRAWLER_USER_AGENT,
            "Referer": "https://115.com/",
            "Accept": "application/json, text/plain, */*",
        }

        result = {
            "proxy_url": target_proxy or "DIRECT (直连)",
            "target": test_target,
            "status": "pending",
            "latency_ms": 0,
            "http_status": None,
            "error": None,
        }

        try:
            async with httpx.AsyncClient(
                proxy=target_proxy,
                timeout=settings.PROXY_TIMEOUT,
                verify=False,
                follow_redirects=True
            ) as client:
                res = await client.get(
                    test_target,
                    params={"share_code": "test_ping_share", "receive_code": "0000"},
                    headers=headers,
                )
                latency = (time.time() - start_time) * 1000
                result["latency_ms"] = round(latency, 1)
                result["http_status"] = res.status_code

                if res.status_code in (200, 400, 403, 404):
                    # 115 API 返回 200 (甚至业务 state=false) 均说明代理与 115 连通正常且未被 WAF 405 拦截
                    result["status"] = "success"
                    if target_proxy:
                        await self.mark_success(target_proxy, latency)
                elif res.status_code == 405:
                    result["status"] = "waf_405_blocked"
                    result["error"] = "115 WAF 返回 405 拦截，该代理已被 115 边缘防火墙限速或封禁"
                    if target_proxy:
                        await self.mark_failure(target_proxy, is_405=True, reason="405 WAF Blocked")
                else:
                    result["status"] = "http_error"
                    result["error"] = f"115 返回异常状态码: HTTP {res.status_code}"
                    if target_proxy:
                        await self.mark_failure(target_proxy, is_405=False, reason=f"HTTP {res.status_code}")

        except Exception as exc:
            latency = (time.time() - start_time) * 1000
            result["latency_ms"] = round(latency, 1)
            result["status"] = "connect_failed"
            result["error"] = str(exc)
            if target_proxy:
                await self.mark_failure(target_proxy, is_405=False, reason=str(exc)[:50])

        return result

    def get_status(self) -> Dict[str, Any]:
        """获取代理系统运行指标摘要"""
        total = len(self.pool)
        available = sum(1 for p in self.pool.values() if p.is_available)
        banned_405 = sum(1 for p in self.pool.values() if p.is_banned_405 and p.banned_until > time.time())
        failed = sum(1 for p in self.pool.values() if p.consecutive_failures >= settings.PROXY_MAX_CONSECUTIVE_FAILURES)

        total_success = sum(p.success_count for p in self.pool.values())
        total_failures = sum(p.failure_count for p in self.pool.values())

        # 示例展示前 8 个节点
        nodes_summary = [node.to_dict() for node in list(self.pool.values())[:8]]

        return {
            "mode": self.mode,
            "rotation_strategy": settings.PROXY_ROTATION_STRATEGY,
            "proxy_url": settings.PROXY_URL,
            "proxy_pool_api": settings.PROXY_POOL_API,
            "proxy_pool_list": settings.PROXY_POOL_LIST,
            "total_proxies": total,
            "available_proxies": available,
            "banned_405_count": banned_405,
            "failed_count": failed,
            "total_success_requests": total_success,
            "total_failed_requests": total_failures,
            "current_sticky_proxy": self._current_sticky_proxy,
            "last_refresh_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.last_refresh_time)) if self.last_refresh_time else None,
            "refresh_interval_sec": settings.PROXY_POOL_REFRESH_INTERVAL,
            "api_endpoint": settings.PROXY_POOL_API if self.mode == "POOL_API" else None,
            "sample_nodes": nodes_summary,
        }
