// ===== 排名领域：rank_history + 排名对比辅助 =====

import { getAdapter } from "./migrations";

export interface RankHistoryRow {
  id: number;
  keyword_id: number;
  date: string; // YYYY-MM-DD
  position: number | null;
  url: string | null;
  /** 该次快照时的 SERP feature 类型列表（P0-02-D 起；旧记录为空数组） */
  featureTypes: string[];
  created_at: string;
}

function parseFeatureTypes(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // 损坏数据按无 feature 处理
  }
  return [];
}

/** 同一天只记一条：position 为 null 表示查询了但未进前 100 */
export async function upsertRankHistory(userId: string, params: {
  keyword_id: number;
  date: string; // YYYY-MM-DD
  position: number | null;
  url: string | null;
  /** SERP feature 类型列表（可选；P0-02-D 起由排名刷新写入） */
  featureTypes?: string[];
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO rank_history (keyword_id, date, position, url, feature_types, user_id)
    VALUES (@keyword_id, @date, @position, @url, @feature_types, @user_id)
    ON CONFLICT(keyword_id, date) DO UPDATE SET
      position = excluded.position,
      url = excluded.url,
      feature_types = excluded.feature_types
  `, [{
    ...params,
    feature_types: params.featureTypes && params.featureTypes.length > 0 ? JSON.stringify(params.featureTypes) : null,
    user_id: userId,
  }]);
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
    position: r.position === null || r.position === undefined ? null : Number(r.position),
    url: r.url ? String(r.url) : null,
    featureTypes: parseFeatureTypes(r.feature_types),
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
    position: row.position === null || row.position === undefined ? null : Number(row.position),
    url: row.url ? String(row.url) : null,
    featureTypes: parseFeatureTypes(row.feature_types),
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

// ---------- Rank Tracking Intelligence（P0-02-D） ----------

export interface RankWindowRow {
  keyword_id: number;
  keyword: string;
  domain: string;
  location: string;
  device: "PC" | "移动端";
  date: string;
  position: number | null;
  url: string | null;
  featureTypes: string[];
}

/**
 * 批量取用户（或某项目 domain）全部 tracked keywords 在时间窗口内的 rank_history。
 * 每个关键词的序列天然按 (keyword, location, device) 隔离——tracked_keywords 的唯一约束保证。
 * 用于 RankTrackingService 计算 current/previous/change/status，一次查询避免 N+1。
 */
export async function getRankWindow(
  userId: string,
  domain: string | null,
  days: number
): Promise<RankWindowRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT tk.id AS keyword_id, tk.keyword, tk.domain, tk.location, tk.device,
           rh.date, rh.position, rh.url, rh.feature_types
    FROM tracked_keywords tk
    JOIN rank_history rh ON rh.keyword_id = tk.id AND rh.user_id = tk.user_id
    WHERE tk.user_id = ?
      AND rh.date >= date('now', 'localtime', ?)
      ${domain ? "AND tk.domain = ?" : ""}
    ORDER BY tk.id ASC, rh.date ASC
  `, domain ? [userId, `-${days} day`, domain] : [userId, `-${days} day`]) as Record<string, unknown>[];
  return rows.map((r) => ({
    keyword_id: Number(r.keyword_id),
    keyword: String(r.keyword),
    domain: String(r.domain),
    location: String(r.location),
    device: String(r.device) as "PC" | "移动端",
    date: String(r.date),
    position: r.position === null || r.position === undefined ? null : Number(r.position),
    url: r.url ? String(r.url) : null,
    featureTypes: parseFeatureTypes(r.feature_types),
  }));
}

export interface CompetitorMovementRow {
  competitor_id: number;
  domain: string;
  /** 最新一次记录的排名（null = 该次检查未进前 100） */
  currentRank: number | null;
  /** 最新记录之前最近一次记录的排名 */
  previousRank: number | null;
  /** previousRank - currentRank（正 = 竞品上升；任一侧缺失为 null） */
  change: number | null;
}

/**
 * 某关键词下所有竞品的最新两次排名（competitor movement）。
 * 复用 competitor_ranks 既有历史（每次刷新 INSERT 新行），不新建表。
 */
export async function getCompetitorRankMovement(
  userId: string,
  keywordId: number
): Promise<CompetitorMovementRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    WITH ordered AS (
      SELECT cr.competitor_id, c.domain, cr.rank,
        ROW_NUMBER() OVER (PARTITION BY cr.competitor_id ORDER BY cr.checked_at DESC) AS rn
      FROM competitor_ranks cr
      JOIN competitors c ON c.id = cr.competitor_id
      WHERE cr.keyword_id = ? AND cr.user_id = ?
    )
    SELECT competitor_id, domain,
      MAX(CASE WHEN rn = 1 THEN rank END) AS current_rank,
      MAX(CASE WHEN rn = 2 THEN rank END) AS previous_rank
    FROM ordered
    WHERE rn <= 2
    GROUP BY competitor_id
    ORDER BY domain ASC
  `, [keywordId, userId]) as Record<string, unknown>[];
  return rows.map((r) => {
    const current = r.current_rank === null || r.current_rank === undefined ? null : Number(r.current_rank);
    const previous = r.previous_rank === null || r.previous_rank === undefined ? null : Number(r.previous_rank);
    return {
      competitor_id: Number(r.competitor_id),
      domain: String(r.domain),
      currentRank: current,
      previousRank: previous,
      change: current !== null && previous !== null ? previous - current : null,
    };
  });
}
