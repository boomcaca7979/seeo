import { serpApiProvider } from "./serpapi";
import { readCache, writeCache, consumeQuota, peekUsage } from "./cache";
import type { SerpResult } from "./types";
import type { PlanTier } from "@/lib/auth";

export interface SerpServiceParams {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  /** SerpApi hl 语言码（可选）；缺省 zh-cn 保持既有行为 */
  language?: string;
}

/**
 * SERP 缓存 key 成分。provider 版本号参与 key：
 * 响应结构升级（如新增 features 字段）后旧缓存自然失效，避免新旧 shape 混读。
 * device / location / language 任一不同都命中不同 key——不同市场/设备的 SERP 是不同快照。
 */
const SERP_PROVIDER_VERSION = "serpapi-v2";

function buildSerpCacheParams(params: SerpServiceParams): Record<string, string> {
  return {
    provider: SERP_PROVIDER_VERSION,
    keyword: params.keyword,
    location: params.location,
    language: params.language ?? "",
    device: params.device,
  };
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

export async function getSerpUsage(userId: string, plan: PlanTier) {
  return peekUsage(userId, "serpapi", plan);
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
  };
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

/** 项目域名匹配口径：registrable domain 相等或互为子域（与 checkRank 一致） */
function isDomainMatch(domainA: string, domainB: string): boolean {
  const a = domainA.toLowerCase();
  const b = domainB.toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
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
