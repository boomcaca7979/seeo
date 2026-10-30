// ===== /api/keywords/expand =====
// 拓词 API：SerpApi 相关搜索 + PAA（既有 contract 不变）
// P0-02-A 起经由 KeywordResearchService 统一入口，附带 DataForSEO 指标补全（data.metrics，可空）
// 缓存与用量：serpapi 沿用 serp 命名空间；dataforseo 沿用 kw-metrics 命名空间 + dataforseo 配额

import { NextResponse } from "next/server";
import { getSerpUsage } from "@/lib/seo/serp-service";
import { researchKeywords } from "@/lib/seo/keyword-research-service";
import { resolveSerpMarket } from "@/lib/seo/serpapi";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
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
  /** 所选市场无精确映射时 true——已使用兜底参数，定位可能与预期不符，由 UI 明示而非静默 */
  marketFallback: boolean;
  /** P4-B 新增（可空）：同一次 searchSerp 调用的第一页快照——种子概览/SERP 分析区使用，
      不产生额外 API 成本。organic 为真实第一页条数；totalResults 是 Google 自报估计值
      （不等于实际获得条数）；adsCount 为快照中真实捕获的广告条数 */
  serpSnapshot?: {
    fetchedAt: string;
    fromCache: boolean;
    language: string | null;
    totalResults: number | null;
    adsCount: number | null;
    organic: {
      position: number;
      title: string;
      link: string;
      domain: string;
      snippet: string;
      date?: string;
    }[];
    features: { featureType: string; position: number | null; title: string | null; url: string | null }[];
    /** PAA 问题（P7 起带 provider 真实 next_page_token，供 PAA 深度展开入口判断） */
    relatedQuestions?: { question: string; snippet?: string; title?: string; nextPageToken?: string }[];
  } | null;
  /** P0-02-A 新增（可空）：DataForSEO 指标补全；不影响既有字段 */
  metrics?: {
    source: "dataforseo" | null;
    fromCache: boolean;
    /** 数据库扩词（Labs suggestions + ideas）可用性；state 区分未配置/失败/成功 */
    discovery?: { source: "dataforseo" | null; fromCache: boolean; state: "unconfigured" | "error" | "ok" };
    unavailableMetrics: string[];
    warnings: string[];
    keywords: {
      keyword: string;
      origin: string;
      origins: string[];
      searchVolume: number | null;
      difficulty: number | null;
      cpc: number | null;
      competition: number | null;
      competitionLevel: string | null;
      intent: string | null;
      intentSource: "provider" | null;
      trend: { year: number; month: number; searchVolume: number }[] | null;
      currency: string | null;
    }[];
  };
}

function badParams(msg: string) {
  return NextResponse.json<SeoApiError>({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
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
    // limit 200：数据库扩词（Labs 2×100）+ SerpApi 词的合并上限（发现词自带指标，不增加补全成本）
    const research = await researchKeywords(userId, plan, { keyword: seed, location, device, limit: 200, enrichMetrics: true });
    const resp: ExpandResponse = {
      seed: research.seed,
      related: research.related,
      paa: research.paa,
      location: research.location,
      device: research.device,
      fromCache: research.fromCache,
      marketFallback: resolveSerpMarket(location).fallback,
      serpSnapshot: research.serp
        ? {
            fetchedAt: research.serp.fetchedAt,
            fromCache: research.serp.fromCache ?? false,
            language: research.serp.language ?? null,
            totalResults: research.serp.totalResults ?? null,
            adsCount: research.serp.adsCount ?? null,
            organic: research.serp.organic,
            features: research.serp.features ?? [],
            relatedQuestions: research.serp.relatedQuestions.map(({ question, snippet, title, nextPageToken }) => ({
              question,
              ...(snippet !== undefined ? { snippet } : {}),
              ...(title !== undefined ? { title } : {}),
              ...(nextPageToken !== undefined ? { nextPageToken } : {}),
            })),
          }
        : null,
      metrics: {
        source: research.metrics.source,
        fromCache: research.metrics.fromCache,
        discovery: research.metrics.discovery,
        unavailableMetrics: research.unavailableMetrics,
        warnings: research.metrics.warnings,
        keywords: research.keywords.map(({ keyword, origin, origins, searchVolume, difficulty, cpc, competition, competitionLevel, intent, intentSource, trend, currency }) => ({
          keyword, origin, origins, searchVolume, difficulty, cpc, competition, competitionLevel, intent, intentSource, trend, currency,
        })),
      },
    };
    return NextResponse.json({ data: resp, usage: await getSerpUsage(userId, plan) });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}
