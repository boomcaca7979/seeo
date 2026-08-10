// ===== 报告领域：reports + 报告导出查询 + alerts =====

import { getAdapter } from "./migrations";

// ---------- 报告导出查询 ----------

/** 获取所有追踪关键词 + 最近 N 天 rank_history（按日期升序） */
export interface KeywordReportRow {
  id: number;
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
  history: { date: string; position: number | null; url: string | null }[];
}

export async function listTrackedKeywordsWithHistory(userId: string, days = 30): Promise<KeywordReportRow[]> {
  const db = await getAdapter();
  const keywords = await db.query(`
    SELECT id, keyword, location, device, domain
    FROM tracked_keywords
    WHERE user_id = ?
    ORDER BY created_at ASC
  `, [userId]) as Record<string, unknown>[];

  const rows: KeywordReportRow[] = keywords.map((k) => ({
    id: Number(k.id),
    keyword: String(k.keyword),
    location: String(k.location),
    device: String(k.device) as "PC" | "移动端",
    domain: String(k.domain),
    history: [],
  }));

  if (rows.length === 0) return rows;

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const histRows = await db.query(`
    SELECT keyword_id, date, position, url
    FROM rank_history
    WHERE keyword_id IN (${placeholders}) AND user_id = ?
    AND date >= date('now', 'localtime', ?)
    ORDER BY keyword_id ASC, date ASC
  `, [...ids, userId, `-${days} day`]) as Record<string, unknown>[];

  const histMap = new Map<number, KeywordReportRow["history"]>();
  for (const h of histRows) {
    const kid = Number(h.keyword_id);
    const arr = histMap.get(kid) ?? [];
    arr.push({
      date: String(h.date),
      position: h.position === null ? null : Number(h.position),
      url: h.url ? String(h.url) : null,
    });
    histMap.set(kid, arr);
  }

  for (const r of rows) {
    r.history = histMap.get(r.id) ?? [];
  }
  return rows;
}

// ---------- reports ----------

export type ReportType = "ranking" | "audit" | "content" | "weekly";

export interface ReportRow {
  id: number;
  project_id: number | null;
  type: ReportType;
  title: string;
  data_json: string;
  pdf_path: string | null;
  created_at: string;
}

function rowToReport(row: Record<string, unknown>): ReportRow {
  return {
    id: Number(row.id),
    project_id: row.project_id !== null && row.project_id !== undefined ? Number(row.project_id) : null,
    type: String(row.type) as ReportType,
    title: String(row.title),
    data_json: String(row.data_json),
    pdf_path: row.pdf_path ? String(row.pdf_path) : null,
    created_at: String(row.created_at),
  };
}

export async function createReport(
  userId: string,
  projectId: number | null,
  type: ReportType,
  title: string,
  dataJson: string
): Promise<number> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO reports (project_id, type, title, data_json, user_id)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, type, title, dataJson, userId]);
  return Number(info.lastInsertRowid);
}

export async function listReports(userId: string, projectId?: number): Promise<ReportRow[]> {
  const db = await getAdapter();
  const rows = projectId !== undefined
    ? await db.query(`SELECT * FROM reports WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC`, [projectId, userId]) as Record<string, unknown>[]
    : await db.query(`SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC`, [userId]) as Record<string, unknown>[];
  return rows.map(rowToReport);
}

export async function getReport(userId: string, id: number): Promise<ReportRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM reports WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToReport(row) : null;
}

export async function deleteReport(userId: string, id: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`DELETE FROM reports WHERE id = ? AND user_id = ?`, [id, userId]);
}

// ---------- alerts ----------

export type AlertType = "rank_drop" | "rank_up" | "new_error" | "audit_done";
export type AlertLevel = "error" | "warning" | "info";

export interface AlertRow {
  id: number;
  type: AlertType;
  level: AlertLevel;
  title: string;
  detail: string | null;
  domain: string | null;
  created_at: string;
  read: 0 | 1;
}

function rowToAlert(row: Record<string, unknown>): AlertRow {
  return {
    id: Number(row.id),
    type: String(row.type) as AlertType,
    level: String(row.level) as AlertLevel,
    title: String(row.title),
    detail: row.detail ? String(row.detail) : null,
    domain: row.domain ? String(row.domain) : null,
    created_at: String(row.created_at),
    read: Number(row.read) as 0 | 1,
  };
}

export async function createAlert(userId: string, params: {
  type: AlertType;
  level: AlertLevel;
  title: string;
  detail?: string | null;
  domain?: string | null;
}): Promise<AlertRow> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO alerts (type, level, title, detail, domain, user_id)
    VALUES (@type, @level, @title, @detail, @domain, @user_id)
  `, [{
    type: params.type,
    level: params.level,
    title: params.title,
    detail: params.detail ?? null,
    domain: params.domain ?? null,
    user_id: userId,
  }]);
  const row = await db.get(`SELECT * FROM alerts WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToAlert(row);
}

export async function listAlerts(userId: string, limit = 50): Promise<AlertRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `, [userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToAlert);
}

export async function markAlertRead(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`UPDATE alerts SET read = 1 WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function markAllAlertsRead(userId: string): Promise<number> {
  const db = await getAdapter();
  const info = await db.run(`UPDATE alerts SET read = 1 WHERE read = 0 AND user_id = ?`, [userId]);
  return info.changes;
}

export async function countUnreadAlerts(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM alerts WHERE read = 0 AND user_id = ?`, [userId]) as { c: number };
  return row.c;
}

export async function countUnreadAlertsByDomain(userId: string, domain: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM alerts WHERE read = 0 AND domain = ? AND user_id = ?`, [domain, userId]) as { c: number };
  return row.c;
}

/** 兜底去重：同 domain + 同 title + 同日期（localtime）是否已存在预警 */
export async function hasAlertToday(userId: string, domain: string, title: string): Promise<boolean> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT 1 FROM alerts
    WHERE domain = ? AND title = ? AND date(created_at) = date('now', 'localtime') AND user_id = ?
    LIMIT 1
  `, [domain, title, userId]) as { 1: number } | undefined;
  return !!row;
}
