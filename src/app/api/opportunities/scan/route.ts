// ===== /api/opportunities/scan =====
// POST：运行 Opportunity Scanner（P1 OpportunityEngine.scanOpportunities）
//   - body: { project_id, include_ctr? }
//   - 扫描主体 DB-only；CTR 证据经 GSC（缓存优先、单次调用）；AI 只读最近 run
//   - dismissed/completed 机会被 fingerprint 抑制

import { NextResponse } from "next/server";
import { scanOpportunities } from "@/lib/seo/opportunity-service";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: "Opportunity 扫描需要登录 SeeO 账号", code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: { project_id?: string | number; include_ctr?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<SeoApiError>({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
  }
  const projectRef = String(body.project_id ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效", code: "INVALID_PROJECT_ID" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(userId, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }

  try {
    const result = await scanOpportunities(userId, auth.plan, projectId, {
      includeCtr: body.include_ctr !== false,
    });
    return NextResponse.json({ data: result });
  } catch (e) {
    const message = (e as Error).message;
    if (message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json<SeoApiError>({ error: `服务器内部错误：${message}`, code: "UPSTREAM_ERROR" }, { status: 500 });
  }
}
