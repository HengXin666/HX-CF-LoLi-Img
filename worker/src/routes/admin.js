import { checkAuth, error, json } from "../utils.js";
import {
  loadManifest,
  loadItem,
  loadItems,
  loadShardPage,
  deleteImage,
  deleteImages,
  updateImage,
  migrateV1toV2,
} from "../meta.js";

function requireAdmin(request, env) {
  if (!checkAuth(request, env.ADMIN_TOKEN)) {
    return error("Unauthorized", 401);
  }
  return null;
}

/**
 * GET /api/admin/images
 * 查询参数: page, per_page, tag, orientation, search
 *
 * 性能: 只读 manifest + 1 个 shard（分页）
 * 搜索时需加载候选 items 详情
 */
export async function handleListImages(request, env, url) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const manifest = await loadManifest(env.BUCKET);
  const page = Math.max(parseInt(url.searchParams.get("page")) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(url.searchParams.get("per_page")) || 20, 1), 100);
  const tag = url.searchParams.get("tag");
  const orientation = url.searchParams.get("orientation");
  const search = url.searchParams.get("search");

  // 先用 manifest 索引缩小候选集
  let candidateIds = [...manifest.ids];

  if (tag) {
    const tagIds = new Set(manifest.by_tag[tag.toLowerCase()] || []);
    candidateIds = candidateIds.filter((id) => tagIds.has(id));
  }
  if (orientation) {
    const orientIds = new Set(manifest.by_orientation[orientation] || []);
    candidateIds = candidateIds.filter((id) => orientIds.has(id));
  }

  // 倒序（最新在前）— ids 是按添加顺序排的
  candidateIds.reverse();

  // 搜索需要加载详情
  if (search) {
    const q = search.toLowerCase();
    // 加载所有候选 items 进行搜索（搜索是管理操作，可以容忍更长时间）
    const allItems = await loadItems(env.BUCKET, candidateIds);
    const filtered = allItems.filter(
      (img) =>
        (img.tags && img.tags.some((t) => t.includes(q))) ||
        (img.source && img.source.toLowerCase().includes(q)) ||
        (img.uploader && img.uploader.toLowerCase().includes(q)) ||
        img.id.includes(q)
    );
    const total = filtered.length;
    const start = (page - 1) * perPage;
    const paged = filtered.slice(start, start + perPage);

    const baseUrl = `${url.protocol}//${url.host}`;
    const withUrls = paged.map((img) => ({
      ...img,
      url: `${baseUrl}/i/${img.id}`,
      thumb_url: `${baseUrl}/i/${img.id}`,
    }));

    return json({
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
      images: withUrls,
    });
  }

  // 无搜索：直接分页 ID，再加载该页的 items
  const total = candidateIds.length;
  const start = (page - 1) * perPage;
  const pagedIds = candidateIds.slice(start, start + perPage);
  const pagedItems = await loadItems(env.BUCKET, pagedIds);

  const baseUrl = `${url.protocol}//${url.host}`;
  const withUrls = pagedItems.map((img) => ({
    ...img,
    url: `${baseUrl}/i/${img.id}`,
    thumb_url: `${baseUrl}/i/${img.id}`,
  }));

  return json({
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
    images: withUrls,
  });
}

/**
 * GET /api/admin/image/:id  — O(1) 查询
 */
export async function handleGetImage(request, env, url, id) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const img = await loadItem(env.BUCKET, id);
  if (!img) return error("Not found", 404);

  const baseUrl = `${url.protocol}//${url.host}`;
  return json({ ...img, url: `${baseUrl}/i/${img.id}` });
}

/**
 * PUT /api/admin/image/:id
 */
export async function handleUpdateImage(request, env, url, id) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const updates = await request.json();
  const img = await updateImage(env.BUCKET, id, updates);
  if (!img) return error("Not found", 404);

  const baseUrl = `${url.protocol}//${url.host}`;
  return json({ ok: true, image: { ...img, url: `${baseUrl}/i/${img.id}` } });
}

/**
 * DELETE /api/admin/image/:id
 */
export async function handleDeleteImage(request, env, url, id) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const img = await deleteImage(env.BUCKET, id);
  if (!img) return error("Not found", 404);
  return json({ ok: true, deleted: img });
}

/**
 * POST /api/admin/batch-delete
 */
export async function handleBatchDelete(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const body = await request.json();
  if (!body.ids || !Array.isArray(body.ids)) {
    return error("Missing ids array");
  }

  const deleted = await deleteImages(env.BUCKET, body.ids);
  return json({ ok: true, deleted_count: deleted.length });
}

/**
 * GET /api/admin/tags — 直接从 manifest 读取，O(1)
 */
export async function handleListTags(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const manifest = await loadManifest(env.BUCKET);
  const tags = Object.entries(manifest.by_tag)
    .map(([name, ids]) => ({ name, count: ids.length }))
    .sort((a, b) => b.count - a.count);

  return json({ tags });
}

/**
 * GET /api/admin/stats — 直接从 manifest 计算，O(1)
 */
export async function handleStats(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const manifest = await loadManifest(env.BUCKET);

  return json({
    total_images: manifest.total,
    orientations: {
      landscape: manifest.by_orientation.landscape.length,
      portrait: manifest.by_orientation.portrait.length,
      square: manifest.by_orientation.square.length,
      unknown: manifest.by_orientation.unknown.length,
    },
    with_prompt: manifest.with_prompt.length,
    unique_tags: Object.keys(manifest.by_tag).length,
    updated_at: manifest.updated_at,
  });
}

/**
 * POST /api/admin/migrate — 从 v1 迁移到 v2
 */
export async function handleMigrate(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const result = await migrateV1toV2(env.BUCKET);
  return json({ ok: true, ...result });
}
