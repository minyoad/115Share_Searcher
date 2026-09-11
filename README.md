# 115 Cloud Drive Share Search Service (115 分享资源搜索服务)

基于 **Python 3.11 + FastAPI + PostgreSQL 15 (pg_trgm) + Redis (Queue/Cache) + 115 Web Snap API** 构建的高吞吐、高可用、可水平扩展的 115 网盘分享资源全文检索与索引服务系统。

---

## 🌟 核心特性

1. **异步非阻塞任务架构**：
   - 采用 Redis 队列与后台分布式多协程 Worker 消费架构，批量导入链接后即刻返回 202，后台异步进行千万级文件树抓取与入库。
2. **115 深度 BFS 递归抓取引擎**：
   - 基于 `collections.deque` 广度优先搜索 (BFS) 遍历 `webapi.115.com/share/snap`，规避传统递归栈深度限制。
   - 自动维护虚拟目录树计算全路径（`full_path`），区分目录（`cid`）与文件（`fid`），提取 SHA1 与文件体积。
   - 内置智能请求抖动（`0.3s - 0.8s`）、指数退避重试（Exponential Backoff）与业务异常识别（失效/密码错误/违规封禁自动标记）。
3. **PostgreSQL pg_trgm + GIN 极速模糊与全文检索**：
   - 数据库原生支持三元分词（Trigram）倒排索引，对 `full_path` 的 `%keyword%` 检索提供毫秒级响应。
   - 针对常用过滤项（`extension`, `size`, `is_dir`）构建复合 B-Tree 索引。
4. **批量 Upsert 高吞吐写入**：
   - 利用 PostgreSQL `ON CONFLICT (share_id, file_115_id) DO UPDATE` 进行分批 Upsert，保证幂等性与极高入库吞吐。
5. **OpenList / AList 生态友好**：
   - 检索结果直接输出 115 节点 ID（`openlist_mount_cid`）与标准直达链接，便于第三方 WebDAV / 网盘聚合挂载工具集成。

---

## 📁 目录结构

```text
├── .github
│   └── workflows
│       └── docker-build-push.yml # GitHub Actions 自动多架构编译与 GHCR 镜像发布
├── docker-compose.yml       # 开发/基础环境一键编排 (零 .env 依赖，一键直接运行)
├── docker-compose.prod.yml  # 生产环境部署 (零 .env 依赖/预编译镜像/多Worker/日志轮转/健康检查/内存调优)
├── DATABASE_CONFIG_AND_BATCH_GUIDE.md # 数据库配置持久化 (免 .env) 与万级链接分批切片引擎指南
├── Dockerfile               # 容器构建镜像定义 (Python 3.11-slim + libpq)
├── requirements.txt         # Python 依赖清单
├── app
│   ├── __init__.py          # 模块标识与版本信息
│   ├── config.py            # Pydantic v2 核心运行配置
│   ├── settings_manager.py  # PostgreSQL 数据库配置管理器 (热加载、分类管理与重置)
│   ├── database.py          # SQLAlchemy 2.0 Async 引擎、会话管理与 pg_trgm 扩展自启
│   ├── models.py            # 声明式模型 (Share, File, SystemSetting)
│   ├── schemas.py           # Pydantic v2 请求响应校验模型与 URL 正则解析
│   ├── crawler.py           # 115 Snapshot API BFS 递归爬虫引擎
│   ├── worker.py            # Redis 队列后台消费 Worker
│   ├── main.py              # FastAPI Web 服务、REST API 与静态前端挂载
│   └── static
│       └── index.html       # 独立响应式搜索前端 (HTML5 + Tailwind CSS + Vue 3)
```

---

## 🚀 部署方式 (零 .env 依赖，即刻开箱即用)

本系统已彻底移除传统的 `.env` 配置文件依赖。所有业务参数（115 VIP Cookie、爬虫并发度、频控速率、代理池、自动看门狗、Google AdSense、管理员密码）全部通过 **PostgreSQL 数据库 `system_settings` 表** 持久化保存，并通过 Web 管理后台直接热修改与热重载。

> **💡 前后端一致性保证 (100% 还原 AI Studio 预览体验)**：
> - 镜像采用 **多阶段构建 (Multi-Stage Dockerfile)**：第一阶段使用 Node 20 自动编译现代 React 18 + Tailwind CSS + Lucide 交互前端，第二阶段由 FastAPI 嵌入托管，确保生产环境、Docker 部署与 AI Studio 预览界面完全一致（包含代理池防封矩阵、实时探活诊断、WebSocket 任务监控流等）。
> - 仓库内已同步内置预编译的 `/dist` 与 `app/dist` 产物，即使在无 Node.js 环境的纯 Python 机器直接启动 `uvicorn app.main:app`，也能直接加载现代 React 界面。

### 方式 1：生产环境部署 (`docker-compose.prod.yml`)

无需创建或配置任何 `.env` 文件，直接执行命令拉起全套生产容器：

```bash
# 1. 启动全套生产服务 (PostgreSQL, Redis, FastAPI, Crawler Worker)
docker compose -f docker-compose.prod.yml up -d

# 2. 查看运行状态与各容器健康检查
docker compose -f docker-compose.prod.yml ps

# 3. 查看实时滚动日志 (带 20MB 日志轮转保护)
docker compose -f docker-compose.prod.yml logs -f --tail=100

# 4. 初始化配置 (无需编辑任何服务器文件)
#    打开浏览器访问: http://<你的服务器IP>:8000
#    首次访问后台管理时直接在 Web 界面设定专属管理员密码；
#    在「系统配置」与「代理池管理」界面填写 115 Cookie、代理等，即刻内存热生效！

# 5. 停止或重启服务
docker compose -f docker-compose.prod.yml restart
# docker compose -f docker-compose.prod.yml down
```

### 方式 2：GitHub Actions 自动编译与镜像发布 (CI/CD)

项目已内置 `.github/workflows/docker-build-push.yml` 自动化流水线：
- **触发条件**：
  - 代码推送到 `main` / `master` 分支时自动触发构建。
  - 发布版本标签（如 `git tag v1.0.0 && git push origin v1.0.0`）时，自动生成 `v1.0.0`、`1.0` 与 `latest` 标签。
  - 支持在 GitHub 控制台手动一键触发（`workflow_dispatch`）。
- **多架构构建 (Multi-Arch)**：
  - 自动编译 `linux/amd64` (标准 x86 云服务器) 与 `linux/arm64` (如 Apple Silicon / 树莓派 / 阿里云 ARM 实例)。
- **智能构建层缓存 (GHA Cache)**：
  - 采用 GitHub Actions Cache 加速，二次编译 Python 依赖只需 30 秒。
- **发布目标**：
  - 默认免密发布至 GitHub 官方容器镜像库 `ghcr.io/<你的用户名>/<仓库名>:latest`，用户在 VPS 上无需安装 Python/编译环境即可 `docker pull` 直接运行。

### 方式 3：本地开发测试环境运行

```bash
# 启动本地开发容器 (带代码目录热重载与开发调试端口)
docker compose up -d --build

# 或本地纯 Python 虚拟环境直接运行:
pip install -r requirements.txt
python -m app.worker &
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

---

## 🔌 API 接口概览

| 接口 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/api/v1/shares/batch-import` | `POST` | 批量提交 115 分享链接（支持 URL 正则提取与提取码分离） |
| `/api/v1/search` | `GET` | 全文模糊检索（支持关键字、扩展名、文件大小、目录类型） |
| `/api/v1/shares/{share_code}/files` | `GET` | 层级浏览指定分享目录树 (按 `parent_115_id` 展开) |
| `/api/v1/shares/{share_code}/report` | `POST` | 用户或巡检上报失效/违规链接 |
| `/api/v1/health` | `GET` | 服务健康检查 |

---

## 📊 数据库设计 (PostgreSQL DDL 核心)

```sql
-- 开启三元分词扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 分享元数据表
CREATE TABLE shares (
    id BIGSERIAL PRIMARY KEY,
    share_code VARCHAR(64) UNIQUE NOT NULL,
    receive_code VARCHAR(32) DEFAULT '' NOT NULL,
    title VARCHAR(512) DEFAULT '' NOT NULL,
    file_count INTEGER DEFAULT 0 NOT NULL,
    folder_count INTEGER DEFAULT 0 NOT NULL,
    total_size BIGINT DEFAULT 0 NOT NULL,
    status SMALLINT DEFAULT 0 NOT NULL,
    last_crawled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 文件与目录节点表
CREATE TABLE files (
    id BIGSERIAL PRIMARY KEY,
    share_id BIGINT REFERENCES shares(id) ON DELETE CASCADE NOT NULL,
    file_115_id VARCHAR(64) NOT NULL,
    parent_115_id VARCHAR(64) DEFAULT '0' NOT NULL,
    name VARCHAR(512) NOT NULL,
    extension VARCHAR(32) DEFAULT '' NOT NULL,
    size BIGINT DEFAULT 0 NOT NULL,
    is_dir BOOLEAN DEFAULT FALSE NOT NULL,
    sha1 VARCHAR(40) DEFAULT '' NOT NULL,
    full_path TEXT NOT NULL,
    CONSTRAINT uq_share_file_115_id UNIQUE (share_id, file_115_id)
);

-- 倒排 GIN 索引加速全路径模糊搜索
CREATE INDEX ix_files_full_path_trgm ON files USING gin (full_path gin_trgm_ops);
CREATE INDEX ix_files_ext_size ON files (extension, size);

-- 系统全量动态配置与管理员凭据持久化存储表 (免 .env 热更新)
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(128) PRIMARY KEY,
    value TEXT NOT NULL,
    data_type VARCHAR(32) NOT NULL DEFAULT 'string',
    category VARCHAR(64) NOT NULL DEFAULT 'general',
    description VARCHAR(512) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

---

## 📖 专项指南与文档

- ⚙️ **[数据库配置与大批量提交说明文档 (DATABASE_CONFIG_AND_BATCH_GUIDE.md)](./DATABASE_CONFIG_AND_BATCH_GUIDE.md)**：包含全配置项移至 PostgreSQL、热重载 API 规范、大批量链接分批切片（每批 150 条，上限 10,000 条）引擎及零 `.env` 部署详细指南。

