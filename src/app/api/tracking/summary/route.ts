// ===== /api/tracking/summary =====
// GET：项目级排名分布与 visibility 原始统计（P0-02-D RankTrackingService.getProjectRankSummary）
//   - query: project_id, days (1-365, 默认 30)
//   - top3/10/20/50/notRanking 计数 + averageRank/medianRank + 每词 status
//   - 纯 DB 聚合，零 provider 成本；项目归属校验同 competitors 路由

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import { getProjectRankSummary } from "@/lib/seo/rank-tracking-service";
import { peekUsage } from "@/lib/seo/cache";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const { searchParams } = new URL(req.url);
  const projectRef = (searchParams.get("project_id") ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效", code: "INVALID_PROJECT_ID" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(userId, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const project = await getProjectById(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const days = Number(searchParams.get("days") ?? "30");
  if (!Number.isInteger(days) || days <= 0 || days > 365) {
    return NextResponse.json<SeoApiError>({ error: "days 参数无效（1-365）", code: "BAD_REQUEST" }, { status: 400 });
  }

  const summary = await getProjectRankSummary(userId, project.domain, days);
  const usage = await peekUsage(userId, "serpapi", plan);
  return NextResponse.json({ data: summary, usage });
}
