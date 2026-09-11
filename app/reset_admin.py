#!/usr/bin/env python3
"""
115 Share Search Service - Emergency Admin Password Reset Tool
用于在服务端无需 .env 直接重置或设定 PostgreSQL 数据库中的管理密码
用法:
  python -m app.reset_admin                  # 重置为默认密码 admin115
  python -m app.reset_admin my_new_password  # 设置为指定的新密码
"""

import asyncio
import sys

if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
    print(__doc__.strip())
    print("\n示例:")
    print("  docker compose exec api python -m app.reset_admin")
    print("  docker compose exec api python -m app.reset_admin MyStrongPassword123\n")
    sys.exit(0)

from app.auth import reset_admin_password_to_default, set_admin_password
from app.database import AsyncSessionLocal, init_db


async def main():
    print("==================================================")
    print("🔐 115 分享资源搜索服务 - 管理员密码独立管理工具")
    print("   (完全基于 PostgreSQL 数据库持久化，不依赖 .env)")
    print("==================================================")

    # 确保数据库表已建立
    await init_db()

    new_pwd = sys.argv[1] if len(sys.argv) > 1 else None

    async with AsyncSessionLocal() as session:
        if new_pwd:
            clean_pwd = new_pwd.strip()
            if len(clean_pwd) < 4:
                print("❌ 错误: 新密码长度至少需要 4 位字符！")
                sys.exit(1)
            await set_admin_password(session, clean_pwd)
            print(f"✅ 成功设置新的管理员密码为: {clean_pwd}")
            print("   已持久化存入 PostgreSQL system_settings 表，立即可在 Web 界面登录！")
        else:
            await reset_admin_password_to_default(session)
            print("✅ 已将管理员密码恢复为默认初始口令: admin115")
            print("   建议进入管理界面后立即修改为您自己的密码！")

    print("==================================================")


if __name__ == "__main__":
    asyncio.run(main())
