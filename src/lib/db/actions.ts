// ===== SEO Action 领域（P2 Execution & Closed-Loop） =====
// seo_actions：已批准 opportunity 的执行记录。
// 一个 opportunity 一条 action（UNIQUE，天然幂等键的宿主）；execution_mode 由
// adapter 注册表决定（当前只有 manual——SeeO 无 CMS/GitHub/部署集成，诚实标记）。
// events_json 记录 who/what/when/result 的审计日志；不存 provider secret / 网站全文。

import { getAdapter } from "./migrations";

export type ActionStatus = "planned" | "approved" | "executing" | "completed" | "failed" | "cancelled";

export interface SeoActionRow {
  id: number;
  user_id: string;
  opportunity_id: number;
  project_id: number;
  action_type: string;
  execution_mode: string;
  status: ActionStatus;
  plan_json: string;
  preview_json: string | null;
  result_json: string | null;
  events_json: string;
  approved_at: string | null;
  approved_by: string | null;
  executed_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export async function getActionById(userId: string, id: number): Promise<SeoActionRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM seo_actions WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToAction(row) : null;
}

export async function getActionByOpportunity(userId: string, opportunityId: number): Promise<SeoActionRow | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT * FROM seo_actions WHERE opportunity_id = ? AND user_id = ?`,
    [opportunityId, userId]
  ) as Record<string, unknown> | undefined;
  return row ? rowToAction(row) : null;
}

export async function createAction(userId: string, params: {
  opportunity_id: number;
  project_id: number;
  action_type: string;
  execution_mode: string;
  plan: Record<string, unknown>;
  idempotency_key: string;
}): Promise<number> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO seo_actions (
      user_id, opportunity_id, project_id, action_type, execution_mode,
      status, plan_json, events_json, idempotency_key
    ) VALUES (
      @user_id, @opportunity_id, @project_id, @action_type, @execution_mode,
      'planned', @plan_json, @events_json, @idempotency_key
    )
  `, [{
    user_id: userId,
    opportunity_id: params.opportunity_id,
    project_id: params.project_id,
    action_type: params.action_type,
    execution_mode: params.execution_mode,
    plan_json: JSON.stringify(params.plan),
    events_json: JSON.stringify([{ event: "created", by: userId, at: new Date().toISOString() }]),
    idempotency_key: params.idempotency_key,
  }]);
  const row = await db.get(
    `SELECT id FROM seo_actions WHERE opportunity_id = ? AND user_id = ?`,
    [params.opportunity_id, userId]
  ) as { id: number } | undefined;
  return row ? Number(row.id) : 0;
}

export async function updateActionStatus(userId: string, id: number, updates: {
  status?: ActionStatus;
  preview_json?: string;
  result_json?: string;
  error_code?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  executed_at?: string | null;
  completed_at?: string | null;
  event: { event: string; by: string; detail?: string };
}): Promise<void> {
  const db = await getAdapter();
  const existing = await db.get(`SELECT events_json FROM seo_actions WHERE id = ? AND user_id = ?`, [id, userId]) as { events_json: string } | undefined;
  let events: unknown[] = [];
  try { events = JSON.parse(existing?.events_json ?? "[]") as unknown[]; } catch { /* 损坏按空 */ }
  events.push({ ...updates.event, at: new Date().toISOString() });

  await db.run(`
    UPDATE seo_actions SET
      status = COALESCE(@status, status),
      preview_json = COALESCE(@preview_json, preview_json),
      result_json = COALESCE(@result_json, result_json),
      error_code = COALESCE(@error_code, error_code),
      approved_at = COALESCE(@approved_at, approved_at),
      approved_by = COALESCE(@approved_by, approved_by),
      executed_at = COALESCE(@executed_at, executed_at),
      completed_at = COALESCE(@completed_at, completed_at),
      events_json = @events_json,
      updated_at = datetime('now')
    WHERE id = @id AND user_id = @user_id
  `, [{
    id, user_id: userId,
    status: updates.status ?? null,
    preview_json: updates.preview_json ?? null,
    result_json: updates.result_json ?? null,
    error_code: updates.error_code ?? null,
    approved_at: updates.approved_at ?? null,
    approved_by: updates.approved_by ?? null,
    executed_at: updates.executed_at ?? null,
    completed_at: updates.completed_at ?? null,
    events_json: JSON.stringify(events),
  }]);
}

function rowToAction(row: Record<string, unknown>): SeoActionRow {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    opportunity_id: Number(row.opportunity_id),
    project_id: Number(row.project_id),
    action_type: String(row.action_type),
    execution_mode: String(row.execution_mode),
    status: String(row.status) as ActionStatus,
    plan_json: String(row.plan_json ?? "{}"),
    preview_json: row.preview_json ? String(row.preview_json) : null,
    result_json: row.result_json ? String(row.result_json) : null,
    events_json: String(row.events_json ?? "[]"),
    approved_at: row.approved_at ? String(row.approved_at) : null,
    approved_by: row.approved_by ? String(row.approved_by) : null,
    executed_at: row.executed_at ? String(row.executed_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    error_code: row.error_code ? String(row.error_code) : null,
    idempotency_key: String(row.idempotency_key),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
