// ===== Competitor Service（P0-02-C Competitor Keyword Gap） =====
// 统一的 Competitor Intelligence 业务层：Web API 使用，MCP 未来复用。
//
//   Competitor API (/api/competitors/discover, /api/competitors/gap)
//     ↓
//   本 Service
//     ├─ discoverCompetitorsFromSerp：复用 SerpService.searchSerp（缓存 + serpapi 计费单点）
//     ├─ getCompetitorKeywordGap：project tracked keywords + competitor_ranks + rank_history
//     │    └─ enrichKeywordMetrics：复用 P0-02-A Keyword Intelligence（kw-metrics 缓存 + dataforseo 计费）
//     └─ classifyDomain / normalizeCompetitor
//
// 不做：provider HTTP、auth、billing 记账（全部在底层 service 单点完成，本层不重复计费）。
// 不做：Opportunity Score（P1）；本层只输出原始、可信的 signals。
// 不做：完整历史（competitor_ranks 既有历史保留，本层只取最新快照做 gap）。

import { searchSerp, domainsMatch, summarizeSerp, calculateSerpOverlap } from "./serp-service";
import { enrichKeywordMetrics, normalizeKeywordForDedup } from "./keyword-research-service";
import { checkCompetitorRanks } from "./competitor";
import { addCompetitorRank, getLatestCompetitorRanks } from "@/lib/db";
import { extractRegistrableDomain } from "./serpapi";
import type { PlanTier } from "@/lib/auth";
import type { SerpResult } from "./types";

// ===== Domain classification =====

/**
 * 平台/聚合类域名（小型 curated 分类，非大 blacklist）：
 * 这些站点出现在任何 SERP 都不构成「竞争对手」。默认从 discovery 中排除，
 * includePlatforms=true 可查看。后续可扩展 classification 维度。
 */
export const PLATFORM_DOMAINS: ReadonlySet<string> = new Set([
  "wikipedia.org", "youtube.com", "reddit.com", "amazon.com",
  "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com",
  "pinterest.com", "linkedin.com", "quora.com", "github.com",
]);

export type DomainCategory = "platform" | "site";

export function classifyDomain(domain: string): DomainCategory {
  return PLATFORM_DOMAINS.has(domain.toLowerCase()) ? "platform" : "site";
}

export interface NormalizedCompetitor {
  domain: string;
  /** registrable domain（provider 域名归一结果），竞争聚合实体 */
  registrableDomain: string;
}

export function normalizeCompetitor(domain: string): NormalizedCompetitor {
  const registrable = extractRegistrableDomain(domain) ?? domain.toLowerCase();
  return { domain: domain.toLowerCase(), registrableDomain: registrable };
}

// ===== Competitor Discovery（SERP-based） =====

export interface DiscoverCompetitorsParams {
  projectDomain: string;
  keywords: string[];
  location: string;
  device: "PC" | "移动端";
  language?: string;
  /** 候选竞争者至少需要出现在多少个关键词的 SERP 中（默认 2） */
  minAppearances?: number;
  /** 最多返回候选竞争者数量（默认 10，最大 50） */
  limit?: number;
  /** 是否包含平台/聚合类域名（默认 false） */
  includePlatforms?: boolean;
}

export interface DiscoveredCompetitor {
  domain: string;
  registrableDomain: string;
  /** 出现的关键词 SERP 数 */
  frequency: number;
  /** frequency / 分析的关键词数 */
  percentage: number;
  avgRank: number | null;
  bestRank: number | null;
  /** 共同出现的关键词 */
  sharedKeywords: string[];
  category: DomainCategory;
}

export interface DiscoverCompetitorsResult {
  projectDomain: string;
  keywordsAnalyzed: number;
  competitors: DiscoveredCompetitor[];
  warnings: string[];
}

/** 单次 discovery 最多分析的关键词数——每个未命中缓存的关键词都是一次 SerpApi 成本 */
export const MAX_DISCOVERY_KEYWORDS = 20;

/**
 * SERP-based competitor discovery：
 * Keyword Set → SerpService（共享缓存）→ domainFrequency → candidate competitors。
 * 排除项目自身域名（含子域名口径）；默认排除平台类域名；minAppearances + limit 控制噪声。
 */
export async function discoverCompetitorsFromSerp(
  userId: string,
  plan: PlanTier,
  params: DiscoverCompetitorsParams
): Promise<DiscoverCompetitorsResult> {
  const minAppearances = Math.max(1, params.minAppearances ?? 2);
  const limit = Math.min(50, Math.max(1, params.limit ?? 10));
  const warnings: string[] = [];

  // 去重 + 上限（成本护栏：每个 keyword 可能是一次真实 SerpApi 调用）
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const keyword of params.keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;
    const key = normalizeKeywordForDedup(trimmed);
    if (seen.has(key)) continue;
    if (keywords.length >= MAX_DISCOVERY_KEYWORDS) {
      warnings.push(`关键词数量超过单次 discovery 上限（${MAX_DISCOVERY_KEYWORDS}），已截断`);
      break;
    }
    seen.add(key);
    keywords.push(trimmed);
  }
  if (keywords.length === 0) {
    return { projectDomain: params.projectDomain, keywordsAnalyzed: 0, competitors: [], warnings };
  }

  // 跨关键词聚合 domain → { 出现次数, 排名, 关键词 }
  interface Agg { ranks: number[]; keywords: Map<string, number> }
  const byDomain = new Map<string, Agg>();
  let analyzed = 0;

  for (const keyword of keywords) {
    let result: SerpResult;
    try {
      ({ result } = await searchSerp(userId, plan, {
        keyword,
        location: params.location,
        device: params.device,
        ...(params.language ? { language: params.language } : {}),
      }));
    } catch (e) {
      // 单个关键词失败不中断 discovery
      warnings.push(`"${keyword}" SERP 查询失败：${(e as Error).message}`);
      continue;
    }
    analyzed++;
    for (const row of result.organic) {
      // 项目自身（含子域名）不算竞争对手
      if (domainsMatch(row.domain, params.projectDomain)) continue;
      let agg = byDomain.get(row.domain);
      if (!agg) {
        agg = { ranks: [], keywords: new Map() };
        byDomain.set(row.domain, agg);
      }
      agg.ranks.push(row.position);
      agg.keywords.set(keyword, row.position);
    }
  }

  const competitors: DiscoveredCompetitor[] = [];
  for (const [domain, agg] of byDomain) {
    if (agg.keywords.size < minAppearances) continue;
    const category = classifyDomain(domain);
    if (category === "platform" && !params.includePlatforms) continue;
    competitors.push({
      domain,
      registrableDomain: normalizeCompetitor(domain).registrableDomain,
      frequency: agg.keywords.size,
      percentage: analyzed > 0 ? Math.round((agg.keywords.size / analyzed) * 100) : 0,
      avgRank: agg.ranks.length > 0
        ? Math.round(agg.ranks.reduce((a, b) => a + b, 0) / agg.ranks.length)
        : null,
      bestRank: agg.ranks.length > 0 ? Math.min(...agg.ranks) : null,
      sharedKeywords: [...agg.keywords.keys()],
      category,
    });
  }
  competitors.sort((a, b) =>
    b.frequency - a.frequency ||
    (a.avgRank ?? Infinity) - (b.avgRank ?? Infinity) ||
    a.domain.localeCompare(b.domain)
  );

  return {
    projectDomain: params.projectDomain,
    keywordsAnalyzed: analyzed,
    competitors: competitors.slice(0, limit),
    warnings,
  };
}

// ===== Competitor Keyword Gap =====

export type GapCategory = "shared" | "weaklyOwned" | "competitorOnly" | "projectOnly";

export interface CompetitorGapKeyword {
  keyword: string;
  location: string;
  device: string;
  /** 项目当前排名（来自 rank_history 最新数据；null = 无排名记录） */
  projectRank: number | null;
  projectUrl: string | null;
  /** 竞品最新排名（来自 competitor_ranks；null = 无排名记录） */
  competitorRank: number | null;
  competitorUrl: string | null;
  /** projectRank - competitorRank（双方都有排名时），正值 = 竞品领先 */
  rankGap: number | null;
  category: GapCategory;
  // —— Opportunity signals（原始数据，不评分；P1 Opportunity Engine 消费）——
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  intent: string | null;
}

export interface CompetitorKeywordGap {
  competitor: NormalizedCompetitor & { id: number };
  summary: {
    analyzedKeywords: number;
    shared: number;
    weaklyOwned: number;
    competitorOnly: number;
    projectOnly: number;
  };
  keywords: CompetitorGapKeyword[];
  warnings: string[];
}

export interface GetCompetitorKeywordGapParams {
  projectDomain: string;
  /** 项目 tracked keywords（调用方从 DB 取出；service 保持 DB 依赖最小化） */
  trackedKeywords: Array<{
    id: number;
    keyword: string;
    location: string;
    device: "PC" | "移动端";
    todayPosition: number | null;
    todayUrl: string | null;
  }>;
  competitorId: number;
  competitorDomain: string;
  /** 排名落后判定：竞品进前 N 且领先该差距以上算 weaklyOwned（默认 competitorRank<=10 且 gap>=5） */
  limit?: number;
  /** 是否触发竞品排名刷新（会经 searchSerp 缓存，可能消耗 serpapi 配额） */
  refresh?: boolean;
  /** 是否用 DataForSEO 补全 keyword metrics（默认 true，配额不足时优雅降级） */
  enrichMetrics?: boolean;
  userId: string;
  plan: PlanTier;
}

/** weaklyOwned 判定阈值：竞品排名进前 10 */
const WEAK_OWNED_COMPETITOR_RANK_MAX = 10;
/** weaklyOwned 判定阈值：排名差至少 5 位 */
const WEAK_OWNED_GAP_MIN = 5;

function categorize(projectRank: number | null, competitorRank: number | null): GapCategory {
  if (projectRank !== null && competitorRank !== null) {
    if (competitorRank <= WEAK_OWNED_COMPETITOR_RANK_MAX && projectRank - competitorRank >= WEAK_OWNED_GAP_MIN) {
      return "weaklyOwned";
    }
    return "shared";
  }
  if (competitorRank !== null && projectRank === null) return "competitorOnly";
  if (projectRank !== null && competitorRank === null) return "projectOnly";
  // 双方都无排名记录：不计入 gap（无 signal）
  return "shared";
}

/**
 * Competitor Keyword Gap（universe = 项目 tracked keywords + 已存的竞品排名）。
 *
 * 数据来源（全部真实，无估算）：
 * - projectRank：rank_history 最新（tracked_keywords.todayPosition），refresh 时取本次 SERP 解析
 * - competitorRank：competitor_ranks 最新记录；refresh 时经 checkCompetitorRanks 刷新并入库
 * - metrics：P0-02-A enrichKeywordMetrics（kw-metrics 缓存 + dataforseo 配额）
 *
 * 注意：本 gap 的 keyword universe 是项目已跟踪的关键词集合；
 * 竞品「全站 ranked keywords」需要 DataForSEO Labs ranked_keywords，属于后续阶段。
 */
export async function getCompetitorKeywordGap(
  params: GetCompetitorKeywordGapParams
): Promise<CompetitorKeywordGap> {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const enrichMetrics = params.enrichMetrics !== false;
  const warnings: string[] = [];

  // 组装 gap 行
  const rows: CompetitorGapKeyword[] = [];
  for (const kw of params.trackedKeywords) {
    let projectRank = kw.todayPosition;
    let projectUrl = kw.todayUrl;
    let competitorRank: number | null = null;
    let competitorUrl: string | null = null;

    if (params.refresh) {
      // 刷新模式：一次 SERP 同时解析「自己 + 该竞品」（searchSerp 共享缓存，miss 时消耗 serpapi 配额）
      try {
        const { results } = await checkCompetitorRanks({
          keyword: kw.keyword,
          location: kw.location,
          device: kw.device,
          competitors: [
            { id: 0, domain: params.projectDomain },
            { id: params.competitorId, domain: params.competitorDomain },
          ],
          userId: params.userId,
          plan: params.plan,
        });
        const competitorResult = results.find((r) => r.competitorId === params.competitorId);
        if (competitorResult) {
          competitorRank = competitorResult.rank;
          competitorUrl = competitorResult.targetUrl;
          // 与 /api/competitors/ranks 相同的入库方式（历史保留）；自排名（id=0）不写库
          await addCompetitorRank(params.userId, {
            competitor_id: params.competitorId,
            keyword_id: kw.id,
            rank: competitorRank,
            target_url: competitorUrl,
          });
        }
        const selfResult = results.find((r) => r.competitorId === 0);
        if (selfResult && projectRank === null) {
          // rank_history 今天没有记录时，用本次 SERP 解析的自排名兜底（不写库）
          projectRank = selfResult.rank;
          projectUrl = selfResult.targetUrl;
        }
      } catch (e) {
        warnings.push(`"${kw.keyword}" 排名刷新失败：${(e as Error).message}`);
      }
    } else {
      const latest = await getLatestCompetitorRanks(params.userId, kw.id);
      const competitorRow = latest.find((r) => r.competitor_id === params.competitorId);
      if (competitorRow) {
        competitorRank = competitorRow.rank;
        competitorUrl = competitorRow.target_url;
      }
    }

    // 双方都无排名数据的关键词没有 gap signal，跳过
    if (projectRank === null && competitorRank === null) continue;

    rows.push({
      keyword: kw.keyword,
      location: kw.location,
      device: kw.device === "PC" ? "desktop" : "mobile",
      projectRank,
      projectUrl,
      competitorRank,
      competitorUrl,
      rankGap: projectRank !== null && competitorRank !== null ? projectRank - competitorRank : null,
      category: categorize(projectRank, competitorRank),
      searchVolume: null,
      difficulty: null,
      cpc: null,
      competition: null,
      intent: null,
    });
  }

  // metrics 补全：按 tracked keyword 自身 location 分组（保持 P0-02-A 的缓存/计费语义）
  if (enrichMetrics && rows.length > 0) {
    const byLocation = new Map<string, string[]>(); // location -> keywords
    const rowByKeyword = new Map<string, CompetitorGapKeyword>();
    for (const row of rows) {
      const list = byLocation.get(row.location) ?? [];
      list.push(row.keyword);
      byLocation.set(row.location, list);
      rowByKeyword.set(`${normalizeKeywordForDedup(row.keyword)}|${row.location}`, row);
    }
    for (const [location, keywords] of byLocation) {
      const enrichment = await enrichKeywordMetrics(params.userId, params.plan, keywords, location);
      warnings.push(...enrichment.warnings);
      if (enrichment.source === "dataforseo") {
        const byKeyword = new Map(enrichment.rows.map((r) => [normalizeKeywordForDedup(r.keyword), r]));
        for (const [key, row] of rowByKeyword) {
          if (!key.endsWith(`|${location}`)) continue;
          const metric = byKeyword.get(key.slice(0, -location.length - 1));
          if (!metric) continue;
          row.searchVolume = metric.searchVolume;
          row.difficulty = metric.difficulty;
          row.cpc = metric.cpc;
          row.competition = metric.competition;
          row.intent = metric.intent;
        }
      }
    }
  }

  // 分类汇总 + 排序（机会信号在前：competitorOnly → weaklyOwned → shared(rankGap desc) → projectOnly）
  const categoryOrder: Record<GapCategory, number> = { competitorOnly: 0, weaklyOwned: 1, shared: 2, projectOnly: 3 };
  rows.sort((a, b) =>
    categoryOrder[a.category] - categoryOrder[b.category] ||
    (a.competitorRank ?? 999) - (b.competitorRank ?? 999) ||
    a.keyword.localeCompare(b.keyword)
  );

  const summary = {
    analyzedKeywords: rows.length,
    shared: rows.filter((r) => r.category === "shared").length,
    weaklyOwned: rows.filter((r) => r.category === "weaklyOwned").length,
    competitorOnly: rows.filter((r) => r.category === "competitorOnly").length,
    projectOnly: rows.filter((r) => r.category === "projectOnly").length,
  };

  return {
    competitor: { ...normalizeCompetitor(params.competitorDomain), id: params.competitorId },
    summary,
    keywords: rows.slice(0, limit),
    warnings,
  };
}

// ===== 导出的辅助对比能力（供未来 dashboard / MCP 复用） =====

export { summarizeSerp, calculateSerpOverlap };
