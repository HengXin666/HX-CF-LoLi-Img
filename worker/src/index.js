import { CORS_HEADERS, error, json } from "./utils.js";
import { handleUpload, handleBatchRegister } from "./routes/upload.js";
import { handleRandom, handleImage } from "./routes/random.js";
import {
  handleListImages,
  handleGetImage,
  handleUpdateImage,
  handleDeleteImage,
  handleBatchDelete,
  handleListTags,
  handleStats,
  handleMigrate,
} from "./routes/admin.js";
import { ADMIN_HTML } from "./admin-ui.js";

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ===== 公开 API =====

      // 随机图片 API
      if (path === "/api/random" && method === "GET") {
        return handleRandom(request, env, url);
      }

      // 直接访问图片 /i/<id>
      const imageMatch = path.match(/^\/i\/([a-z0-9]+)$/);
      if (imageMatch && method === "GET") {
        return handleImage(request, env, url, imageMatch[1]);
      }

      // ===== 上传 API（需要 UPLOAD_TOKEN） =====
      if (path === "/api/upload" && method === "POST") {
        return handleUpload(request, env);
      }
      if (path === "/api/upload/batch" && method === "POST") {
        return handleBatchRegister(request, env);
      }

      // ===== 管理 API（需要 ADMIN_TOKEN） =====
      if (path === "/api/admin/images" && method === "GET") {
        return handleListImages(request, env, url);
      }
      if (path === "/api/admin/tags" && method === "GET") {
        return handleListTags(request, env);
      }
      if (path === "/api/admin/stats" && method === "GET") {
        return handleStats(request, env);
      }
      if (path === "/api/admin/batch-delete" && method === "POST") {
        return handleBatchDelete(request, env);
      }
      if (path === "/api/admin/migrate" && method === "POST") {
        return handleMigrate(request, env);
      }

      // /api/admin/image/:id
      const adminImageMatch = path.match(/^\/api\/admin\/image\/([a-z0-9]+)$/);
      if (adminImageMatch) {
        const id = adminImageMatch[1];
        if (method === "GET") return handleGetImage(request, env, url, id);
        if (method === "PUT") return handleUpdateImage(request, env, url, id);
        if (method === "DELETE") return handleDeleteImage(request, env, url, id);
      }

      // ===== 管理前端 =====
      if (path === "/admin" || path === "/admin/") {
        return new Response(ADMIN_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // ===== 首页 - API 文档 =====
      if (path === "/" || path === "") {
        return new Response(LANDING_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return error("Not Found", 404);
    } catch (e) {
      console.error("Unhandled error:", e);
      return error(`Internal Server Error: ${e.message}`, 500);
    }
  },
};

const LANDING_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HX LoLi Img - 二次元随机图片 API</title>
<style>
  :root { --pink: #ff6b9d; --pink-light: #ffd4e5; --pink-dark: #e8467c; --bg: #fff5f9; --text: #4a3347; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .hero { text-align: center; padding: 4rem 1rem 2rem; background: linear-gradient(135deg, #ff6b9d22, #ff9a5622); }
  .hero h1 { font-size: 2.5rem; background: linear-gradient(135deg, var(--pink), var(--pink-dark)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .hero p { font-size: 1.1rem; margin-top: .5rem; opacity: .8; }
  .badge { display: inline-block; background: var(--pink); color: #fff; padding: .2rem .8rem; border-radius: 1rem; font-size: .8rem; margin-top: .5rem; }
  .container { max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
  .card { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 12px #ff6b9d18; }
  .card h2 { color: var(--pink-dark); margin-bottom: 1rem; font-size: 1.3rem; }
  code { background: #ffeef5; color: var(--pink-dark); padding: .15rem .4rem; border-radius: 4px; font-size: .9em; }
  pre { background: #2d2040; color: #f8e8f0; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: .85rem; line-height: 1.5; margin: .5rem 0; }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0; }
  th, td { text-align: left; padding: .5rem .8rem; border-bottom: 1px solid #ffd4e5; font-size: .9rem; }
  th { color: var(--pink-dark); font-weight: 600; }
  a { color: var(--pink-dark); }
  footer { text-align: center; padding: 2rem; opacity: .6; font-size: .85rem; }
</style>
</head>
<body>
<div class="hero">
  <h1>HX LoLi Img</h1>
  <p>二次元随机图片 API &middot; Powered by Cloudflare R2</p>
  <span class="badge">零出口费 &middot; 全球 CDN</span>
</div>
<div class="container">
  <div class="card">
    <h2>随机获取图片</h2>
    <pre>GET /api/random?count=1&amp;tag=genshin&amp;orientation=landscape</pre>
    <table>
      <tr><th>参数</th><th>说明</th><th>默认</th></tr>
      <tr><td><code>count</code></td><td>返回数量 (1-20)</td><td>1</td></tr>
      <tr><td><code>tag</code></td><td>标签筛选 (可多次指定)</td><td>-</td></tr>
      <tr><td><code>orientation</code></td><td>landscape / portrait / square</td><td>-</td></tr>
      <tr><td><code>min_width</code></td><td>最小宽度</td><td>-</td></tr>
      <tr><td><code>min_height</code></td><td>最小高度</td><td>-</td></tr>
      <tr><td><code>has_prompt</code></td><td>true/false 是否有 AI 提示词</td><td>-</td></tr>
      <tr><td><code>mode</code></td><td>json / redirect / proxy</td><td>json</td></tr>
    </table>
  </div>
  <div class="card">
    <h2>直接访问图片</h2>
    <pre>GET /i/{image_id}</pre>
    <p>返回图片二进制，适合 <code>&lt;img src&gt;</code> 直接引用。加 <code>?dl</code> 触发下载。</p>
  </div>
  <div class="card">
    <h2>管理后台</h2>
    <p>访问 <a href="/admin">/admin</a> 进入管理界面（需要管理员 Token）。</p>
  </div>
</div>
<footer>HX LoLi Img &copy; 2026 &middot; Open Source on GitHub</footer>
</body>
</html>`;
