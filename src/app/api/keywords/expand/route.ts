// ===== /api/keywords/expand =====
// 拓词 API：SerpApi 相关搜索 + PAA（既有 contract 不变）
// P0-02-A 起经由 KeywordResearchService 统一入口，附带 DataForSEO 指标补全（data.metrics，可空）
// 缓存与用量：serpapi 沿用 serp 命名空间；dataforseo 沿用 kw-metrics 命名空间 + dataforseo 配额

import { NextResponse } from "next/server";
import { getSerpUsage } from "@/lib/seo/serp-service";
import { researchKeywords } from "@/lib/seo/keyword-research-service";
import { resolveSerpMarket } from "@/lib/seo/serpapi";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import { normalizeDeviceParam } from "@/lib/seo/device-params";
import { getPlanLimits, PLAN_ORDER, PLAN_RANK } from "@/lib/billing";
import type { PlanTier } from "@/lib/auth";
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
  /** 市场指标（搜索量/KD/CPC/竞争密度）在当前套餐下的可用性。
      由服务端按真实套餐额度判定，前端不得自行假设「免费版才没有」：
      - included=false 且 requiredPlan 非空 → 套餐确实不含额度（可给升级出口）
      - included=true → 额度存在；实际取不到数值时由 metrics.discovery.state 说明原因（未配置/失败）
      - planQuota → 各套餐真实月度额度（来自 billing.ts），前端文案只能用这里的数字，不得硬编码 */
  metricsAccess?: {
    included: boolean;
    plan: PlanTier;
    monthlyLimit: number;
    requiredPlan: PlanTier | null;
    planQuota: Record<PlanTier, number>;
  };
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

/**
 * 市场指标可用性：只读取套餐定义，不假设、不修改额度。
 * 额度为 0 = 该套餐不含市场指标；否则额度存在（是否真能取到由数据源配置决定）。
 * requiredPlan 只在确实存在更高套餐含额度时给出，绝不给出无法兑现的升级承诺。
 */
async function resolveMetricsAccess(plan: PlanTier): Promise<NonNullable<ExpandResponse["metricsAccess"]>> {
  const limits = await getPlanLimits(plan);
  const monthlyLimit = limits.dataforseo_monthly_limit;
  const included = monthlyLimit > 0;
  let requiredPlan: PlanTier | null = null;
  if (!included) {
    for (const tier of PLAN_ORDER) {
      if (PLAN_RANK[tier] <= PLAN_RANK[plan]) continue;
      const tierLimits = await getPlanLimits(tier);
      if (tierLimits.dataforseo_monthly_limit > 0) {
        requiredPlan = tier;
        break;
      }
    }
  }
  // 各套餐真实额度：让 UI 能写出「Lite 每月 5 次、Pro 每月 30 次」而不用硬编码数字
  const planQuota = {} as Record<PlanTier, number>;
  for (const tier of PLAN_ORDER) {
    planQuota[tier] = (await getPlanLimits(tier)).dataforseo_monthly_limit;
  }
  return { included, plan, monthlyLimit, requiredPlan, planQuota };
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
  // 与 /api/seo/serp 同一口径：既接受页面口径（PC/移动端），也接受 desktop/mobile
  const deviceRaw = (body.device ?? "").trim();
  const device = deviceRaw ? normalizeDeviceParam(deviceRaw) : "PC";

  if (!seed) return badParams("seed 不能为空");
  if (!device) return badParams("device 必须是 PC/desktop 或 移动端/mobile");

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
      metricsAccess: await resolveMetricsAccess(plan),
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
