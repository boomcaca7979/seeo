// ===== 关键词研究成果领域：keyword_researches =====
// 一次「分析」的完整快照（种子词 + 相关搜索 + PAA + SERP 快照 + 发现词），
// 保存后重开零 API 调用；payload 为页面重建工作台状态所需的最小 JSON。

import { getAdapter } from "./migrations";

// ---------- 类型 ----------

/** 列表项（不含 payload，避免列表接口拖全量快照） */
export interface KeywordResearchSummary {
  id: number;
  seed: string;
  location: string;
  device: string;
  keywordCount: number;
  savedAt: string;
}

export interface SavedKeywordResearch extends KeywordResearchSummary {
  payload: string;
}

// ---------- Repository ----------

export async function saveKeywordResearch(
  userId: string,
  params: { seed: string; location: string; device: string; keywordCount: number; payload: string }
): Promise<KeywordResearchSummary> {
  const db = await getAdapter();
  const info = await db.run(
    `INSERT INTO keyword_researches (seed, location, device, keyword_count, payload, user_id)
     VALUES (@seed, @location, @device, @keywordCount, @payload, @userId)`,
    [{ ...params, userId }]
  );
  const row = (await db.get(`SELECT * FROM keyword_researches WHERE id = ?`, [info.lastInsertRowid])) as Record<
    string,
    unknown
  >;
  return rowToSummary(row);
}

export async function listKeywordResearches(userId: string, limit = 50): Promise<KeywordResearchSummary[]> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT id, seed, location, device, keyword_count, saved_at
     FROM keyword_researches WHERE user_id = ? ORDER BY saved_at DESC, id DESC LIMIT ?`,
    [userId, limit]
  )) as Record<string, unknown>[];
  return rows.map(rowToSummary);
}

export async function getKeywordResearch(userId: string, id: number): Promise<SavedKeywordResearch | null> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT * FROM keyword_researches WHERE id = ? AND user_id = ?`,
    [id, userId]
  )) as Record<string, unknown> | undefined;
  return row ? rowToSaved(row) : null;
}

export async function deleteKeywordResearch(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM keyword_researches WHERE id = ? AND user_id = ?`, [id, userId]);
  return Number(info.changes) > 0;
}

// ---------- helpers ----------

function rowToSummary(row: Record<string, unknown>): KeywordResearchSummary {
  return {
    id: Number(row.id),
    seed: String(row.seed),
    location: String(row.location),
    device: String(row.device),
    keywordCount: Number(row.keyword_count ?? 0),
    savedAt: String(row.saved_at),
  };
}

function rowToSaved(row: Record<string, unknown>): SavedKeywordResearch {
  return { ...rowToSummary(row), payload: String(row.payload) };
}
