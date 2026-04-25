import { json, error, getMime } from "../utils.js";
import {
  loadManifest,
  loadItem,
  loadItems,
  queryIds,
  queryWithDimensions,
  pickRandomIds,
} from "../meta.js";

/**
 * GET /api/random
 *
 * 性能:
 *   无筛选 → 读 manifest(几KB) + N 个 item(各~300B) → CPU < 3ms
 *   tag 筛选 → manifest 倒排索引取交集 → O(1) 无需遍历
 *   尺寸筛选 → 需按需加载 item 详情，但先用索引大幅缩小候选集
 */
export async function handleRandom(request, env, url) {
  const manifest = await loadManifest(env.BUCKET);

  // 解析筛选条件
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

  // 第一步：用 manifest 索引快速筛选 ID（O(1) 级别，无 IO）
  let candidateIds = queryIds(manifest, filter);
  if (candidateIds.length === 0) {
    return error("No images match the given filters", 404);
  }

  // 第二步：如果有尺寸筛选，按需加载 item 详情再过滤
  const hasDimFilter = minWidth || minHeight || maxWidth || maxHeight;
  if (hasDimFilter) {
    // 尺寸过滤前先随机采样，避免全量加载
    // 策略：取 count * 10 个候选，加载详情后再筛选
    const sampleSize = Math.min(candidateIds.length, count * 10);
    const sampled = pickRandomIds(candidateIds, sampleSize);
    candidateIds = await queryWithDimensions(env.BUCKET, sampled, filter);
    if (candidateIds.length === 0) {
      return error("No images match the given size filters", 404);
    }
  }

  // 第三步：随机选取
  const pickedIds = pickRandomIds(candidateIds, count);

  // 第四步：批量加载选中图片的详情
  const picked = await loadItems(env.BUCKET, pickedIds);

  // 构造响应
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
    total_matched: candidateIds.length,
    images: withUrls,
  });
}

/**
 * GET /i/<id> — 直接返回图片 (O(1) 查询)
 * 只读一个 item JSON + 一个图片文件，不碰 manifest
 */
export async function handleImage(request, env, url, id) {
  const img = await loadItem(env.BUCKET, id);
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
