// ===== /api/actions =====
// GET :?action_id= 详情（含 preview/events）或 ?opportunity_id= 按机会读取（ensure 幂等创建）
// POST：对机会的动作 { opportunity_id, operation: "preview" | "approve" | "complete" | "cancel" }
// 授权：user → opportunity（user_id）→ project 一致性由 opportunity 行保证

import { NextResponse } from "next/server";
import { getActionByOpportunity } from "@/lib/db/actions";
import { getOpportunityById } from "@/lib/db/opportunities";
import {
  approveAction,
  cancelAction,
  completeActionManually,
  ensureAction,
  executeActionViaGitHub,
  previewAction,
  refreshGitHubStatus,
  ActionError,
} from "@/lib/seo/action-service";
import { getActionById as dbGetActionById } from "@/lib/db/actions";
import { requireAuthOrDemo } from "@/lib/auth";
import { GitHubExecutionError } from "@/lib/seo/github-execution-adapter";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function mapActionError(e: unknown) {
  if (e instanceof ActionError) {
    const status = e.code === "EXECUTION_NOT_APPROVED" || e.code === "EXECUTION_INVALID_STATE" || e.code === "EXECUTION_CONFLICT" ? 409 : 400;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  if (e instanceof GitHubExecutionError) {
    const status = e.code === "EXECUTION_CONFLICT" ? 409
      : e.code === "GITHUB_RATE_LIMITED" ? 429
      : e.code === "GITHUB_PERMISSION_DENIED" ? 403
      : e.code === "GITHUB_NOT_CONNECTED" ? 409
      : 400;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  return NextResponse.json<SeoApiError>({ error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" }, { status: 500 });
}

function serialize(row: NonNullable<Awaited<ReturnType<typeof getActionByOpportunity>>>) {
  const parse = (<T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  });
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    projectId: row.project_id,
    actionType: row.action_type,
    executionMode: row.execution_mode,
    status: row.status,
    plan: parse<{ steps?: string[]; recommendation?: string; filePath?: string; newContent?: string }>(row.plan_json, {}),
    preview: parse<{ kind: string; currentState: string[]; exactSteps: string[]; expectedResult: string; verificationPlan: string[]; rollbackNotes: string } | null>(row.preview_json, null),
    result: parse<Record<string, unknown> | null>(row.result_json, null),
    events: parse<Array<{ event: string; by: string; at: string; detail?: string }>>(row.events_json, []),
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    executedAt: row.executed_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    idempotencyKey: row.idempotency_key,
  };
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const opportunityId = Number(searchParams.get("opportunity_id") ?? "");
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    return NextResponse.json<SeoApiError>({ error: "opportunity_id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const row = await getActionByOpportunity(userId, opportunityId);
  if (!row) return NextResponse.json({ data: { action: null } });
  return NextResponse.json({ data: { action: serialize(row) } });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: {
    opportunity_id?: number;
    operation?: string;
    file_path?: string;
    new_content?: string;
    commit_description?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<SeoApiError>({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
  }
  const opportunityId = Number(body.opportunity_id);
  const operation = body.operation ?? "preview";
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    return NextResponse.json<SeoApiError>({ error: "opportunity_id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  // 授权：opportunity 必须属于当前用户
  const opportunity = await getOpportunityById(userId, opportunityId);
  if (!opportunity) {
    return NextResponse.json({ error: "未找到该机会", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });
  }

  try {
    switch (operation) {
      case "preview": {
        // 显式 file_path/new_content → 真实 GitHub preview（读取仓库当前内容生成 before/after）
        const spec = body.file_path && body.new_content
          ? {
              filePath: body.file_path,
              newContent: body.new_content,
              ...(body.commit_description ? { commitDescription: body.commit_description } : {}),
            }
          : undefined;
        const preview = await previewAction(userId, opportunityId, spec);
        const row = await getActionByOpportunity(userId, opportunityId);
        return NextResponse.json({ data: { preview, action: row ? serialize(row) : null } });
      }
      case "approve": {
        await ensureAction(userId, opportunityId);
        const row = await getActionByOpportunity(userId, opportunityId);
        if (!row) throw new ActionError("EXECUTION_NOT_SUPPORTED", "action 创建失败");
        const approved = await approveAction(userId, row.id);
        return NextResponse.json({ data: { action: serialize(approved) } });
      }
      case "complete": {
        await ensureAction(userId, opportunityId);
        const row = await getActionByOpportunity(userId, opportunityId);
        if (!row) throw new ActionError("EXECUTION_NOT_SUPPORTED", "action 创建失败");
        const { action, verification } = await completeActionManually(userId, auth.plan, row.id);
        return NextResponse.json({ data: { action: serialize(action), verification } });
      }
      case "execute": {
        // P3：GitHub PR 执行。硬门槛：action approved（内部再校验）；spec 必须显式提供
        if (!body.file_path || !body.new_content) {
          return NextResponse.json({ error: "GitHub 执行需要 file_path 与 new_content", code: "EXECUTION_TARGET_NOT_FOUND" }, { status: 400 });
        }
        await ensureAction(userId, opportunityId);
        const row = await getActionByOpportunity(userId, opportunityId);
        if (!row) throw new ActionError("EXECUTION_NOT_SUPPORTED", "action 创建失败");
        const actionRow = await dbGetActionById(userId, row.id);
        if (!actionRow) throw new ActionError("EXECUTION_NOT_SUPPORTED", "action 创建失败");
        const execution = await executeActionViaGitHub(userId, auth.plan, actionRow.id, {
          filePath: body.file_path,
          newContent: body.new_content,
          ...(body.commit_description ? { commitDescription: body.commit_description } : {}),
        });
        const updated = await getActionByOpportunity(userId, opportunityId);
        return NextResponse.json({ data: { execution, action: updated ? serialize(updated) : null } });
      }
      case "status": {
        await ensureAction(userId, opportunityId);
        const row = await getActionByOpportunity(userId, opportunityId);
        if (!row) throw new ActionError("EXECUTION_NOT_SUPPORTED", "action 创建失败");
        const status = await refreshGitHubStatus(userId, auth.plan, row.id);
        const updated = await getActionByOpportunity(userId, opportunityId);
        return NextResponse.json({ data: { status, action: updated ? serialize(updated) : null } });
      }
      case "cancel": {
        await ensureAction(userId, opportunityId);
        const row = await getActionByOpportunity(userId, opportunityId);
        if (!row) throw new ActionError("EXECUTION_NOT_SUPPORTED", "action 创建失败");
        await cancelAction(userId, row.id);
        const updated = await getActionByOpportunity(userId, opportunityId);
        return NextResponse.json({ data: { action: updated ? serialize(updated) : null } });
      }
      default:
        return NextResponse.json<SeoApiError>({ error: "operation 必须是 preview/approve/complete/cancel", code: "BAD_REQUEST" }, { status: 400 });
    }
  } catch (e) {
    return mapActionError(e);
  }
}
