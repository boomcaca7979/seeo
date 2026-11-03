// ===== 关键词策略领域：keyword_strategies =====
// 与 keyword_researches 同范式（一次生成 = 一份快照），但多了运行状态、
// topics/keywords 结构化 JSON、收藏集合与分享 token。
//
// 安全约束：
//   - 所有读写都带 user_id 条件（除按 share_token 的只读查询）；
//   - share_token 只由服务端生成，写入/撤销都走本文件。

import { getAdapter } from "./migrations";
import type { SavedBrief, SavedBriefMap, StrategyDoc } from "@/lib/seo/strategy-model";

export type StrategyStatus = "running" | "ready" | "partial" | "failed";

export interface StrategySummary {
  id: number;
  name: string;
  /** 原始种子（永不因 Add keywords 改变） */
  seeds: string[];
  /** 用户手动追加的种子（Add keywords） */
  addedSeeds: string[];
  market: string;
  device: string;
  status: StrategyStatus;
  progress: number;
  keywordCount: number;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
}

// SavedBrief / SavedBriefMap 定义在 strategy-model（纯函数模块），客户端也能安全引用。
export type { SavedBrief, SavedBriefMap };

export interface StrategyRecord extends StrategySummary {
  doc: StrategyDoc | null;
  favorites: string[];
  /** 已保存的 Content Brief；公开分享路径不返回（见 getStrategyByShareToken） */
  briefs: SavedBriefMap;
  error: string | null;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToSummary(row: Record<string, unknown>): StrategySummary {
  return {
    id: Number(row.id),
    name: String(row.name),
    seeds: parseJson<string[]>(row.seeds, []),
    addedSeeds: parseJson<string[]>(row.added_seeds_json, []),
    market: String(row.market),
    device: String(row.device),
    status: String(row.status) as StrategyStatus,
    progress: Number(row.progress ?? 0),
    keywordCount: Number(row.keyword_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    shareToken: row.share_token ? String(row.share_token) : null,
  };
}

function rowToRecord(row: Record<string, unknown>): StrategyRecord {
  const topics = parseJson<StrategyDoc["topics"]>(row.topics_json, []);
  const keywords = parseJson<StrategyDoc["keywords"]>(row.keywords_json, []);
  const meta = parseJson<StrategyDoc["meta"] | null>(row.meta_json, null);
  return {
    ...rowToSummary(row),
    doc: meta ? { topics, keywords, meta } : null,
    favorites: parseJson<string[]>(row.favorites_json, []),
    briefs: parseJson<SavedBriefMap>(row.briefs_json, {}),
    error: row.error ? String(row.error) : null,
  };
}

export async function createStrategy(
  userId: string,
  params: { name: string; seeds: string[]; market: string; device: string }
): Promise<StrategySummary> {
  const db = await getAdapter();
  const info = await db.run(
    `INSERT INTO keyword_strategies (user_id, name, seeds, added_seeds_json, market, device, status, progress, keyword_count)
     VALUES (@user_id, @name, @seeds, '[]', @market, @device, 'running', 0, 0)`,
    [{
      user_id: userId,
      name: params.name,
      seeds: JSON.stringify(params.seeds),
      market: params.market,
      device: params.device,
    }]
  );
  const row = (await db.get(`SELECT * FROM keyword_strategies WHERE id = ?`, [info.lastInsertRowid])) as Record<string, unknown>;
  return rowToSummary(row);
}

export async function setStrategyProgress(
  userId: string,
  id: number,
  params: { status?: StrategyStatus; progress?: number; error?: string | null }
): Promise<void> {
  const db = await getAdapter();
  const sets: string[] = ["updated_at = datetime('now', 'localtime')"];
  const args: Record<string, unknown> = { id, user_id: userId };
  if (params.status !== undefined) {
    sets.push("status = @status");
    args.status = params.status;
  }
  if (params.progress !== undefined) {
    sets.push("progress = @progress");
    args.progress = params.progress;
  }
  if (params.error !== undefined) {
    sets.push("error = @error");
    args.error = params.error;
  }
  await db.run(`UPDATE keyword_strategies SET ${sets.join(", ")} WHERE id = @id AND user_id = @user_id`, [args]);
}

/**
 * 原子抢占式置 running：只有当前状态不是 running 时才写入，返回是否抢到。
 * retry / Add keywords 用它替代「先查后写」，消灭并发双击下两个后台任务
 * 同时跑同一批种子、重复消耗 SerpApi 配额的窗口（检查-置位非原子的 TOCTOU）。
 * status 条件与置位在同一条 UPDATE 内，由 SQLite 写锁串行化，并发只会有一个赢家。
 */
export async function claimStrategyRun(
  userId: string,
  id: number,
  params: { status?: StrategyStatus; progress?: number; error?: string | null }
): Promise<boolean> {
  const db = await getAdapter();
  const sets: string[] = ["updated_at = datetime('now', 'localtime')"];
  const args: Record<string, unknown> = { id, user_id: userId };
  if (params.status !== undefined) {
    sets.push("status = @status");
    args.status = params.status;
  }
  if (params.progress !== undefined) {
    sets.push("progress = @progress");
    args.progress = params.progress;
  }
  if (params.error !== undefined) {
    sets.push("error = @error");
    args.error = params.error;
  }
  const res = await db.run(
    `UPDATE keyword_strategies SET ${sets.join(", ")}
      WHERE id = @id AND user_id = @user_id AND status != 'running'`,
    [args]
  );
  return res.changes === 1;
}

export async function saveStrategyDoc(
  userId: string,
  id: number,
  doc: StrategyDoc,
  status: StrategyStatus
): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE keyword_strategies SET
       keywords_json = @keywords,
       topics_json = @topics,
       meta_json = @meta,
       added_seeds_json = @addedSeeds,
       keyword_count = @count,
       status = @status,
       progress = 100,
       error = NULL,
       updated_at = datetime('now', 'localtime')
     WHERE id = @id AND user_id = @user_id`,
    [{
      id,
      user_id: userId,
      keywords: JSON.stringify(doc.keywords),
      topics: JSON.stringify(doc.topics),
      meta: JSON.stringify(doc.meta),
      addedSeeds: JSON.stringify(doc.meta.addedSeeds ?? []),
      count: doc.keywords.length,
      status,
    }]
  );
}

export async function getStrategy(userId: string, id: number): Promise<StrategyRecord | null> {
  const db = await getAdapter();
  const row = (await db.get(`SELECT * FROM keyword_strategies WHERE id = ? AND user_id = ?`, [id, userId])) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRecord(row) : null;
}

/** 公开分享：只按 token 读，不返回 user_id 等内部字段 */
export async function getStrategyByShareToken(token: string): Promise<StrategyRecord | null> {
  if (!token) return null;
  const db = await getAdapter();
  const row = (await db.get(`SELECT * FROM keyword_strategies WHERE share_token = ?`, [token])) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const record = rowToRecord(row);
  // 公开分享只含「策略本身」（doc + 元信息），不含任何用户私有编辑稿。
  return { ...record, briefs: {}, favorites: [] };
}

/** 分享 token 是否已被占用（创建新 token 前查重，避免碰撞覆盖别人的链接） */
export async function isShareTokenTaken(token: string): Promise<boolean> {
  if (!token) return true;
  const db = await getAdapter();
  const row = (await db.get(`SELECT 1 AS ok FROM keyword_strategies WHERE share_token = ? LIMIT 1`, [token])) as
    | { ok?: number }
    | undefined;
  return row?.ok === 1;
}

export async function listStrategies(userId: string, limit = 50): Promise<StrategySummary[]> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT id, name, seeds, added_seeds_json, market, device, status, progress, keyword_count, created_at, updated_at, share_token
     FROM keyword_strategies WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [userId, limit]
  )) as Record<string, unknown>[];
  return rows.map(rowToSummary);
}

export async function renameStrategy(userId: string, id: number, name: string): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(
    `UPDATE keyword_strategies SET name = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND user_id = ?`,
    [name, id, userId]
  );
  return Number(info.changes) > 0;
}

export async function setStrategyFavorites(userId: string, id: number, favorites: string[]): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(
    `UPDATE keyword_strategies SET favorites_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND user_id = ?`,
    [JSON.stringify(favorites), id, userId]
  );
  return Number(info.changes) > 0;
}

/**
 * 保存 / 删除某主题的 Content Brief。
 * 归属校验在 SQL 的 user_id 条件里；返回 false 表示策略不属于该用户（调用方按 404 处理）。
 */
export async function setStrategyBrief(
  userId: string,
  id: number,
  topicId: string,
  brief: SavedBrief | null
): Promise<boolean> {
  const db = await getAdapter();
  const row = (await db.get(`SELECT briefs_json FROM keyword_strategies WHERE id = ? AND user_id = ?`, [id, userId])) as
    | { briefs_json?: string | null }
    | undefined;
  if (!row) return false;
  const briefs = parseJson<SavedBriefMap>(row.briefs_json, {});
  if (brief) briefs[topicId] = brief;
  else delete briefs[topicId];
  const info = await db.run(
    `UPDATE keyword_strategies SET briefs_json = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ? AND user_id = ?`,
    [JSON.stringify(briefs), id, userId]
  );
  return Number(info.changes) > 0;
}

export async function deleteStrategy(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM keyword_strategies WHERE id = ? AND user_id = ?`, [id, userId]);
  return Number(info.changes) > 0;
}

export async function setStrategyShareToken(
  userId: string,
  id: number,
  token: string | null
): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(
    `UPDATE keyword_strategies SET share_token = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ? AND user_id = ?`,
    [token, id, userId]
  );
  return Number(info.changes) > 0;
}

// ---------- Strategy Priority 用户覆盖 ----------

export type PriorityOverrideMap = Record<string, "recommended" | "review" | "low">;

function parseOverrides(raw: unknown): PriorityOverrideMap {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: PriorityOverrideMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === "recommended" || v === "review" || v === "low") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function getPriorityOverrides(userId: string, id: number): Promise<PriorityOverrideMap> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT priority_overrides_json FROM keyword_strategies WHERE id = ? AND user_id = ?`,
    [id, userId]
  )) as { priority_overrides_json?: string | null } | undefined;
  return parseOverrides(row?.priority_overrides_json);
}

/** 设置/清除单个主题的优先级覆盖（level=null 清除） */
export async function setPriorityOverride(
  userId: string,
  id: number,
  topicId: string,
  level: "recommended" | "review" | "low" | null
): Promise<boolean> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT priority_overrides_json FROM keyword_strategies WHERE id = ? AND user_id = ?`,
    [id, userId]
  )) as { priority_overrides_json?: string | null } | undefined;
  if (!row) return false;
  const map = parseOverrides(row.priority_overrides_json);
  if (level) map[topicId] = level;
  else delete map[topicId];
  const info = await db.run(
    `UPDATE keyword_strategies SET priority_overrides_json = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ? AND user_id = ?`,
    [JSON.stringify(map), id, userId]
  );
  return Number(info.changes) > 0;
}

/**
 * 防重复：同一用户 + 相同种子集合/市场/设备，且仍在 running 或 30 秒内创建过，
 * 视为重复提交（返回已有 id，不新建任务、不重复扣配额）。
 */
export async function findDuplicateStrategy(
  userId: string,
  params: { seeds: string[]; market: string; device: string }
): Promise<StrategySummary | null> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT id, name, seeds, added_seeds_json, market, device, status, progress, keyword_count, created_at, updated_at, share_token
     FROM keyword_strategies
     WHERE user_id = ? AND market = ? AND device = ?
     ORDER BY id DESC LIMIT 20`,
    [userId, params.market, params.device]
  )) as Record<string, unknown>[];
  const key = [...params.seeds].map((s) => s.trim().toLowerCase()).sort().join("\n");
  const now = Date.now();
  for (const row of rows) {
    const summary = rowToSummary(row);
    const rowKey = [...summary.seeds].map((s) => s.trim().toLowerCase()).sort().join("\n");
    if (rowKey !== key) continue;
    const created = new Date(summary.createdAt.replace(" ", "T")).getTime();
    const fresh = Number.isFinite(created) ? now - created < 30_000 : false;
    if (summary.status === "running" || fresh) return summary;
  }
  return null;
}
