import { serpApiProvider, fetchAutocompleteSuggestions, fetchRelatedQuestions, resolveSerpHl, type AutocompleteSuggestion } from "./serpapi";
import { readCache, writeCache, consumeQuota, peekUsage } from "./cache";
import type { RankResult, SerpResult, RelatedQuestion } from "./types";
import type { PlanTier } from "@/lib/auth";

export interface SerpServiceParams {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  /** SerpApi hl 语言码（可选）；缺省 zh-cn 保持既有行为 */
  language?: string;
  /** SERP 分页偏移（SerpApi start）；缺省/0 = 第一页（与旧缓存 key 完全一致） */
  start?: number;
}

/**
 * SERP 缓存 key 成分。provider 版本号参与 key：
 * 响应结构或**请求语义**升级后旧缓存自然失效，避免新旧 shape 混读。
 * device / location / language 任一不同都命中不同 key——不同市场/设备的 SERP 是不同快照。
 * serpapi-v3：按市场取默认 hl（美国→en 等）+ 补全香港/台湾映射。旧 v2 快照是
 * hl=zh-cn 的产物，与 v3 请求结果不可混用，故整版失效。
 * serpapi-v4：google_domain 纳入市场配置（香港→google.com.hk、日本→google.co.jp 等，
 * 核实自 SerpApi 官方域名列表）。旧 v3 快照是 google.com 的产物，整版失效。
 * serpapi-v5：响应解析扩展（totalResults / adsCount 参与种子概览）；旧 v4 快照缺这两个
 * 字段，读取端无法区分「无广告」与「未捕获」，整版失效保持缓存 shape 一致。
 */
const SERP_PROVIDER_VERSION = "serpapi-v5";

function buildSerpCacheParams(params: SerpServiceParams): Record<string, string> {
  const cacheParams: Record<string, string> = {
    provider: SERP_PROVIDER_VERSION,
    keyword: params.keyword,
    location: params.location,
    language: params.language ?? "",
    device: params.device,
  };
  // 分页偏移只在 >0 时参与 key：第一页的 key 与旧实现字节一致，旧缓存继续命中
  if (typeof params.start === "number" && Number.isInteger(params.start) && params.start > 0) {
    cacheParams.start = String(params.start);
  }
  return cacheParams;
}

export async function searchSerp(
  userId: string,
  plan: PlanTier,
  params: SerpServiceParams,
): Promise<{ result: SerpResult; fromCache: boolean }> {
  const cacheParams = buildSerpCacheParams(params);
  const cached = await readCache<SerpResult>("serp", cacheParams);
  if (cached) {
    return {
      result: { ...cached, fromCache: true, features: cached.features ?? [], language: cached.language ?? "zh-cn" },
      fromCache: true,
    };
  }
  await consumeQuota(userId, "serpapi", plan);
  const result = await serpApiProvider.searchSerp(params);
  try { await writeCache("serp", cacheParams, result); } catch { /* cache failure does not fail a provider result */ }
  return { result, fromCache: false };
}

// SERP 分页（P4-D）：SerpApi 官方 start 偏移（0/10/20…），经 SerpServiceParams.start
// 直通 searchSerp——第一页 key 与旧实现字节一致；>0 的每一页是独立缓存 key + 独立配额
// 消耗，只能由用户显式触发「加载更多」。Google 不保证每页返回条数，也不把自报总数
// 当作实际获得条数（读取端展示实际 organic 条数）。

// ===== SeeO SERP Competition Signal =====
// 实现位于 ./serp-signal（纯函数，客户端页面与服务端共用；本模块 re-export 保持单点实现）。
export { computeSerpCompetitionSignal, type SerpCompetitionSignal } from "./serp-signal";

export async function getSerpUsage(userId: string, plan: PlanTier) {
  return peekUsage(userId, "serpapi", plan);
}

// ===== Rank check（P0-02-D Rank Tracking Intelligence） =====
// Top-100 排名检查与 Top-10 SERP 是两种 provider 调用（num=100 vs num=10），
// 但缓存与计费必须统一在 service 层单点完成：
// P0-02-D 之前 refresh.ts 与 /api/seo/rank 各自复制了一套 cache/quota 逻辑，
// 本函数是唯一的 rank 检查入口（key 含 provider 版本 + language 维度）。

/** rank 缓存 key 成分：domain 是匹配目标而非市场维度，但不同 domain 的结果不同，须参与 key */
// serpapi-v3：rank 快照同样受 google_domain 市场配置影响（旧 v2 为 google.com 产物），整版失效
const RANK_PROVIDER_VERSION = "serpapi-v3";

export interface RankServiceParams {
  keyword: string;
  domain: string;
  location: string;
  device: "PC" | "移动端";
  /** SerpApi hl 语言码（可选）；缺省 zh-cn 保持既有行为 */
  language?: string;
}

export async function searchRank(
  userId: string,
  plan: PlanTier,
  params: RankServiceParams,
): Promise<{ result: RankResult; fromCache: boolean }> {
  const cacheParams = {
    provider: RANK_PROVIDER_VERSION,
    keyword: params.keyword,
    domain: params.domain,
    location: params.location,
    language: params.language ?? "",
    device: params.device,
  };
  const cached = await readCache<RankResult>("rank", cacheParams);
  if (cached) {
    return { result: { ...cached, fromCache: true }, fromCache: true };
  }
  await consumeQuota(userId, "serpapi", plan);
  const result = await serpApiProvider.checkRank({
    keyword: params.keyword,
    domain: params.domain,
    location: params.location,
    device: params.device,
    ...(params.language ? { language: params.language } : {}),
  });
  try { await writeCache("rank", cacheParams, result); } catch { /* cache failure does not fail a provider result */ }
  return { result, fromCache: false };
}

export async function expandKeyword(
  userId: string,
  plan: PlanTier,
  params: SerpServiceParams,
) {
  const { result, fromCache } = await searchSerp(userId, plan, params);
  return {
    seed: params.keyword,
    related: result.relatedSearches.map((item) => item.query),
    paa: result.relatedQuestions.map((item) => item.question),
    location: params.location,
    device: params.device === "PC" ? "desktop" : "mobile",
    fromCache,
    // P4-B：同一次 searchSerp 调用的完整快照（零额外 API 成本）——供种子概览/SERP 分析区
    // 展示真实第一页结果、SERP feature、广告状态与 Google 自报总数（口径标注由 UI 负责）
    serpSnapshot: result,
  };
}

// ===== Google Autocomplete 建议词（用户主动触发的第二扩词来源）=====
// 与 expandKeyword 不同：这是独立的一次 SerpApi 引擎调用（engine=google_autocomplete，
// 参数为 q/gl/hl，无 google_domain），必须由用户显式点击「获取更多建议」触发，
// 绝不在分析主流程中自动调用。缓存与配额沿用 serp-service 单点惯例。
// 建议词不依赖 device，缓存 key 不含 device。

const SUGGEST_PROVIDER_VERSION = "serpapi-ac-v1";

export interface SuggestServiceParams {
  keyword: string;
  location: string;
  language?: string;
}

export interface SuggestServiceResult {
  seed: string;
  location: string;
  language: string;
  suggestions: string[];
  fromCache: boolean;
}

/** 并发去重：同一关键词/市场/语言的进行中请求共享同一个 Promise，双击不重复扣费 */
const inFlightSuggestions = new Map<string, Promise<SuggestServiceResult>>();

function suggestCacheParams(params: SuggestServiceParams): Record<string, string> {
  return {
    provider: SUGGEST_PROVIDER_VERSION,
    keyword: params.keyword.trim().toLowerCase(),
    location: params.location,
    language: params.language ?? "",
  };
}

async function loadSuggestions(
  userId: string,
  plan: PlanTier,
  params: SuggestServiceParams
): Promise<SuggestServiceResult> {
  const cacheParams = suggestCacheParams(params);
  const cached = await readCache<string[]>("suggest", cacheParams);
  const resolvedLanguage = resolveSerpHl(params.location, params.language);
  if (cached) {
    return {
      seed: params.keyword,
      location: params.location,
      language: resolvedLanguage,
      suggestions: cached,
      fromCache: true,
    };
  }
  await consumeQuota(userId, "serpapi", plan);
  const rows: AutocompleteSuggestion[] = await fetchAutocompleteSuggestions(
    params.keyword,
    params.location,
    params.language
  );
  const suggestions = rows.map((row) => row.value);
  try { await writeCache("suggest", cacheParams, suggestions); } catch { /* cache failure does not fail a provider result */ }
  return {
    seed: params.keyword,
    location: params.location,
    language: resolvedLanguage,
    suggestions,
    fromCache: false,
  };
}

export async function fetchKeywordSuggestions(
  userId: string,
  plan: PlanTier,
  params: SuggestServiceParams
): Promise<SuggestServiceResult> {
  const key = JSON.stringify(suggestCacheParams(params));
  const inFlight = inFlightSuggestions.get(key);
  if (inFlight) return inFlight;
  const promise = loadSuggestions(userId, plan, params).finally(() => {
    inFlightSuggestions.delete(key);
  });
  inFlightSuggestions.set(key, promise);
  return promise;
}

// ===== PAA 深度展开（P7）=====
// 用普通搜索响应中真实返回的 next_page_token 调用 engine=google_related_questions。
// 与 trends 相同惯例：缓存与配额只在 service 层单点完成；一次调用 = 1 个 serpapi 配额
// 单位；token 来自 provider 真实响应，UI 对无 token 的问题明确显示无法继续（绝不猜 token）。

const PAA_PROVIDER_VERSION = "serpapi-paa-v1";

export interface PaaExpandResult {
  questions: RelatedQuestion[];
  fromCache: boolean;
}

/** 并发去重：同一 token 的进行中请求共享同一个 Promise（双击不重复扣费） */
const inFlightPaa = new Map<string, Promise<PaaExpandResult>>();

async function loadPaaQuestions(
  userId: string,
  plan: PlanTier,
  token: string
): Promise<PaaExpandResult> {
  const cacheParams = { provider: PAA_PROVIDER_VERSION, token };
  const cached = await readCache<RelatedQuestion[]>("paa", cacheParams);
  if (cached) {
    return { questions: cached, fromCache: true };
  }
  await consumeQuota(userId, "serpapi", plan);
  const { questions } = await fetchRelatedQuestions(token);
  try { await writeCache("paa", cacheParams, questions); } catch { /* cache failure does not fail a provider result */ }
  return { questions, fromCache: false };
}

export async function expandPaaQuestions(
  userId: string,
  plan: PlanTier,
  token: string
): Promise<PaaExpandResult> {
  const trimmed = token.trim();
  const inFlight = inFlightPaa.get(trimmed);
  if (inFlight) return inFlight;
  const promise = loadPaaQuestions(userId, plan, trimmed).finally(() => {
    inFlightPaa.delete(trimmed);
  });
  inFlightPaa.set(trimmed, promise);
  return promise;
}

// ===== SERP Intelligence 分析能力（P0-02-B） =====
// 纯函数，供 Web API / MCP / 未来 Competitor Gap、Clustering、Opportunity Engine 复用。

export interface SerpSummary {
  organicCount: number;
  featureCount: number;
  featureTypes: string[];
  /** 是否需要项目域名参与；未提供 projectDomain 时为 null */
  projectPresent: boolean | null;
  projectRank: number | null;
  projectRankingUrl: string | null;
  /** 按 domain 出现次数降序的前 N 个域名 */
  topDomains: { domain: string; count: number }[];
  /** keyword → Top organic 结果中该域名出现次数 */
  domainFrequency: Record<string, number>;
}

/** 域名匹配口径：registrable/hostname 相等或互为子域（与 checkRank、competitor 解析一致） */
export function domainsMatch(domainA: string, domainB: string): boolean {
  const a = domainA.toLowerCase();
  const b = domainB.toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** 项目域名匹配口径：registrable domain 相等或互为子域（与 checkRank 一致） */
function isDomainMatch(domainA: string, domainB: string): boolean {
  return domainsMatch(domainA, domainB);
}

/**
 * SERP 组成摘要：organic 数量、feature 构成、域名频次、（可选）项目域名表现。
 * projectDomain 缺省时 projectPresent/projectRank/projectRankingUrl 为 null 而非 false——
 * 明确区分「没有项目上下文」与「项目确实不在结果里」。
 */
export function summarizeSerp(
  result: Pick<SerpResult, "organic" | "features">,
  projectDomain?: string | null
): SerpSummary {
  const features = result.features ?? [];
  const domainFrequency: Record<string, number> = {};
  for (const row of result.organic) {
    domainFrequency[row.domain] = (domainFrequency[row.domain] ?? 0) + 1;
  }
  const topDomains = Object.entries(domainFrequency)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  let projectPresent: boolean | null = null;
  let projectRank: number | null = null;
  let projectRankingUrl: string | null = null;
  if (projectDomain && projectDomain.trim()) {
    projectPresent = false;
    for (const row of result.organic) {
      if (isDomainMatch(row.domain, projectDomain)) {
        projectPresent = true;
        projectRank = row.position;
        projectRankingUrl = row.link;
        break;
      }
    }
  }

  return {
    organicCount: result.organic.length,
    featureCount: features.length,
    featureTypes: features.map((feature) => feature.featureType),
    projectPresent,
    projectRank,
    projectRankingUrl,
    topDomains,
    domainFrequency,
  };
}

export interface SerpOverlapResult {
  /** Jaccard：|A∩B| / |A∪B|；任一集合为空时为 null（无有意义基数） */
  overlap: number | null;
  commonCount: number;
  unionCount: number;
  /** 交集成员（按所选粒度：registrable domain 或完整 URL） */
  common: string[];
}

/**
 * 两个 SERP 的重叠度（deterministic、可解释）：
 * overlap = common / union。
 * granularity="domain"（默认）按 registrable domain 计——衡量「同一批站点在竞争」；
 * granularity="url" 按完整 URL 计——衡量「完全相同的页面」。
 * 后续可作为 Keyword Clustering 的 deterministic signal。
 */
export function calculateSerpOverlap(
  resultSetA: Pick<SerpResult, "organic">,
  resultSetB: Pick<SerpResult, "organic">,
  granularity: "domain" | "url" = "domain"
): SerpOverlapResult {
  const identity = (row: { link: string; domain: string }) =>
    granularity === "url" ? row.link : row.domain;
  const setA = new Set(resultSetA.organic.map(identity));
  const setB = new Set(resultSetB.organic.map(identity));
  const common = [...setA].filter((item) => setB.has(item));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) {
    return { overlap: null, commonCount: 0, unionCount: 0, common: [] };
  }
  return {
    overlap: Math.round((common.length / union.size) * 1000) / 1000,
    commonCount: common.length,
    unionCount: union.size,
    common,
  };
}
