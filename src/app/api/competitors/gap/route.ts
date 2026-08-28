// ===== /api/competitors/gap =====
// GET：Competitor Keyword Gap（P0-02-C CompetitorService.getCompetitorKeywordGap）
//   - query: project_id, competitor_id, limit(1-200,默认50), refresh(默认false), enrich(默认true)
//   - universe：项目 tracked keywords + competitor_ranks 最新排名 + rank_history
//   - metrics：P0-02-A enrichKeywordMetrics（kw-metrics 缓存 + dataforseo 配额）
//   - 授权：project 归属校验 + competitor 必须属于该项目

import { NextResponse } from "next/server";
import {
  getProjectById,
  getCompetitorById,
  listTrackedKeywords,
} from "@/lib/db";
import { getCompetitorKeywordGap } from "@/lib/seo/competitor-service";
import { peekUsage, QuotaExceededError } from "@/lib/seo/cache";
import { SeoProviderError } from "@/lib/seo/provider";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapError(e: unknown) {
  if (e instanceof SeoProviderError) {
    const status =
      e.code === "INVALID_KEY" ? 401 :
      e.code === "QUOTA_EXCEEDED" ? 429 :
      e.code === "TIMEOUT" ? 504 :
      e.code === "BAD_REQUEST" ? 400 : 502;
    return NextResponse.json<SeoApiError>({ error: e.message, code: e.code }, { status });
  }
  if (e instanceof QuotaExceededError) {
    return NextResponse.json<SeoApiError>({ error: e.message, code: "QUOTA_EXCEEDED" }, { status: 429 });
  }
  return NextResponse.json<SeoApiError>(
    { error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" },
    { status: 500 }
  );
}

function parseBool(value: string | null): boolean {
  return value === "true" || value === "1";
}

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

  const competitorId = Number(searchParams.get("competitor_id") ?? "");
  if (!Number.isInteger(competitorId) || competitorId <= 0) {
    return NextResponse.json<SeoApiError>({ error: "competitor_id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  // competitor 必须真实存在且属于该项目（禁止跨项目访问 competitor 数据）
  const competitor = await getCompetitorById(userId, competitorId);
  if (!competitor || competitor.project_id !== projectId) {
    return NextResponse.json({ error: "未找到该竞品", code: "COMPETITOR_NOT_FOUND" }, { status: 404 });
  }

  const limit = Number(searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return NextResponse.json<SeoApiError>({ error: "limit 必须是 1-200", code: "BAD_REQUEST" }, { status: 400 });
  }
  const refresh = parseBool(searchParams.get("refresh"));
  // enrich 默认 true；仅显式 enrich=false/0 时关闭 metrics 补全
  const enrichParam = (searchParams.get("enrich") ?? "").trim();
  const enrichMetrics = !(enrichParam === "false" || enrichParam === "0");

  try {
    // 关键词 universe：项目 tracked keywords（与 tracked domain 一致，同 SOV 口径）
    const allTracked = await listTrackedKeywords(userId);
    const tracked = allTracked
      .filter((k) => k.domain === project.domain)
      .map((k) => ({
        id: k.id,
        keyword: k.keyword,
        location: k.location,
        device: k.device,
        todayPosition: k.todayPosition,
        todayUrl: k.matchedUrl ?? null,
      }));

    const result = await getCompetitorKeywordGap({
      userId,
      plan,
      projectDomain: project.domain,
      trackedKeywords: tracked,
      competitorId,
      competitorDomain: competitor.domain,
      limit,
      refresh,
      enrichMetrics,
    });

    return NextResponse.json({
      data: result,
      usage: {
        serpapi: await peekUsage(userId, "serpapi", plan),
        dataforseo: await peekUsage(userId, "dataforseo", plan),
      },
    });
  } catch (e) {
    return mapError(e);
  }
}
