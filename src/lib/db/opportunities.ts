// ===== SEO Opportunity 领域（P1） =====
// seo_opportunities：Opportunity Engine 的持久化层。
// 原则：只存 evidence references + normalized signals + decision，不复制 provider 原始数据
//（rank/GSC/SERP/竞品原始行仍在各自表中，opportunity 通过 evidence 引用）。
// fingerprint = sha256(project|type|target)：同一目标同一类型只保留一条（UNIQUE），
// dismissed/completed 的机会在扫描时被抑制，不会反复重建。

import { createHash } from "node:crypto";
import { getAdapter } from "./migrations";

export type OpportunityStatus = "new" | "reviewed" | "approved" | "in_progress" | "completed" | "dismissed";
export type OpportunityPriority = "P0" | "P1" | "P2";
export type OpportunityType =
  | "rank_improvement"
  | "competitor_gap"
  | "ctr"
  | "content_refresh"
  | "lost_recovery"
  | "ai_visibility"
  | "technical";

export interface OpportunityEvidence {
  source: string; // rank_history | competitor_ranks | gsc | audit_issues | ai_search_runs
  ref: string; // 指向源数据的引用（keyword/url/audit id 等）
  summary: string;
  capturedAt: string;
}

export interface OpportunityActionPlan {
  /** SeeO 无 CMS/GitHub/部署集成：V1 全部为 manual（诚实标记，不伪造执行） */
  executionMode: "manual";
  actionType: "content_update" | "meta_update" | "internal_link" | "technical_fix" | "refresh_page" | "create_content";
  steps: string[];
}

export interface OpportunityVerificationCheck {
  check: string; // rank | gsc | ai_search | technical
  status: "pass" | "pending" | "failed" | "stale";
  detail: string | null;
  checkedAt: string | null;
}

export interface SeoOpportunityRow {
  id: number;
  user_id: string;
  project_id: number;
  type: OpportunityType;
  target_type: string;
  target_value: string;
  fingerprint: string;
  priority: OpportunityPriority;
  impact: string | null;
  confidence: string | null;
  evidence_json: string;
  signals_json: string;
  action_plan_json: string | null;
  verification_json: string | null;
  status: OpportunityStatus;
  generated_at: string;
  last_evaluated_at: string;
}

/** fingerprint：project + type + target 唯一（dedup 的根基） */
export function buildOpportunityFingerprint(projectId: number, type: OpportunityType, targetValue: string): string {
  return createHash("sha256").update(`${projectId}|${type}|${targetValue.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

export interface UpsertOpportunityParams {
  user_id: string;
  project_id: number;
  type: OpportunityType;
  target_type: string;
  target_value: string;
  priority: OpportunityPriority;
  impact: string | null;
  confidence: string | null;
  evidence: OpportunityEvidence[];
  signals: Record<string, unknown>;
  actionPlan: OpportunityActionPlan | null;
}

/** 生成或刷新机会；返回 isNew。dismissed/completed 的既有机会被抑制（不重建、不复活） */
export async function upsertOpportunity(userId: string, params: UpsertOpportunityParams): Promise<{ isNew: boolean; suppressed: boolean }> {
  const db = await getAdapter();
  const fingerprint = buildOpportunityFingerprint(params.project_id, params.type, params.target_value);
  const existing = await db.get(
    `SELECT id, status FROM seo_opportunities WHERE project_id = ? AND fingerprint = ?`,
    [params.project_id, fingerprint]
  ) as { id: number; status: string } | undefined;

  if (existing && (existing.status === "dismissed" || existing.status === "completed")) {
    // 抑制：用户已 dismiss/completed 的机会不再重建
    await db.run(
      `UPDATE seo_opportunities SET last_evaluated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [existing.id, userId]
    );
    return { isNew: false, suppressed: true };
  }

  const evidenceJson = JSON.stringify(params.evidence);
  const signalsJson = JSON.stringify(params.signals);
  const actionPlanJson = params.actionPlan ? JSON.stringify(params.actionPlan) : null;

  if (existing) {
    await db.run(`
      UPDATE seo_opportunities SET
        priority = @priority, impact = @impact, confidence = @confidence,
        evidence_json = @evidence, signals_json = @signals,
        action_plan_json = COALESCE(@action_plan, action_plan_json),
        last_evaluated_at = datetime('now')
      WHERE id = @id AND user_id = @user_id
    `, [{
      id: existing.id, user_id: userId,
      priority: params.priority, impact: params.impact, confidence: params.confidence,
      evidence: evidenceJson, signals: signalsJson, action_plan: actionPlanJson,
    }]);
    return { isNew: false, suppressed: false };
  }

  await db.run(`
    INSERT INTO seo_opportunities (
      user_id, project_id, type, target_type, target_value, fingerprint,
      priority, impact, confidence, evidence_json, signals_json, action_plan_json,
      status, generated_at, last_evaluated_at
    ) VALUES (
      @user_id, @project_id, @type, @target_type, @target_value, @fingerprint,
      @priority, @impact, @confidence, @evidence, @signals, @action_plan,
      'new', datetime('now'), datetime('now')
    )
  `, [{
    user_id: userId, project_id: params.project_id,
    type: params.type, target_type: params.target_type, target_value: params.target_value,
    fingerprint, priority: params.priority, impact: params.impact, confidence: params.confidence,
    evidence: evidenceJson, signals: signalsJson, action_plan: actionPlanJson,
  }]);
  return { isNew: true, suppressed: false };
}

export async function getOpportunityById(userId: string, id: number): Promise<SeoOpportunityRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM seo_opportunities WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToOpportunity(row) : null;
}

export async function listOpportunities(userId: string, params: {
  project_id: number;
  status?: string;
  type?: string;
  limit?: number;
}): Promise<SeoOpportunityRow[]> {
  const db = await getAdapter();
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const conditions: string[] = [`user_id = @user_id`, `project_id = @project_id`];
  const values: Record<string, unknown> = { user_id: userId, project_id: params.project_id, limit };
  if (params.status) {
    conditions.push(`status = @status`);
    values.status = params.status;
  }
  if (params.type) {
    conditions.push(`type = @type`);
    values.type = params.type;
  }
  const rows = await db.query(`
    SELECT * FROM seo_opportunities
    WHERE ${conditions.join(" AND ")}
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END ASC,
      generated_at DESC
    LIMIT @limit
  `, [values]) as Record<string, unknown>[];
  return rows.map(rowToOpportunity);
}

/** 状态机：new → reviewed → approved → in_progress → completed；任意未完成状态可 dismissed */
const ALLOWED_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  new: ["reviewed", "dismissed"],
  reviewed: ["approved", "dismissed"],
  approved: ["in_progress", "dismissed"],
  in_progress: ["completed", "dismissed"],
  completed: [],
  dismissed: [],
};

export function canTransition(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function transitionOpportunity(userId: string, id: number, to: OpportunityStatus): Promise<{ ok: boolean; reason?: string }> {
  const existing = await getOpportunityById(userId, id);
  if (!existing) return { ok: false, reason: "not_found" };
  if (!canTransition(existing.status, to)) {
    return { ok: false, reason: `invalid_transition:${existing.status}->${to}` };
  }
  const db = await getAdapter();
  await db.run(
    `UPDATE seo_opportunities SET status = ?, last_evaluated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [to, id, userId]
  );
  return { ok: true };
}

export async function saveOpportunityVerification(userId: string, id: number, checks: OpportunityVerificationCheck[]): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE seo_opportunities SET verification_json = ?, last_evaluated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [JSON.stringify(checks), id, userId]
  );
}

export async function saveOpportunityActionPlan(userId: string, id: number, plan: OpportunityActionPlan): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE seo_opportunities SET action_plan_json = ?, last_evaluated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [JSON.stringify(plan), id, userId]
  );
}

function rowToOpportunity(row: Record<string, unknown>): SeoOpportunityRow {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    project_id: Number(row.project_id),
    type: String(row.type) as OpportunityType,
    target_type: String(row.target_type),
    target_value: String(row.target_value),
    fingerprint: String(row.fingerprint),
    priority: String(row.priority) as OpportunityPriority,
    impact: row.impact ? String(row.impact) : null,
    confidence: row.confidence ? String(row.confidence) : null,
    evidence_json: String(row.evidence_json ?? "[]"),
    signals_json: String(row.signals_json ?? "{}"),
    action_plan_json: row.action_plan_json ? String(row.action_plan_json) : null,
    verification_json: row.verification_json ? String(row.verification_json) : null,
    status: String(row.status) as OpportunityStatus,
    generated_at: String(row.generated_at),
    last_evaluated_at: String(row.last_evaluated_at),
  };
}
