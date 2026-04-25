export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HX LoLi Img - Admin</title>
<style>
:root {
  --pink: #ff6b9d; --pink-light: #ffd4e5; --pink-dark: #e8467c; --pink-bg: #fff5f9;
  --rose: #ff9eb5; --text: #4a3347; --text-light: #8a7088; --white: #ffffff;
  --danger: #ff4757; --success: #2ed573; --radius: 12px; --shadow: 0 4px 20px #ff6b9d20;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--pink-bg); color: var(--text); }

/* 导航 */
.nav { background: linear-gradient(135deg, var(--pink), var(--pink-dark)); padding: 0 1.5rem; display: flex; align-items: center; height: 56px; box-shadow: 0 2px 16px #e8467c40; position: sticky; top: 0; z-index: 100; }
.nav h1 { color: #fff; font-size: 1.2rem; font-weight: 700; }
.nav h1 span { font-weight: 400; opacity: .8; font-size: .9rem; margin-left: .5rem; }
.nav-actions { margin-left: auto; display: flex; gap: .5rem; align-items: center; }
.nav-actions button { background: rgba(255,255,255,.2); color: #fff; border: none; padding: .4rem 1rem; border-radius: 20px; cursor: pointer; font-size: .85rem; transition: .2s; }
.nav-actions button:hover { background: rgba(255,255,255,.35); }

/* 登录 */
.login-overlay { position: fixed; inset: 0; background: linear-gradient(135deg, #fff5f9, #ffe8f0); display: flex; align-items: center; justify-content: center; z-index: 999; }
.login-box { background: #fff; border-radius: 20px; padding: 2.5rem; width: 360px; box-shadow: var(--shadow); text-align: center; }
.login-box h2 { color: var(--pink-dark); margin-bottom: .5rem; font-size: 1.5rem; }
.login-box p { color: var(--text-light); margin-bottom: 1.5rem; font-size: .9rem; }
.login-box input { width: 100%; padding: .7rem 1rem; border: 2px solid var(--pink-light); border-radius: 10px; font-size: 1rem; outline: none; transition: .2s; }
.login-box input:focus { border-color: var(--pink); }
.login-box button { width: 100%; padding: .7rem; margin-top: 1rem; background: linear-gradient(135deg, var(--pink), var(--pink-dark)); color: #fff; border: none; border-radius: 10px; font-size: 1rem; cursor: pointer; transition: .2s; }
.login-box button:hover { transform: translateY(-1px); box-shadow: 0 4px 16px #e8467c50; }

/* 布局 */
.container { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }

/* 统计卡片 */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.stat-card { background: #fff; border-radius: var(--radius); padding: 1.2rem; box-shadow: var(--shadow); text-align: center; }
.stat-card .num { font-size: 1.8rem; font-weight: 700; color: var(--pink-dark); }
.stat-card .label { font-size: .8rem; color: var(--text-light); margin-top: .2rem; }

/* 工具栏 */
.toolbar { display: flex; gap: .8rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
.toolbar input, .toolbar select { padding: .5rem .8rem; border: 2px solid var(--pink-light); border-radius: 8px; font-size: .9rem; outline: none; background: #fff; }
.toolbar input:focus, .toolbar select:focus { border-color: var(--pink); }
.toolbar .search { flex: 1; min-width: 200px; }
.btn { padding: .5rem 1.2rem; border: none; border-radius: 8px; cursor: pointer; font-size: .85rem; transition: .2s; font-weight: 600; }
.btn-pink { background: var(--pink); color: #fff; }
.btn-pink:hover { background: var(--pink-dark); }
.btn-outline { background: transparent; color: var(--pink-dark); border: 2px solid var(--pink-light); }
.btn-outline:hover { background: var(--pink-light); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { opacity: .85; }
.btn-sm { padding: .3rem .7rem; font-size: .8rem; }

/* 图片网格 */
.image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
.image-card { background: #fff; border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); transition: .3s; position: relative; }
.image-card:hover { transform: translateY(-4px); box-shadow: 0 8px 30px #ff6b9d30; }
.image-card img { width: 100%; height: 180px; object-fit: cover; display: block; cursor: pointer; }
.image-card .info { padding: .8rem; }
.image-card .tags { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .4rem; }
.tag { display: inline-block; background: var(--pink-light); color: var(--pink-dark); padding: .1rem .5rem; border-radius: 10px; font-size: .75rem; }
.tag-prompt { background: #e8d4ff; color: #7c3aed; }
.image-card .meta { font-size: .75rem; color: var(--text-light); }
.image-card .actions { display: flex; gap: .3rem; margin-top: .5rem; }
.image-card .checkbox { position: absolute; top: 8px; left: 8px; width: 20px; height: 20px; accent-color: var(--pink); }

/* 分页 */
.pagination { display: flex; justify-content: center; align-items: center; gap: .5rem; margin-top: 1.5rem; }
.pagination button { padding: .4rem .8rem; border: 2px solid var(--pink-light); background: #fff; color: var(--pink-dark); border-radius: 8px; cursor: pointer; font-size: .85rem; }
.pagination button.active { background: var(--pink); color: #fff; border-color: var(--pink); }
.pagination button:disabled { opacity: .4; cursor: not-allowed; }

/* 模态框 */
.modal-overlay { position: fixed; inset: 0; background: rgba(74,51,71,.6); z-index: 200; display: none; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.modal-overlay.show { display: flex; }
.modal { background: #fff; border-radius: 16px; width: 500px; max-width: 95vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.modal-header { padding: 1.2rem 1.5rem; border-bottom: 1px solid var(--pink-light); display: flex; align-items: center; }
.modal-header h3 { color: var(--pink-dark); flex: 1; }
.modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-light); }
.modal-body { padding: 1.5rem; }
.modal-body label { display: block; font-weight: 600; margin-bottom: .3rem; color: var(--text); font-size: .9rem; }
.modal-body input, .modal-body textarea { width: 100%; padding: .6rem .8rem; border: 2px solid var(--pink-light); border-radius: 8px; font-size: .9rem; outline: none; margin-bottom: 1rem; font-family: inherit; }
.modal-body textarea { min-height: 80px; resize: vertical; }
.modal-body input:focus, .modal-body textarea:focus { border-color: var(--pink); }
.modal-footer { padding: 1rem 1.5rem; border-top: 1px solid var(--pink-light); display: flex; justify-content: flex-end; gap: .5rem; }
.modal-img { width: 100%; max-height: 300px; object-fit: contain; border-radius: 8px; margin-bottom: 1rem; background: #f9f0f5; }

/* Toast */
.toast { position: fixed; bottom: 20px; right: 20px; padding: .8rem 1.5rem; border-radius: 10px; color: #fff; font-size: .9rem; z-index: 999; animation: slideIn .3s ease; }
.toast-success { background: var(--success); }
.toast-error { background: var(--danger); }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* 空状态 */
.empty { text-align: center; padding: 4rem 1rem; color: var(--text-light); }
.empty .icon { font-size: 3rem; margin-bottom: 1rem; }

/* 上传区 */
.upload-zone { border: 3px dashed var(--pink-light); border-radius: var(--radius); padding: 2rem; text-align: center; cursor: pointer; transition: .2s; margin-bottom: 1rem; }
.upload-zone:hover, .upload-zone.dragover { border-color: var(--pink); background: #fff0f5; }
.upload-zone input { display: none; }

.loading { text-align: center; padding: 2rem; color: var(--text-light); }
</style>
</head>
<body>

<!-- 登录 -->
<div id="loginOverlay" class="login-overlay">
  <div class="login-box">
    <h2>HX LoLi Img</h2>
    <p>管理后台 &middot; 请输入管理员密钥</p>
    <input type="password" id="tokenInput" placeholder="Admin Token" autofocus>
    <button onclick="doLogin()">登 录</button>
  </div>
</div>

<!-- 导航 -->
<nav class="nav">
  <h1>HX LoLi Img <span>Admin</span></h1>
  <div class="nav-actions">
    <button onclick="showUploadModal()">上传图片</button>
    <button onclick="logout()">登出</button>
  </div>
</nav>

<div class="container">
  <!-- 统计 -->
  <div class="stats-grid" id="statsGrid"></div>

  <!-- 工具栏 -->
  <div class="toolbar">
    <input type="text" class="search" id="searchInput" placeholder="搜索标签、来源、ID..." onkeyup="if(event.key==='Enter')doSearch()">
    <select id="orientationFilter" onchange="doSearch()">
      <option value="">全部方向</option>
      <option value="landscape">横向</option>
      <option value="portrait">竖向</option>
      <option value="square">方形</option>
    </select>
    <select id="tagFilter" onchange="doSearch()">
      <option value="">全部标签</option>
    </select>
    <button class="btn btn-pink" onclick="doSearch()">搜索</button>
    <button class="btn btn-outline" onclick="toggleSelect()">批量选择</button>
    <button class="btn btn-danger" id="batchDeleteBtn" style="display:none" onclick="batchDelete()">删除选中</button>
  </div>

  <!-- 图片列表 -->
  <div id="imageGrid" class="image-grid"></div>
  <div id="pagination" class="pagination"></div>
</div>

<!-- 编辑模态框 -->
<div id="editModal" class="modal-overlay">
  <div class="modal">
    <div class="modal-header">
      <h3>编辑图片信息</h3>
      <button class="modal-close" onclick="closeModal('editModal')">&times;</button>
    </div>
    <div class="modal-body">
      <img id="editImg" class="modal-img" alt="">
      <label>标签（逗号分隔）</label>
      <input type="text" id="editTags" placeholder="genshin, hutao, cute">
      <label>来源 URL</label>
      <input type="text" id="editSource" placeholder="https://...">
      <label>上传者</label>
      <input type="text" id="editUploader" placeholder="">
      <label>AI 提示词 (JSON)</label>
      <textarea id="editPrompt" placeholder='{"positive": "1girl, ...", "negative": "...", "model": "..."}'></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal('editModal')">取消</button>
      <button class="btn btn-pink" onclick="saveEdit()">保存</button>
    </div>
  </div>
</div>

<!-- 上传模态框 -->
<div id="uploadModal" class="modal-overlay">
  <div class="modal">
    <div class="modal-header">
      <h3>上传图片</h3>
      <button class="modal-close" onclick="closeModal('uploadModal')">&times;</button>
    </div>
    <div class="modal-body">
      <div class="upload-zone" id="uploadZone" onclick="document.getElementById('fileInput').click()">
        <div class="icon">📁</div>
        <p>点击或拖拽图片到此处</p>
        <p style="font-size:.8rem;color:var(--text-light);margin-top:.3rem">支持 JPG / PNG / GIF / WebP / AVIF，最大 20MB</p>
        <input type="file" id="fileInput" accept="image/*" multiple onchange="handleFiles(this.files)">
      </div>
      <div id="uploadQueue"></div>
      <label>标签（逗号分隔，应用到所有）</label>
      <input type="text" id="uploadTags" placeholder="genshin, hutao">
      <label>来源 URL</label>
      <input type="text" id="uploadSource" placeholder="https://...">
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal('uploadModal')">取消</button>
      <button class="btn btn-pink" id="uploadBtn" onclick="doUpload()">开始上传</button>
    </div>
  </div>
</div>

<!-- 预览模态框 -->
<div id="previewModal" class="modal-overlay" onclick="if(event.target===this)closeModal('previewModal')">
  <div class="modal" style="width:800px">
    <div class="modal-header">
      <h3 id="previewTitle">预览</h3>
      <button class="modal-close" onclick="closeModal('previewModal')">&times;</button>
    </div>
    <div class="modal-body" style="text-align:center;">
      <img id="previewImg" style="max-width:100%;max-height:70vh;border-radius:8px;" alt="">
      <div id="previewInfo" style="margin-top:1rem;text-align:left;font-size:.85rem;"></div>
    </div>
  </div>
</div>

<script>
const API = location.origin;
let token = localStorage.getItem("admin_token") || "";
let currentPage = 1;
let selectMode = false;
let selectedIds = new Set();
let editingId = null;
let uploadFiles = [];

// === 登录 ===
function checkLogin() {
  if (token) {
    document.getElementById("loginOverlay").style.display = "none";
    init();
  }
}
function doLogin() {
  token = document.getElementById("tokenInput").value.trim();
  if (!token) return;
  localStorage.setItem("admin_token", token);
  document.getElementById("loginOverlay").style.display = "none";
  init();
}
function logout() {
  token = "";
  localStorage.removeItem("admin_token");
  location.reload();
}
document.getElementById("tokenInput").addEventListener("keyup", e => { if (e.key === "Enter") doLogin(); });

// === API ===
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) },
  });
  if (res.status === 401) { logout(); throw new Error("Unauthorized"); }
  return res.json();
}

// === 初始化 ===
async function init() {
  await Promise.all([loadStats(), loadTags(), loadImages()]);
}

// === 统计 ===
async function loadStats() {
  try {
    const d = await api("/api/admin/stats");
    document.getElementById("statsGrid").innerHTML = \`
      <div class="stat-card"><div class="num">\${d.total_images}</div><div class="label">总图片数</div></div>
      <div class="stat-card"><div class="num">\${d.total_size_mb} MB</div><div class="label">总大小</div></div>
      <div class="stat-card"><div class="num">\${d.unique_tags}</div><div class="label">标签数</div></div>
      <div class="stat-card"><div class="num">\${d.with_prompt}</div><div class="label">有提示词</div></div>
      <div class="stat-card"><div class="num">\${d.orientations.landscape}</div><div class="label">横向</div></div>
      <div class="stat-card"><div class="num">\${d.orientations.portrait}</div><div class="label">竖向</div></div>
    \`;
  } catch (e) { console.error(e); }
}

// === 标签 ===
async function loadTags() {
  try {
    const d = await api("/api/admin/tags");
    const sel = document.getElementById("tagFilter");
    sel.innerHTML = '<option value="">全部标签</option>' +
      d.tags.map(t => \`<option value="\${t.name}">\${t.name} (\${t.count})</option>\`).join("");
  } catch (e) { console.error(e); }
}

// === 图片列表 ===
async function loadImages() {
  const search = document.getElementById("searchInput").value.trim();
  const orientation = document.getElementById("orientationFilter").value;
  const tag = document.getElementById("tagFilter").value;

  let qs = \`?page=\${currentPage}&per_page=24\`;
  if (search) qs += \`&search=\${encodeURIComponent(search)}\`;
  if (orientation) qs += \`&orientation=\${orientation}\`;
  if (tag) qs += \`&tag=\${encodeURIComponent(tag)}\`;

  try {
    const d = await api("/api/admin/images" + qs);
    renderImages(d);
    renderPagination(d);
  } catch (e) {
    document.getElementById("imageGrid").innerHTML = '<div class="empty"><div class="icon">😿</div><p>加载失败，请检查 Token</p></div>';
  }
}

function renderImages(d) {
  const grid = document.getElementById("imageGrid");
  if (d.images.length === 0) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="icon">🖼️</div><p>暂无图片</p></div>';
    return;
  }
  grid.innerHTML = d.images.map(img => \`
    <div class="image-card">
      \${selectMode ? \`<input type="checkbox" class="checkbox" data-id="\${img.id}" \${selectedIds.has(img.id)?'checked':''} onchange="toggleSelect2(this)">\` : ''}
      <img src="\${img.url}" alt="\${img.id}" loading="lazy" onclick="previewImage('\${img.id}')">
      <div class="info">
        <div class="tags">
          \${(img.tags||[]).map(t => \`<span class="tag">\${t}</span>\`).join('')}
          \${img.prompt ? '<span class="tag tag-prompt">AI</span>' : ''}
        </div>
        <div class="meta">\${img.width||'?'}×\${img.height||'?'} · \${formatSize(img.size)} · \${img.orientation||''}</div>
        <div class="actions">
          <button class="btn btn-outline btn-sm" onclick="editImage('\${img.id}')">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="deleteOne('\${img.id}')">删除</button>
        </div>
      </div>
    </div>
  \`).join('');
}

function renderPagination(d) {
  const el = document.getElementById("pagination");
  if (d.total_pages <= 1) { el.innerHTML = ''; return; }
  let html = \`<button \${d.page<=1?'disabled':''} onclick="goPage(\${d.page-1})">上一页</button>\`;
  const start = Math.max(1, d.page - 2);
  const end = Math.min(d.total_pages, d.page + 2);
  for (let i = start; i <= end; i++) {
    html += \`<button class="\${i===d.page?'active':''}" onclick="goPage(\${i})">\${i}</button>\`;
  }
  html += \`<button \${d.page>=d.total_pages?'disabled':''} onclick="goPage(\${d.page+1})">下一页</button>\`;
  html += \`<span style="font-size:.85rem;color:var(--text-light);margin-left:.5rem">共 \${d.total} 张</span>\`;
  el.innerHTML = html;
}

function goPage(p) { currentPage = p; loadImages(); }
function doSearch() { currentPage = 1; loadImages(); }

// === 批量选择 ===
function toggleSelect() {
  selectMode = !selectMode;
  selectedIds.clear();
  document.getElementById("batchDeleteBtn").style.display = selectMode ? "inline-block" : "none";
  loadImages();
}
function toggleSelect2(el) {
  if (el.checked) selectedIds.add(el.dataset.id);
  else selectedIds.delete(el.dataset.id);
}
async function batchDelete() {
  if (selectedIds.size === 0) return toast("请先选择图片", "error");
  if (!confirm(\`确定删除 \${selectedIds.size} 张图片？\`)) return;
  await api("/api/admin/batch-delete", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ids: [...selectedIds]}) });
  toast(\`已删除 \${selectedIds.size} 张\`);
  selectedIds.clear();
  selectMode = false;
  document.getElementById("batchDeleteBtn").style.display = "none";
  await Promise.all([loadStats(), loadTags(), loadImages()]);
}

// === 预览 ===
async function previewImage(id) {
  const d = await api(\`/api/admin/image/\${id}\`);
  document.getElementById("previewImg").src = d.url;
  document.getElementById("previewTitle").textContent = d.id;
  let info = \`<p><b>尺寸:</b> \${d.width||'?'}×\${d.height||'?'} · <b>方向:</b> \${d.orientation} · <b>大小:</b> \${formatSize(d.size)}</p>\`;
  info += \`<p><b>标签:</b> \${(d.tags||[]).join(', ')||'无'}</p>\`;
  info += \`<p><b>来源:</b> \${d.source||'无'}</p>\`;
  info += \`<p><b>上传者:</b> \${d.uploader||'未知'}</p>\`;
  info += \`<p><b>创建时间:</b> \${d.created_at}</p>\`;
  if (d.prompt) info += \`<p><b>AI 提示词:</b></p><pre style="background:#2d2040;color:#f8e8f0;padding:.8rem;border-radius:8px;font-size:.8rem;overflow-x:auto;white-space:pre-wrap;">\${JSON.stringify(d.prompt, null, 2)}</pre>\`;
  document.getElementById("previewInfo").innerHTML = info;
  showModal("previewModal");
}

// === 编辑 ===
async function editImage(id) {
  const d = await api(\`/api/admin/image/\${id}\`);
  editingId = id;
  document.getElementById("editImg").src = d.url;
  document.getElementById("editTags").value = (d.tags||[]).join(", ");
  document.getElementById("editSource").value = d.source || "";
  document.getElementById("editUploader").value = d.uploader || "";
  document.getElementById("editPrompt").value = d.prompt ? JSON.stringify(d.prompt, null, 2) : "";
  showModal("editModal");
}
async function saveEdit() {
  const tags = document.getElementById("editTags").value.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean);
  const source = document.getElementById("editSource").value.trim();
  const uploader = document.getElementById("editUploader").value.trim();
  let prompt = null;
  const promptRaw = document.getElementById("editPrompt").value.trim();
  if (promptRaw) {
    try { prompt = JSON.parse(promptRaw); } catch { return toast("提示词 JSON 格式错误", "error"); }
  }
  await api(\`/api/admin/image/\${editingId}\`, {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ tags, source, uploader, prompt }),
  });
  toast("已保存");
  closeModal("editModal");
  await Promise.all([loadTags(), loadImages()]);
}

// === 删除 ===
async function deleteOne(id) {
  if (!confirm("确定删除？")) return;
  await api(\`/api/admin/image/\${id}\`, { method: "DELETE" });
  toast("已删除");
  await Promise.all([loadStats(), loadTags(), loadImages()]);
}

// === 上传 ===
function showUploadModal() {
  uploadFiles = [];
  document.getElementById("uploadQueue").innerHTML = "";
  document.getElementById("fileInput").value = "";
  showModal("uploadModal");
}

const zone = document.getElementById("uploadZone");
zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("dragover"); handleFiles(e.dataTransfer.files); });

function handleFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    uploadFiles.push(f);
  }
  renderQueue();
}
function renderQueue() {
  document.getElementById("uploadQueue").innerHTML = uploadFiles.map((f,i) =>
    \`<div style="display:flex;align-items:center;gap:.5rem;margin:.3rem 0;font-size:.85rem;">
      <span>\${f.name}</span>
      <span style="color:var(--text-light)">\${formatSize(f.size)}</span>
      <button class="btn btn-danger btn-sm" onclick="removeFile(\${i})">×</button>
    </div>\`
  ).join('');
}
function removeFile(i) { uploadFiles.splice(i, 1); renderQueue(); }

async function doUpload() {
  if (uploadFiles.length === 0) return toast("请先选择文件", "error");
  const btn = document.getElementById("uploadBtn");
  btn.disabled = true; btn.textContent = "上传中...";
  const tags = document.getElementById("uploadTags").value.trim();
  const source = document.getElementById("uploadSource").value.trim();

  let ok = 0, fail = 0;
  for (const f of uploadFiles) {
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (tags) fd.append("tags", tags);
      if (source) fd.append("source", source);
      // 尝试用 Image 获取尺寸
      const dim = await getImageDimensions(f);
      if (dim) { fd.append("width", dim.width); fd.append("height", dim.height); }
      await fetch(API + "/api/upload", { method: "POST", headers: { Authorization: "Bearer " + token }, body: fd });
      ok++;
    } catch { fail++; }
  }

  btn.disabled = false; btn.textContent = "开始上传";
  toast(\`上传完成: \${ok} 成功\${fail ? ', ' + fail + ' 失败' : ''}\`);
  closeModal("uploadModal");
  uploadFiles = [];
  await Promise.all([loadStats(), loadTags(), loadImages()]);
}

function getImageDimensions(file) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

// === 工具 ===
function showModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function formatSize(bytes) {
  if (!bytes) return "?";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1024/1024).toFixed(1) + " MB";
}
function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = \`toast toast-\${type}\`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// 启动
checkLogin();
</script>
</body>
</html>`;
