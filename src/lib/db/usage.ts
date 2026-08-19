// ===== API 用量与缓存领域：api_cache + api_usage =====

import { getAdapter } from "./migrations";

export interface ApiCacheRow {
  key: string;
  value: string;
  expires_at: string;
}

export interface ApiUsageRow {
  month: string;
  used: number;
  limit: number;
}

/** 读取缓存：返回 { value, expiresAt } 或 null（无记录） */
export async function getCache(key: string): Promise<{ value: string; expiresAt: string } | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT value, expires_at FROM api_cache WHERE key = ?`, [key]) as
    | { value: string; expires_at: string }
    | undefined;
  return row ? { value: row.value, expiresAt: row.expires_at } : null;
}

/** 写入缓存（UPSERT）：value 为 JSON 字符串，expiresAt 为 ISO 字符串 */
export async function setCache(key: string, value: string, expiresAt: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_cache (key, value, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      expires_at = excluded.expires_at
  `, [key, value, expiresAt]);
}

/** 删除已过期缓存（清理任务用） */
export async function deleteExpiredCache(): Promise<number> {
  const db = await getAdapter();
  const nowIso = new Date().toISOString();
  const info = await db.run(`DELETE FROM api_cache WHERE expires_at < ?`, [nowIso]);
  return info.changes;
}

/** 统计当前缓存条目数（含未过期与已过期，用于设置页展示） */
export async function countCacheEntries(): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM api_cache`) as { c: number };
  return Number(row.c);
}

/** 读取某月用量：返回 { used, limit } 或 null（无记录） */
export async function getApiUsage(month: string): Promise<{ used: number; limit: number } | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT used, "limit" FROM api_usage WHERE month = ?`, [month]) as
    | { used: number; limit: number }
    | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : null;
}

/** 用量 +1（UPSERT，首次自动创建） */
export async function incrementApiUsage(month: string): Promise<{ used: number; limit: number }> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_usage (month, used, "limit")
    VALUES (?, 1, 100)
    ON CONFLICT(month) DO UPDATE SET
      used = used + 1
  `, [month]);
  const row = await db.get(`SELECT used, "limit" FROM api_usage WHERE month = ?`, [month]) as
    | { used: number; limit: number }
    | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : { used: 1, limit: 100 };
}

/** 重置某月用量（用于月份切换时） */
export async function resetApiUsage(month: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_usage (month, used, "limit")
    VALUES (?, 0, 100)
    ON CONFLICT(month) DO UPDATE SET
      used = 0
  `, [month]);
}

// ========== 用户级用量（P0 商业化改造） ==========

export type ApiType = "serpapi" | "dataforseo" | "content_check";

export interface ApiUsagePerUserRow {
  user_id: string;
  api_type: ApiType;
  month: string;
  used: number;
  limit: number;
}

/** 读取某用户某 API 某月用量 */
export async function getUserApiUsage(
  userId: string,
  apiType: ApiType,
  month: string
): Promise<{ used: number; limit: number } | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT used, "limit" FROM api_usage_per_user WHERE user_id = ? AND api_type = ? AND month = ?`,
    [userId, apiType, month]
  ) as { used: number; limit: number } | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : null;
}

/**
 * 原子性消耗用户级用量（UPSERT + WHERE used < limit）。
 * 返回 { ok: true, used, limit } 表示成功消耗；
 * 返回 { ok: false, used, limit } 表示已达上限（未消耗）。
 * 消除 TOCTOU 竞态：检查与递增在同一条 SQL 中完成。
 */
export async function tryIncrementUserApiUsage(
  userId: string,
  apiType: ApiType,
  month: string,
  defaultLimit: number
): Promise<{ ok: boolean; used: number; limit: number }> {
  const db = await getAdapter();
  // 原子操作：仅当 used < limit 时才递增，RETURNING 返回递增后的行
  const row = await db.get(
    `INSERT INTO api_usage_per_user (user_id, api_type, month, used, "limit", created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, api_type, month) DO UPDATE SET
      used = used + 1,
      updated_at = datetime('now')
    WHERE api_usage_per_user.used < ?
    RETURNING used, "limit"`,
    [userId, apiType, month, defaultLimit, defaultLimit]
  ) as { used: number; limit: number } | undefined;

  if (row) {
    return { ok: true, used: Number(row.used), limit: Number(row.limit) };
  }
  // 没返回行说明已存在且 used >= limit，读取当前值
  const existing = await db.get(
    `SELECT used, "limit" FROM api_usage_per_user WHERE user_id = ? AND api_type = ? AND month = ?`,
    [userId, apiType, month]
  ) as { used: number; limit: number } | undefined;
  return {
    ok: false,
    used: existing ? Number(existing.used) : 0,
    limit: existing ? Number(existing.limit) : defaultLimit,
  };
}

/** 用户级用量 +N（UPSERT，首次自动创建，默认 limit 由调用方传入） */
export async function incrementUserApiUsage(
  userId: string,
  apiType: ApiType,
  month: string,
  defaultLimit: number
): Promise<{ used: number; limit: number }> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_usage_per_user (user_id, api_type, month, used, "limit", created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, api_type, month) DO UPDATE SET
      used = used + 1,
      updated_at = datetime('now')
  `, [userId, apiType, month, defaultLimit]);
  const row = await db.get(
    `SELECT used, "limit" FROM api_usage_per_user WHERE user_id = ? AND api_type = ? AND month = ?`,
    [userId, apiType, month]
  ) as { used: number; limit: number } | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : { used: 1, limit: defaultLimit };
}

/** 设置某用户某 API 某月用量上限（用于套餐变更时） */
export async function setUserApiLimit(
  userId: string,
  apiType: ApiType,
  month: string,
  limit: number
): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_usage_per_user (user_id, api_type, month, used, "limit", created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, api_type, month) DO UPDATE SET
      "limit" = excluded."limit",
      updated_at = datetime('now')
  `, [userId, apiType, month, limit]);
}

// ========== API 每日用量（Free 额度调整：SerpApi 每日限额） ==========

export interface ApiDailyUsageRow {
  user_id: string;
  api_type: ApiType;
  date: string;
  used: number;
  limit: number;
}

/** 读取某用户某 API 某日用量 */
export async function getApiDailyUsage(
  userId: string,
  apiType: ApiType,
  date: string
): Promise<{ used: number; limit: number } | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT used, "limit" FROM api_usage_daily_per_user WHERE user_id = ? AND api_type = ? AND date = ?`,
    [userId, apiType, date]
  ) as { used: number; limit: number } | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : null;
}

/**
 * 原子性消耗 API 每日用量（UPSERT + WHERE used < limit）。
 * 与月度 tryIncrementUserApiUsage 同模式，消除 TOCTOU 竞态。
 */
export async function tryIncrementApiDailyUsage(
  userId: string,
  apiType: ApiType,
  date: string,
  defaultLimit: number
): Promise<{ ok: boolean; used: number; limit: number }> {
  const db = await getAdapter();
  const row = await db.get(
    `INSERT INTO api_usage_daily_per_user (user_id, api_type, date, used, "limit", created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, api_type, date) DO UPDATE SET
      used = used + 1,
      updated_at = datetime('now')
    WHERE api_usage_daily_per_user.used < ?
    RETURNING used, "limit"`,
    [userId, apiType, date, defaultLimit, defaultLimit]
  ) as { used: number; limit: number } | undefined;

  if (row) {
    return { ok: true, used: Number(row.used), limit: Number(row.limit) };
  }
  const existing = await db.get(
    `SELECT used, "limit" FROM api_usage_daily_per_user WHERE user_id = ? AND api_type = ? AND date = ?`,
    [userId, apiType, date]
  ) as { used: number; limit: number } | undefined;
  return {
    ok: false,
    used: existing ? Number(existing.used) : 0,
    limit: existing ? Number(existing.limit) : defaultLimit,
  };
}

// ========== 审计每日用量（P2 商业化改造） ==========

export interface AuditUsagePerUserRow {
  user_id: string;
  date: string;
  used: number;
  limit: number;
}

/** 读取某用户某日审计用量 */
export async function getAuditDailyUsage(
  userId: string,
  date: string
): Promise<{ used: number; limit: number } | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT used, "limit" FROM audit_usage_per_user WHERE user_id = ? AND date = ?`,
    [userId, date]
  ) as { used: number; limit: number } | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : null;
}

/**
 * 原子性消耗审计每日用量（UPSERT + WHERE used < limit）。
 * 消除 TOCTOU 竞态。
 */
export async function tryIncrementAuditDailyUsage(
  userId: string,
  date: string,
  defaultLimit: number
): Promise<{ ok: boolean; used: number; limit: number }> {
  const db = await getAdapter();
  const row = await db.get(
    `INSERT INTO audit_usage_per_user (user_id, date, used, "limit", created_at, updated_at)
    VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET
      used = used + 1,
      updated_at = datetime('now')
    WHERE audit_usage_per_user.used < ?
    RETURNING used, "limit"`,
    [userId, date, defaultLimit, defaultLimit]
  ) as { used: number; limit: number } | undefined;

  if (row) {
    return { ok: true, used: Number(row.used), limit: Number(row.limit) };
  }
  const existing = await db.get(
    `SELECT used, "limit" FROM audit_usage_per_user WHERE user_id = ? AND date = ?`,
    [userId, date]
  ) as { used: number; limit: number } | undefined;
  return {
    ok: false,
    used: existing ? Number(existing.used) : 0,
    limit: existing ? Number(existing.limit) : defaultLimit,
  };
}


