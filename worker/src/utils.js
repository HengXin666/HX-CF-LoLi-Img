/** CORS 头 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** JSON 响应 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** 错误响应 */
export function error(message, status = 400) {
  return json({ error: message }, status);
}

/** 验证 Bearer Token */
export function checkAuth(request, token) {
  const auth = request.headers.get("Authorization");
  if (!auth) return false;
  const [scheme, value] = auth.split(" ");
  return scheme === "Bearer" && value === token;
}

/** 生成短 ID (nanoid 风格) */
export function nanoid(size = 12) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

/** 从文件名获取 MIME 类型 */
export function getMime(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
  };
  return map[ext] || "application/octet-stream";
}

/** 解析 URL 的 search params，支持重复 key 转数组 */
export function parseParams(url) {
  const p = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (p[k]) {
      if (Array.isArray(p[k])) p[k].push(v);
      else p[k] = [p[k], v];
    } else {
      p[k] = v;
    }
  }
  return p;
}
