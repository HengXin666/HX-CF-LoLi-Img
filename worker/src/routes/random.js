import { json, error, getMime } from "../utils.js";
import { queryRandom, queryCount, loadItem, loadItems } from "../meta.js";

/**
 * GET /api/random
 *
 * 性能: 单次 D1 SQL 查询，利用索引
 *   无筛选 → ORDER BY RANDOM() LIMIT N → ~1ms
 *   tag 筛选 → JOIN image_tags + HAVING → ~2ms
 *   尺寸筛选 → WHERE width >= ? → 索引命中
 */
export async function handleRandom(request, env, url) {
  const tags = url.searchParams.getAll("tag").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const orientation = url.searchParams.get("orientation") || "";
  const minWidth = parseInt(url.searchParams.get("min_width")) || 0;
  const minHeight = parseInt(url.searchParams.get("min_height")) || 0;
  const maxWidth = parseInt(url.searchParams.get("max_width")) || 0;
  const maxHeight = parseInt(url.searchParams.get("max_height")) || 0;
  const hasPromptParam = url.searchParams.get("has_prompt");
  const count = Math.min(Math.max(parseInt(url.searchParams.get("count")) || 1, 1), 20);
  const mode = url.searchParams.get("mode") || "json";

  const filter = {};
  if (tags.length > 0) filter.tags = tags;
  if (orientation) filter.orientation = orientation;
  if (minWidth) filter.minWidth = minWidth;
  if (minHeight) filter.minHeight = minHeight;
  if (maxWidth) filter.maxWidth = maxWidth;
  if (maxHeight) filter.maxHeight = maxHeight;
  if (hasPromptParam !== null) filter.hasPrompt = hasPromptParam === "true";

  // 单次 D1 查询完成筛选 + 随机
  const pickedIds = await queryRandom(env.DB, filter, count);
  if (pickedIds.length === 0) {
    return error("No images match the given filters", 404);
  }

  const picked = await loadItems(env.DB, pickedIds);
  const totalMatched = await queryCount(env.DB, filter);

  const baseUrl = `${url.protocol}//${url.host}`;
  const withUrls = picked.map((img) => ({
    id: img.id,
    url: `${baseUrl}/i/${img.id}`,
    tags: img.tags,
    width: img.width,
    height: img.height,
    orientation: img.orientation,
    mime: img.mime,
    prompt: img.prompt,
    source: img.source,
    created_at: img.created_at,
  }));

  if (mode === "redirect" && withUrls.length === 1) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: withUrls[0].url,
        "Cache-Control": "no-cache, no-store",
      },
    });
  }

  if (mode === "proxy" && withUrls.length === 1) {
    const img = picked[0];
    const obj = await env.BUCKET.get(img.key);
    if (!obj) return error("Image file not found", 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": img.mime || getMime(img.key),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return json({
    count: withUrls.length,
    total_matched: totalMatched,
    images: withUrls,
  });
}

/**
 * GET /i/<id> — 直接返回图片
 * 1 次 D1 查询 + 1 次 R2 读取
 */
export async function handleImage(request, env, url, id) {
  const img = await loadItem(env.DB, id);
  if (!img) return error("Not found", 404);

  const obj = await env.BUCKET.get(img.key);
  if (!obj) return error("Image file missing from storage", 404);

  const headers = {
    "Content-Type": img.mime || getMime(img.key),
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
    "X-Image-Id": img.id,
  };

  if (url.searchParams.has("dl")) {
    const ext = img.key.split(".").pop();
    headers["Content-Disposition"] = `attachment; filename="${img.id}.${ext}"`;
  }

  return new Response(obj.body, { headers });
}
