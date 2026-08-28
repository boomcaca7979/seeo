// ===== Keyword Research Service（P0-02-A Keyword Intelligence） =====
// 统一的 Keyword Research 业务层：Web API 与 MCP 共用，禁止各自实现。
//
//   Keyword API / MCP research_keywords
//     ↓
//   本 Service（扩词：现有 serp-service；指标补全：dataforseo.ts keyword metrics）
//     ↓
//   Provider（SerpApi + DataForSEO）
//     ↓
//   Cache（serp / kw-metrics 命名空间，缓存位于 Service 层而非 MCP）
//     ↓
//   Usage / Billing（consumeQuota：serpapi 与 dataforseo 各自按既有规则计数，不重复）
//     ↓
//   DB（tracked_keywords / keyword_groups 等既有模型）
//
// 数据真实性原则：所有指标均为 provider 真实数据；provider 未覆盖一律 null，
// 不猜测、不推算冒充、不用 LLM 生成。唯一数值换算是 competition_index / 100（单位换算）。

import type { ApiUsage } from "./types";
import type { PlanTier } from "@/lib/auth";
import { consumeQuota, peekUsage, readCache, writeCache } from "./cache";
import { expandKeyword, getSerpUsage } from "./serp-service";
import { fetchKeywordMetrics, type KeywordMetricRow } from "./dataforseo";

export const KEYWORD_METRICS_CACHE_NAMESPACE = "kw-metrics";
/** 单次指标补全的最大关键词数（DataForSEO 上限 700，这里取更保守的批次上限） */
export const KEYWORD_METRICS_BATCH_LIMIT = 100;

export type KeywordOrigin = "seed" | "related" | "paa";

/** 统一 Keyword Intelligence 结果模型 */
export interface KeywordIntelligenceKeyword {
  keyword: string;
  origin: KeywordOrigin;
  seed: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  intent: string | null;
  trend: { year: number; month: number; searchVolume: number }[] | null;
  /** 指标来源：有补全数据的行为 "dataforseo"，否则 "serpapi"（keyword 字符串本身来自 SerpApi 扩词） */
  source: "serpapi" | "dataforseo";
}

export interface KeywordMetricsMeta {
  /** 指标补全是否发生：null = 未请求或完全不可用 */
  source: "dataforseo" | null;
  fromCache: boolean;
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
  metrics: KeywordMetricsMeta;
  unavailableMetrics: string[];
  usage: { serp: ApiUsage; dataforseo: ApiUsage };
}

const ALL_METRIC_FIELDS = ["searchVolume", "difficulty", "cpc", "competition", "intent", "trend"] as const;

/** 去重 key：与 OpenSEO 一致的 trim + 小写归一 */
export function normalizeKeywordForDedup(keyword: string): string {
  return keyword.trim().toLowerCase();
}

/**
 * 合并 seed / related / paa 为去重后的候选关键词列表（保留首次出现的原文）。
 */
export function mergeKeywordCandidates(
  seed: string,
  related: string[],
  paa: string[],
  limit: number
): { keyword: string; origin: KeywordOrigin }[] {
  const seen = new Set<string>();
  const candidates: { keyword: string; origin: KeywordOrigin }[] = [];
  const push = (keyword: string, origin: KeywordOrigin) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    const key = normalizeKeywordForDedup(trimmed);
    if (seen.has(key)) return;
    if (candidates.length >= limit) return;
    seen.add(key);
    candidates.push({ keyword: trimmed, origin });
  };
  push(seed, "seed");
  for (const keyword of related) push(keyword, "related");
  for (const keyword of paa) push(keyword, "paa");
  return candidates;
}

/** 按 provider 数据行统计哪些指标整体不可用（真实数据缺失即视为 unavailable） */
export function computeUnavailableMetrics(rows: KeywordIntelligenceKeyword[]): string[] {
  return ALL_METRIC_FIELDS.filter((field) =>
    rows.every((row) => row[field] === null)
  );
}

function metricsCacheKey(keywords: { keyword: string }[], location: string, language: string): Record<string, string> {
  return {
    provider: "dfs-v1",
    keywords: keywords.map((k) => normalizeKeywordForDedup(k.keyword)).sort().join("\n"),
    location,
    language,
  };
}

function applyMetrics(
  seed: string,
  keywords: { keyword: string; origin: KeywordOrigin }[],
  rows: KeywordMetricRow[]
): KeywordIntelligenceKeyword[] {
  const byKeyword = new Map<string, KeywordMetricRow>();
  for (const row of rows) byKeyword.set(normalizeKeywordForDedup(row.keyword), row);
  return keywords.map(({ keyword, origin }) => {
    const metric = byKeyword.get(normalizeKeywordForDedup(keyword));
    const hasMetrics = metric !== undefined;
    return {
      keyword,
      origin,
      seed,
      searchVolume: metric?.searchVolume ?? null,
      difficulty: metric?.difficulty ?? null,
      cpc: metric?.cpc ?? null,
      competition: metric?.competition ?? null,
      competitionLevel: metric?.competitionLevel ?? null,
      intent: metric?.intent ?? null,
      trend: metric?.trend ?? null,
      source: hasMetrics ? "dataforseo" : "serpapi",
    };
  });
}

/**
 * 核心入口：seed 扩词（SerpApi）+ 指标补全（DataForSEO，缓存优先，配额不足时优雅降级）。
 */
export async function researchKeywords(
  userId: string,
  plan: PlanTier,
  params: KeywordResearchParams
): Promise<KeywordResearchResult> {
  const limit = Math.max(1, params.limit ?? 50);
  const enrichMetrics = params.enrichMetrics !== false;
  const warnings: string[] = [];

  // 1. 扩词：现有 SerpApi 能力（缓存 + 用量都在 serp-service 内）
  const expansion = await expandKeyword(userId, plan, {
    keyword: params.keyword,
    location: params.location,
    device: params.device,
  });
  const candidates = mergeKeywordCandidates(params.keyword, expansion.related, expansion.paa, limit);

  // 2. 指标补全：DataForSEO（缓存优先 → 配额 → provider → 归一化）
  let metricsSource: "dataforseo" | null = null;
  let metricsFromCache = false;
  let metricRows: KeywordMetricRow[] = [];
  if (enrichMetrics && candidates.length > 0) {
    const cacheParams = metricsCacheKey(candidates, params.location, params.language ?? "");
    const cached = await readCache<KeywordMetricRow[]>(KEYWORD_METRICS_CACHE_NAMESPACE, cacheParams);
    if (cached) {
      metricRows = cached;
      metricsSource = "dataforseo";
      metricsFromCache = true;
    } else {
      try {
        // DataForSEO 补全批次按 1 个 dataforseo 单位计费（与 backlink-service 的 fetchBacklinks 同惯例），
        // 计费只发生在 provider 真实调用前的这一处；MCP/API 层不再重复记账。
        await consumeQuota(userId, "dataforseo", plan);
        const result = await fetchKeywordMetrics(
          candidates.map((c) => c.keyword),
          { location: params.location, language: params.language }
        );
        metricRows = result.rows;
        metricsSource = "dataforseo";
        warnings.push(...result.warnings);
        try {
          await writeCache(KEYWORD_METRICS_CACHE_NAMESPACE, cacheParams, metricRows);
        } catch {
          // 缓存写失败不影响结果
        }
      } catch (e) {
        // 优雅降级：指标保持 null，不使扩词结果失败
        warnings.push(`keyword metrics 不可用：${(e as Error).message}`);
      }
    }
  } else if (!enrichMetrics) {
    warnings.push("keyword metrics 未启用（enrichMetrics=false）");
  }

  const keywords = applyMetrics(params.keyword, candidates, metricRows);

  return {
    seed: expansion.seed,
    location: expansion.location,
    device: expansion.device,
    keywords,
    related: expansion.related,
    paa: expansion.paa,
    fromCache: expansion.fromCache,
    metrics: { source: metricsSource, fromCache: metricsFromCache, warnings },
    unavailableMetrics: computeUnavailableMetrics(keywords),
    usage: {
      serp: await getSerpUsage(userId, plan),
      dataforseo: await peekUsage(userId, "dataforseo", plan),
    },
  };
}
