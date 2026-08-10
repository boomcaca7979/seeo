// ===== 排名领域：rank_history + 排名对比辅助 =====

import { getAdapter } from "./migrations";

export interface RankHistoryRow {
  id: number;
  keyword_id: number;
  date: string; // YYYY-MM-DD
  position: number | null;
  url: string | null;
  created_at: string;
}

/** 同一天只记一条：position 为 null 表示查询了但未进前 100 */
export async function upsertRankHistory(userId: string, params: {
  keyword_id: number;
  date: string; // YYYY-MM-DD
  position: number | null;
  url: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO rank_history (keyword_id, date, position, url, user_id)
    VALUES (@keyword_id, @date, @position, @url, @user_id)
    ON CONFLICT(keyword_id, date) DO UPDATE SET
      position = excluded.position,
      url = excluded.url
  `, [{ ...params, user_id: userId }]);
}

export async function getRankHistory(userId: string, keywordId: number, days = 30): Promise<RankHistoryRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM rank_history
    WHERE keyword_id = ? AND user_id = ?
    AND date >= date('now', 'localtime', ?)
    ORDER BY date ASC
  `, [keywordId, userId, `-${days} day`]) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    keyword_id: Number(r.keyword_id),
    date: String(r.date),
    position: r.position === null ? null : Number(r.position),
    url: r.url ? String(r.url) : null,
    created_at: String(r.created_at),
  }));
}

export async function updateLastRefreshed(userId: string, keywordId: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE tracked_keywords SET last_refreshed_at = datetime('now') WHERE id = ? AND user_id = ?`, [keywordId, userId]);
}

/** 判断今日是否已刷新过（用于避免重复扣额度） */
export async function hasTodayHistory(userId: string, keywordId: number): Promise<boolean> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT 1 FROM rank_history
    WHERE keyword_id = ? AND date = date('now', 'localtime') AND user_id = ?
    LIMIT 1
  `, [keywordId, userId]) as { 1: number } | undefined;
  return !!row;
}

// ---------- 排名对比辅助 ----------

/** 获取某关键词在指定日期之前最近的一条 rank_history */
export async function getPreviousRankHistory(userId: string, keywordId: number, beforeDate: string): Promise<RankHistoryRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM rank_history
    WHERE keyword_id = ? AND date < ? AND user_id = ?
    ORDER BY date DESC
    LIMIT 1
  `, [keywordId, beforeDate, userId]) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    keyword_id: Number(row.keyword_id),
    date: String(row.date),
    position: row.position === null ? null : Number(row.position),
    url: row.url ? String(row.url) : null,
    created_at: String(row.created_at),
  };
}

// ---------- automation 辅助查询（weekly 报告用） ----------

export interface RankChangeRow {
  keyword_id: number;
  keyword: string;
  domain: string;
  oldRank: number | null;
  newRank: number | null;
  change: number | null;
}

/**
 * 获取某时间点之后的排名变化（对比该时间点前最近一次记录）
 * 优化：使用窗口函数批量取每个关键词的 newest/oldest，避免 N+1 查询
 */
export async function getRankChangesSince(userId: string, sinceISO: string): Promise<RankChangeRow[]> {
  const db = await getAdapter();
  const sinceDate = sinceISO.slice(0, 10);

  // 1. 获取所有关键词（1 次查询）
  const keywords = await db.query(`
    SELECT tk.id, tk.keyword, tk.domain
    FROM tracked_keywords tk
    WHERE tk.user_id = ?
    ORDER BY tk.created_at ASC
  `, [userId]) as Record<string, unknown>[];

  if (keywords.length === 0) return [];

  const keywordIds = keywords.map((k) => Number(k.id));
  const placeholders = keywordIds.map(() => "?").join(", ");

  // 2. 批量获取 sinceDate 当天及之后最近一条记录（1 次查询，窗口函数取每组最新）
  const newestRows = await db.query(`
    WITH ranked AS (
      SELECT keyword_id, position, date,
        ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY date DESC) AS rn
      FROM rank_history
      WHERE keyword_id IN (${placeholders}) AND date >= ? AND user_id = ?
    )
    SELECT keyword_id, position, date FROM ranked WHERE rn = 1
  `, [...keywordIds, sinceDate, userId]) as Record<string, unknown>[];

  // 3. 批量获取 sinceDate 之前最近一条记录（1 次查询）
  const oldestRows = await db.query(`
    WITH ranked AS (
      SELECT keyword_id, position, date,
        ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY date DESC) AS rn
      FROM rank_history
      WHERE keyword_id IN (${placeholders}) AND date < ? AND user_id = ?
    )
    SELECT keyword_id, position, date FROM ranked WHERE rn = 1
  `, [...keywordIds, sinceDate, userId]) as Record<string, unknown>[];

  // 4. 内存分组：keyword_id -> position
  const newestMap = new Map<number, number | null>();
  for (const r of newestRows) {
    newestMap.set(
      Number(r.keyword_id),
      r.position === null || r.position === undefined ? null : Number(r.position)
    );
  }
  const oldestMap = new Map<number, number | null>();
  for (const r of oldestRows) {
    oldestMap.set(
      Number(r.keyword_id),
      r.position === null || r.position === undefined ? null : Number(r.position)
    );
  }

  // 5. 组装结果（保持原有顺序与语义）
  const result: RankChangeRow[] = [];
  for (const k of keywords) {
    const kid = Number(k.id);
    const newRank = newestMap.get(kid) ?? null;
    const oldRank = oldestMap.get(kid) ?? null;

    let change: number | null = null;
    if (oldRank !== null && newRank !== null) {
      change = newRank - oldRank; // 正 = 下降，负 = 上升
    }

    result.push({
      keyword_id: kid,
      keyword: String(k.keyword),
      domain: String(k.domain),
      oldRank,
      newRank,
      change,
    });
  }
  return result;
}

/** 7 天内有数据的关键词数 */
export async function countActiveKeywords(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT COUNT(DISTINCT keyword_id) AS c
    FROM rank_history
    WHERE date >= date('now', 'localtime', '-7 day') AND user_id = ?
  `, [userId]) as { c: number };
  return row.c;
}
