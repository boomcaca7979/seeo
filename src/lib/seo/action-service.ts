// ===== Action Service（P2 Execution & Closed-Loop） =====
//
//   Opportunity (approved)
//     ↓
//   本 Service（ensure action → preview → approve → complete/verify）
//     ↓
//   ExecutionAdapter（manual；未来 GitHub/CMS 插入此层，上层零改动）
//     ↓
//   seo_actions（审计日志：who/what/when/result）+ verification evidence
//
// 硬规则：
// - Approval 硬门槛：opportunity 必须已 approved；action 未 approved 不可执行/完成
// - 幂等：一 opportunity 一 action（UNIQUE）；重复 approve/complete 幂等处理
// - 不伪造：manual adapter 无真实旧内容 → 预览只有指令包；execute = 记录用户确认
// - 闭环：action completed → 触发 opportunity 的 verification（P1 verifyOpportunity）
// - 成本：验证经既有 service（缓存优先），MCP/API 不二次计费

import { createAction, getActionById as dbGetActionById, getActionByOpportunity, updateActionStatus, type ActionStatus, type SeoActionRow } from "@/lib/db/actions";
import { getOpportunityById, saveOpportunityVerification, type OpportunityStatus } from "@/lib/db/opportunities";
import { getExecutionAdapter, type ActionForExecution, type ExecutionPreview } from "./execution-adapter";
import { verifyOpportunity } from "./opportunity-service";
import type { PlanTier } from "@/lib/auth";

export class ActionError extends Error {
  code: "EXECUTION_NOT_APPROVED" | "EXECUTION_INVALID_STATE" | "EXECUTION_NOT_SUPPORTED" | "EXECUTION_CONFLICT" | "EXECUTION_ADAPTER_ERROR";
  constructor(code: ActionError["code"], message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

function parsePlan(row: SeoActionRow): { steps: string[]; actionType: string } {
  try {
    const plan = JSON.parse(row.plan_json) as { steps?: string[] };
    return { steps: Array.isArray(plan.steps) ? plan.steps : [], actionType: row.action_type };
  } catch {
    return { steps: [], actionType: row.action_type };
  }
}

/** 确保存在 action（幂等）：从 opportunity 的 action plan 创建；返回 action */
export async function ensureAction(userId: string, opportunityId: number): Promise<SeoActionRow> {
  const existing = await getActionByOpportunity(userId, opportunityId);
  if (existing) return existing;
  const opportunity = await getOpportunityById(userId, opportunityId);
  if (!opportunity) throw new ActionError("EXECUTION_NOT_SUPPORTED", "未找到该机会");
  if (opportunity.status === "dismissed" || opportunity.status === "completed") {
    throw new ActionError("EXECUTION_INVALID_STATE", `机会状态为 ${opportunity.status}，不可创建执行动作`);
  }
  let plan: { executionMode?: string; actionType?: string; steps?: string[] } = {};
  try { plan = JSON.parse(opportunity.action_plan_json ?? "{}") as typeof plan; } catch { /* 损坏按空 */ }
  const idempotencyKey = `${opportunity.project_id}|${opportunity.type}|${opportunity.target_value}`.toLowerCase();
  await createAction(userId, {
    opportunity_id: opportunityId,
    project_id: opportunity.project_id,
    action_type: plan.actionType ?? "content_update",
    execution_mode: plan.executionMode ?? "manual",
    plan: { steps: plan.steps ?? [], recommendation: opportunity.target_value },
    idempotency_key: idempotencyKey,
  });
  const created = await getActionByOpportunity(userId, opportunityId);
  if (!created) throw new ActionError("EXECUTION_NOT_SUPPORTED", "action 创建失败");
  return created;
}

function toExecutionAction(row: SeoActionRow, evidence: Array<{ source: string; ref: string; summary: string }>): ActionForExecution {
  const { steps } = parsePlan(row);
  return {
    actionId: row.id,
    opportunityId: row.opportunity_id,
    projectId: row.project_id,
    actionType: row.action_type,
    targetValue: row.idempotency_key.split("|").slice(1).join("|") || row.action_type,
    steps,
    evidence,
  };
}

/**
 * Preview（确定性）：生成结构化手动执行包并持久化到 preview_json。
 * 不伪造旧内容 diff——manual adapter 只输出指令包。
 */
export async function previewAction(userId: string, opportunityId: number): Promise<ExecutionPreview> {
  const row = await ensureAction(userId, opportunityId);
  const adapter = getExecutionAdapter(row.execution_mode);
  if (!adapter) throw new ActionError("EXECUTION_NOT_SUPPORTED", `执行模式 ${row.execution_mode} 没有可用 adapter`);
  const opportunity = await getOpportunityById(userId, opportunityId);
  let evidence: Array<{ source: string; ref: string; summary: string }> = [];
  try { evidence = JSON.parse(opportunity?.evidence_json ?? "[]") as typeof evidence; } catch { /* 损坏按空 */ }
  const preview = adapter.preview(toExecutionAction(row, evidence));
  await updateActionStatus(userId, row.id, {
    preview_json: JSON.stringify(preview),
    event: { event: "preview_generated", by: userId },
  });
  return preview;
}

/** Approve（硬门槛）：opportunity 必须已批准；记录 approved_at/by；重复 approve 幂等 */
export async function approveAction(userId: string, actionId: number): Promise<SeoActionRow> {
  const row = await getActionById(userId, actionId);
  if (row.status === "approved" || row.status === "executing" || row.status === "completed") {
    return row; // 幂等：重复 approve 不报错、不重写时间戳
  }
  if (row.status !== "planned") {
    throw new ActionError("EXECUTION_INVALID_STATE", `状态 ${row.status} 不可批准`);
  }
  const opportunity = await getOpportunityById(userId, row.opportunity_id);
  const opportunityStatus = opportunity?.status as OpportunityStatus | undefined;
  if (opportunityStatus !== "approved" && opportunityStatus !== "in_progress") {
    throw new ActionError("EXECUTION_NOT_APPROVED", `先在 Opportunity 层批准（当前 ${opportunityStatus ?? "unknown"}），再批准执行动作`);
  }
  await updateActionStatus(userId, row.id, {
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: userId,
    event: { event: "approved", by: userId },
  });
  const updated = await getActionById(userId, actionId);
  if (!updated) throw new ActionError("EXECUTION_INVALID_STATE", "action 消失");
  return updated;
}

/** 手动执行完成确认：仅 approved 可确认；幂等（重复确认直接返回既有结果） */
export async function completeActionManually(userId: string, plan: PlanTier, actionId: number): Promise<{ action: SeoActionRow; verification: Array<{ check: string; status: string; detail: string | null; checkedAt: string | null }> }> {
  const row = await getActionById(userId, actionId);
  if (row.status === "completed") {
    // 幂等：重复标记完成 → 返回既有状态 + 最近验证
    const opportunity = await getOpportunityById(userId, row.opportunity_id);
    const verification = parseVerification(opportunity?.verification_json ?? null);
    return { action: row, verification };
  }
  if (row.status !== "approved") {
    throw new ActionError("EXECUTION_NOT_APPROVED", `仅 approved 状态可标记执行完成（当前 ${row.status}）`);
  }
  const adapter = getExecutionAdapter(row.execution_mode);
  if (!adapter) throw new ActionError("EXECUTION_NOT_SUPPORTED", `执行模式 ${row.execution_mode} 没有可用 adapter`);
  const opportunity = await getOpportunityById(userId, row.opportunity_id);
  let evidence: Array<{ source: string; ref: string; summary: string }> = [];
  try { evidence = JSON.parse(opportunity?.evidence_json ?? "[]") as typeof evidence; } catch { /* 损坏按空 */ }

  await updateActionStatus(userId, row.id, { status: "executing", event: { event: "executing", by: userId } });
  const result = await adapter.execute({ ...toExecutionAction(row, evidence), approvedBy: row.approved_by ?? userId });
  if (result.status !== "completed") {
    await updateActionStatus(userId, row.id, {
      status: "failed", error_code: "EXECUTION_ADAPTER_ERROR", result_json: JSON.stringify(result),
      event: { event: "failed", by: userId, detail: result.detail },
    });
    throw new ActionError("EXECUTION_ADAPTER_ERROR", result.detail);
  }
  await updateActionStatus(userId, row.id, {
    status: "completed",
    result_json: JSON.stringify(result),
    executed_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    event: { event: "completed", by: userId, detail: "manual execution confirmed" },
  });

  // 闭环：action 完成 → opportunity 推进 + 触发验证
  if (opportunity && (opportunity.status === "approved" || opportunity.status === "in_progress")) {
    await updateActionStatus(userId, row.id, { event: { event: "verification_started", by: userId } });
    const { checks } = await verifyOpportunity(userId, plan, {
      projectId: row.project_id,
      type: opportunity.type,
      targetType: opportunity.target_type,
      targetValue: opportunity.target_value,
      signals: safeParse(opportunity.signals_json),
    });
    await saveOpportunityVerification(userId, opportunity.id, checks);
  }

  const updated = await getActionById(userId, actionId);
  if (!updated) throw new ActionError("EXECUTION_INVALID_STATE", "action 消失");
  const verification = parseVerification((await getOpportunityById(userId, row.opportunity_id))?.verification_json ?? null);
  return { action: updated, verification };
}

export async function cancelAction(userId: string, actionId: number): Promise<void> {
  const row = await getActionById(userId, actionId);
  if (row.status === "completed") {
    throw new ActionError("EXECUTION_CONFLICT", "已完成的 action 不可取消");
  }
  await updateActionStatus(userId, row.id, { status: "cancelled", event: { event: "cancelled", by: userId } });
}

async function getActionById(userId: string, actionId: number): Promise<SeoActionRow> {
  const row = await dbGetActionById(userId, actionId);
  if (!row) throw new ActionError("EXECUTION_NOT_SUPPORTED", "未找到该执行动作");
  return row;
}

function safeParse(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

interface VerificationCheckView { check: string; status: string; detail: string | null; checkedAt: string | null }

function parseVerification(raw: string | null): VerificationCheckView[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as VerificationCheckView[]; } catch { return []; }
}

// re-export 供 route 层读取
export { getActionByOpportunity };
export type { ActionStatus };
