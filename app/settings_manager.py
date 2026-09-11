"""
System Settings Manager (全配置项数据库持久化管理器)
将原本分散在 .env 中的所有配置项迁移至 PostgreSQL 的 system_settings 表中，
支持启动自检初始化、数据库持久化保存、Web 管理界面热更新（免重启）、
以及一键恢复出厂默认值。
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import SystemSetting

logger = logging.getLogger("app.settings_manager")


# 定义所有系统配置项的元数据（默认值、类型、所属分类、中文说明、是否敏感）
SYSTEM_CONFIG_REGISTRY: Dict[str, Dict[str, Any]] = {
    # ── 1. 爬虫引擎参数 (Crawler Engine) ──
    "CRAWLER_COOKIE": {
        "default": "",
        "type": "str",
        "category": "crawler",
        "title": "115 VIP/账号 Cookie",
        "description": "可选。填入 115 账号 Cookie（包含 UID/CID/SEID），可大幅提升单 IP 访问限额并支持更深层目录抓取",
        "sensitive": True,
    },
    "CRAWLER_USER_AGENT": {
        "default": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        "type": "str",
        "category": "crawler",
        "title": "请求头 User-Agent",
        "description": "向 115 snap 接口发送请求时使用的浏览器标识字符串",
        "sensitive": False,
    },
    "CRAWLER_REFERER": {
        "default": "https://115.com/",
        "type": "str",
        "category": "crawler",
        "title": "请求头 Referer",
        "description": "向 115 API 请求时的来源页面 Referer，默认 https://115.com/",
        "sensitive": False,
    },
    "CRAWLER_SNAP_URL": {
        "default": "https://webapi.115.com/share/snap",
        "type": "str",
        "category": "crawler",
        "title": "115 Snapshot 接口地址",
        "description": "115 分享目录与文件快照的官方 API 地址",
        "sensitive": False,
    },
    "CRAWLER_DEFAULT_METHOD": {
        "default": "GET",
        "type": "str",
        "category": "crawler",
        "title": "爬虫请求方法",
        "description": "访问 115 snap API 的默认 HTTP 方法 (GET 或 POST)",
        "sensitive": False,
    },
    "CRAWLER_PAGE_SIZE": {
        "default": 100,
        "type": "int",
        "category": "crawler",
        "title": "单批快照文件抓取条数 (limit)",
        "description": "每次向 115 snap 发起请求获取的文件数量，官方安全标准为 100（或 115）",
        "sensitive": False,
    },
    "CRAWLER_CONCURRENCY": {
        "default": 16,
        "type": "int",
        "category": "crawler",
        "title": "单个分享任务目录遍历并发度",
        "description": "在遍历多层级子目录时的协程并发数，配置多代理池时可提高至 24~36",
        "sensitive": False,
    },
    "CRAWLER_RATE_MIN": {
        "default": 0.15,
        "type": "float",
        "category": "crawler",
        "title": "单节点最小请求间隔 (秒)",
        "description": "单个代理或直连 IP 请求之间的最小随机休眠秒数（防频控）",
        "sensitive": False,
    },
    "CRAWLER_RATE_MAX": {
        "default": 0.35,
        "type": "float",
        "category": "crawler",
        "title": "单节点最大请求间隔 (秒)",
        "description": "单个代理或直连 IP 请求之间的最大随机休眠秒数",
        "sensitive": False,
    },
    "CRAWLER_BATCH_UPSERT_SIZE": {
        "default": 1000,
        "type": "int",
        "category": "crawler",
        "title": "数据库批量入库缓冲区条数",
        "description": "抓取过程中累积多少条文件记录执行一次 PostgreSQL 批量 upsert 入库",
        "sensitive": False,
    },
    "CRAWLER_BACKOFF_ON_405": {
        "default": 3.0,
        "type": "float",
        "category": "crawler",
        "title": "触发 405 WAF 拦截退避时间 (秒)",
        "description": "当遭遇 115 API 返回 405 频控拦截时，当前 IP 的强制休眠冷却秒数",
        "sensitive": False,
    },
    "CRAWLER_MAX_RETRIES": {
        "default": 5,
        "type": "int",
        "category": "crawler",
        "title": "单次请求最大失败重试次数",
        "description": "网络波动或超时时的最大指数退避重试次数",
        "sensitive": False,
    },
    "CRAWLER_TIMEOUT": {
        "default": 25.0,
        "type": "float",
        "category": "crawler",
        "title": "爬虫单次 HTTP 请求超时 (秒)",
        "description": "访问 115 snap 接口的超时时间阈值",
        "sensitive": False,
    },

    # ── 2. 后台 Worker 与死锁抢救调度参数 (Worker & Watchdog) ──
    "CONCURRENCY": {
        "default": 4,
        "type": "int",
        "category": "worker",
        "title": "后台 Worker 协程消费并发数",
        "description": "监听 Redis 任务队列的 Worker 数量，决定可同时并行抓取多少个不同的分享链接",
        "sensitive": False,
    },
    "STUCK_TASK_CHECK_INTERVAL": {
        "default": 60,
        "type": "int",
        "category": "worker",
        "title": "死锁抢救扫描周期 (秒)",
        "description": "后台看门狗定时扫描处于 PENDING 僵死任务的间隔时间",
        "sensitive": False,
    },
    "STUCK_TASK_TIMEOUT_SECONDS": {
        "default": 300,
        "type": "int",
        "category": "worker",
        "title": "任务僵死超时判定阈值 (秒)",
        "description": "超过该秒数未更新且状态为 PENDING 的任务将被自动抢救重新推入队列（默认 300 秒 = 5 分钟）",
        "sensitive": False,
    },

    # ── 3. 代理池与网络中继 (Proxy Pool) ──
    "PROXY_MODE": {
        "default": "OFF",
        "type": "str",
        "category": "proxy",
        "title": "代理模式",
        "description": "可选值: OFF (直连), STATIC (单静态代理), POOL_API (动态提取接口), CUSTOM_LIST (静态列表)",
        "sensitive": False,
    },
    "PROXY_URL": {
        "default": "",
        "type": "str",
        "category": "proxy",
        "title": "单个静态代理地址",
        "description": "如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080",
        "sensitive": False,
    },
    "PROXY_POOL_API": {
        "default": "",
        "type": "str",
        "category": "proxy",
        "title": "动态代理池 API 提取地址",
        "description": "如 http://api.proxy.com/get?num=20 或开源代理池接口",
        "sensitive": False,
    },
    "PROXY_POOL_LIST": {
        "default": "",
        "type": "str",
        "category": "proxy",
        "title": "多静态代理地址列表",
        "description": "逗号或换行分隔的多个代理 URL",
        "sensitive": False,
    },
    "PROXY_ROTATION_STRATEGY": {
        "default": "least_busy",
        "type": "str",
        "category": "proxy",
        "title": "代理轮询策略",
        "description": "可选: least_busy (最闲优先), rotate_per_request (按请求切换), round_robin (轮询), rotate_on_error (遇错切换)",
        "sensitive": False,
    },
    "PROXY_POOL_REFRESH_INTERVAL": {
        "default": 600,
        "type": "int",
        "category": "proxy",
        "title": "动态代理池自动刷新周期 (秒)",
        "description": "定期从 POOL_API 提取新代理并维护健康池的间隔秒数",
        "sensitive": False,
    },
    "PROXY_POOL_MIN_AVAILABLE_THRESHOLD": {
        "default": 3,
        "type": "int",
        "category": "proxy",
        "title": "代理池最小可用健康节点数",
        "description": "当健康可用节点数少于此值时，自动触发动态拉取",
        "sensitive": False,
    },
    "PROXY_POOL_FETCH_COOLDOWN": {
        "default": 15.0,
        "type": "float",
        "category": "proxy",
        "title": "代理提取接口防刷冷却时间 (秒)",
        "description": "两次调用第三方代理商 API 之间的强制安全冷却时间",
        "sensitive": False,
    },
    "PROXY_MAX_CONSECUTIVE_FAILURES": {
        "default": 3,
        "type": "int",
        "category": "proxy",
        "title": "代理最大连续失败熔断阈值",
        "description": "连续失败超过此次数的代理将被临时隔离移出活动池",
        "sensitive": False,
    },
    "PROXY_BAN_DURATION_405": {
        "default": 60.0,
        "type": "float",
        "category": "proxy",
        "title": "代理 405 违规隔离时长 (秒)",
        "description": "若某代理触发 115 频控，将其隔离的秒数（隔离结束后自动重新探活）",
        "sensitive": False,
    },
    "PROXY_HEALTH_CHECK_INTERVAL": {
        "default": 60,
        "type": "int",
        "category": "proxy",
        "title": "代理池后台探活周期 (秒)",
        "description": "定期向 115 测活所有在池代理的间隔时间",
        "sensitive": False,
    },
    "PROXY_HEALTH_CHECK_CONCURRENCY": {
        "default": 5,
        "type": "int",
        "category": "proxy",
        "title": "代理探活并发度",
        "description": "执行健康检查时的最大并行协程数",
        "sensitive": False,
    },
    "PROXY_TIMEOUT": {
        "default": 12.0,
        "type": "float",
        "category": "proxy",
        "title": "代理连接超时 (秒)",
        "description": "代理节点单次握手与请求超时时间",
        "sensitive": False,
    },

    # ── 4. 全局与管理授权 (Auth & General) ──
    "ADMIN_AUTH_ENABLED": {
        "default": True,
        "type": "bool",
        "category": "auth",
        "title": "管理权限验证开关",
        "description": "开启后，查看任务详情、配置代理、修改配置等管理操作需要输入管理密码",
        "sensitive": False,
    },
    "PROJECT_NAME": {
        "default": "115 Share Search Service",
        "type": "str",
        "category": "general",
        "title": "系统名称",
        "description": "展示在页面与接口头部的应用名称",
        "sensitive": False,
    },

    # ── 5. Google AdSense 商业化广告系统 (Google AdSense Integration) ──
    "ADSENSE_ENABLED": {
        "default": False,
        "type": "bool",
        "category": "adsense",
        "title": "启用 Google AdSense",
        "description": "总开关。开启后将在公共页面自动注入 AdSense 脚本并展示商业化广告位",
        "sensitive": False,
    },
    "ADSENSE_CLIENT_ID": {
        "default": "",
        "type": "str",
        "category": "adsense",
        "title": "AdSense 客户 ID (Publisher ID)",
        "description": "Google AdSense 账号发布商唯一标识，格式如 ca-pub-1234567890123456",
        "sensitive": False,
    },
    "ADSENSE_SLOT_ID": {
        "default": "",
        "type": "str",
        "category": "adsense",
        "title": "固定广告单元 ID (Slot ID)",
        "description": "可选。在搜索结果流与详情页展示的指定广告单元代码 (纯数字如 1234567890)，留空则仅使用 Auto Ads",
        "sensitive": False,
    },
    "ADSENSE_AUTO_ADS": {
        "default": True,
        "type": "bool",
        "category": "adsense",
        "title": "启用全自动广告 (Auto Ads)",
        "description": "开启后 Google AI 算法将自动识别最佳版位并在页面合适位置呈现响应式广告",
        "sensitive": False,
    },
    "ADSENSE_TEST_MODE": {
        "default": False,
        "type": "bool",
        "category": "adsense",
        "title": "测试广告模式 (Test Mode)",
        "description": "本地调试或刚接入审核阶段建议开启 (data-adtest='on')，避免因站长自测访问误点导致账号被限制",
        "sensitive": False,
    },
}

CATEGORY_NAMES = {
    "crawler": "爬虫引擎与抓取频控",
    "worker": "后台任务调度与看门狗",
    "proxy": "代理池与网络中继",
    "auth": "管理安全与授权",
    "adsense": "Google AdSense 商业化广告",
    "general": "全局通用设置",
}


def cast_value(raw_val: Any, target_type: str) -> Any:
    """根据类型定义安全转换字符串"""
    if raw_val is None:
        return ""
    if target_type == "bool":
        if isinstance(raw_val, bool):
            return raw_val
        return str(raw_val).strip().lower() in ("true", "1", "yes", "on")
    elif target_type == "int":
        try:
            return int(float(str(raw_val).strip()))
        except Exception:
            return 0
    elif target_type == "float":
        try:
            return float(str(raw_val).strip())
        except Exception:
            return 0.0
    return str(raw_val)


class DatabaseSettingsManager:
    """
    单例模式·数据库配置管理器
    """
    _instance: Optional["DatabaseSettingsManager"] = None

    def __init__(self):
        self._cached_values: Dict[str, Any] = {}
        self._lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "DatabaseSettingsManager":
        if cls._instance is None:
            cls._instance = DatabaseSettingsManager()
        return cls._instance

    async def initialize_and_sync(self, session: AsyncSession) -> Dict[str, Any]:
        """
        在服务启动时调用：
        1. 从 PostgreSQL 的 system_settings 表中查询已有的配置项；
        2. 若发现新增加的配置项尚未存入数据库，则自动以默认值写入数据库（自动建档/迁移）；
        3. 同步回写更新内存中的 settings 对象，实现全配置项在数据库中的持久化管理！
        """
        async with self._lock:
            # 查询当前所有持久化配置
            stmt = select(SystemSetting)
            res = await session.execute(stmt)
            existing_settings = {row.key: row.value for row in res.scalars().all()}

            dirty = False
            for key, meta in SYSTEM_CONFIG_REGISTRY.items():
                target_type = meta["type"]
                default_val = meta["default"]

                if key in existing_settings:
                    val_str = existing_settings[key]
                    typed_val = cast_value(val_str, target_type)
                else:
                    # 数据库中尚无此项，先检查环境变量/原 settings 是否有配置，若无则使用 registry 默认值
                    env_val = getattr(settings, key, None)
                    chosen_val = env_val if env_val is not None else default_val
                    typed_val = cast_value(chosen_val, target_type)
                    
                    # 写入数据库记录
                    str_for_db = str(typed_val).lower() if target_type == "bool" else str(typed_val)
                    new_rec = SystemSetting(key=key, value=str_for_db)
                    session.add(new_rec)
                    dirty = True

                self._cached_values[key] = typed_val
                # 热同步到全局 settings 单例中
                setattr(settings, key, typed_val)

            if dirty:
                try:
                    await session.commit()
                    logger.info("[DatabaseSettingsManager] Auto-seeded missing config items into system_settings table.")
                except Exception as exc:
                    logger.warning(f"[DatabaseSettingsManager] Commit failed during auto-seed: {exc}")
                    await session.rollback()

            logger.info(
                f"[DatabaseSettingsManager] Successfully loaded and synced {len(self._cached_values)} "
                f"dynamic configuration items from PostgreSQL database into runtime memory."
            )
            return dict(self._cached_values)

    async def get_grouped_settings(self, session: AsyncSession) -> Dict[str, Any]:
        """
        获取按分类组织的所有配置项信息（包含当前值、默认值、类型、说明、是否修改），
        供 Web 管理后台直接渲染展示。
        """
        stmt = select(SystemSetting)
        res = await session.execute(stmt)
        db_records = {row.key: row.value for row in res.scalars().all()}

        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for cat_key in CATEGORY_NAMES.keys():
            grouped[cat_key] = []

        for key, meta in SYSTEM_CONFIG_REGISTRY.items():
            cat = meta.get("category", "general")
            target_type = meta["type"]
            default_val = meta["default"]

            raw_db_val = db_records.get(key)
            if raw_db_val is not None:
                current_val = cast_value(raw_db_val, target_type)
            else:
                current_val = self._cached_values.get(key, default_val)

            item_payload = {
                "key": key,
                "title": meta.get("title", key),
                "description": meta.get("description", ""),
                "type": target_type,
                "category": cat,
                "default": default_val,
                "current": current_val,
                "is_modified": current_val != default_val,
                "sensitive": meta.get("sensitive", False),
            }
            if cat not in grouped:
                grouped[cat] = []
            grouped[cat].append(item_payload)

        return {
            "categories": [
                {"id": cat_id, "name": cat_name, "items": grouped.get(cat_id, [])}
                for cat_id, cat_name in CATEGORY_NAMES.items()
            ],
            "total_count": len(SYSTEM_CONFIG_REGISTRY),
        }

    async def update_settings(self, updates: Dict[str, Any], session: AsyncSession) -> Dict[str, Any]:
        """
        批量更新配置项至 PostgreSQL 数据库，并即刻热加载至内存，免去重启服务。
        """
        applied_changes: Dict[str, Any] = {}

        async with self._lock:
            for key, raw_val in updates.items():
                if key not in SYSTEM_CONFIG_REGISTRY:
                    continue

                meta = SYSTEM_CONFIG_REGISTRY[key]
                target_type = meta["type"]
                typed_val = cast_value(raw_val, target_type)

                str_for_db = str(typed_val).lower() if target_type == "bool" else str(typed_val)

                # PostgreSQL Upsert
                insert_stmt = insert(SystemSetting).values(
                    key=key,
                    value=str_for_db
                ).on_conflict_do_update(
                    index_elements=[SystemSetting.key],
                    set_={"value": str_for_db}
                )
                await session.execute(insert_stmt)

                # Update live cache and live settings object
                self._cached_values[key] = typed_val
                setattr(settings, key, typed_val)
                applied_changes[key] = typed_val

            await session.commit()

        # 同步通知 ProxyManager 进行热重载
        try:
            from app.proxy import ProxyManager
            proxy_mgr = ProxyManager.get_instance()
            await proxy_mgr.load_config_from_db()
        except Exception as exc:
            logger.warning(f"[DatabaseSettingsManager] ProxyManager reload callback notice: {exc}")

        logger.info(f"[DatabaseSettingsManager] Applied and persisted {len(applied_changes)} settings to database: {list(applied_changes.keys())}")
        return applied_changes

    async def reset_settings(self, keys: Optional[List[str]], session: AsyncSession) -> Dict[str, Any]:
        """
        将指定的（或全部）配置项恢复为初始默认值
        """
        target_keys = keys if keys else list(SYSTEM_CONFIG_REGISTRY.keys())
        updates_to_apply = {}

        for k in target_keys:
            if k in SYSTEM_CONFIG_REGISTRY:
                updates_to_apply[k] = SYSTEM_CONFIG_REGISTRY[k]["default"]

        return await self.update_settings(updates_to_apply, session)


async def load_and_sync_all_settings(session: AsyncSession) -> Dict[str, Any]:
    """便捷包装函数供 FastAPI 生命周期调用"""
    mgr = DatabaseSettingsManager.get_instance()
    return await mgr.initialize_and_sync(session)
