// ===== 用户领域：用户枚举 + 自动化设置与日志 =====

import { getAdapter } from "./migrations";

/**
 * 查询所有 distinct user_id（cron 遍历用户用）。
 * 演示模式下返回 ['demo-user']；鉴权模式下返回所有真实用户 ID（含 demo-user）。
 * 从有数据的表 union 取，确保至少有数据的用户被处理。
 */
export async function listDistinctUserIds(): Promise<string[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT DISTINCT user_id FROM (
      SELECT DISTINCT user_id FROM tracked_keywords
      UNION
      SELECT DISTINCT user_id FROM projects
      UNION
      SELECT DISTINCT user_id FROM automation_settings
      UNION
      SELECT DISTINCT user_id FROM audits
    )
    WHERE user_id IS NOT NULL AND user_id != ''
  `) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

// ---------- automation ----------

export interface AutomationSettings {
  id: number;
  daily_refresh_enabled: number;
  daily_refresh_time: string;
  weekly_report_enabled: number;
  weekly_report_day: number;
  weekly_report_time: string;
  updated_at: string;
}

export interface AutomationLog {
  id: number;
  type: "daily_refresh" | "weekly_report";
  status: "success" | "failed" | "running";
  summary: string | null;
  details: string | null;
  created_at: string;
}

function rowToAutomationSettings(row: Record<string, unknown>): AutomationSettings {
  return {
    id: Number(row.id),
    daily_refresh_enabled: Number(row.daily_refresh_enabled),
    daily_refresh_time: String(row.daily_refresh_time),
    weekly_report_enabled: Number(row.weekly_report_enabled),
    weekly_report_day: Number(row.weekly_report_day),
    weekly_report_time: String(row.weekly_report_time),
    updated_at: String(row.updated_at),
  };
}

function rowToAutomationLog(row: Record<string, unknown>): AutomationLog {
  return {
    id: Number(row.id),
    type: String(row.type) as AutomationLog["type"],
    status: String(row.status) as AutomationLog["status"],
    summary: row.summary ? String(row.summary) : null,
    details: row.details ? String(row.details) : null,
    created_at: String(row.created_at),
  };
}

export async function getAutomationSettings(userId: string): Promise<AutomationSettings | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM automation_settings WHERE user_id = ?`, [userId]) as Record<string, unknown> | undefined;
  return row ? rowToAutomationSettings(row) : null;
}

export async function updateAutomationSettings(userId: string, settings: Partial<Omit<AutomationSettings, "id" | "updated_at">>): Promise<void> {
  const db = await getAdapter();
  const current = await getAutomationSettings(userId);
  const merged = {
    daily_refresh_enabled: settings.daily_refresh_enabled ?? current?.daily_refresh_enabled ?? 0,
    daily_refresh_time: settings.daily_refresh_time ?? current?.daily_refresh_time ?? "09:00",
    weekly_report_enabled: settings.weekly_report_enabled ?? current?.weekly_report_enabled ?? 0,
    weekly_report_day: settings.weekly_report_day ?? current?.weekly_report_day ?? 1,
    weekly_report_time: settings.weekly_report_time ?? current?.weekly_report_time ?? "09:00",
  };
  if (!current) {
    // 不存在则插入新行（user_id 唯一）
    await db.run(`
      INSERT INTO automation_settings (daily_refresh_enabled, daily_refresh_time, weekly_report_enabled, weekly_report_day, weekly_report_time, updated_at, user_id)
      VALUES (@daily_refresh_enabled, @daily_refresh_time, @weekly_report_enabled, @weekly_report_day, @weekly_report_time, datetime('now', 'localtime'), @user_id)
    `, [{ ...merged, user_id: userId }]);
  } else {
    await db.run(`
      UPDATE automation_settings
      SET daily_refresh_enabled = @daily_refresh_enabled,
          daily_refresh_time = @daily_refresh_time,
          weekly_report_enabled = @weekly_report_enabled,
          weekly_report_day = @weekly_report_day,
          weekly_report_time = @weekly_report_time,
          updated_at = datetime('now', 'localtime')
      WHERE user_id = @user_id
    `, [{ ...merged, user_id: userId }]);
  }
}

export async function listAutomationLogs(userId: string, limit = 50): Promise<AutomationLog[]> {
  const db = await getAdapter();
  const rows = await db.query(`SELECT * FROM automation_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToAutomationLog);
}

export async function addAutomationLog(userId: string, log: Omit<AutomationLog, "id" | "created_at">): Promise<number> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO automation_logs (type, status, summary, details, user_id)
    VALUES (@type, @status, @summary, @details, @user_id)
  `, [{ ...log, user_id: userId }]);
  return Number(info.lastInsertRowid);
}

export async function updateAutomationLog(userId: string, id: number, status: AutomationLog["status"], summary: string | null, details: string | null): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE automation_logs SET status = ?, summary = ?, details = ? WHERE id = ? AND user_id = ?`, [status, summary, details, id, userId]);
}
