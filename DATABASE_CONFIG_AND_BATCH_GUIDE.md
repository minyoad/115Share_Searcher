# 115 分享资源搜索服务：数据库持久化配置与大批量提交说明文档

本文档针对近期架构升级进行专门说明，涵盖两项重大优化：
1. **全配置项移入 PostgreSQL 数据库（零 `.env` 依赖运维与热重载）**
2. **解除 200 条提交限制：大批量链接分批切片引擎与高吞吐入库**

---

## 一、全配置项数据库持久化（彻底摆脱 `.env` 困扰）

### 1. 改造背景与核心收益

在以往的 Docker 容器化部署中，管理员经常遇到如下痛点：
- Docker Compose 或部分容器云平台（如某些 NAS 系统、群晖 Container Manager、Portainer）对 `.env` 环境变量加载顺序或路径支持不一，导致配置未正确读取；
- 修改爬虫 Cookie、代理池或频控参数时，必须手动修改服务器上的 `.env` 文件并重启容器，影响在线搜索服务；
- 管理员初始密码写在明文配置文件中，存在泄漏风险。

**本次升级方案：**
- 将系统所有运行配置与管理凭证全面迁移至 PostgreSQL 数据库的 `system_settings` 表中；
- 服务启动时自动执行数据同步（若数据库无记录则自动写入出厂安全默认值，若环境变量有指定则智能兼容作为种子值）；
- 提供 Web 控制台可视化修改，修改后内存即刻热重载生效，无需重启任何 Docker 容器。

---

### 2. 数据库配置表结构设计

```sql
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(128) PRIMARY KEY,
    value TEXT NOT NULL,
    data_type VARCHAR(32) NOT NULL DEFAULT 'string',
    category VARCHAR(64) NOT NULL DEFAULT 'general',
    description VARCHAR(512) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

### 3. 已迁移至数据库的配置项清单

所有系统配置已按功能模块划分为 5 大类：

| 分组分类 | 配置键名 (Key) | 数据类型 | 默认预设值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- |
| **115 爬虫与频控** | `CRAWLER_COOKIE` | string | `""` | 115 会员账号 VIP Cookie，用于访问快照和深度遍历 |
| | `CRAWLER_CONCURRENCY` | int | `5` | 爬虫最大并发请求协程数（控制抓取速度与防封） |
| | `CRAWLER_MIN_RATE_LIMIT_SEC` | float | `0.05` | 两次 API 请求的极小间隔秒数 |
| | `CRAWLER_MAX_RATE_LIMIT_SEC` | float | `0.15` | 两次 API 请求的极大间隔秒数（随机抖动） |
| | `CRAWLER_PAGE_SIZE` | int | `100` | `share/snap` 每次遍历拉取的节点数量 |
| | `CRAWLER_MAX_RETRY` | int | `3` | 遭遇网络抖动或临时异常时的自动重试次数 |
| | `CRAWLER_USER_AGENT` | string | 现代 Chrome UA | 爬虫伪装浏览器请求头 User-Agent |
| **任务调度与看门狗** | `WORKER_CONCURRENCY` | int | `4` | 后台并发处理抓取任务的 Worker 协程数量 |
| | `WATCHDOG_CHECK_INTERVAL_SEC` | int | `30` | 死锁巡检看门狗自动探测卡死任务的时间间隔（秒） |
| | `TASK_STUCK_TIMEOUT_SEC` | int | `600` | 判定任务异常僵死的超时阈值（秒），超时自动恢复重试 |
| **防封代理池矩阵** | `PROXY_MODE` | string | `OFF` | 代理模式：`OFF` (直连) / `STATIC` (静态) / `POOL` (动态池) |
| | `PROXY_URL` | string | `""` | 静态代理地址（支持 HTTP/HTTPS/SOCKS5） |
| | `PROXY_POOL_API` | string | `""` | 第三方动态代理提取 API（支持 JSON 或换行格式） |
| | `PROXY_POOL_LIST` | string | `""` | 自定义代理节点列表（换行分隔，支持 `user:pass@host:port`） |
| | `PROXY_ROTATION_STRATEGY` | string | `rotate_on_error` | 轮换策略：`rotate_on_error` (遇错轮换) / `round_robin` / `random` |
| | `PROXY_REFRESH_INTERVAL_SEC` | int | `120` | 动态代理池定时刷新拉取间隔秒数 |
| | `PROXY_BAN_COOLDOWN_SEC` | int | `1800` | 遭遇 405 封禁节点的静默冷却时间（秒） |
| **系统核心与搜索** | `DEFAULT_PAGE_SIZE` | int | `20` | 前端搜索结果每页展示条数 |
| | `MAX_PAGE_SIZE` | int | `100` | 单次搜索允许拉取的最大条数 |
| | `ENABLE_SEARCH_CACHE` | bool | `true` | 是否启用 Redis 热门关键词搜索结果缓存 |
| | `SEARCH_CACHE_TTL_SEC` | int | `300` | 搜索缓存过期时间（秒） |
| **管理认证与安全** | `ADMIN_PASSWORD_HASH` | string | *(加密哈希)* | PBKDF2-HMAC-SHA256 加盐安全哈希，防爆破 |
| | `ADMIN_SESSION_TTL_HOURS` | int | `168` | 管理员登录态令牌有效时长（小时，默认 7 天） |

---

### 4. 如何在 Web 界面查看与修改

1. 打开前端网页，点击右上角 **「管理入口」**；
2. 首次访问使用默认口令 `admin123` 登录（建议登录后立即修改口令）；
3. 登录成功后，顶部导航栏将出现 **「⚙️ 系统配置」** 标签页；
4. 进入系统配置页面后：
   - 支持按分类标签（全部、爬虫频控、看门狗、代理池、系统管理）快速切换；
   - 参数字段带有清晰的类型校验（布尔开关、数值调节步进、敏感凭证掩码输入）；
   - 支持一键 **「填入预设」**、**「重置本组默认」** 或 **「恢复全部默认」**；
   - 修改完成后点击 **「保存并热生效」**，后端即刻同步内存与数据库，全程平滑无缝。

---

## 二、大批量链接分批提交引擎（解决 >200 条限制）

### 1. 200 条限制的原因与隐患

之前版本在处理大批量链接导入时存在以下隐患：
1. **Schema 硬编码**：Pydantic 请求体设置了 `max_length=200`，超过直接抛出 `422 Unprocessable Entity`；
2. **大事务锁表风险**：一次性向数据库写入数百上千条 `Share` 记录并推入 Redis 队列，容易引发数据库连接耗尽、事务超时或网关 504 Timeout；
3. **缺少分批进度反馈**：前端发起单一大请求后若中间网络中断，整个导入全部失败，且用户不知道已入库了多少条。

---

### 2. 全新解决方案：双端分批协同引擎

#### 后端优化：
1. **解除 Schema 硬编码**：将请求单批上限从 200 提升至 **10,000** 条；
2. **高吞吐批次切片引擎（Chunking）**：
   - 后端无论接收到多大的请求，均自动按 **150 条 / 批** 进行微事务切片；
   - 每一批独立执行已有数据去重判定、批量插入 `Share` 记录以及入队操作；
   - 避免长时间独占数据库连接，提升并发吞吐量。
3. **扩展响应数据结构**：
   ```json
   {
     "total_submitted": 650,
     "tasks_queued": 520,
     "ignored_duplicates": 130,
     "failed_count": 0,
     "batches_processed": 5,
     "task_ids": ["task_1", "task_2", "..."],
     "message": "大批量导入圆满完成！已分 5 批次成功入库 650 条分享..."
   }
   ```

#### 前端优化：
1. **大批量智能感知横幅**：当粘贴链接有效条数超过 200 条时，自动高亮提示已启用大批量智能分批提交引擎；
2. **连续切片入队与实时进度条**：
   - 前端自动按 150 条/批进行平滑切片并依次发起请求；
   - 实时显示当前进度（如 `正在分批提交第 2/5 批 (本批 150 条，已处理 150/650 条)...`）；
   - 进度条带有动态百分比动画；
3. **明细结果卡片**：
   - 汇总展示提交总数、入队数、批次数、智能去重跳过数、失败数；
   - 杜绝用户在未知状态下重复点击。

---

## 三、相关 REST API 规范

### 1. 获取全量系统配置
- **请求**: `GET /api/v1/admin/settings`
- **响应**:
  ```json
  {
    "categories": [
      {
        "id": "crawler",
        "name": "115 爬虫与引擎频控",
        "items": [
          {
            "key": "CRAWLER_COOKIE",
            "title": "115 账号凭据 (VIP Cookie)",
            "description": "用于快照与递归抓取的 115 账号 Cookie",
            "type": "string",
            "category": "crawler",
            "default": "",
            "current": "UID=xxx; CID=yyy; SEID=zzz",
            "is_modified": true,
            "sensitive": true
          }
        ]
      }
    ],
    "total_count": 22
  }
  ```

### 2. 保存并热生效配置
- **请求**: `POST /api/v1/admin/settings`
- **请求体**:
  ```json
  {
    "settings": {
      "CRAWLER_CONCURRENCY": 8,
      "CRAWLER_MIN_RATE_LIMIT_SEC": 0.08,
      "CRAWLER_MAX_RATE_LIMIT_SEC": 0.2
    }
  }
  ```
- **响应**:
  ```json
  {
    "status": "ok",
    "updated_count": 3,
    "message": "已成功更新 3 项系统配置，数据库已持久化并完成热重载！"
  }
  ```

### 3. 重置配置为默认值
- **请求**: `POST /api/v1/admin/settings/reset`
- **请求体**:
  ```json
  {
    "keys": ["CRAWLER_CONCURRENCY"] // 传入 null 时重置全部配置
  }
  ```

### 4. 批量提交分享链接
- **请求**: `POST /api/v1/shares/batch-import`
- **请求体**:
  ```json
  {
    "shares": [
      { "share_code": "swnsdrk3h2m", "receive_code": "p783" },
      { "raw_url": "https://115.com/s/sw6tcot3hbe?password=e9d7" }
    ],
    "force_crawl": false
  }
  ```

---

## 四、极简 Docker 启动（零配置开箱即用）

由于所有配置已移入数据库，您的 `docker-compose.yml` 可以极其简单，无需维护冗长的环境变量列表：

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres123
      POSTGRES_DB: db_115share
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data

  api:
    build: .
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres123@postgres:5432/db_115share
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - postgres
      - redis

  worker:
    build: .
    restart: unless-stopped
    command: python -m app.worker
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres123@postgres:5432/db_115share
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - postgres
      - redis

volumes:
  pgdata:
  redisdata:
```

容器启动后直接打开浏览器访问 `http://你的服务器IP:8000`，在前端界面的 **「系统配置」** 中按需设置 115 Cookie、代理池等即可！

---

## 五、链接移除与级联清除文件功能说明 (防失效链接与孤儿文件残留)

针对用户提出的「添加链接移除功能，同时移除该链接的文件列表，防止链接失效后，文件还在」需求，系统现已全面支持单条与批量级联删除。

### 1. 业务痛点与设计原则
- **痛点**：115 云盘分享存在过期、被举报或被分享者主动取消的情况。若仅将分享状态标记为失效（status=2），名下的大量文件记录依然占据数据库存储空间，并在全库检索中产生无效干扰。
- **解决方案**：在移除分享链接时，执行底层数据库事务级联清理：
  1. 物理删除 `files` 表中所有归属于该 `share_id` 的文件与目录记录；
  2. 物理删除 `shares` 表中对应的分享主记录；
  3. 通过 WebSocket 全局推送 `share_deleted` 或 `shares_batch_deleted` 广播事件，通知所有在线前端实时移除该卡片与文件列表，无需刷新页面。

### 2. 交互操作入口
1. **公开检索界面 (Search Engine View)**：
   - 搜索结果列表中每一项均提供 🗑️「彻底移除链接及文件」按钮；
   - 点击后弹出二次防误触确认对话框，告知将级联清理名下全部文件；
   - 确认后即刻清理，使失效资源迅速从全站检索中消失。
2. **任务监控与管理后台 (Share Task Manager)**：
   - 单条操作：在任务卡片操作区提供危险操作按钮「彻底删除分享与所有文件」；
   - 批量操作：支持勾选多条分享链接，在底部弹出的批量操作工具栏中点击 **「批量彻底删除」**，一键级联销毁所选链接及名下海量文件。

### 3. 后端 API 规范
- **单条级联删除**：
  - 路由：`DELETE /api/v1/shares/{share_code}`
  - 请求头：`X-Admin-Token: <口令>` (若启用管理鉴权)
  - 响应示例：
    ```json
    {
      "status": "success",
      "share_code": "swnsdrk3h2m",
      "deleted_files": 142,
      "message": "已彻底移除分享链接 swnsdrk3h2m，并级联清除其名下全部关联文件记录！"
    }
    ```
- **批量级联删除**：
  - 路由：`POST /api/v1/shares/batch-delete`
  - 请求体：
    ```json
    {
      "share_codes": ["swnsdrk3h2m", "sw6tcot3hbe"]
    }
    ```
  - 响应示例：
    ```json
    {
      "status": "success",
      "deleted_shares": 2,
      "deleted_files": 318,
      "message": "已成功批量移除 2 个分享链接及名下所有文件！"
    }
    ```

