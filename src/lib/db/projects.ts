// ===== 项目领域：projects + competitors + 项目指标辅助 =====

import { getAdapter } from "./migrations";

// ---------- projects ----------

export interface ProjectRow {
  id: number;
  name: string;
  domain: string;
  created_at: string;
}

export interface ProjectWithMetrics extends ProjectRow {
  trackedKeywordCount: number;
  healthScore: number | null;
  lastAuditTime: string | null;
  rankUp7d: number;
  rankDown7d: number;
  alertCount: number;
}

function rowToProject(row: Record<string, unknown>): ProjectRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    domain: String(row.domain),
    created_at: String(row.created_at),
  };
}

export async function listProjects(userId: string): Promise<ProjectRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC`, [userId]) as Record<string, unknown>[];
  return rows.map(rowToProject);
}

export async function addProject(userId: string, name: string, domain: string): Promise<ProjectRow> {
  const db = await getAdapter();
  const info = await db.run(`INSERT INTO projects (name, domain, user_id) VALUES (?, ?, ?)`, [name, domain, userId]);
  const row = await db.get(`SELECT * FROM projects WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToProject(row);
}

export async function removeProject(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();

  // 先确认项目存在并取 domain（用于按 domain 关联的表）
  const project = await db.get(`SELECT domain FROM projects WHERE id = ? AND user_id = ?`, [id, userId]) as
    | { domain: string }
    | undefined;
  if (!project) return false;
  const domain = project.domain;

  // 1. 获取该项目 domain 下的所有关键词 ID
  const keywords = await db.query(
    `SELECT id FROM tracked_keywords WHERE domain = ? AND user_id = ?`,
    [domain, userId]
  ) as Array<{ id: number }>;
  const keywordIds = keywords.map((k) => k.id);

  // 2. 删除关键词关联数据（rank_history / competitor_ranks / keyword_group_members）
  if (keywordIds.length > 0) {
    const placeholders = keywordIds.map(() => "?").join(",");
    await db.run(
      `DELETE FROM rank_history WHERE keyword_id IN (${placeholders}) AND user_id = ?`,
      [...keywordIds, userId]
    );
    await db.run(
      `DELETE FROM competitor_ranks WHERE keyword_id IN (${placeholders}) AND user_id = ?`,
      [...keywordIds, userId]
    );
    await db.run(
      `DELETE FROM keyword_group_members WHERE keyword_id IN (${placeholders}) AND user_id = ?`,
      [...keywordIds, userId]
    );
  }

  // 3. 删除竞品及其排名（competitors.project_id 直接关联）
  await db.run(
    `DELETE FROM competitor_ranks WHERE competitor_id IN (SELECT id FROM competitors WHERE project_id = ? AND user_id = ?) AND user_id = ?`,
    [id, userId, userId]
  );
  await db.run(`DELETE FROM competitors WHERE project_id = ? AND user_id = ?`, [id, userId]);

  // 4. 删除审计及其问题（audits 按 domain 关联）
  await db.run(
    `DELETE FROM audit_issues WHERE audit_id IN (SELECT id FROM audits WHERE domain = ? AND user_id = ?) AND user_id = ?`,
    [domain, userId, userId]
  );
  await db.run(`DELETE FROM audits WHERE domain = ? AND user_id = ?`, [domain, userId]);

  // 5. 删除内容检查（content_checks 按 url LIKE domain% 关联）
  await db.run(`DELETE FROM content_checks WHERE url LIKE ? AND user_id = ?`, [`${domain}%`, userId]);

  // 6. 删除告警（alerts 按 domain 关联）
  await db.run(`DELETE FROM alerts WHERE domain = ? AND user_id = ?`, [domain, userId]);

  // 7. 删除报告（reports.project_id 直接关联）
  await db.run(`DELETE FROM reports WHERE project_id = ? AND user_id = ?`, [id, userId]);

  // 8. 删除追踪关键词
  await db.run(`DELETE FROM tracked_keywords WHERE domain = ? AND user_id = ?`, [domain, userId]);

  // 9. 删除项目本身
  await db.run(`DELETE FROM projects WHERE id = ? AND user_id = ?`, [id, userId]);

  return true;
}

export async function getProjectById(userId: string, id: number): Promise<ProjectRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM projects WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

export async function getProjectByDomain(userId: string, domain: string): Promise<ProjectRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM projects WHERE domain = ? AND user_id = ?`, [domain, userId]) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

// ---------- 项目指标辅助查询 ----------

export async function countTrackedKeywordsByDomain(userId: string, domain: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM tracked_keywords WHERE domain = ? AND user_id = ?`, [domain, userId]) as { c: number };
  return row.c;
}

/** 获取某域名下追踪关键词近 7 天排名升降数 */
export async function getRankStats7d(userId: string, domain: string): Promise<{ up: number; down: number }> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT
      today.position AS today_pos,
      past.position AS past_pos
    FROM tracked_keywords tk
    LEFT JOIN rank_history today
      ON today.keyword_id = tk.id AND today.date = date('now', 'localtime')
    LEFT JOIN rank_history past
      ON past.keyword_id = tk.id AND past.date = date('now', 'localtime', '-7 day')
    WHERE tk.domain = ? AND tk.user_id = ?
  `, [domain, userId]) as Record<string, unknown>[];

  let up = 0;
  let down = 0;
  for (const r of rows) {
    const todayPos = r.today_pos === null || r.today_pos === undefined ? null : Number(r.today_pos);
    const pastPos = r.past_pos === null || r.past_pos === undefined ? null : Number(r.past_pos);
    if (todayPos !== null && pastPos !== null) {
      if (todayPos < pastPos) up++;
      else if (todayPos > pastPos) down++;
    }
  }
  return { up, down };
}

/**
 * 批量构建项目指标（核心辅助函数）。
 * 用 4 次批量查询替代 4N 次循环查询，避免 N+1 问题。
 * - 第 1 次：按 domain 批量统计 tracked_keywords
 * - 第 2 次：按 domain 批量取最新 audit（MAX(id)）
 * - 第 3 次：按 domain 批量计算近 7 天排名升降数
 * - 第 4 次：按 domain 批量统计未读 alerts
 */
async function buildProjectsWithMetricsBase(
  userId: string,
  projects: ProjectRow[]
): Promise<ProjectWithMetrics[]> {
  if (projects.length === 0) return [];
  const db = await getAdapter();

  const domains = projects.map((p) => p.domain);
  const placeholders = domains.map(() => "?").join(",");

  // 1. 批量获取关键词计数
  const keywordRows = await db.query(
    `SELECT domain, COUNT(*) AS c FROM tracked_keywords WHERE domain IN (${placeholders}) AND user_id = ? GROUP BY domain`,
    [...domains, userId]
  ) as Array<{ domain: string; c: number }>;
  const keywordMap = new Map<string, number>();
  for (const r of keywordRows) keywordMap.set(r.domain, Number(r.c));

  // 2. 批量获取每个 domain 的最新审计（MAX(id) 等价于 ORDER BY started_at DESC LIMIT 1）
  const auditRows = await db.query(
    `SELECT domain, health_score, started_at, finished_at
     FROM audits
     WHERE domain IN (${placeholders}) AND user_id = ?
       AND id IN (SELECT MAX(id) FROM audits a2 GROUP BY a2.domain)`,
    [...domains, userId]
  ) as Array<{
      domain: string;
      health_score: number | null;
      started_at: string;
      finished_at: string | null;
    }>;
  const auditMap = new Map<string, { healthScore: number | null; lastTime: string }>();
  for (const r of auditRows) {
    auditMap.set(r.domain, {
      healthScore: r.health_score === null || r.health_score === undefined ? null : Number(r.health_score),
      lastTime: r.finished_at ?? r.started_at,
    });
  }

  // 3. 批量获取每个 domain 近 7 天排名升降数（today vs 7-day-ago）
  const rankRows = await db.query(
    `SELECT tk.domain,
       SUM(CASE WHEN today.position IS NOT NULL AND past.position IS NOT NULL
                 AND today.position < past.position THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN today.position IS NOT NULL AND past.position IS NOT NULL
                 AND today.position > past.position THEN 1 ELSE 0 END) AS down
     FROM tracked_keywords tk
     LEFT JOIN rank_history today
       ON today.keyword_id = tk.id AND today.date = date('now', 'localtime')
     LEFT JOIN rank_history past
       ON past.keyword_id = tk.id AND past.date = date('now', 'localtime', '-7 day')
     WHERE tk.domain IN (${placeholders}) AND tk.user_id = ?
     GROUP BY tk.domain`,
    [...domains, userId]
  ) as Array<{ domain: string; up: number | null; down: number | null }>;
  const rankMap = new Map<string, { up: number; down: number }>();
  for (const r of rankRows) {
    rankMap.set(r.domain, {
      up: Number(r.up ?? 0),
      down: Number(r.down ?? 0),
    });
  }

  // 4. 批量获取每个 domain 未读预警数
  const alertRows = await db.query(
    `SELECT domain, COUNT(*) AS c FROM alerts WHERE read = 0 AND domain IN (${placeholders}) AND user_id = ? GROUP BY domain`,
    [...domains, userId]
  ) as Array<{ domain: string; c: number }>;
  const alertMap = new Map<string, number>();
  for (const r of alertRows) alertMap.set(r.domain, Number(r.c));

  return projects.map((p) => {
    const audit = auditMap.get(p.domain);
    const rank = rankMap.get(p.domain);
    return {
      ...p,
      trackedKeywordCount: keywordMap.get(p.domain) ?? 0,
      healthScore: audit?.healthScore ?? null,
      lastAuditTime: audit?.lastTime ?? null,
      rankUp7d: rank?.up ?? 0,
      rankDown7d: rank?.down ?? 0,
      alertCount: alertMap.get(p.domain) ?? 0,
    };
  });
}

/** 获取所有项目及其指标（一次调用，工作台用）。
 *  查询次数固定 5 次（1 次取项目 + 4 次批量指标），与项目数无关。 */
export async function listProjectsWithMetrics(userId: string): Promise<ProjectWithMetrics[]> {
  const projects = await listProjects(userId);
  return buildProjectsWithMetricsBase(userId, projects);
}

/**
 * 获取指定用户有权限的项目及其指标（启用鉴权时用）。
 * 通过 Supabase 的 projects 表（RLS 自动按 user_id 过滤）查询项目，
 * 再用 domain 关联本地 SQLite/Turso 获取指标（审计/排名/告警）。
 *
 * 注意：Supabase projects.id 是 UUID 字符串，与本地 INTEGER id 不同。
 * 这里用 domain 作为关联键，返回的 id 仍为 Supabase UUID（字符串转 number 失败时用 0 占位）。
 * 同样使用批量查询避免 N+1（4N → 4 次）。
 */
export async function listProjectsWithMetricsForUser(
  userId: string,
  supabaseProjects: Array<{ id: string; name: string; domain: string; created_at: string }>
): Promise<ProjectWithMetrics[]> {
  // 转换为 ProjectRow[] 后复用批量构建逻辑（Supabase UUID 无法转 number，用 0 占位）
  const projects: ProjectRow[] = supabaseProjects.map((p) => ({
    id: 0,
    name: p.name,
    domain: p.domain,
    created_at: p.created_at,
  }));
  return buildProjectsWithMetricsBase(userId, projects);
}

// ---------- competitors ----------

export interface Competitor {
  id: number;
  project_id: number;
  domain: string;
  name: string | null;
  created_at: string;
}

export interface CompetitorRank {
  id: number;
  competitor_id: number;
  keyword_id: number;
  rank: number | null;
  target_url: string | null;
  checked_at: string;
}

export interface CompetitorRankLatest {
  competitor_id: number;
  domain: string;
  rank: number | null;
  target_url: string | null;
  checked_at: string;
}

function rowToCompetitor(row: Record<string, unknown>): Competitor {
  return {
    id: Number(row.id),
    project_id: Number(row.project_id),
    domain: String(row.domain),
    name: row.name ? String(row.name) : null,
    created_at: String(row.created_at),
  };
}

export async function createCompetitor(userId: string, params: {
  project_id: number;
  domain: string;
  name?: string | null;
}): Promise<Competitor> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO competitors (project_id, domain, name, user_id)
    VALUES (@project_id, @domain, @name, @user_id)
  `, [{
    project_id: params.project_id,
    domain: params.domain,
    name: params.name ?? null,
    user_id: userId,
  }]);
  const row = await db.get(`SELECT * FROM competitors WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToCompetitor(row);
}

export async function listCompetitors(userId: string, projectId: number): Promise<Competitor[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM competitors WHERE project_id = ? AND user_id = ? ORDER BY created_at ASC
  `, [projectId, userId]) as Record<string, unknown>[];
  return rows.map(rowToCompetitor);
}

export async function deleteCompetitor(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM competitors WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function getCompetitorById(userId: string, id: number): Promise<Competitor | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM competitors WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToCompetitor(row) : null;
}

export async function addCompetitorRank(userId: string, params: {
  competitor_id: number;
  keyword_id: number;
  rank: number | null;
  target_url: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO competitor_ranks (competitor_id, keyword_id, rank, target_url, user_id)
    VALUES (@competitor_id, @keyword_id, @rank, @target_url, @user_id)
  `, [{ ...params, user_id: userId }]);
}

/** 获取某关键词下所有竞品的最新一条排名 */
export async function getLatestCompetitorRanks(userId: string, keywordId: number): Promise<CompetitorRankLatest[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT cr.competitor_id, c.domain, cr.rank, cr.target_url, cr.checked_at
    FROM competitor_ranks cr
    JOIN competitors c ON c.id = cr.competitor_id
    WHERE cr.keyword_id = ? AND cr.user_id = ?
    AND cr.id = (
      SELECT cr2.id FROM competitor_ranks cr2
      WHERE cr2.competitor_id = cr.competitor_id AND cr2.keyword_id = cr.keyword_id
      ORDER BY cr2.checked_at DESC LIMIT 1
    )
    ORDER BY c.domain ASC
  `, [keywordId, userId]) as Record<string, unknown>[];
  return rows.map((r) => ({
    competitor_id: Number(r.competitor_id),
    domain: String(r.domain),
    rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
    target_url: r.target_url ? String(r.target_url) : null,
    checked_at: String(r.checked_at),
  }));
}

/** 获取某竞品在某关键词下的历史排名（按时间倒序） */
export async function getCompetitorRanksHistory(
  userId: string,
  competitorId: number,
  keywordId: number,
  limit = 30
): Promise<Array<{ rank: number | null; checked_at: string }>> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT rank, checked_at FROM competitor_ranks
    WHERE competitor_id = ? AND keyword_id = ? AND user_id = ?
    ORDER BY checked_at DESC LIMIT ?
  `, [competitorId, keywordId, userId, limit]) as Record<string, unknown>[];
  return rows.map((r) => ({
    rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
    checked_at: String(r.checked_at),
  }));
}

/** 获取某关键词下所有竞品的所有排名记录（用于 SOV 趋势） */
export async function getCompetitorRanksByKeyword(
  userId: string,
  keywordId: number,
  days = 30
): Promise<Array<{
  competitor_id: number;
  domain: string;
  rank: number | null;
  checked_at: string;
}>> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT cr.competitor_id, c.domain, cr.rank, cr.checked_at
    FROM competitor_ranks cr
    JOIN competitors c ON c.id = cr.competitor_id
    WHERE cr.keyword_id = ? AND cr.user_id = ?
    AND date(cr.checked_at) >= date('now', 'localtime', ?)
    ORDER BY cr.checked_at ASC
  `, [keywordId, userId, `-${days} day`]) as Record<string, unknown>[];
  return rows.map((r) => ({
    competitor_id: Number(r.competitor_id),
    domain: String(r.domain),
    rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
    checked_at: String(r.checked_at),
  }));
}
