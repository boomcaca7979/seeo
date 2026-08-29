// ===== /api/opportunities/status =====
// POST：机会生命周期流转（reviewed/approved/in_progress/completed/dismissed）
//   - body: { id, status }
//   - 状态机：new→reviewed→approved→in_progress→completed；未完成状态可 dismissed
//   - 非法流转返回 409

import { NextResponse } from "next/server";
import { canTransition, transitionOpportunity, type OpportunityStatus } from "@/lib/db/opportunities";
import { requireAuthOrDemo } from "@/lib/auth";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: OpportunityStatus[] = ["new", "reviewed", "approved", "in_progress", "completed", "dismissed"];

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
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
  const result = await transitionOpportunity(auth.user.id, id, to);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.reason === "not_found" ? "未找到该机会" : `非法状态流转（${result.reason?.replace("invalid_transition:", "")}）`, code: result.reason === "not_found" ? "OPPORTUNITY_NOT_FOUND" : "INVALID_TRANSITION" }, { status });
  }
  return NextResponse.json({ data: { id, status: to } });
}
