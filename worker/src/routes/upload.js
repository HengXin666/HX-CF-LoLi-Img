import { checkAuth, error, json, nanoid, getMime } from "../utils.js";
import { addImage, loadManifest, invalidateCache } from "../meta.js";

/**
 * POST /api/upload
 * Content-Type: multipart/form-data
 *
 * 字段:
 *   file      - 图片文件（必须）
 *   tags      - 逗号分隔的标签，如 "genshin,hutao"（可选）
 *   prompt    - JSON 字符串，AI 提示词（可选）
 *   source    - 图片来源 URL（可选）
 *   width     - 图片宽度（可选，不传则不记录）
 *   height    - 图片高度（可选，不传则不记录）
 *
 * 鉴权: Bearer <UPLOAD_TOKEN>
 */
export async function handleUpload(request, env) {
  if (!checkAuth(request, env.UPLOAD_TOKEN)) {
    return error("Unauthorized", 401);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return error("Content-Type must be multipart/form-data");
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return error("Missing file field");
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"];
  if (!allowedTypes.includes(file.type)) {
    return error(`Unsupported file type: ${file.type}. Allowed: ${allowedTypes.join(", ")}`);
  }

  if (file.size > 20 * 1024 * 1024) {
    return error("File too large (max 20MB)");
  }

  const id = nanoid();
  const ext = file.name.split(".").pop().toLowerCase() || "jpg";
  const key = `images/${id}.${ext}`;

  const tagsRaw = formData.get("tags") || "";
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  let prompt = null;
  const promptRaw = formData.get("prompt");
  if (promptRaw) {
    try {
      prompt = JSON.parse(promptRaw);
    } catch {
      return error("prompt must be valid JSON");
    }
  }

  const width = parseInt(formData.get("width")) || 0;
  const height = parseInt(formData.get("height")) || 0;

  let orientation = "unknown";
  if (width > 0 && height > 0) {
    if (width > height) orientation = "landscape";
    else if (height > width) orientation = "portrait";
    else orientation = "square";
  }

  // 上传图片到 R2
  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { id, tags: tags.join(",") },
  });

  const imageData = {
    id,
    key,
    tags,
    width,
    height,
    orientation,
    size: file.size,
    mime: file.type,
    prompt,
    source: formData.get("source") || "",
    uploader: formData.get("uploader") || "",
    created_at: new Date().toISOString(),
  };

  // 写入索引（manifest + item + shard）
  await addImage(env.BUCKET, imageData);

  return json({ ok: true, image: imageData }, 201);
}

/**
 * POST /api/upload/batch
 * Content-Type: application/json
 *
 * Body: { images: [{ key, tags, prompt, source, width, height, size }] }
 * 用于批量注册已通过 S3 API 上传到 R2 的图片
 */
export async function handleBatchRegister(request, env) {
  if (!checkAuth(request, env.UPLOAD_TOKEN)) {
    return error("Unauthorized", 401);
  }

  const body = await request.json();
  if (!body.images || !Array.isArray(body.images)) {
    return error("Missing images array");
  }

  const results = [];
  for (const item of body.images) {
    if (!item.key) continue;

    const id = nanoid();
    const tags = (item.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);

    const width = parseInt(item.width) || 0;
    const height = parseInt(item.height) || 0;
    let orientation = "unknown";
    if (width > 0 && height > 0) {
      if (width > height) orientation = "landscape";
      else if (height > width) orientation = "portrait";
      else orientation = "square";
    }

    let prompt = null;
    if (item.prompt) {
      prompt = typeof item.prompt === "string" ? JSON.parse(item.prompt) : item.prompt;
    }

    const imageData = {
      id,
      key: item.key,
      tags,
      width,
      height,
      orientation,
      size: item.size || 0,
      mime: getMime(item.key),
      prompt,
      source: item.source || "",
      uploader: item.uploader || "",
      created_at: new Date().toISOString(),
    };

    await addImage(env.BUCKET, imageData);
    results.push(imageData);
  }

  return json({ ok: true, registered: results.length, images: results }, 201);
}
