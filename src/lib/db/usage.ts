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
