// ===== /api/opportunities/verify =====
// POST：机会验证（rank 即时复检 = 真实 provider 调用消耗 serpapi 配额；GSC/AI 因数据滞后 → PENDING）
//   - body: { id }
//   - 仅 approved / in_progress 状态可验证（未批准不产生验证成本）
//   - rank 复检：searchRank（Top-100，缓存优先），不伪造"立即见效"

import { NextResponse } from "next/server";
import { getOpportunityById, saveOpportunityVerification, type OpportunityStatus } from "@/lib/db/opportunities";
import { verifyOpportunity } from "@/lib/seo/opportunity-service";
import { QuotaExceededError } from "@/lib/seo/cache";
import { requireAuthOrDemo } from "@/lib/auth";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VERIFIABLE: OpportunityStatus[] = ["approved", "in_progress"];

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<SeoApiError>({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json<SeoApiError>({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const row = await getOpportunityById(userId, id);
  if (!row) {
    return NextResponse.json({ error: "未找到该机会", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });
  }
  if (!VERIFIABLE.includes(row.status)) {
    return NextResponse.json({ error: `仅 approved/in_progress 状态可验证（当前 ${row.status}）`, code: "INVALID_TRANSITION" }, { status: 409 });
  }

  let signals: Record<string, unknown> = {};
  try {
    signals = JSON.parse(row.signals_json) as Record<string, unknown>;
  } catch { /* 损坏数据按空处理 */ }

  try {
    const { checks } = await verifyOpportunity(userId, auth.plan, {
      projectId: row.project_id,
      type: row.type,
      targetType: row.target_type,
      targetValue: row.target_value,
      signals,
    });
    await saveOpportunityVerification(userId, id, checks);
    return NextResponse.json({ data: { id, verification: checks } });
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json({ error: e.message, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }
    return NextResponse.json<SeoApiError>({ error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" }, { status: 500 });
  }
}
