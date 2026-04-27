import { checkAuth, error, json } from "../utils.js";
import {
  loadItem,
  loadItems,
  deleteImage,
  deleteImages,
  updateImage,
  queryList,
  listTags,
  getStats,
  migrateR2toD1,
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
 * 性能: 单次 D1 查询 + 分页
 */
export async function handleListImages(request, env, url) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const page = Math.max(parseInt(url.searchParams.get("page")) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(url.searchParams.get("per_page")) || 20, 1), 100);
  const tag = url.searchParams.get("tag");
  const orientation = url.searchParams.get("orientation");
  const search = url.searchParams.get("search");

  const result = await queryList(env.DB, { page, perPage, tag, orientation, search });

  const baseUrl = `${url.protocol}//${url.host}`;
  const withUrls = result.images.map((img) => ({
    ...img,
    url: `${baseUrl}/i/${img.id}`,
    thumb_url: `${baseUrl}/i/${img.id}`,
  }));

  return json({
    total: result.total,
    page: result.page,
    per_page: result.perPage,
    total_pages: Math.ceil(result.total / result.perPage),
    images: withUrls,
  });
}

/**
 * GET /api/admin/image/:id
 */
export async function handleGetImage(request, env, url, id) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const img = await loadItem(env.DB, id);
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
  const img = await updateImage(env.DB, id, updates);
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

  const img = await deleteImage(env.DB, id);
  if (!img) return error("Not found", 404);

  // 删除 R2 图片文件
  await env.BUCKET.delete(img.key);

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

  const deleted = await deleteImages(env.DB, body.ids);

  // 批量删除 R2 图片文件
  const r2Keys = deleted.map((img) => img.key).filter(Boolean);
  if (r2Keys.length > 0) {
    for (let i = 0; i < r2Keys.length; i += 1000) {
      await env.BUCKET.delete(r2Keys.slice(i, i + 1000));
    }
  }

  return json({ ok: true, deleted_count: deleted.length });
}

/**
 * GET /api/admin/tags
 */
export async function handleListTags(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const tags = await listTags(env.DB);
  return json({ tags });
}

/**
 * GET /api/admin/stats
 */
export async function handleStats(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const stats = await getStats(env.DB);
  return json(stats);
}

/**
 * POST /api/admin/migrate — 从 R2 旧元数据迁移到 D1
 */
export async function handleMigrate(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const result = await migrateR2toD1(env.BUCKET, env.DB);
  return json({ ok: true, ...result });
}
