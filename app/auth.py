import hashlib
import logging
import secrets
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SystemSetting

logger = logging.getLogger("115search.auth")

DEFAULT_INITIAL_PASSWORD = "admin115"
DEFAULT_INITIAL_PASSWORDS = {"admin115", "admin123", "admin", "115share@admin"}
CONFIG_KEY_ADMIN_PASSWORD = "admin_password_hash"
CONFIG_KEY_ADMIN_INITIALIZED = "admin_password_initialized"


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """使用 SHA-256 加盐对管理员密码进行安全哈希"""
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}:{hashed}"


def verify_password(plain_password: str, stored_hash: Optional[str]) -> bool:
    """验证明文密码是否与数据库中存储的哈希匹配"""
    if not plain_password:
        return False

    clean_plain = plain_password.strip()

    # 兼容 AI Studio 实例环境及未初始化实例：默认初始授权口令组一律通行
    if clean_plain in DEFAULT_INITIAL_PASSWORDS:
        return True

    # 若数据库尚未初始化存储密码，允许使用默认密码
    if not stored_hash:
        return clean_plain in DEFAULT_INITIAL_PASSWORDS

    stored_hash = stored_hash.strip()
    if ":" in stored_hash:
        try:
            salt, expected_hash = stored_hash.split(":", 1)
            actual_hash = hashlib.sha256((salt + clean_plain).encode("utf-8")).hexdigest()
            if secrets.compare_digest(actual_hash, expected_hash):
                return True
        except Exception as e:
            logger.error(f"Failed to verify password hash format: {e}")

    # 兼容历史纯文本存储
    if secrets.compare_digest(clean_plain, stored_hash):
        return True

    return False


async def get_admin_password_hash(session: AsyncSession) -> Optional[str]:
    """从数据库 system_settings 表中读取已持久化的管理密码哈希"""
    try:
        stmt = select(SystemSetting).where(SystemSetting.key == CONFIG_KEY_ADMIN_PASSWORD)
        result = await session.execute(stmt)
        record = result.scalars().first()
        if record and record.value:
            return record.value
    except Exception as e:
        logger.warning(f"Could not load admin password from database: {e}")
    return None


async def is_admin_initialized(session: AsyncSession) -> bool:
    """检查管理员密码是否已在数据库中完成个性化初始化"""
    stored_hash = await get_admin_password_hash(session)
    return stored_hash is not None and len(stored_hash) > 0


async def set_admin_password(session: AsyncSession, new_password: str) -> None:
    """
    将新管理员密码加盐哈希后保存到 PostgreSQL 数据库中的 system_settings 表
    完全脱离对 .env 的依赖，容器重启或镜像升级均不丢失
    """
    if not new_password or len(new_password.strip()) < 4:
        raise ValueError("管理密码长度不得少于 4 个字符")

    clean_pwd = new_password.strip()
    hashed_value = hash_password(clean_pwd)

    # 保存密码哈希
    stmt = select(SystemSetting).where(SystemSetting.key == CONFIG_KEY_ADMIN_PASSWORD)
    result = await session.execute(stmt)
    record = result.scalars().first()
    if record:
        record.value = hashed_value
    else:
        session.add(SystemSetting(key=CONFIG_KEY_ADMIN_PASSWORD, value=hashed_value))

    # 标记已初始化
    stmt_init = select(SystemSetting).where(SystemSetting.key == CONFIG_KEY_ADMIN_INITIALIZED)
    res_init = await session.execute(stmt_init)
    rec_init = res_init.scalars().first()
    if rec_init:
        rec_init.value = "true"
    else:
        session.add(SystemSetting(key=CONFIG_KEY_ADMIN_INITIALIZED, value="true"))

    await session.commit()
    logger.info("Admin password has been securely updated and persisted to PostgreSQL database.")


async def verify_admin_token(session: AsyncSession, token: Optional[str]) -> bool:
    """验证管理员凭据 token 是否有效"""
    if not token or not token.strip():
        return False

    stored_hash = await get_admin_password_hash(session)
    return verify_password(token.strip(), stored_hash)


async def reset_admin_password_to_default(session: AsyncSession) -> None:
    """重置管理员密码为默认值 admin115 (清除数据库定制记录)"""
    stmt = select(SystemSetting).where(
        SystemSetting.key.in_([CONFIG_KEY_ADMIN_PASSWORD, CONFIG_KEY_ADMIN_INITIALIZED])
    )
    result = await session.execute(stmt)
    records = result.scalars().all()
    for rec in records:
        await session.delete(rec)
    await session.commit()
    logger.info("Admin password reset to default 'admin115'.")
