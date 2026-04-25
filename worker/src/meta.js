/**
 * 元数据索引管理 v2 — 三级索引 + 全局缓存
 *
 * 存储结构:
 *
 * _meta/manifest.json (轻量清单, ~1-5KB 即使万张图)
 * {
 *   "version": 2,
 *   "total": 1234,
 *   "shard_size": 500,
 *   "shard_count": 3,
 *   "ids": ["abc","def",...],           // 所有 ID（用于纯随机，无需加载详情）
 *   "by_orientation": {                  // 预计算的分桶 → ID 列表
 *     "landscape": ["abc","ghi",...],
 *     "portrait": ["def",...],
 *     "square": [...],
 *     "unknown": [...]
 *   },
 *   "by_tag": {                          // 倒排索引 → tag: ID[]
 *     "genshin": ["abc","def"],
 *     "hutao": ["abc"]
 *   },
 *   "with_prompt": ["abc",...],          // 有提示词的 ID
 *   "updated_at": "..."
 * }
 *
 * _meta/items/{id}.json (单条详情, ~200-500B)
 * {
 *   "id","key","tags","width","height","orientation",
 *   "size","mime","prompt","source","uploader","created_at"
 * }
 *
 * _meta/shards/shard-0.json (分片, 管理列表用, 每片最多 500 条)
 * { "images": { "<id>": {...}, ... } }
 *
 * 性能特征:
 * - /api/random (无筛选) → 读 manifest (几KB) + 读 N 个 items → O(1) R2 读取
 * - /api/random?tag=x → 读 manifest → 从倒排索引取 ID 集 → 取交集 → 随机 + 读 items
 * - /i/{id}           → 读 items/{id}.json → O(1) R2 读取
 * - 管理列表           → 读 manifest + 1 个 shard → 按需分页
 * - 上传/删除          → 读 manifest → 更新 manifest + items + shard → 写回
 *
 * CF Worker 免费版 CPU 10ms，本方案公开 API 耗时 < 3ms
 */

const MANIFEST_KEY = "_meta/manifest.json";
const SHARD_SIZE = 500;

// ========== 全局内存缓存（同一个 Worker isolate 内复用） ==========

let _manifestCache = null;
let _manifestCacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30 秒缓存

function isManifestCacheValid() {
  return _manifestCache && (Date.now() - _manifestCacheTime < CACHE_TTL_MS);
}

export function invalidateCache() {
  _manifestCache = null;
  _manifestCacheTime = 0;
}

// ========== Manifest（轻量清单） ==========

function emptyManifest() {
  return {
    version: 2,
    total: 0,
    shard_size: SHARD_SIZE,
    shard_count: 0,
    ids: [],
    by_orientation: { landscape: [], portrait: [], square: [], unknown: [] },
    by_tag: {},
    with_prompt: [],
    updated_at: new Date().toISOString(),
  };
}

export async function loadManifest(bucket) {
  if (isManifestCacheValid()) return _manifestCache;

  const obj = await bucket.get(MANIFEST_KEY);
  if (!obj) {
    const m = emptyManifest();
    _manifestCache = m;
    _manifestCacheTime = Date.now();
    return m;
  }
  const m = await obj.json();
  _manifestCache = m;
  _manifestCacheTime = Date.now();
  return m;
}

async function saveManifest(bucket, manifest) {
  manifest.updated_at = new Date().toISOString();
  manifest.total = manifest.ids.length;
  manifest.shard_count = Math.ceil(manifest.total / SHARD_SIZE);
  await bucket.put(MANIFEST_KEY, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  _manifestCache = manifest;
  _manifestCacheTime = Date.now();
}

// ========== Item（单条详情） ==========

function itemKey(id) {
  return `_meta/items/${id}.json`;
}

export async function loadItem(bucket, id) {
  const obj = await bucket.get(itemKey(id));
  if (!obj) return null;
  return obj.json();
}

async function saveItem(bucket, imageData) {
  await bucket.put(itemKey(imageData.id), JSON.stringify(imageData), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function deleteItemFile(bucket, id) {
  await bucket.delete(itemKey(id));
}

// ========== Shard（管理分片） ==========

function shardKey(index) {
  return `_meta/shards/shard-${index}.json`;
}

async function loadShard(bucket, index) {
  const obj = await bucket.get(shardKey(index));
  if (!obj) return { images: {} };
  return obj.json();
}

async function saveShard(bucket, index, shard) {
  await bucket.put(shardKey(index), JSON.stringify(shard), {
    httpMetadata: { contentType: "application/json" },
  });
}

function getShardIndex(manifest, id) {
  const pos = manifest.ids.indexOf(id);
  if (pos === -1) return -1;
  return Math.floor(pos / SHARD_SIZE);
}

// ========== 写操作 ==========

/** 添加图片 */
export async function addImage(bucket, imageData) {
  const manifest = await loadManifest(bucket);

  // 更新 manifest 索引
  manifest.ids.push(imageData.id);

  const orient = imageData.orientation || "unknown";
  if (manifest.by_orientation[orient]) {
    manifest.by_orientation[orient].push(imageData.id);
  }

  if (imageData.tags) {
    for (const tag of imageData.tags) {
      if (!manifest.by_tag[tag]) manifest.by_tag[tag] = [];
      manifest.by_tag[tag].push(imageData.id);
    }
  }

  if (imageData.prompt) {
    manifest.with_prompt.push(imageData.id);
  }

  // 写 item 文件
  await saveItem(bucket, imageData);

  // 写入对应 shard
  const shardIdx = Math.floor((manifest.ids.length - 1) / SHARD_SIZE);
  const shard = await loadShard(bucket, shardIdx);
  shard.images[imageData.id] = imageData;
  await saveShard(bucket, shardIdx, shard);

  // 保存 manifest
  await saveManifest(bucket, manifest);

  return imageData;
}

/** 删除图片（同时删除 R2 图片文件） */
export async function deleteImage(bucket, id) {
  const manifest = await loadManifest(bucket);
  const pos = manifest.ids.indexOf(id);
  if (pos === -1) return null;

  // 先读 item 获取详情
  const img = await loadItem(bucket, id);
  if (!img) return null;

  // 从 shard 中移除
  const shardIdx = Math.floor(pos / SHARD_SIZE);
  const shard = await loadShard(bucket, shardIdx);
  delete shard.images[id];
  await saveShard(bucket, shardIdx, shard);

  // 从 manifest 中移除
  manifest.ids.splice(pos, 1);
  const orient = img.orientation || "unknown";
  if (manifest.by_orientation[orient]) {
    const oi = manifest.by_orientation[orient].indexOf(id);
    if (oi !== -1) manifest.by_orientation[orient].splice(oi, 1);
  }
  if (img.tags) {
    for (const tag of img.tags) {
      if (manifest.by_tag[tag]) {
        const ti = manifest.by_tag[tag].indexOf(id);
        if (ti !== -1) manifest.by_tag[tag].splice(ti, 1);
        if (manifest.by_tag[tag].length === 0) delete manifest.by_tag[tag];
      }
    }
  }
  if (img.prompt) {
    const pi = manifest.with_prompt.indexOf(id);
    if (pi !== -1) manifest.with_prompt.splice(pi, 1);
  }

  // 删除 R2 文件
  await bucket.delete([img.key, itemKey(id)]);

  await saveManifest(bucket, manifest);
  return img;
}

/** 批量删除 */
export async function deleteImages(bucket, ids) {
  const manifest = await loadManifest(bucket);
  const deleted = [];
  const r2KeysToDelete = [];
  const affectedShards = new Map(); // shardIdx -> shard

  for (const id of ids) {
    const pos = manifest.ids.indexOf(id);
    if (pos === -1) continue;

    const img = await loadItem(bucket, id);
    if (!img) continue;

    // 收集需要删除的 R2 key
    r2KeysToDelete.push(img.key, itemKey(id));
    deleted.push(img);

    // 从 shard 中移除
    const shardIdx = Math.floor(pos / SHARD_SIZE);
    if (!affectedShards.has(shardIdx)) {
      affectedShards.set(shardIdx, await loadShard(bucket, shardIdx));
    }
    delete affectedShards.get(shardIdx).images[id];

    // 从 manifest 中移除（标记为 null，之后 filter）
    manifest.ids[pos] = null;

    const orient = img.orientation || "unknown";
    if (manifest.by_orientation[orient]) {
      const oi = manifest.by_orientation[orient].indexOf(id);
      if (oi !== -1) manifest.by_orientation[orient].splice(oi, 1);
    }
    if (img.tags) {
      for (const tag of img.tags) {
        if (manifest.by_tag[tag]) {
          const ti = manifest.by_tag[tag].indexOf(id);
          if (ti !== -1) manifest.by_tag[tag].splice(ti, 1);
          if (manifest.by_tag[tag].length === 0) delete manifest.by_tag[tag];
        }
      }
    }
    if (img.prompt) {
      const pi = manifest.with_prompt.indexOf(id);
      if (pi !== -1) manifest.with_prompt.splice(pi, 1);
    }
  }

  manifest.ids = manifest.ids.filter((x) => x !== null);

  if (r2KeysToDelete.length > 0) {
    // R2 批量删除，每次最多 1000
    for (let i = 0; i < r2KeysToDelete.length; i += 1000) {
      await bucket.delete(r2KeysToDelete.slice(i, i + 1000));
    }
  }

  // 保存受影响的 shards
  for (const [idx, shard] of affectedShards) {
    await saveShard(bucket, idx, shard);
  }

  await saveManifest(bucket, manifest);
  return deleted;
}

/** 更新图片元数据 */
export async function updateImage(bucket, id, updates) {
  const manifest = await loadManifest(bucket);
  if (!manifest.ids.includes(id)) return null;

  const img = await loadItem(bucket, id);
  if (!img) return null;

  const oldTags = img.tags || [];
  const hadPrompt = img.prompt != null;

  // 应用更新
  const allowed = ["tags", "prompt", "source", "uploader"];
  for (const key of allowed) {
    if (updates[key] !== undefined) img[key] = updates[key];
  }

  // 同步 manifest 中的倒排索引
  const newTags = img.tags || [];
  const hasPromptNow = img.prompt != null;

  // 处理 tags 变更
  const removedTags = oldTags.filter((t) => !newTags.includes(t));
  const addedTags = newTags.filter((t) => !oldTags.includes(t));

  for (const tag of removedTags) {
    if (manifest.by_tag[tag]) {
      const ti = manifest.by_tag[tag].indexOf(id);
      if (ti !== -1) manifest.by_tag[tag].splice(ti, 1);
      if (manifest.by_tag[tag].length === 0) delete manifest.by_tag[tag];
    }
  }
  for (const tag of addedTags) {
    if (!manifest.by_tag[tag]) manifest.by_tag[tag] = [];
    manifest.by_tag[tag].push(id);
  }

  // 处理 prompt 变更
  if (!hadPrompt && hasPromptNow) {
    manifest.with_prompt.push(id);
  } else if (hadPrompt && !hasPromptNow) {
    const pi = manifest.with_prompt.indexOf(id);
    if (pi !== -1) manifest.with_prompt.splice(pi, 1);
  }

  // 保存 item
  await saveItem(bucket, img);

  // 更新 shard
  const pos = manifest.ids.indexOf(id);
  const shardIdx = Math.floor(pos / SHARD_SIZE);
  const shard = await loadShard(bucket, shardIdx);
  shard.images[id] = img;
  await saveShard(bucket, shardIdx, shard);

  await saveManifest(bucket, manifest);
  return img;
}

// ========== 查询操作 ==========

/**
 * 基于 manifest 倒排索引快速筛选 ID 集合
 * 不需要加载任何详情数据！
 *
 * @returns {string[]} 匹配的 ID 列表
 */
export function queryIds(manifest, filter = {}) {
  let candidateIds = null; // null = 全部

  // 标签筛选（AND 关系，用倒排索引取交集）
  if (filter.tags && filter.tags.length > 0) {
    for (const tag of filter.tags) {
      const tagIds = manifest.by_tag[tag];
      if (!tagIds || tagIds.length === 0) return []; // 某个 tag 无结果 → 交集为空
      const tagSet = new Set(tagIds);
      if (candidateIds === null) {
        candidateIds = [...tagSet];
      } else {
        candidateIds = candidateIds.filter((id) => tagSet.has(id));
      }
      if (candidateIds.length === 0) return [];
    }
  }

  // 方向筛选
  if (filter.orientation) {
    const orientIds = manifest.by_orientation[filter.orientation] || [];
    if (orientIds.length === 0) return [];
    const orientSet = new Set(orientIds);
    if (candidateIds === null) {
      candidateIds = [...orientSet];
    } else {
      candidateIds = candidateIds.filter((id) => orientSet.has(id));
    }
    if (candidateIds.length === 0) return [];
  }

  // 提示词筛选
  if (filter.hasPrompt === true) {
    const promptSet = new Set(manifest.with_prompt);
    if (candidateIds === null) {
      candidateIds = [...promptSet];
    } else {
      candidateIds = candidateIds.filter((id) => promptSet.has(id));
    }
  } else if (filter.hasPrompt === false) {
    const promptSet = new Set(manifest.with_prompt);
    if (candidateIds === null) {
      candidateIds = manifest.ids.filter((id) => !promptSet.has(id));
    } else {
      candidateIds = candidateIds.filter((id) => !promptSet.has(id));
    }
  }

  // 如果还没有筛选过，用全部 ID
  if (candidateIds === null) {
    candidateIds = manifest.ids;
  }

  return candidateIds;
}

/**
 * 快速筛选后还需要基于尺寸进一步过滤时，按需加载 items
 * 只有传了尺寸参数才需要这一步
 */
export async function queryWithDimensions(bucket, ids, filter) {
  const needsDimFilter =
    filter.minWidth || filter.minHeight || filter.maxWidth || filter.maxHeight;
  if (!needsDimFilter) return ids;

  // 批量加载详情（并发请求，最多同时 20 个）
  const BATCH = 20;
  const result = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const items = await Promise.all(batch.map((id) => loadItem(bucket, id)));
    for (const item of items) {
      if (!item) continue;
      if (filter.minWidth && item.width < filter.minWidth) continue;
      if (filter.minHeight && item.height < filter.minHeight) continue;
      if (filter.maxWidth && item.width > filter.maxWidth) continue;
      if (filter.maxHeight && item.height > filter.maxHeight) continue;
      result.push(item.id);
    }
  }
  return result;
}

/** 从 ID 列表中随机取 n 个（不重复） */
export function pickRandomIds(ids, count = 1) {
  if (ids.length === 0) return [];
  const n = Math.min(count, ids.length);
  const arr = [...ids];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/** 批量加载多个 item 详情（并发） */
export async function loadItems(bucket, ids) {
  const items = await Promise.all(ids.map((id) => loadItem(bucket, id)));
  return items.filter(Boolean);
}

/** 加载一个 shard 的图片列表（管理页分页用） */
export async function loadShardPage(bucket, shardIdx) {
  const shard = await loadShard(bucket, shardIdx);
  return Object.values(shard.images);
}

// ========== 兼容迁移 ==========

/**
 * 从 v1 单文件索引迁移到 v2
 * 管理 API 提供一个 POST /api/admin/migrate 调用
 */
export async function migrateV1toV2(bucket) {
  const oldObj = await bucket.get("_meta/index.json");
  if (!oldObj) return { migrated: 0 };

  const oldIndex = await oldObj.json();
  if (!oldIndex.images) return { migrated: 0 };

  const images = Object.values(oldIndex.images);
  const manifest = emptyManifest();

  // 按创建时间排序
  images.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const shards = {};
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    manifest.ids.push(img.id);

    const orient = img.orientation || "unknown";
    if (manifest.by_orientation[orient]) {
      manifest.by_orientation[orient].push(img.id);
    }
    if (img.tags) {
      for (const tag of img.tags) {
        if (!manifest.by_tag[tag]) manifest.by_tag[tag] = [];
        manifest.by_tag[tag].push(img.id);
      }
    }
    if (img.prompt) manifest.with_prompt.push(img.id);

    // 写 item 文件
    await saveItem(bucket, img);

    // 分片
    const shardIdx = Math.floor(i / SHARD_SIZE);
    if (!shards[shardIdx]) shards[shardIdx] = { images: {} };
    shards[shardIdx].images[img.id] = img;
  }

  // 写所有 shards
  for (const [idx, shard] of Object.entries(shards)) {
    await saveShard(bucket, parseInt(idx), shard);
  }

  // 写 manifest
  await saveManifest(bucket, manifest);

  // 删除旧索引
  await bucket.delete("_meta/index.json");

  return { migrated: images.length };
}
