// ===== /api/keywords/expand =====
// 拓词 API：SerpApi 相关搜索 + PAA（既有 contract 不变）
// P0-02-A 起经由 KeywordResearchService 统一入口，附带 DataForSEO 指标补全（data.metrics，可空）
// 缓存与用量：serpapi 沿用 serp 命名空间；dataforseo 沿用 kw-metrics 命名空间 + dataforseo 配额

import { NextResponse } from "next/server";
import { SeoProviderError } from "@/lib/seo/provider";
import { getSerpUsage } from "@/lib/seo/serp-service";
import { researchKeywords } from "@/lib/seo/keyword-research-service";
import { QuotaExceededError } from "@/lib/seo/cache";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExpandResponse {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
  /** P0-02-A 新增（可空）：DataForSEO 指标补全；不影响既有字段 */
  metrics?: {
    source: "dataforseo" | null;
    fromCache: boolean;
    unavailableMetrics: string[];
    warnings: string[];
    keywords: {
      keyword: string;
      origin: string;
      searchVolume: number | null;
      difficulty: number | null;
      cpc: number | null;
      competition: number | null;
      competitionLevel: string | null;
      intent: string | null;
      trend: { year: number; month: number; searchVolume: number }[] | null;
    }[];
  };
}

function badParams(msg: string) {
  return NextResponse.json<SeoApiError>({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
}

function mapError(e: unknown) {
  if (e instanceof SeoProviderError) {
    const status =
      e.code === "INVALID_KEY" ? 401 :
      e.code === "QUOTA_EXCEEDED" ? 429 :
      e.code === "TIMEOUT" ? 504 :
      e.code === "BAD_REQUEST" ? 400 : 502;
    return NextResponse.json<SeoApiError>({ error: e.message, code: e.code }, { status });
  }
  if (e instanceof Error && e.message === "QUOTA_EXCEEDED") {
    return NextResponse.json<SeoApiError>(
      { error: "本月额度已用尽，下月 1 日自动重置", code: "QUOTA_EXCEEDED" },
      { status: 429 }
    );
  }
  if (e instanceof QuotaExceededError) {
    return NextResponse.json<SeoApiError>(
      { error: e.message, code: "QUOTA_EXCEEDED" },
      { status: 429 }
    );
  }
  return NextResponse.json<SeoApiError>(
    { error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" },
    { status: 500 }
  );
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  let body: { seed?: string; location?: string; device?: string };
  try {
    body = await req.json();
  } catch {
    return badParams("请求体格式错误，需要 JSON");
  }

  const seed = (body.seed ?? "").trim();
  const location = (body.location ?? "中国").trim();
  const device = (body.device ?? "PC").trim() as "PC" | "移动端";

  if (!seed) return badParams("seed 不能为空");
  if (device !== "PC" && device !== "移动端") return badParams("device 必须是 PC 或 移动端");

  try {
    // KeywordResearchService 内部已兼容旧的 expand contract（seed/related/paa/device/fromCache）
    const research = await researchKeywords(userId, plan, { keyword: seed, location, device, enrichMetrics: true });
    const resp: ExpandResponse = {
      seed: research.seed,
      related: research.related,
      paa: research.paa,
      location: research.location,
      device: research.device,
      fromCache: research.fromCache,
      metrics: {
        source: research.metrics.source,
        fromCache: research.metrics.fromCache,
        unavailableMetrics: research.unavailableMetrics,
        warnings: research.metrics.warnings,
        keywords: research.keywords.map(({ keyword, origin, searchVolume, difficulty, cpc, competition, competitionLevel, intent, trend }) => ({
          keyword, origin, searchVolume, difficulty, cpc, competition, competitionLevel, intent, trend,
        })),
      },
    };
    return NextResponse.json({ data: resp, usage: await getSerpUsage(userId, plan) });
  } catch (e) {
    return mapError(e);
  }
}
