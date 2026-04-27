# 🌸 HX LoLi Img

> 二次元随机图片 API · Powered by Cloudflare D1 + R2 + Workers

**零出口费 · 全球 CDN · 10GB 免费存储/月 · 纯 Serverless**

## ✨ 特性

- **随机图片 API** — 支持标签筛选、横竖向筛选、尺寸筛选, 单次最多返回 20 张
- **AI 提示词存储** — 支持任意 JSON 结构的提示词元数据（上传/编辑时均可填写）
- **Python SDK** — 爬虫一行代码上传, 自动读取图片尺寸
- **管理后台** — 粉色二次元主题的 SPA 管理界面, 支持批量操作
- **D1 + R2 混合架构** — D1 存元数据（SQL 索引）, R2 存图片文件, 读写均为 O(1)
- **鉴权保护** — 上传和管理 API 需要 Token, 公开 API 可选限流
- **GitHub Actions** — push 到 main/master 自动部署

## 🏗️ 架构

```
py爬虫 ──(SDK/API)──► CF Worker (API) ──┬──► R2 存储 (图片文件)
                          │              └──► D1 数据库 (元数据)
                          │
                    D1: images 表         (id, key, width, height, orientation, prompt, source, ...)
                    D1: image_tags 表     (image_id, tag) — 标签关联, 支持倒排索引
                    R2: images/{id}.{ext} (图片二进制文件)
                          │
用户 ──(GET /api/random)──► CF Worker ──► D1 SQL 查询 (筛选+随机) → R2 读图片
                          │
管理员 ──(/admin)─────────► CF Worker ──► SPA 前端 ──► CRUD API (D1 读写)
```

## ⚡ 性能设计

所有查询通过 D1 SQL 索引完成, 单次请求只需 1 次 D1 查询 + N 次 R2 读取:

| 操作 | D1 查询 | R2 读取 | 原理 |
|---|---|---|---|
| `/api/random` (无筛选) | 1 次 | 0 | `ORDER BY RANDOM() LIMIT N` |
| `/api/random?tag=x` | 1 次 | 0 | `JOIN image_tags + HAVING` 索引命中 |
| `/api/random?orientation=landscape` | 1 次 | 0 | `WHERE orientation = ?` 索引命中 |
| `/i/{id}` | 1 次 | 1 次 | `WHERE id = ?` 主键查询 + R2 读图片 |
| `POST /api/upload` | 1 次写入 | 1 次写入 | `INSERT` + R2 PUT |
| `/api/admin/stats` | 4 次 (batch) | 0 | 聚合统计, D1 batch 并行 |

对比旧方案 (R2 JSON 索引):
- ✅ 无并发竞态 (D1 事务保证)
- ✅ 数据实时一致 (无缓存延迟)
- ✅ 写入 O(1) (不再全量读写 manifest)
- ✅ 支持完整 SQL 查询能力

## 📦 Cloudflare 免费额度

| 服务 | 免费额度 | 日均 1000 请求消耗 |
|---|---|---|
| **D1** 读取行数 | 5,000,000 / 天 | ~0.06% |
| **D1** 写入行数 | 100,000 / 天 | ~0.03% |
| **D1** 存储 | 5 GB | 极小 |
| **R2** 存储 | 10 GB-month | 取决于图片数量 |
| **R2** Class A (写) | 1,000,000 / 月 | 极小 |
| **R2** Class B (读) | 10,000,000 / 月 | ~0.3% |
| **R2** 出口流量 | **$0 (零费用)** | — |
| **Workers** 请求 | 100,000 / 天 | 1% |

## 📁 项目结构

```
HX-CF-LoLi-Img/
├── worker/src/
│   ├── index.js          # 入口, 路由分发
│   ├── meta.js           # D1 数据库操作 (schema, CRUD, 查询)
│   ├── utils.js          # 工具函数 (CORS, auth, nanoid, MIME)
│   ├── admin-ui.js       # 管理后台 SPA (内嵌 HTML/CSS/JS)
│   └── routes/
│       ├── random.js     # GET /api/random, GET /i/{id}
│       ├── upload.js     # POST /api/upload, POST /api/upload/batch
│       └── admin.js      # 管理 API (列表/详情/编辑/删除/统计/迁移)
├── sdk/python/           # Python 上传 SDK
│   ├── hx_loli_img/
│   │   ├── __init__.py
│   │   └── client.py
│   ├── example.py
│   └── pyproject.toml
├── scripts/
│   └── deploy.py         # 交互式一键部署脚本 (幂等)
├── .github/workflows/
│   └── deploy.yml        # GitHub Actions 自动部署
├── wrangler.toml         # Cloudflare Worker 配置
├── package.json
└── .dev.vars.example     # 环境变量模板
```

## 🗄️ D1 数据库 Schema

```sql
-- 图片主表
CREATE TABLE images (
  id TEXT PRIMARY KEY,           -- nanoid 短 ID
  key TEXT NOT NULL UNIQUE,      -- R2 存储路径 (images/{id}.{ext})
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  orientation TEXT DEFAULT 'unknown',  -- landscape / portrait / square
  size INTEGER DEFAULT 0,        -- 文件大小 (bytes)
  mime TEXT DEFAULT '',           -- MIME 类型
  prompt TEXT,                   -- AI 提示词 (JSON 字符串, 可为 NULL)
  source TEXT DEFAULT '',        -- 来源 URL
  uploader TEXT DEFAULT '',      -- 上传者标识
  created_at TEXT NOT NULL       -- ISO 8601 时间戳
);

-- 标签关联表 (多对多)
CREATE TABLE image_tags (
  image_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (image_id, tag),
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_image_tags_tag ON image_tags(tag);
CREATE INDEX idx_images_orientation ON images(orientation);
CREATE INDEX idx_images_created_at ON images(created_at);
```

## 🚀 部署指南

### 方式一: 一键部署 (推荐)

```bash
# 需要: git, node>=18, gh(可选)
uv run scripts/deploy.py
```

脚本完全幂等, 可安全重复运行, 会自动完成:

| 步骤 | 说明 |
|---|---|
| Step 1 | 检查依赖工具 (git, node, npm) |
| Step 2 | 生成安全密钥 (已有则复用, 写入 `.dev.vars`) |
| Step 3 | 安装 npm 依赖 |
| Step 4 | 初始化 Git + 创建 GitHub 仓库 (可选) |
| Step 5 | 创建 R2 存储桶 + 配置 Worker 线上密钥 |
| Step 6 | 创建 D1 数据库 + 更新 wrangler.toml |
| Step 7 | 部署 Worker + 初始化 D1 表结构 |
| Step 8 | 配置自定义域名 (可选) |
| Step 9 | 配置 GitHub Actions 自动部署 (可选) |

### 方式二: 手动部署

**1. 前置条件**

- [Cloudflare 账号](https://dash.cloudflare.com/)
- Node.js >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

**2. 登录 Cloudflare**

```bash
npx wrangler login
```

**3. 创建 R2 存储桶 + D1 数据库**

```bash
npx wrangler r2 bucket create loli-img
npx wrangler d1 create loli-img-db
```

创建 D1 后会输出 `database_id`, 填入 `wrangler.toml` 的 `database_id` 字段。

**4. 配置密钥**

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars, 填入你的密钥
```

在 Cloudflare 线上也需要设置:

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put UPLOAD_TOKEN
```

**5. 安装依赖并部署**

```bash
npm install
npm run deploy
```

**6. 初始化 D1 表结构**

部署成功后, 调用一次初始化接口 (幂等):

```bash
curl -X POST https://your-worker.dev/api/admin/init-db \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

**7. 绑定自定义域名 (可选)**

在 `wrangler.toml` 中添加 (需在所有 `[[table]]` 之前):

```toml
routes = [
  { pattern = "img.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

或在 Cloudflare Dashboard → Workers & Pages → Settings → Domains & Routes 中操作。

**8. 部署后验证**

| 地址 | 说明 |
|---|---|
| `<URL>/` | API 文档首页 |
| `<URL>/admin` | 管理后台 (输入 ADMIN_TOKEN 登录) |
| `<URL>/api/random` | 随机图片 API |
| `<URL>/api/admin/stats` | 统计信息 (需 ADMIN_TOKEN) |

## 📖 API 文档

### 公开 API

#### 随机图片

```
GET /api/random
```

| 参数 | 说明 | 默认 |
|---|---|---|
| `count` | 返回数量 (1-20) | 1 |
| `tag` | 标签筛选 (可多次指定, AND 关系) | - |
| `orientation` | `landscape` / `portrait` / `square` | - |
| `min_width` | 最小宽度 | - |
| `min_height` | 最小高度 | - |
| `max_width` | 最大宽度 | - |
| `max_height` | 最大高度 | - |
| `has_prompt` | `true`/`false` 是否有 AI 提示词 | - |
| `mode` | `json`(默认) / `redirect` / `proxy` | json |

**响应示例:**

```json
{
  "count": 1,
  "total_matched": 42,
  "images": [
    {
      "id": "abc123xyz",
      "url": "https://your-worker.dev/i/abc123xyz",
      "tags": ["genshin", "hutao"],
      "width": 1920,
      "height": 1080,
      "orientation": "landscape",
      "mime": "image/png",
      "prompt": {
        "positive": "1girl, hutao...",
        "negative": "lowres, bad anatomy",
        "model": "animagine-xl-3.0"
      },
      "source": "https://pixiv.net/artworks/...",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

#### 直接访问图片

```
GET /i/{image_id}
GET /i/{image_id}?dl    # 触发下载
```

### 上传 API (需鉴权)

#### 单张上传

```
POST /api/upload
Authorization: Bearer <UPLOAD_TOKEN>
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必须 | 说明 |
|---|---|---|---|
| `file` | File | ✅ | 图片文件 (JPG/PNG/GIF/WebP/AVIF, 最大 20MB) |
| `tags` | string | | 逗号分隔标签, 如 `genshin,hutao` |
| `prompt` | string | | AI 提示词, JSON 字符串 |
| `source` | string | | 来源 URL |
| `width` | number | | 图片宽度 (不传则不记录) |
| `height` | number | | 图片高度 (不传则不记录) |
| `uploader` | string | | 上传者标识 |

#### 批量注册

```
POST /api/upload/batch
Authorization: Bearer <UPLOAD_TOKEN>
Content-Type: application/json
```

用于批量注册已通过 S3 API 上传到 R2 的图片:

```json
{
  "images": [
    {
      "key": "images/xxx.jpg",
      "tags": ["genshin"],
      "prompt": { "positive": "1girl..." },
      "source": "https://...",
      "width": 1920,
      "height": 1080
    }
  ]
}
```

### 管理 API (需鉴权)

所有管理 API 需要 `Authorization: Bearer <ADMIN_TOKEN>` 头。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/init-db` | 初始化 D1 表结构 (幂等) |
| GET | `/api/admin/images` | 列表 (支持分页/搜索/筛选) |
| GET | `/api/admin/image/:id` | 详情 |
| PUT | `/api/admin/image/:id` | 更新元数据 (tags/prompt/source/uploader) |
| DELETE | `/api/admin/image/:id` | 删除 (同时删除 R2 文件) |
| POST | `/api/admin/batch-delete` | 批量删除 |
| GET | `/api/admin/tags` | 标签列表 (含计数) |
| GET | `/api/admin/stats` | 统计信息 |
| POST | `/api/admin/migrate` | 从旧版 R2 索引迁移到 D1 |

#### 列表查询参数

| 参数 | 说明 |
|---|---|
| `page` | 页码 (默认 1) |
| `per_page` | 每页数量 (1-100, 默认 20) |
| `tag` | 按标签筛选 |
| `orientation` | 按方向筛选 |
| `search` | 搜索 id/source/uploader/标签 |

## 🐍 Python SDK

```bash
cd sdk/python
uv sync
```

```python
from hx_loli_img import LoLiImgClient

with LoLiImgClient("https://your-worker.dev", "your-upload-token") as client:
    # 上传 (自动读取图片尺寸)
    client.upload(
        "image.jpg",
        tags=["genshin", "hutao"],
        prompt={
            "positive": "1girl, hutao, genshin impact",
            "negative": "lowres, bad anatomy",
            "model": "animagine-xl-3.0",
            "steps": 28,
        },
        source="https://pixiv.net/artworks/12345678",
    )

    # 获取随机图片
    result = client.random(count=5, tags=["genshin"], orientation="landscape")
    for img in result["images"]:
        print(f"{img['url']}  tags={img['tags']}")
```

## 🔄 GitHub Actions 自动部署

项目内置 `.github/workflows/deploy.yml`, push 到 `main` 或 `master` 分支时自动部署。

**配置步骤:**

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) 创建 API Token
   - 模板选择 **Edit Cloudflare Workers**
   - 权限需包含: Workers Scripts:Edit, Workers Routes:Edit, D1:Edit, Workers R2 Storage:Edit
2. 在 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** 中添加:
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: 上一步创建的 Token
3. Push 代码即可自动部署

## 🔀 从旧版迁移

如果之前使用的是 R2 JSON 索引方案 (manifest.json + items/*.json), 可以一键迁移:

```bash
curl -X POST https://your-worker.dev/api/admin/migrate \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

迁移脚本会读取 R2 中的旧元数据, 逐条写入 D1, 支持幂等重复执行。

## 🛡️ 安全说明

- 所有 Token 通过环境变量配置, 不存储在代码中
- `.dev.vars` 已在 `.gitignore` 中忽略
- 上传 API 和管理 API 都需要 Bearer Token 鉴权
- 公开的随机 API 无需鉴权, 可通过 CF Worker 配置限流

## 📄 License

MIT
