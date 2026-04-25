# 🌸 HX LoLi Img

> 二次元随机图片 API · Powered by Cloudflare R2 + Workers

**零出口费 · 全球 CDN · 10GB 免费存储/月 · 纯 Serverless**

## ✨ 特性

- **随机图片 API** — 支持标签筛选、横竖向筛选、尺寸筛选, 单次最多返回 20 张
- **AI 提示词存储** — 支持任意 JSON 结构的提示词元数据
- **Python SDK** — 爬虫一行代码上传, 自动读取图片尺寸
- **管理后台** — 粉色二次元主题的 SPA 管理界面, 支持批量操作
- **纯 R2 存储** — 图片文件 + JSON 索引全部存在 R2, 不依赖 D1/KV 等额外服务
- **鉴权保护** — 上传和管理 API 需要 Token, 公开 API 可选限流

## 🏗️ 架构

```
py爬虫 ──(SDK/API)──► CF Worker (API) ──► R2 存储
                          │
                          ▼
                    R2: _meta/manifest.json    (轻量清单 + 倒排索引, ~5KB)
                    R2: _meta/items/{id}.json  (单条详情, ~300B)
                    R2: _meta/shards/shard-N   (管理分页用, 每片 500 条)
                    R2: images/{id}.{ext}      (图片文件)
                          │
用户 ──(GET /api/random)──► CF Worker ──► 读 manifest → 倒排索引筛选 → 随机 → 读 items
                          │
管理员 ──(/admin)─────────► CF Worker ──► SPA 前端 ──► CRUD API
```

## ⚡ 性能设计

CF Worker **免费版 CPU 限制 10ms**，我们通过三级索引 + 倒排避免全表扫描：

| 操作 | R2 读取次数 | CPU 耗时 | 原理 |
|---|---|---|---|
| `/api/random` (无筛选) | 1 (manifest) + N (items) | ~2ms | manifest 只有 ID 数组 |
| `/api/random?tag=x` | 1 (manifest) + N (items) | ~2ms | 倒排索引 O(1) 取交集 |
| `/api/random?orientation=landscape` | 1 (manifest) + N (items) | ~1ms | 预计算分桶 |
| `/i/{id}` | 1 (item) + 1 (图片) | ~1ms | **不碰 manifest** |
| `/api/admin/stats` | 1 (manifest) | ~0.5ms | manifest 内直接计算 |
| `/api/admin/tags` | 1 (manifest) | ~0.5ms | 倒排索引即标签表 |

**扩展能力**：

| 图片数量 | manifest 大小 | 是否安全 |
|---|---|---|
| 1,000 | ~40 KB | ✅ 无压力 |
| 5,000 | ~200 KB | ✅ 安全 |
| 10,000 | ~400 KB | ✅ 仍在 10ms 内 |
| 50,000+ | ~2 MB | ⚠️ 考虑开启 KV 缓存 manifest |

对比旧方案（单文件全量索引）在 5000 张时就会超时，新方案可轻松支撑万张级别。

## 📦 CF R2 免费额度

| 项目 | 免费额度 |
|---|---|
| 存储 | 10 GB-month |
| Class A 操作 (写) | 1,000,000 / 月 |
| Class B 操作 (读) | 10,000,000 / 月 |
| 出口流量 | **$0(零费用)** |

## 🚀 部署指南

### 方式一：一键部署（推荐）

```bash
# 需要: git, node>=18, gh(可选)
uv run scripts/deploy.py
```

交互式脚本会自动完成：
1. ✅ 检查依赖工具
2. ✅ 生成安全密钥（自动写入 `.dev.vars`）
3. ✅ 安装 npm 依赖
4. ✅ 初始化 Git + 创建 GitHub 仓库（可选）
5. ✅ 创建 R2 存储桶 + 配置 Worker 线上密钥
6. ✅ 部署到 Cloudflare

### 方式二：手动部署

### 1. 前置条件

- [Cloudflare 账号](https://dash.cloudflare.com/)
- Node.js >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 2. 创建 R2 存储桶

```bash
# 登录 Cloudflare
npx wrangler login

# 创建存储桶
npx wrangler r2 bucket create loli-img
```

### 3. 配置密钥

```bash
# 复制示例配置
cp .dev.vars.example .dev.vars

# 编辑 .dev.vars, 填入你的密钥
```

在 Cloudflare Dashboard 中也需要设置 Workers 环境变量: 
- `ADMIN_TOKEN` — 管理员密钥
- `UPLOAD_TOKEN` — 上传密钥

### 4. 安装依赖并部署

```bash
npm install

# 本地开发
npm run dev

# 部署到 Cloudflare
npm run deploy
```

### 5. 绑定自定义域名(推荐)

在 Cloudflare Dashboard → Workers → 你的 Worker → Settings → Domains & Routes 中绑定域名。

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

**响应示例: **

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
      "prompt": {
        "positive": "1girl, hutao...",
        "model": "animagine-xl-3.0"
      },
      "source": "https://pixiv.net/artworks/...",
      "created_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

#### 直接访问图片

```
GET /i/{image_id}
GET /i/{image_id}?dl    # 触发下载
```

### 上传 API(需鉴权)

```
POST /api/upload
Authorization: Bearer <UPLOAD_TOKEN>
Content-Type: multipart/form-data

字段:
  file     - 图片文件(必须)
  tags     - 逗号分隔标签
  prompt   - JSON 字符串(AI 提示词)
  source   - 来源 URL
  width    - 宽度
  height   - 高度
```

### 管理 API(需鉴权)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/images` | 列表 (支持分页/搜索/筛选) |
| GET | `/api/admin/image/:id` | 详情 |
| PUT | `/api/admin/image/:id` | 更新元数据 |
| DELETE | `/api/admin/image/:id` | 删除 |
| POST | `/api/admin/batch-delete` | 批量删除 |
| GET | `/api/admin/tags` | 标签列表 |
| GET | `/api/admin/stats` | 统计信息 |
| POST | `/api/admin/migrate` | 从 v1 索引迁移到 v2 |

## 🐍 Python SDK

```bash
cd sdk/python
uv sync
```

```python
from hx_loli_img import LoLiImgClient

with LoLiImgClient("https://your-worker.dev", "your-token") as client:
    # 上传
    client.upload("image.jpg", tags=["genshin"], prompt={"positive": "1girl..."})

    # 获取随机图片
    result = client.random(count=5, tags=["genshin"], orientation="landscape")
```

## 🛡️ 安全说明

- **密钥管理**: 所有 Token 通过环境变量配置, 不存储在代码中
- `.dev.vars` 和 `.env` 已在 `.gitignore` 中忽略
- 上传 API 和管理 API 都需要 Bearer Token 鉴权
- 公开的随机 API 无需鉴权, 但可以通过 CF Worker 配置限流

## 📊 与现有方案的差异

| 功能 | 本项目 | ShiinaKin | ReiaKurona | 二叉树树 |
|---|---|---|---|---|
| 标签系统 | ✅ | ❌ | ❌ | ❌ |
| AI 提示词 | ✅ JSON | ❌ | ❌ | ❌ |
| 尺寸筛选 | ✅ | 部分 | ❌ | ❌ |
| 管理界面 | ✅ SPA | ❌ | ❌ | ❌ |
| Python SDK | ✅ | ❌ | ❌ | ❌ |
| 纯 R2 存储 | ✅ | ❌ (需 Redis/DB) | ✅ | ✅ |
| 部署复杂度 | Serverless | Docker | Worker | EdgeOne |

## 📄 License

MIT
