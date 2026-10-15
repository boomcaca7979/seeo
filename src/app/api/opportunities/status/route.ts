// ===== /api/opportunities/status =====
// POST：机会生命周期流转（reviewed/approved/in_progress/completed/dismissed）
//   - body: { id, status }
//   - 状态机：new→reviewed→approved→in_progress→completed；未完成状态可 dismissed
//   - 非法流转返回 409

import { NextResponse } from "next/server";
import { canTransition, transitionOpportunity, getOpportunityById, type OpportunityStatus } from "@/lib/db/opportunities";
import { getProjectById } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";
import { captureOpportunityBaseline } from "@/lib/seo/task-observations";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: OpportunityStatus[] = ["new", "reviewed", "approved", "in_progress", "completed", "dismissed"];

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: { id?: number; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<SeoApiError>({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
  }
  const id = Number(body.id);
  const to = body.status as OpportunityStatus;
  if (!Number.isInteger(id) || id <= 0 || !VALID_STATUSES.includes(to)) {
    return NextResponse.json<SeoApiError>({ error: "id/status 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  // 预校验给出清晰错误；transition 内部再原子校验
  void canTransition;
  const result = await transitionOpportunity(userId, id, to);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.reason === "not_found" ? "未找到该机会" : `非法状态流转（${result.reason?.replace("invalid_transition:", "")}）`, code: result.reason === "not_found" ? "OPPORTUNITY_NOT_FOUND" : "INVALID_TRANSITION" }, { status });
  }

  // 反馈闭环：用户开始执行/声称完成时，捕获执行前真实基线（幂等，不覆盖已有基线）。
  // 仅在该机会的目标关键词确实被追踪且已有排名历史时才会成功 —— 否则不伪造基线。
  // 捕获失败绝不影响状态流转结果（状态机仍是唯一权威）。
  if (to === "in_progress" || to === "completed") {
    try {
      const opp = await getOpportunityById(userId, id);
      if (opp) {
        const project = await getProjectById(userId, opp.project_id);
        if (project?.domain) {
          await captureOpportunityBaseline(userId, project.domain, id);
        }
      }
    } catch {
      // 静默：无追踪数据时不捕获基线
    }
  }

  return NextResponse.json({ data: { id, status: to } });
}