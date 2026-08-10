// ===== 关键词领域：tracked_keywords + keyword_groups =====

import { getAdapter } from "./migrations";

// ---------- 类型 ----------

export interface TrackedKeyword {
  id: number;
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
  created_at: string;
  last_refreshed_at: string | null;
}

export interface TrackedKeywordWithLatest extends TrackedKeyword {
  todayPosition: number | null;
  yesterdayPosition: number | null;
  change: number | null; // 正为上升（排名数字变小），负为下降
  matchedUrl: string | null;
}

export interface KeywordGroup {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface KeywordGroupWithCount extends KeywordGroup {
  keywordCount: number;
}

export interface TrackedKeywordWithGroups extends TrackedKeywordWithLatest {
  groups: KeywordGroup[];
}

// ---------- Repository ----------

function rowToTracked(row: Record<string, unknown>): TrackedKeyword {
  return {
    id: Number(row.id),
    keyword: String(row.keyword),
    location: String(row.location),
    device: String(row.device) as "PC" | "移动端",
    domain: String(row.domain),
    created_at: String(row.created_at),
    last_refreshed_at: row.last_refreshed_at ? String(row.last_refreshed_at) : null,
  };
}

export async function listTrackedKeywords(userId: string): Promise<TrackedKeywordWithGroups[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT
      tk.*,
      today.position AS today_position,
      today.url AS today_url,
      yest.position AS yesterday_position
    FROM tracked_keywords tk
    LEFT JOIN rank_history today
      ON today.keyword_id = tk.id AND today.date = date('now', 'localtime')
    LEFT JOIN rank_history yest
      ON yest.keyword_id = tk.id AND yest.date = date('now', 'localtime', '-1 day')
    WHERE tk.user_id = ?
    ORDER BY tk.created_at ASC
  `, [userId]) as Record<string, unknown>[];

  // 一次性查所有分组关联，再按 keyword_id 聚合（避免 N+1）
  const allMembers = await db.query(`
    SELECT m.keyword_id, g.id AS group_id, g.name, g.description, g.created_at
    FROM keyword_group_members m
    JOIN keyword_groups g ON g.id = m.group_id
    WHERE m.user_id = ?
  `, [userId]) as Record<string, unknown>[];
  const groupsByKw = new Map<number, KeywordGroup[]>();
  for (const m of allMembers) {
    const kid = Number(m.keyword_id);
    const g: KeywordGroup = {
      id: Number(m.group_id),
      name: String(m.name),
      description: m.description ? String(m.description) : null,
      created_at: String(m.created_at),
    };
    if (!groupsByKw.has(kid)) groupsByKw.set(kid, []);
    groupsByKw.get(kid)!.push(g);
  }

  return rows.map((r) => {
    const today = r.today_position === null || r.today_position === undefined
      ? null
      : Number(r.today_position);
    const yest = r.yesterday_position === null || r.yesterday_position === undefined
      ? null
      : Number(r.yesterday_position);
    let change: number | null = null;
    if (today !== null && yest !== null) {
      // 排名数字变小 = 上升，change 显示为正
      change = yest - today;
    }
    const kid = Number(r.id);
    return {
      ...rowToTracked(r),
      todayPosition: today,
      yesterdayPosition: yest,
      change,
      matchedUrl: r.today_url ? String(r.today_url) : null,
      groups: groupsByKw.get(kid) ?? [],
    };
  });
}

export async function addTrackedKeyword(userId: string, params: {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
}): Promise<TrackedKeyword> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO tracked_keywords (keyword, location, device, domain, user_id)
    VALUES (@keyword, @location, @device, @domain, @user_id)
  `, [{ ...params, user_id: userId }]);
  const row = await db.get(`SELECT * FROM tracked_keywords WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToTracked(row);
}

export async function removeTrackedKeyword(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM tracked_keywords WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function getTrackedKeywordById(userId: string, id: number): Promise<TrackedKeyword | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM tracked_keywords WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToTracked(row) : null;
}

export async function countTrackedKeywords(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM tracked_keywords WHERE user_id = ?`, [userId]) as { c: number };
  return row.c;
}

// ---------- keyword_groups ----------

function rowToKeywordGroup(row: Record<string, unknown>): KeywordGroup {
  return {
    id: Number(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    created_at: String(row.created_at),
  };
}

export async function createKeywordGroup(userId: string, name: string, description?: string): Promise<KeywordGroup> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO keyword_groups (name, description, user_id)
    VALUES (@name, @description, @user_id)
  `, [{ name, description: description ?? null, user_id: userId }]);
  const row = await db.get(`SELECT * FROM keyword_groups WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToKeywordGroup(row);
}

export async function listKeywordGroups(userId: string): Promise<KeywordGroupWithCount[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT g.*, COUNT(m.keyword_id) AS keyword_count
    FROM keyword_groups g
    LEFT JOIN keyword_group_members m ON m.group_id = g.id
    WHERE g.user_id = ?
    GROUP BY g.id
    ORDER BY g.created_at ASC
  `, [userId]) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...rowToKeywordGroup(r),
    keywordCount: Number(r.keyword_count),
  }));
}

export async function deleteKeywordGroup(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM keyword_groups WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function addKeywordToGroup(userId: string, groupId: number, keywordId: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT OR IGNORE INTO keyword_group_members (group_id, keyword_id, user_id)
    VALUES (@group_id, @keyword_id, @user_id)
  `, [{ group_id: groupId, keyword_id: keywordId, user_id: userId }]);
}

export async function removeKeywordFromGroup(userId: string, groupId: number, keywordId: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`
    DELETE FROM keyword_group_members
    WHERE group_id = ? AND keyword_id = ? AND user_id = ?
  `, [groupId, keywordId, userId]);
  return info.changes > 0;
}

export async function listKeywordsInGroup(userId: string, groupId: number): Promise<TrackedKeyword[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT tk.* FROM tracked_keywords tk
    JOIN keyword_group_members m ON m.keyword_id = tk.id
    WHERE m.group_id = ? AND m.user_id = ?
    ORDER BY tk.created_at ASC
  `, [groupId, userId]) as Record<string, unknown>[];
  return rows.map(rowToTracked);
}

export async function getKeywordGroups(userId: string, keywordId: number): Promise<KeywordGroup[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT g.* FROM keyword_groups g
    JOIN keyword_group_members m ON m.group_id = g.id
    WHERE m.keyword_id = ? AND m.user_id = ?
    ORDER BY g.created_at ASC
  `, [keywordId, userId]) as Record<string, unknown>[];
  return rows.map(rowToKeywordGroup);
}
