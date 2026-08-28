// ===== /api/competitors/discover =====
// GET：SERP-based 竞争者发现（P0-02-C CompetitorService.discoverCompetitorsFromSerp）
//   - query: project_id, limit(1-50,默认10), min_appearances(1-10,默认2), include_platforms(默认false)
//            location(默认中国), device(PC/移动端), language(可选)
//   - 数据源：项目 tracked keywords 逐个 searchSerp（serp 命名空间共享缓存；miss 时消耗 serpapi 配额）

import { NextResponse } from "next/server";
import {
  getProjectById,
  listTrackedKeywords,
} from "@/lib/db";
import { discoverCompetitorsFromSerp } from "@/lib/seo/competitor-service";
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

  const location = (searchParams.get("location") ?? "中国").trim();
  const deviceRaw = (searchParams.get("device") ?? "PC").trim();
  if (deviceRaw !== "PC" && deviceRaw !== "移动端") {
    return NextResponse.json<SeoApiError>({ error: "device 必须是 PC 或 移动端", code: "BAD_REQUEST" }, { status: 400 });
  }
  const language = (searchParams.get("language") ?? "").trim() || undefined;
  const limit = Number(searchParams.get("limit") ?? "10");
  const minAppearances = Number(searchParams.get("min_appearances") ?? "2");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json<SeoApiError>({ error: "limit 必须是 1-50", code: "BAD_REQUEST" }, { status: 400 });
  }
  if (!Number.isInteger(minAppearances) || minAppearances < 1 || minAppearances > 10) {
    return NextResponse.json<SeoApiError>({ error: "min_appearances 必须是 1-10", code: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    // 关键词 universe：项目 tracked keywords（与 tracked domain 一致，同 SOV 口径）
    const allTracked = await listTrackedKeywords(userId);
    const tracked = allTracked.filter((k) => k.domain === project.domain);

    const result = await discoverCompetitorsFromSerp(userId, plan, {
      projectDomain: project.domain,
      keywords: tracked.map((k) => k.keyword),
      location,
      device: deviceRaw,
      language,
      limit,
      minAppearances,
      includePlatforms: parseBool(searchParams.get("include_platforms")),
    });

    return NextResponse.json({
      data: result,
      usage: await peekUsage(userId, "serpapi", plan),
    });
  } catch (e) {
    return mapError(e);
  }
}
