// ===== Keyword Research Service（P0-02-A Keyword Intelligence） =====
// 统一的 Keyword Research 业务层：Web API 与 MCP 共用，禁止各自实现。
//
//   Keyword API / MCP research_keywords
//     ↓
//   本 Service（扩词：SerpApi related/PAA + DataForSEO Labs suggestions/ideas；
//               指标：Labs 响应自带，未覆盖词走 dataforseo.ts keyword metrics 批量补全）
//     ↓
//   Provider（SerpApi + DataForSEO）
//     ↓
//   Cache（serp / kw-discovery / kw-metrics 命名空间，缓存位于 Service 层而非 MCP）
//     ↓
//   Usage / Billing（consumeQuota：serpapi 与 dataforseo 各自按既有规则计数，不重复）
//     ↓
//   DB（tracked_keywords / keyword_groups 等既有模型）
//
// 数据真实性原则：所有指标均为 provider 真实数据；provider 未覆盖一律 null，
// 不猜测、不推算冒充、不用 LLM 生成。数值换算只有两处、各执行一次：
// search_volume 端点的 competition_index / 100；Labs 的 keyword_info.competition 本身
// 就是 0-1（官方定义），直接使用不再换算。

import type { ApiUsage, SerpResult } from "./types";
import type { PlanTier } from "@/lib/auth";
import { consumeQuota, peekUsage, readCache, writeCache } from "./cache";
import { expandKeyword, getSerpUsage } from "./serp-service";
import {
  DataForSeoNotConfiguredError,
  fetchKeywordDiscovery,
  fetchKeywordMetrics,
  type KeywordDiscoveryRow,
  type KeywordMetricRow,
} from "./dataforseo";
// 合并/去重/来源类型的单一实现（纯函数，客户端共用）；此处 re-export 保持既有 import 契约
import {
  mergeKeywordCandidates,
  normalizeKeywordForDedup,
  type KeywordCandidate,
  type KeywordOrigin,
} from "./keyword-merge";

export { mergeKeywordCandidates, normalizeKeywordForDedup } from "./keyword-merge";
export type { KeywordCandidate, KeywordExtraSource, KeywordOrigin } from "./keyword-merge";

export const KEYWORD_METRICS_CACHE_NAMESPACE = "kw-metrics";
/** 数据库扩词（Labs suggestions + ideas）缓存命名空间 */
export const KEYWORD_DISCOVERY_CACHE_NAMESPACE = "kw-discovery";
/** 单次指标补全的最大关键词数（DataForSEO 上限 700，这里取更保守的批次上限） */
export const KEYWORD_METRICS_BATCH_LIMIT = 100;

/** 关键词来源与合并去重逻辑见 ./keyword-merge（单一实现，本模块 re-export 保持契约） */

/** 统一 Keyword Intelligence 结果模型 */
export interface KeywordIntelligenceKeyword {
  keyword: string;
  /** 首个/主要来源（优先级 seed > related > paa > labs_suggestions > labs_ideas） */
  origin: KeywordOrigin;
  /** 全部来源（同一关键词命中多个来源时合并，不重复计数） */
  origins: KeywordOrigin[];
  seed: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  /** Labs 行为 provider 原始 main_intent（如 "informational"）；批量补全行为 null */
  intent: string | null;
  /** "provider" = 意图来自 Labs search_intent_info；null = 展示层用文本规则估算 */
  intentSource: "provider" | null;
  trend: { year: number; month: number; searchVolume: number }[] | null;
  /** provider 返回的货币码（如 USD/CNY）；无指标数据时为 null */
  currency: string | null;
  /** 指标来源：有补全数据的行为 "dataforseo"，否则 "serpapi"（keyword 字符串本身来自 SerpApi 扩词） */
  source: "serpapi" | "dataforseo";
}

export interface KeywordMetricsMeta {
  /** 指标补全是否发生：null = 未请求或完全不可用 */
  source: "dataforseo" | null;
  fromCache: boolean;
  /** 数据库扩词（Labs）可用性。state 三态不混为一谈：
      "unconfigured" = 未配置凭据/未请求（能力存在但当前无数据来源）；
      "error" = 已配置但供应商请求失败（可重试）；
      "ok" = 请求成功（rows 可能为空=供应商确实没有返回） */
  discovery: {
    source: "dataforseo" | null;
    fromCache: boolean;
    state: "unconfigured" | "error" | "ok";
  };
  /** 请求了补全但因套餐/配置/错误未获得数据时给出原因 */
  warnings: string[];
}

export interface KeywordResearchParams {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  /** 返回关键词上限（含 seed），默认 50 */
  limit?: number;
  /** 是否调用 DataForSEO 补全指标，默认 true（配额不足时自动降级为 null 指标） */
  enrichMetrics?: boolean;
  /** DataForSEO language_name 覆盖（可选） */
  language?: string;
}

export interface KeywordResearchResult {
  seed: string;
  location: string;
  /** "desktop" | "mobile"（沿用 /api/keywords/expand 的对外口径） */
  device: string;
  keywords: KeywordIntelligenceKeyword[];
  /** 与旧 expand contract 保持一致的相关词/PAA 列表 */
  related: string[];
  paa: string[];
  /** SerpApi 扩词是否命中缓存 */
  fromCache: boolean;
  /** 同一次 searchSerp 调用的第一页快照（零额外 API 成本；种子概览/SERP 分析区用） */
  serp: SerpResult;
  metrics: KeywordMetricsMeta;
  unavailableMetrics: string[];
  usage: { serp: ApiUsage; dataforseo: ApiUsage };
}

const ALL_METRIC_FIELDS = ["searchVolume", "difficulty", "cpc", "competition", "intent", "trend"] as const;

/** 按 provider 数据行统计哪些指标整体不可用（真实数据缺失即视为 unavailable） */
export function computeUnavailableMetrics(rows: KeywordIntelligenceKeyword[]): string[] {
  return ALL_METRIC_FIELDS.filter((field) =>
    rows.every((row) => row[field] === null)
  );
}

function metricsCacheKey(keywords: string[], location: string, language: string): Record<string, string> {
  return {
    provider: "dfs-v1",
    keywords: keywords.map((k) => normalizeKeywordForDedup(k)).sort().join("\n"),
    location,
    language,
  };
}

/** 指标补全结果（供 Competitor Gap 等下游复用 P0-02-A 的 Keyword Intelligence） */
export interface KeywordMetricsEnrichment {
  rows: KeywordMetricRow[];
  source: "dataforseo" | null;
  fromCache: boolean;
  warnings: string[];
}

/**
 * 为精确关键词列表补全 DataForSEO 指标（kw-metrics 缓存优先，配额不足时优雅降级为 null）。
 * CompetitorService 等下游直接复用本函数，禁止自建第二套 metrics provider。
 */
export async function enrichKeywordMetrics(
  userId: string,
  plan: PlanTier,
  keywords: string[],
  location: string,
  language?: string
): Promise<KeywordMetricsEnrichment> {
  const warnings: string[] = [];
  if (keywords.length === 0) {
    return { rows: [], source: null, fromCache: false, warnings };
  }
  const cacheParams = metricsCacheKey(keywords, location, language ?? "");
  const cached = await readCache<KeywordMetricRow[]>(KEYWORD_METRICS_CACHE_NAMESPACE, cacheParams);
  if (cached) {
    return { rows: cached, source: "dataforseo", fromCache: true, warnings };
  }
  try {
    // DataForSEO 补全批次按 1 个 dataforseo 单位计费（与 backlink-service 的 fetchBacklinks 同惯例），
    // 计费只发生在 provider 真实调用前的这一处；MCP/API 层不再重复记账。
    await consumeQuota(userId, "dataforseo", plan);
    const result = await fetchKeywordMetrics(keywords, { location, language });
    try {
      await writeCache(KEYWORD_METRICS_CACHE_NAMESPACE, cacheParams, result.rows);
    } catch {
      // 缓存写失败不影响结果
    }
    return { rows: result.rows, source: "dataforseo", fromCache: false, warnings: [...warnings, ...result.warnings] };
  } catch (e) {
    // 优雅降级：指标保持 null，不使调用方失败
    return { rows: [], source: null, fromCache: false, warnings: [...warnings, `keyword metrics 不可用：${(e as Error).message}`] };
  }
}

function applyMetrics(
  seed: string,
  keywords: KeywordCandidate[],
  discoveryRows: Map<string, KeywordDiscoveryRow>,
  discoverySeedRow: KeywordDiscoveryRow | null,
  rows: KeywordMetricRow[]
): KeywordIntelligenceKeyword[] {
  const byKeyword = new Map<string, KeywordMetricRow>();
  for (const row of rows) byKeyword.set(normalizeKeywordForDedup(row.keyword), row);
  const seedKey = normalizeKeywordForDedup(seed);
  return keywords.map(({ keyword, origin, origins }) => {
    const key = normalizeKeywordForDedup(keyword);
    // 种子词优先使用 suggestions 端点 include_seed_keyword 返回的自带指标
    const discoveryRow = key === seedKey && discoverySeedRow ? discoverySeedRow : discoveryRows.get(key);
    const metric = discoveryRow ?? byKeyword.get(key);
    const hasMetrics = metric !== undefined;
    return {
      keyword,
      origin,
      origins,
      seed,
      searchVolume: metric?.searchVolume ?? null,
      difficulty: metric?.difficulty ?? null,
      cpc: metric?.cpc ?? null,
      competition: metric?.competition ?? null,
      competitionLevel: metric?.competitionLevel ?? null,
      intent: metric?.intent ?? null,
      intentSource: discoveryRow?.intent ? "provider" : null,
      trend: metric?.trend ?? null,
      currency: metric?.currency ?? null,
      source: hasMetrics ? "dataforseo" : "serpapi",
    };
  });
}

interface DiscoveryCachePayload {
  rows: KeywordDiscoveryRow[];
  seedRow: KeywordDiscoveryRow | null;
}

function discoveryCacheKey(keyword: string, location: string, language?: string): Record<string, string> {
  return {
    provider: "dfs-labs-v1",
    keyword: normalizeKeywordForDedup(keyword),
    location,
    language: language ?? "",
  };
}

/**
 * 数据库扩词（Labs suggestions + ideas）：缓存优先，未配置凭据/失败时优雅降级（source=null + warning）。
 * state 三态区分：unconfigured（无凭据/未请求）/ error（供应商失败）/ ok（成功，rows 可能为空）。
 * 双端点按 1 个 dataforseo 单位计费（与 backlink-service 的 fetchBacklinks 双端点单计费同惯例）。
 */
async function discoverKeywords(
  userId: string,
  plan: PlanTier,
  keyword: string,
  location: string,
  language?: string
): Promise<{
  rows: Map<string, KeywordDiscoveryRow>;
  seedRow: KeywordDiscoveryRow | null;
  meta: KeywordMetricsMeta["discovery"];
  warnings: string[];
}> {
  const cacheParams = discoveryCacheKey(keyword, location, language);
  const cached = await readCache<DiscoveryCachePayload>(KEYWORD_DISCOVERY_CACHE_NAMESPACE, cacheParams);
  if (cached) {
    return {
      rows: new Map(cached.rows.map((row) => [row.keyword.toLowerCase(), row])),
      seedRow: cached.seedRow,
      meta: { source: "dataforseo", fromCache: true, state: "ok" },
      warnings: [],
    };
  }
  try {
    await consumeQuota(userId, "dataforseo", plan);
    const discovery = await fetchKeywordDiscovery(keyword, { location, language });
    try {
      await writeCache(KEYWORD_DISCOVERY_CACHE_NAMESPACE, cacheParams, {
        rows: [...discovery.rows.values()],
        seedRow: discovery.seedRow,
      } satisfies DiscoveryCachePayload);
    } catch {
      // 缓存写失败不影响结果
    }
    return {
      rows: discovery.rows,
      seedRow: discovery.seedRow,
      meta: { source: "dataforseo", fromCache: false, state: "ok" },
      warnings: discovery.warnings,
    };
  } catch (e) {
    // 优雅降级：发现不可用不影响 SerpApi 扩词结果；state 区分「未配置」与「请求失败」
    const unconfigured = e instanceof DataForSeoNotConfiguredError;
    return {
      rows: new Map(),
      seedRow: null,
      meta: { source: null, fromCache: false, state: unconfigured ? "unconfigured" : "error" },
      warnings: [
        unconfigured
          ? "数据库扩词不可用：未配置 DataForSEO 凭据（DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD）"
          : `数据库扩词不可用：${(e as Error).message}`,
      ],
    };
  }
}

/**
 * 核心入口：seed 扩词（SerpApi related/PAA + DataForSEO Labs 数据库发现）
 * + 指标补全（Labs 响应自带；未覆盖词走批量补全；缓存优先，配额不足时优雅降级）。
 */
export async function researchKeywords(
  userId: string,
  plan: PlanTier,
  params: KeywordResearchParams
): Promise<KeywordResearchResult> {
  const limit = Math.max(1, params.limit ?? 50);
  const enrichMetrics = params.enrichMetrics !== false;
  const warnings: string[] = [];

  // 1. SerpApi 扩词：Google 相关搜索 + PAA（缓存 + 用量都在 serp-service 内）
  const expansion = await expandKeyword(userId, plan, {
    keyword: params.keyword,
    location: params.location,
    device: params.device,
  });

  // 2. 数据库发现：Labs suggestions（长尾）+ ideas（语义相关），响应自带真实指标
  let discoveryRows = new Map<string, KeywordDiscoveryRow>();
  let discoverySeedRow: KeywordDiscoveryRow | null = null;
  // enrichMetrics=false：未请求（能力保留，未来启用），state 如实标 unconfigured
  let discoveryMeta: KeywordMetricsMeta["discovery"] = { source: null, fromCache: false, state: "unconfigured" };
  if (enrichMetrics) {
    const discovery = await discoverKeywords(userId, plan, params.keyword, params.location, params.language);
    discoveryRows = discovery.rows;
    discoverySeedRow = discovery.seedRow;
    discoveryMeta = discovery.meta;
    warnings.push(...discovery.warnings);
  } else {
    warnings.push("keyword metrics 未启用（enrichMetrics=false）");
  }

  // 3. 合并候选：SerpApi 词 + 数据库发现词，跨来源去重并保留 origins
  const candidates = mergeKeywordCandidates(
    params.keyword,
    expansion.related,
    expansion.paa,
    limit,
    [
      {
        origin: "labs_suggestions",
        keywords: [...discoveryRows.values()].filter((row) => row.origin === "labs_suggestions").map((row) => row.keyword),
      },
      {
        origin: "labs_ideas",
        keywords: [...discoveryRows.values()].filter((row) => row.origin === "labs_ideas").map((row) => row.keyword),
      },
    ]
  );

  // 4. 指标补全：只为发现未覆盖的候选（SerpApi 来源词）调用批量端点，不重复消耗
  let metricsSource: "dataforseo" | null = null;
  let metricsFromCache = false;
  let metricRows: KeywordMetricRow[] = [];
  if (enrichMetrics) {
    const uncovered = candidates
      .filter((candidate) => !discoveryRows.has(normalizeKeywordForDedup(candidate.keyword)))
      .map((candidate) => candidate.keyword);
    if (uncovered.length > 0) {
      const enrichment = await enrichKeywordMetrics(userId, plan, uncovered, params.location, params.language);
      metricRows = enrichment.rows;
      metricsSource = enrichment.source;
      metricsFromCache = enrichment.fromCache;
      warnings.push(...enrichment.warnings);
    }
  }

  const keywords = applyMetrics(params.keyword, candidates, discoveryRows, discoverySeedRow, metricRows);

  return {
    seed: expansion.seed,
    location: expansion.location,
    device: expansion.device,
    keywords,
    related: expansion.related,
    paa: expansion.paa,
    fromCache: expansion.fromCache,
    serp: expansion.serpSnapshot,
    metrics: { source: metricsSource, fromCache: metricsFromCache, discovery: discoveryMeta, warnings },
    unavailableMetrics: computeUnavailableMetrics(keywords),
    usage: {
      serp: await getSerpUsage(userId, plan),
      dataforseo: await peekUsage(userId, "dataforseo", plan),
    },
  };
}
