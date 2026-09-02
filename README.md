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
├── docker-compose.yml       # 一键编排容器 (postgres, redis, api, worker)
├── Dockerfile               # 容器构建镜像定义
├── requirements.txt         # Python 依赖清单
├── app
│   ├── __init__.py          # 模块标识与版本信息
│   ├── config.py            # Pydantic v2 环境配置管理
│   ├── database.py          # SQLAlchemy 2.0 Async 引擎、会话管理与 pg_trgm 扩展自启
│   ├── models.py            # 声明式模型 (Share, File, GIN 索引)
│   ├── schemas.py           # Pydantic v2 请求响应校验模型与 URL 正则解析
│   ├── crawler.py           # 115 Snapshot API BFS 递归爬虫引擎
│   ├── worker.py            # Redis 队列后台消费 Worker
│   ├── main.py              # FastAPI Web 服务、REST API 与静态前端挂载
│   └── static
│       └── index.html       # 独立响应式搜索前端 (HTML5 + Tailwind CSS + Vue 3)
```

---

## 🚀 快速启动

### 方式 1：Docker Compose 一键部署 (推荐生产使用)

```bash
# 1. 启动所有服务 (PostgreSQL, Redis, FastAPI, Crawler Worker)
docker-compose up -d --build

# 2. 查看实时日志
docker-compose logs -f api worker

# 3. 访问应用
# - 搜索前端界面: http://localhost:8000
# - 交互式 Swagger API 文档: http://localhost:8000/docs
```

### 方式 2：本地开发环境直接运行

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动本地 Postgres 与 Redis
# (确保本地 PostgreSQL 已开启 pg_trgm 扩展)

# 3. 启动后台抓取 Worker
python -m app.worker

# 4. 另开终端启动 FastAPI Web 接口服务
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

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
```
