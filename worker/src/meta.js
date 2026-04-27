/**
 * 元数据管理 — D1 SQL 数据库
 *
 * 表结构:
 *   images      — 图片主表（id, key, width, height, orientation, size, mime, prompt, source, uploader, created_at）
 *   image_tags  — 标签关联表（image_id, tag）
 *
 * 性能特征:
 *   /api/random (无筛选)     → SELECT ... ORDER BY RANDOM() LIMIT N  → 1 次 D1 查询
 *   /api/random?tag=x        → JOIN image_tags + WHERE tag IN (...)   → 1 次 D1 查询
 *   /i/{id}                  → SELECT ... WHERE id = ?                → 1 次 D1 查询
 *   上传/删除                → INSERT/DELETE                          → 1-2 次 D1 写入
 *   管理列表                 → SELECT + LIMIT/OFFSET                  → 1 次 D1 查询
 *
 * 对比旧方案:
 *   - 无并发竞态（D1 事务保证）
 *   - 数据实时一致（无 30s 缓存延迟）
 *   - 写入 O(1)（不再全量读写 manifest）
 *   - R2 只存图片文件，不再存元数据 JSON
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  orientation TEXT DEFAULT 'unknown',
  size INTEGER DEFAULT 0,
  mime TEXT DEFAULT '',
  prompt TEXT,
  source TEXT DEFAULT '',
  uploader TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_tags (
  image_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (image_id, tag),
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag);
CREATE INDEX IF NOT EXISTS idx_images_orientation ON images(orientation);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
`;

/**
 * 初始化数据库表（幂等，可重复调用）
 */
export async function initDB(db) {
  const statements = SCHEMA_SQL
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

/**
 * 添加图片
 */
export async function addImage(db, imageData) {
  const promptStr = imageData.prompt ? JSON.stringify(imageData.prompt) : null;

  await db.batch([
    db.prepare(
      `INSERT INTO images (id, key, width, height, orientation, size, mime, prompt, source, uploader, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      imageData.id,
      imageData.key,
      imageData.width || 0,
      imageData.height || 0,
      imageData.orientation || "unknown",
      imageData.size || 0,
      imageData.mime || "",
      promptStr,
      imageData.source || "",
      imageData.uploader || "",
      imageData.created_at
    ),
    ...(imageData.tags || []).map((tag) =>
      db.prepare("INSERT INTO image_tags (image_id, tag) VALUES (?, ?)").bind(imageData.id, tag)
    ),
  ]);

  return imageData;
}

/**
 * 加载单条图片详情
 */
export async function loadItem(db, id) {
  const row = await db.prepare("SELECT * FROM images WHERE id = ?").bind(id).first();
  if (!row) return null;
  return await enrichRow(db, row);
}

/**
 * 批量加载图片详情
 */
export async function loadItems(db, ids) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  return enrichRows(db, results);
}

/**
 * 删除图片（返回被删除的图片信息，不删 R2 文件，由调用方处理）
 */
export async function deleteImage(db, id) {
  const img = await loadItem(db, id);
  if (!img) return null;

  await db.batch([
    db.prepare("DELETE FROM image_tags WHERE image_id = ?").bind(id),
    db.prepare("DELETE FROM images WHERE id = ?").bind(id),
  ]);

  return img;
}

/**
 * 批量删除图片
 */
export async function deleteImages(db, ids) {
  if (ids.length === 0) return [];

  const items = await loadItems(db, ids);
  if (items.length === 0) return [];

  const existingIds = items.map((i) => i.id);
  const placeholders = existingIds.map(() => "?").join(",");

  await db.batch([
    db.prepare(`DELETE FROM image_tags WHERE image_id IN (${placeholders})`).bind(...existingIds),
    db.prepare(`DELETE FROM images WHERE id IN (${placeholders})`).bind(...existingIds),
  ]);

  return items;
}

/**
 * 更新图片元数据
 */
export async function updateImage(db, id, updates) {
  const img = await loadItem(db, id);
  if (!img) return null;

  const stmts = [];
  const allowed = ["prompt", "source", "uploader"];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      const val = key === "prompt" && updates[key] ? JSON.stringify(updates[key]) : updates[key];
      stmts.push(db.prepare(`UPDATE images SET ${key} = ? WHERE id = ?`).bind(val, id));
    }
  }

  // 标签更新：删除旧的，插入新的
  if (updates.tags !== undefined) {
    stmts.push(db.prepare("DELETE FROM image_tags WHERE image_id = ?").bind(id));
    for (const tag of updates.tags) {
      stmts.push(db.prepare("INSERT INTO image_tags (image_id, tag) VALUES (?, ?)").bind(id, tag));
    }
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return loadItem(db, id);
}

/**
 * 随机查询图片 ID
 *
 * 性能: 单次 D1 查询，利用 SQL 索引
 * 无筛选: SELECT id FROM images ORDER BY RANDOM() LIMIT N
 * 有筛选: JOIN image_tags + WHERE 条件 + ORDER BY RANDOM()
 */
export async function queryRandom(db, filter = {}, count = 1) {
  const conditions = [];
  const binds = [];

  let needTagJoin = false;

  // 标签筛选（AND 关系：同时拥有所有标签）
  if (filter.tags && filter.tags.length > 0) {
    needTagJoin = true;
    const tagPlaceholders = filter.tags.map(() => "?").join(",");
    conditions.push(`t.tag IN (${tagPlaceholders})`);
    binds.push(...filter.tags);
  }

  // 方向筛选
  if (filter.orientation) {
    conditions.push("i.orientation = ?");
    binds.push(filter.orientation);
  }

  // 提示词筛选
  if (filter.hasPrompt === true) {
    conditions.push("i.prompt IS NOT NULL");
  } else if (filter.hasPrompt === false) {
    conditions.push("i.prompt IS NULL");
  }

  // 尺寸筛选
  if (filter.minWidth) {
    conditions.push("i.width >= ?");
    binds.push(filter.minWidth);
  }
  if (filter.minHeight) {
    conditions.push("i.height >= ?");
    binds.push(filter.minHeight);
  }
  if (filter.maxWidth) {
    conditions.push("i.width <= ?");
    binds.push(filter.maxWidth);
  }
  if (filter.maxHeight) {
    conditions.push("i.height <= ?");
    binds.push(filter.maxHeight);
  }

  let sql;
  if (needTagJoin) {
    const tagCount = filter.tags.length;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    // HAVING COUNT(DISTINCT t.tag) = tagCount 确保 AND 语义
    sql = `
      SELECT i.id FROM images i
      JOIN image_tags t ON i.id = t.image_id
      ${where}
      GROUP BY i.id
      HAVING COUNT(DISTINCT t.tag) = ?
      ORDER BY RANDOM()
      LIMIT ?
    `;
    binds.push(tagCount, count);
  } else {
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    sql = `SELECT i.id FROM images i ${where} ORDER BY RANDOM() LIMIT ?`;
    binds.push(count);
  }

  const { results } = await db.prepare(sql).bind(...binds).all();
  return results.map((r) => r.id);
}

/**
 * 统计匹配筛选条件的总数
 */
export async function queryCount(db, filter = {}) {
  const conditions = [];
  const binds = [];
  let needTagJoin = false;

  if (filter.tags && filter.tags.length > 0) {
    needTagJoin = true;
    const tagPlaceholders = filter.tags.map(() => "?").join(",");
    conditions.push(`t.tag IN (${tagPlaceholders})`);
    binds.push(...filter.tags);
  }
  if (filter.orientation) {
    conditions.push("i.orientation = ?");
    binds.push(filter.orientation);
  }
  if (filter.hasPrompt === true) {
    conditions.push("i.prompt IS NOT NULL");
  } else if (filter.hasPrompt === false) {
    conditions.push("i.prompt IS NULL");
  }
  if (filter.minWidth) { conditions.push("i.width >= ?"); binds.push(filter.minWidth); }
  if (filter.minHeight) { conditions.push("i.height >= ?"); binds.push(filter.minHeight); }
  if (filter.maxWidth) { conditions.push("i.width <= ?"); binds.push(filter.maxWidth); }
  if (filter.maxHeight) { conditions.push("i.height <= ?"); binds.push(filter.maxHeight); }

  let sql;
  if (needTagJoin) {
    const tagCount = filter.tags.length;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    sql = `
      SELECT COUNT(*) as cnt FROM (
        SELECT i.id FROM images i
        JOIN image_tags t ON i.id = t.image_id
        ${where}
        GROUP BY i.id
        HAVING COUNT(DISTINCT t.tag) = ?
      )
    `;
    binds.push(tagCount);
  } else {
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    sql = `SELECT COUNT(*) as cnt FROM images i ${where}`;
  }

  const row = await db.prepare(sql).bind(...binds).first();
  return row?.cnt || 0;
}

/**
 * 管理列表查询（分页 + 筛选 + 搜索）
 */
export async function queryList(db, { page = 1, perPage = 20, tag, orientation, search } = {}) {
  const conditions = [];
  const binds = [];
  let needTagJoin = false;

  if (tag) {
    needTagJoin = true;
    conditions.push("t.tag = ?");
    binds.push(tag.toLowerCase());
  }
  if (orientation) {
    conditions.push("i.orientation = ?");
    binds.push(orientation);
  }
  if (search) {
    const q = `%${search.toLowerCase()}%`;
    // 搜索 id/source/uploader 或标签名
    conditions.push(
      `(i.id LIKE ? OR i.source LIKE ? OR i.uploader LIKE ? OR i.id IN (SELECT image_id FROM image_tags WHERE tag LIKE ?))`
    );
    binds.push(q, q, q, q);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * perPage;

  let countSql, dataSql;

  if (needTagJoin) {
    countSql = `SELECT COUNT(DISTINCT i.id) as cnt FROM images i JOIN image_tags t ON i.id = t.image_id ${where}`;
    dataSql = `
      SELECT DISTINCT i.* FROM images i
      JOIN image_tags t ON i.id = t.image_id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `;
  } else {
    countSql = `SELECT COUNT(*) as cnt FROM images i ${where}`;
    dataSql = `SELECT i.* FROM images i ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`;
  }

  const [countResult, dataResult] = await db.batch([
    db.prepare(countSql).bind(...binds),
    db.prepare(dataSql).bind(...binds, perPage, offset),
  ]);

  const total = countResult.results[0]?.cnt || 0;
  const images = await enrichRows(db, dataResult.results);

  return { total, page, perPage, images };
}

/**
 * 获取所有标签及其计数
 */
export async function listTags(db) {
  const { results } = await db
    .prepare("SELECT tag, COUNT(*) as count FROM image_tags GROUP BY tag ORDER BY count DESC")
    .all();
  return results.map((r) => ({ name: r.tag, count: r.count }));
}

/**
 * 获取统计信息
 */
export async function getStats(db) {
  const [totalResult, orientResult, promptResult, tagResult] = await db.batch([
    db.prepare("SELECT COUNT(*) as cnt FROM images"),
    db.prepare("SELECT orientation, COUNT(*) as cnt FROM images GROUP BY orientation"),
    db.prepare("SELECT COUNT(*) as cnt FROM images WHERE prompt IS NOT NULL"),
    db.prepare("SELECT COUNT(DISTINCT tag) as cnt FROM image_tags"),
  ]);

  const orientations = { landscape: 0, portrait: 0, square: 0, unknown: 0 };
  for (const row of orientResult.results) {
    if (orientations.hasOwnProperty(row.orientation)) {
      orientations[row.orientation] = row.cnt;
    }
  }

  return {
    total_images: totalResult.results[0]?.cnt || 0,
    orientations,
    with_prompt: promptResult.results[0]?.cnt || 0,
    unique_tags: tagResult.results[0]?.cnt || 0,
  };
}

/**
 * 将 DB row 转换为完整的图片对象（附带 tags）
 */
async function enrichRow(db, row) {
  const { results: tagRows } = await db
    .prepare("SELECT tag FROM image_tags WHERE image_id = ?")
    .bind(row.id)
    .all();

  return {
    id: row.id,
    key: row.key,
    tags: tagRows.map((r) => r.tag),
    width: row.width,
    height: row.height,
    orientation: row.orientation,
    size: row.size,
    mime: row.mime,
    prompt: row.prompt ? JSON.parse(row.prompt) : null,
    source: row.source,
    uploader: row.uploader,
    created_at: row.created_at,
  };
}

/**
 * 批量 enrichRow（减少 D1 查询次数）
 */
async function enrichRows(db, rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: allTags } = await db
    .prepare(`SELECT image_id, tag FROM image_tags WHERE image_id IN (${placeholders})`)
    .bind(...ids)
    .all();

  const tagMap = {};
  for (const t of allTags) {
    if (!tagMap[t.image_id]) tagMap[t.image_id] = [];
    tagMap[t.image_id].push(t.tag);
  }

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    tags: tagMap[row.id] || [],
    width: row.width,
    height: row.height,
    orientation: row.orientation,
    size: row.size,
    mime: row.mime,
    prompt: row.prompt ? JSON.parse(row.prompt) : null,
    source: row.source,
    uploader: row.uploader,
    created_at: row.created_at,
  }));
}

/**
 * 从 R2 旧版 manifest 迁移到 D1
 * 读取 R2 中的 _meta/manifest.json + _meta/items/*.json，写入 D1
 */
export async function migrateR2toD1(bucket, db) {
  await initDB(db);

  // 尝试读取旧 manifest
  const manifestObj = await bucket.get("_meta/manifest.json");
  if (!manifestObj) {
    // 尝试 v1 格式
    const v1Obj = await bucket.get("_meta/index.json");
    if (!v1Obj) return { migrated: 0, message: "No R2 metadata found" };
    const v1Index = await v1Obj.json();
    if (!v1Index.images) return { migrated: 0, message: "No images in v1 index" };

    const images = Object.values(v1Index.images);
    let migrated = 0;
    for (const img of images) {
      try {
        await addImage(db, img);
        migrated++;
      } catch (e) {
        console.error(`Failed to migrate ${img.id}:`, e.message);
      }
    }
    return { migrated, message: `Migrated ${migrated} images from v1 index` };
  }

  const manifest = await manifestObj.json();
  const ids = manifest.ids || [];
  let migrated = 0;
  let failed = 0;

  // 逐个读取 item 文件并写入 D1
  const BATCH = 10;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const items = await Promise.all(
      batch.map(async (id) => {
        const obj = await bucket.get(`_meta/items/${id}.json`);
        if (!obj) return null;
        return obj.json();
      })
    );

    for (const img of items) {
      if (!img) { failed++; continue; }
      try {
        await addImage(db, img);
        migrated++;
      } catch (e) {
        // 可能已存在（幂等）
        if (e.message?.includes("UNIQUE constraint")) {
          console.log(`Skip existing: ${img.id}`);
        } else {
          console.error(`Failed to migrate ${img.id}:`, e.message);
          failed++;
        }
      }
    }
  }

  return {
    migrated,
    failed,
    total_in_manifest: ids.length,
    message: `Migrated ${migrated} images, ${failed} failed`,
  };
}
