// ===== 审计领域：audits + audit_issues =====

import { getAdapter } from "./migrations";

export interface AuditRow {
  id: number;
  domain: string;
  started_at: string;
  finished_at: string | null;
  pages_crawled: number;
  health_score: number | null;
  status: "running" | "completed" | "failed";
  errors: number;
  warnings: number;
  notices: number;
  comparison: string | null;
  error: string | null;
  depth: "quick" | "full";
  pages_detail: string | null;
  /** Audit Engine V2：引擎版本（如 v2） */
  engine_version: string | null;
  /** Audit Engine V2：规则集版本（如 2.0） */
  rule_set_version: string | null;
  /** Audit Dashboard V2：完整快照 JSON（页面/规则/分数/分类/报告） */
  dashboard_json: string | null;
}

export interface AuditIssueRow {
  id: number;
  audit_id: number;
  type: string;
  severity: "error" | "warning" | "notice";
  url: string;
  detail: string;
  suggestion: string | null;
}

export async function createAudit(userId: string, domain: string, depth: "quick" | "full" = "quick"): Promise<AuditRow> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO audits (domain, status, depth, user_id) VALUES (?, 'running', ?, ?)
  `, [domain, depth, userId]);
  const row = await db.get(`SELECT * FROM audits WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToAudit(row);
}

function rowToAudit(row: Record<string, unknown>): AuditRow {
  return {
    id: Number(row.id),
    domain: String(row.domain),
    started_at: String(row.started_at),
    finished_at: row.finished_at ? String(row.finished_at) : null,
    pages_crawled: Number(row.pages_crawled),
    health_score: row.health_score === null ? null : Number(row.health_score),
    status: String(row.status) as AuditRow["status"],
    errors: Number(row.errors),
    warnings: Number(row.warnings),
    notices: Number(row.notices),
    comparison: row.comparison ? String(row.comparison) : null,
    error: row.error ? String(row.error) : null,
    depth: (row.depth === "full" ? "full" : "quick"),
    pages_detail: row.pages_detail ? String(row.pages_detail) : null,
    engine_version: row.engine_version ? String(row.engine_version) : null,
    rule_set_version: row.rule_set_version ? String(row.rule_set_version) : null,
    dashboard_json: row.dashboard_json ? String(row.dashboard_json) : null,
  };
}

export async function updateAuditProgress(userId: string, id: number, pagesCrawled: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE audits SET pages_crawled = ? WHERE id = ? AND user_id = ?`, [pagesCrawled, id, userId]);
}

export async function finishAudit(
  userId: string,
  id: number,
  params: {
    health_score: number;
    errors: number;
    warnings: number;
    notices: number;
    status?: "completed" | "failed";
    comparison?: string | null;
    error?: string | null;
    pages_detail?: string | null;
    /** Audit Engine V2 版本号（写库，供历史解释） */
    engine_version?: string | null;
    rule_set_version?: string | null;
    /** Audit Dashboard V2 完整快照 JSON */
    dashboard_json?: string | null;
  }
): Promise<void> {
  const db = await getAdapter();
  // WHERE 含 status = 'running'：runAudit 收尾时 audit 必为 running（不受影响）；
  // reapStaleRunningAudit 回收时只覆盖仍 running 的行，已 completed 的不会被误改为 failed。
  await db.run(`
    UPDATE audits
    SET health_score = ?, errors = ?, warnings = ?, notices = ?, status = ?, finished_at = datetime('now'),
        comparison = COALESCE(?, comparison),
        error = COALESCE(?, error),
        pages_detail = COALESCE(?, pages_detail),
        engine_version = COALESCE(?, engine_version),
        rule_set_version = COALESCE(?, rule_set_version),
        dashboard_json = COALESCE(?, dashboard_json)
    WHERE id = ? AND user_id = ? AND status = 'running'
  `, [
    params.health_score,
    params.errors,
    params.warnings,
    params.notices,
    params.status ?? "completed",
    params.comparison ?? null,
    params.error ?? null,
    params.pages_detail ?? null,
    params.engine_version ?? null,
    params.rule_set_version ?? null,
    params.dashboard_json ?? null,
    id,
    userId
  ]);
}

export async function getAuditById(userId: string, id: number): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM audits WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

export async function getLatestAudit(userId: string, domain: string): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM audits WHERE domain = ? AND user_id = ? ORDER BY started_at DESC LIMIT 1
  `, [domain, userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

/**
 * 若最近一次审计仍为 running 且已超过阈值，标记为 failed。
 *
 * 背景：/api/audit/start 用 after() 异步执行 runAudit。runAudit 内部总会调用
 * finishAudit(completed|failed) 收尾，但当 Vercel 在响应后回收函数实例（如套餐
 * maxDuration 限制）时，after() 可能根本未执行，导致审计行永久停留在 running。
 * 这会让前端在重新进入 /app/audit 时一直显示“审计进行中”，且 start 的 running
 * 拦截（409）阻止用户重跑——表现为“审计结果跨页面丢失”。
 *
 * 阈值 15 分钟：quick 审计 3-5s、full 审计 <3min，前端轮询窗口 5min，15min 远超
 * 这些，不会误杀仍在真实运行的审计；即便误杀，后续 finishAudit 仍会覆盖。
 */
const STALE_RUNNING_MS = 15 * 60 * 1000;

export async function reapStaleRunningAudit(userId: string, domain: string): Promise<void> {
  const latest = await getLatestAudit(userId, domain);
  if (!latest || latest.status !== "running") return;
  const startedAt = new Date(
    latest.started_at.endsWith("Z") ? latest.started_at : latest.started_at + "Z"
  ).getTime();
  if (Number.isNaN(startedAt)) return;
  if (Date.now() - startedAt < STALE_RUNNING_MS) return;
  await finishAudit(userId, latest.id, {
    health_score: 0,
    errors: 0,
    warnings: 0,
    notices: 0,
    status: "failed",
    error: "审计超时未完成（后台任务可能被服务器回收，请重新运行）",
  });
}

/** 获取某域名在指定 auditId 之前最近一次审计 */
export async function getPreviousAudit(userId: string, domain: string, currentAuditId: number): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM audits WHERE domain = ? AND id < ? AND user_id = ? ORDER BY started_at DESC LIMIT 1
  `, [domain, currentAuditId, userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

export async function addAuditIssue(userId: string, params: {
  audit_id: number;
  type: string;
  severity: "error" | "warning" | "notice";
  url: string;
  detail: string;
  suggestion?: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO audit_issues (audit_id, type, severity, url, detail, suggestion, user_id)
    VALUES (@audit_id, @type, @severity, @url, @detail, @suggestion, @user_id)
  `, [{ ...params, suggestion: params.suggestion ?? null, user_id: userId }]);
}

export async function getAuditIssues(userId: string, auditId: number): Promise<AuditIssueRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM audit_issues WHERE audit_id = ? AND user_id = ? ORDER BY
      CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      type
  `, [auditId, userId]) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    audit_id: Number(r.audit_id),
    type: String(r.type),
    severity: String(r.severity) as AuditIssueRow["severity"],
    url: String(r.url),
    detail: String(r.detail),
    suggestion: r.suggestion ? String(r.suggestion) : null,
  }));
}

/** 获取某域名最近 N 次审计摘要（含 comparison JSON） */
export async function getAuditHistory(userId: string, domain: string, limit = 10): Promise<AuditRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM audits WHERE domain = ? AND status = 'completed' AND user_id = ?
    ORDER BY started_at DESC LIMIT ?
  `, [domain, userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToAudit);
}

/** 全局最近一次审计（不限域名） */
export async function getGlobalLatestAudit(userId: string): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM audits WHERE user_id = ? ORDER BY started_at DESC LIMIT 1
  `, [userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

/** 获取某时间点之后的审计记录 */
export async function getAuditsSince(userId: string, sinceISO: string): Promise<AuditRow[]> {
  const db = await getAdapter();
  const sinceDate = sinceISO.slice(0, 10);
  const rows = await db.query(`
    SELECT * FROM audits WHERE date(started_at) >= ? AND user_id = ? ORDER BY started_at ASC
  `, [sinceDate, userId]) as Record<string, unknown>[];
  return rows.map(rowToAudit);
}
