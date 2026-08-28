// ===== AI Search Service（P0-03-B AI Search Intelligence Foundation） =====
// 统一的 AI Search 业务层：Web API 与 MCP 共用。
//
//   AI Search API / MCP ai_search_brand_lookup
//     ↓
//   本 Service（brandLookup / promptExplore / SOV / citations / history / prompt 生成）
//     ↓
//   dataforseo.ts AI Optimization（同一 provider 基础层：auth/timeout/错误封装共用）
//     ↓
//   Cache（ai-search:* 命名空间；仅全成功且有数据才写长期缓存）
//     ↓
//   Usage（consumeQuota("dataforseo")：1 unit = 1 个平台扇出批次 / 1 次模型响应）
//     ↓
//   DB（ai_search_runs：run 摘要持久化 → AI visibility 时间维度，OpenSEO 所无）
//
// 边界：
// - Mention ≠ Citation：mention = 品牌出现在答案/品牌实体中；citation = URL 被引用。
// - AI SOV ≠ Google SERP SOV（P0-02-C sov.ts 是排名分 SOV，两者不混用、不互写）。
// - ChatGPT mentions 库官方仅 US(2840)/en：用户请求其他 locale 时显式降级并加 warning，
//   不静默覆盖（google 平台支持其他 location/language）。
// - 可解释性：不产出不可解释的 visibility score，只输出原始计数 + 公式明确的 aiShareOfVoice。

import {
  AI_SEARCH_MODEL_WHITELIST,
  AI_SEARCH_PLATFORMS,
  assertAiModelAllowed,
  fetchAiLlmResponse,
  fetchAiMentionsSearch,
  fetchAiMultiTargetMetrics,
  fetchAiTargetMetrics,
  fetchAiTopMentionedPages,
  type AiGroupElement,
  type AiMentionItem,
  type AiMentionSource,
  type AiSearchPlatform,
  type AiSearchTargetEntity,
  type AiTopPageItem,
} from "./dataforseo";
import { consumeQuota, readCache, writeCache } from "./cache";
import { createAiSearchRun, listAiSearchRuns } from "@/lib/db/ai-search";
import { extractRegistrableDomain } from "./serpapi";
import type { PlanTier } from "@/lib/auth";

const AI_SEARCH_PROVIDER_VERSION = "dfs-ai-v1";
const BRAND_LOOKUP_CACHE_NAMESPACE = "ai-search:brand-lookup";
const PROMPT_CACHE_NAMESPACE = "ai-search:prompt-response";
/** 与 OpenSEO 同依据：LLM 响应短期稳定、成本高 → 7 天缓存（cache.ts 支持自定义 TTL） */
const PROMPT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Brand Lookup 数据每日刷新、底层月更 → 24h（cache.ts 默认 TTL） */
const BRAND_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;

/** DataForSEO 官方默认（US/en）；ChatGPT mentions 库仅支持该 locale */
export const AI_SEARCH_DEFAULT_LOCATION_CODE = 2840;
export const AI_SEARCH_DEFAULT_LANGUAGE = "en";

const MAX_COMPETITORS = 9; // multi_target_metrics 最多 10 组（target + 9 competitors）
const MENTIONS_PER_PLATFORM = 100;
const MAX_PROMPT_LENGTH = 500; // DataForSEO user_prompt 限制

// ===== 目标检测（brand ≠ domain） =====

export interface AiSearchTarget {
  type: "brand" | "domain";
  /** domain 时为归一值（小写、无 protocol/www）；brand 为原文 trim */
  value: string;
}

export function detectAiTarget(input: string): AiSearchTarget {
  const trimmed = input.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "");
  // 有合法 domain 结构（点分 + TLD 字符）即视为 domain
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(withoutProtocol) && !withoutProtocol.includes(" ")) {
    return { type: "domain", value: withoutProtocol.toLowerCase() };
  }
  return { type: "brand", value: trimmed };
}

function toEntities(target: AiSearchTarget): AiSearchTargetEntity[] {
  return target.type === "domain"
    ? [{ domain: target.value }]
    : [{ keyword: target.value }];
}

/** 品牌名正则：词边界只在字符侧加（C++/AT&T 类品牌不含 \b）——吸收 OpenSEO 的可解释实现 */
function brandMentionRegex(brand: string): RegExp {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = brand[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const last = brand[brand.length - 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leading = /^\w/.test(brand) ? "\\b" : `(?<!${first})`;
  const trailing = /\w$/.test(brand) ? "\\b" : `(?!${last})`;
  return new RegExp(`${leading}${escaped}${trailing}`, "i");
}

/** citation URL 安全过滤：仅 http/https，拒绝 javascript:/data:/file:/vbscript: 等 */
export function safeCitationUrl(url: string | null): string | null {
  if (!url || url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export interface AiCitation {
  url: string;
  domain: string;
  platform: string;
  title: string | null;
  /** 提供来源：mention_sources（答案引用）| top_page（平台引用排名行） */
  sourceType: "mention_sources" | "top_page";
}

function dedupeCitations(citations: AiCitation[]): AiCitation[] {
  const seen = new Set<string>();
  const result: AiCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.platform}::${citation.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

function citationsFromMentions(mentions: AiMentionItem[]): AiCitation[] {
  const result: AiCitation[] = [];
  for (const mention of mentions) {
    for (const source of mention.sources ?? []) {
      const url = safeCitationUrl(source.url);
      if (!url) continue;
      result.push({
        url,
        domain: extractRegistrableDomain(url) ?? source.domain ?? "",
        platform: mention.platform,
        title: source.title,
        sourceType: "mention_sources",
      });
    }
  }
  return result;
}

function citationsFromTopPages(platform: string, pages: AiTopPageItem[]): AiCitation[] {
  const result: AiCitation[] = [];
  for (const page of pages) {
    const url = safeCitationUrl(page.url);
    if (!url) continue;
    result.push({
      url,
      domain: extractRegistrableDomain(url) ?? "",
      platform,
      title: null,
      sourceType: "top_page",
    });
  }
  return result;
}

// ===== AI SOV（跨 target mention 对比；与 SERP SOV 完全独立） =====

export interface AiShareOfVoiceEntry {
  label: string;
  isTarget: boolean;
  mentions: number | null;
  /** mentions / Σmentions × 100（无数据=null ≠ 0） */
  aiSharePct: number | null;
}

export function computeAiShareOfVoice(
  items: Array<{ key: string; totalMentions: number | null }>,
  targetKey: string
): AiShareOfVoiceEntry[] {
  const denominator = items.reduce((sum, item) => sum + (item.totalMentions ?? 0), 0);
  return items
    .map((item) => ({
      label: item.key,
      isTarget: item.key.toLowerCase() === targetKey.toLowerCase(),
      mentions: item.totalMentions,
      aiSharePct:
        item.totalMentions === null || denominator <= 0
          ? null
          : Math.round((item.totalMentions / denominator) * 1000) / 10,
    }))
    .sort((a, b) => (b.mentions ?? -1) - (a.mentions ?? -1) || a.label.localeCompare(b.label));
}

// ===== Brand Lookup =====

export interface AiBrandLookupParams {
  userId: string;
  plan: PlanTier;
  projectId: number;
  target: string;
  /** 最多 9 个（multi_target_metrics 上限 10 组 = target + 9） */
  competitors?: string[];
  locationCode?: number;
  languageCode?: string;
}

export interface AiPlatformBundle {
  platform: AiSearchPlatform;
  status: "success" | "error";
  totalMentions: number | null;
  totalAiSearchVolume: number | null;
  mentions: Array<{
    question: string | null;
    aiSearchVolume: number | null;
    brandEntities: string[];
    citedDomains: string[];
    isWebSearchBased: boolean | null;
  }>;
  /** 平台维度分组（provider 原始分组，target 行） */
  platformGroups: AiGroupElement[];
}

export interface AiBrandLookupResult {
  target: AiSearchTarget;
  platforms: AiPlatformBundle[];
  mentionsTotal: number | null;
  citations: AiCitation[];
  topCitedDomains: Array<{ domain: string; citationCount: number }>;
  /** mentions / Σcompared mentions × 100；无 competitors 或对比失败为 null */
  aiShareOfVoice: AiShareOfVoiceEntry[] | null;
  /** requested ≠ effective 时逐平台给出显式 warning（不静默覆盖 locale） */
  warnings: string[];
  hasData: boolean;
  fromCache: boolean;
  runId: number | null;
  providerCostUsd: number | null;
}

function platformLocaleWarning(platform: AiSearchPlatform, requested: { locationCode: number; languageCode: string }): string | null {
  // ChatGPT mentions 库官方仅 US(2840)/en——显式降级并告知，不静默覆盖
  if (platform === "chat_gpt" && (requested.locationCode !== AI_SEARCH_DEFAULT_LOCATION_CODE || requested.languageCode.toLowerCase() !== "en")) {
    return `platform chat_gpt 的 mentions 数据仅覆盖 US/en；已按官方限制使用 US/en（请求值 location=${requested.locationCode}, language=${requested.languageCode} 已记录在 run 中）`;
  }
  return null;
}

function competitorGroups(target: AiSearchTarget, competitors: string[]): AiSearchTarget[] {
  const seen = new Set([target.value.toLowerCase()]);
  const groups: AiSearchTarget[] = [];
  for (const competitor of competitors) {
    const detected = detectAiTarget(competitor);
    if (!detected.value || seen.has(detected.value.toLowerCase())) continue;
    seen.add(detected.value.toLowerCase());
    groups.push(detected);
    if (groups.length >= MAX_COMPETITORS) break;
  }
  return groups;
}

export async function aiBrandLookup(params: AiBrandLookupParams): Promise<AiBrandLookupResult> {
  const target = detectAiTarget(params.target);
  if (!target.value) {
    throw new AiSearchInputError("target 不能为空");
  }
  const competitors = competitorGroups(target, params.competitors ?? []);
  const requested = {
    locationCode: params.locationCode ?? AI_SEARCH_DEFAULT_LOCATION_CODE,
    languageCode: params.languageCode ?? AI_SEARCH_DEFAULT_LANGUAGE,
  };
  const warnings: string[] = [];

  const cacheParams = {
    v: AI_SEARCH_PROVIDER_VERSION,
    target: target.value.toLowerCase(),
    targetType: target.type,
    competitors: competitors.map((c) => c.value.toLowerCase()).sort().join("|"),
    locationCode: String(requested.locationCode),
    languageCode: requested.languageCode.toLowerCase(),
  };
  const cached = await readCache<AiBrandLookupResult>(BRAND_LOOKUP_CACHE_NAMESPACE, cacheParams);
  if (cached) {
    return { ...cached, target, fromCache: true, runId: cached.runId };
  }

  // 配额：1 unit = 1 个平台扇出批次（3-4 个 provider task，~$0.10/task）
  // 免费套餐 dataforseo_monthly_limit=0 → consumeQuota 抛 QuotaExceededError（由 API 层映射 429）
  const platformBundles: AiPlatformBundle[] = [];
  const allCitations: AiCitation[] = [];
  let providerCostUsd = 0;
  let costKnown = false;

  for (const platform of AI_SEARCH_PLATFORMS) {
    const quota = await consumeQuota(params.userId, "dataforseo", params.plan); // 平台级配额（失败则整批跳过）
    void quota;
    const effective = {
      locationCode: platform === "chat_gpt" ? AI_SEARCH_DEFAULT_LOCATION_CODE : requested.locationCode,
      languageCode: platform === "chat_gpt" ? "en" : requested.languageCode.toLowerCase(),
    };
    const localeWarning = platformLocaleWarning(platform, requested);
    if (localeWarning) warnings.push(localeWarning);

    try {
      // 平台内 3 个 paid 调用独立 settle：单个失败不弃掉已付费的其他调用
      const [metrics, topPages, mentions] = await Promise.all([
        fetchAiTargetMetrics({ entities: toEntities(target), platform, ...effective }).catch((e) => e),
        fetchAiTopMentionedPages({ entities: toEntities(target), platform, ...effective, itemsListLimit: 10 }).catch((e) => e),
        fetchAiMentionsSearch({ entities: toEntities(target), platform, ...effective, limit: MENTIONS_PER_PLATFORM }).catch((e) => e),
      ]);
      rethrowFatal([metrics, topPages, mentions]);

      const metricsOk = !(metrics instanceof Error);
      const topPagesOk = !(topPages instanceof Error);
      const mentionsOk = !(mentions instanceof Error);
      for (const outcome of [metrics, topPages, mentions]) {
        if (outcome instanceof Error) {
          warnings.push(`platform ${platform} 部分调用失败：${outcome.message}`);
        } else if (typeof outcome.cost.usd === "number") {
          providerCostUsd += outcome.cost.usd;
          costKnown = true;
        }
      }
      if (!metricsOk && !topPagesOk && !mentionsOk) throw metrics; // 整平台失败

      const mentionsItems = mentionsOk ? (mentions as Awaited<ReturnType<typeof fetchAiMentionsSearch>>).items : [];
      platformBundles.push({
        platform,
        status: metricsOk && topPagesOk && mentionsOk ? "success" : "error",
        totalMentions: metricsOk ? (metrics as Awaited<ReturnType<typeof fetchAiTargetMetrics>>).totalMentions : null,
        totalAiSearchVolume: metricsOk ? (metrics as Awaited<ReturnType<typeof fetchAiTargetMetrics>>).totalAiSearchVolume : null,
        platformGroups: metricsOk ? (metrics as Awaited<ReturnType<typeof fetchAiTargetMetrics>>).platformGroups : [],
        mentions: mentionsItems.map((item) => ({
          question: item.question,
          aiSearchVolume: item.aiSearchVolume,
          brandEntities: item.brandEntities,
          citedDomains: (item.sources ?? [])
            .map((source: AiMentionSource) => safeCitationUrl(source.url))
            .filter((url): url is string => Boolean(url))
            .map((url) => extractRegistrableDomain(url) ?? ""),
          isWebSearchBased: item.isWebSearchBased,
        })),
      });
      if (topPagesOk) allCitations.push(...citationsFromTopPages(platform, (topPages as Awaited<ReturnType<typeof fetchAiTopMentionedPages>>).items));
      allCitations.push(...citationsFromMentions(mentionsItems));
    } catch (e) {
      if (e instanceof Error && e.message.includes("计费")) throw e; // billing fatal
      warnings.push(`platform ${platform} 查询失败：${(e as Error).message}`);
      platformBundles.push({
        platform, status: "error", totalMentions: null, totalAiSearchVolume: null,
        platformGroups: [], mentions: [],
      });
    }
  }

  // 竞品对比（每平台 1 个 multi_target task；有 competitors 才调用）
  let aiShareOfVoice: AiShareOfVoiceEntry[] | null = null;
  if (competitors.length > 0) {
    const quota = await consumeQuota(params.userId, "dataforseo", params.plan);
    void quota;
    const groups = [
      { key: target.value, entities: toEntities(target) },
      ...competitors.map((competitor) => ({ key: competitor.value, entities: toEntities(competitor) })),
    ];
    const mentionsByKey = new Map<string, number | null>(
      groups.map((group) => [group.key.toLowerCase(), null as number | null])
    );
    let anySuccess = false;
    for (const platform of AI_SEARCH_PLATFORMS) {
      const effective = {
        locationCode: platform === "chat_gpt" ? AI_SEARCH_DEFAULT_LOCATION_CODE : requested.locationCode,
        languageCode: platform === "chat_gpt" ? "en" : requested.languageCode.toLowerCase(),
      };
      try {
        const { items, cost } = await fetchAiMultiTargetMetrics({ groups, platform, ...effective });
        if (typeof cost.usd === "number") {
          providerCostUsd += cost.usd;
          costKnown = true;
        }
        for (const item of items) {
          const key = item.key.toLowerCase();
          if (!mentionsByKey.has(key)) continue;
          const platformMentions = item.platformGroups
            .filter((group) => group.key === platform)
            .reduce((sum, group) => sum + (group.mentions ?? 0), 0);
          const prior = mentionsByKey.get(key) ?? null;
          mentionsByKey.set(key, prior === null ? platformMentions : prior + platformMentions);
        }
        anySuccess = true;
      } catch (e) {
        if (e instanceof Error && e.message.includes("计费")) throw e;
        warnings.push(`platform ${platform} 竞品对比失败：${(e as Error).message}`);
      }
    }
    if (anySuccess) {
      aiShareOfVoice = computeAiShareOfVoice(
        Array.from(mentionsByKey.entries()).map(([key, mentions]) => ({ key, totalMentions: mentions })),
        target.value
      );
    }
  }

  // 域名级 citation 频次
  const domainCounts = new Map<string, number>();
  for (const citation of dedupeCitations(allCitations)) {
    if (!citation.domain) continue;
    domainCounts.set(citation.domain, (domainCounts.get(citation.domain) ?? 0) + 1);
  }
  const topCitedDomains = Array.from(domainCounts.entries())
    .map(([domain, citationCount]) => ({ domain, citationCount }))
    .sort((a, b) => b.citationCount - a.citationCount || a.domain.localeCompare(b.domain))
    .slice(0, 10);

  const hasData = platformBundles.some((bundle) => bundle.totalMentions !== null || bundle.mentions.length > 0);
  const result: AiBrandLookupResult = {
    target,
    platforms: platformBundles,
    mentionsTotal: platformBundles.reduce((sum, bundle) => sum + (bundle.totalMentions ?? 0), 0) || (hasData ? 0 : null),
    citations: dedupeCitations(allCitations).slice(0, 50),
    topCitedDomains,
    aiShareOfVoice,
    warnings,
    hasData,
    fromCache: false,
    runId: null,
    providerCostUsd: costKnown ? Math.round(providerCostUsd * 10000) / 10000 : null,
  };

  // 持久化 run（服务端历史——SeeO 对 OpenSEO 的核心差异；不存 raw answer）
  let runId: number | null = null;
  try {
    runId = await createAiSearchRun(params.userId, {
      user_id: params.userId,
      project_id: params.projectId,
      run_type: "brand_lookup",
      target: target.value,
      target_type: target.type,
      platforms: platformBundles.map((bundle) => `${bundle.platform}:${bundle.status}`),
      models: [],
      requested_location_code: requested.locationCode,
      requested_language: requested.languageCode,
      effective_location_code: requested.locationCode,
      effective_language: requested.languageCode,
      summary: {
        mentionsTotal: result.mentionsTotal,
        citationCount: result.citations.length,
        topCitedDomains: result.topCitedDomains.slice(0, 5),
        aiShareOfVoice: result.aiShareOfVoice,
        platformStatuses: platformBundles.map((bundle) => ({ platform: bundle.platform, status: bundle.status })),
        warnings,
      },
      provider_cost_usd: result.providerCostUsd,
    });
    result.runId = runId;
  } catch {
    warnings.push("run 持久化失败（结果不受影响）");
  }

  // 仅全平台成功且有数据才进入长期缓存（部分失败不冻结 24h）
  const allSucceeded = platformBundles.every((bundle) => bundle.status === "success");
  if (allSucceeded && hasData) {
    try {
      await writeCache(BRAND_LOOKUP_CACHE_NAMESPACE, cacheParams, result, BRAND_LOOKUP_TTL_MS);
    } catch {
      // 缓存写失败不影响结果
    }
  }
  return result;
}

export class AiSearchInputError extends Error {}

function rethrowFatal(outcomes: unknown[]): void {
  for (const outcome of outcomes) {
    if (outcome instanceof Error && outcome.message.includes("计费")) throw outcome;
  }
}

// ===== Prompt Explorer =====

export type AiPromptModel = "chat_gpt" | "perplexity";
export const AI_PROMPT_MODELS: Record<AiPromptModel, string> = {
  chat_gpt: "gpt-5",
  perplexity: "sonar-pro",
};

export interface AiPromptExploreParams {
  userId: string;
  plan: PlanTier;
  projectId: number;
  prompt: string;
  models?: AiPromptModel[];
  /** highlight 品牌的 mention 判定（不参与缓存 key） */
  highlightBrand?: string;
  webSearch?: boolean;
  countryCode?: string;
}

export interface AiPromptModelResult {
  model: AiPromptModel;
  status: "success" | "error";
  modelName: string | null;
  /** 答案摘要（≤1200 字符；完整答案不落库不外发） */
  answerExcerpt: string | null;
  mentionsBrand: boolean | null;
  citations: AiCitation[];
  outputTokens: number | null;
  webSearch: boolean;
  fromCache: boolean;
  error?: string;
}

export interface AiPromptExploreResult {
  prompt: string;
  results: AiPromptModelResult[];
  warnings: string[];
  runId: number | null;
}

export async function aiPromptExplore(params: AiPromptExploreParams): Promise<AiPromptExploreResult> {
  const prompt = params.prompt.trim().replace(/\s+/g, " ");
  if (!prompt) throw new AiSearchInputError("prompt 不能为空");
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new AiSearchInputError(`prompt 长度不能超过 ${MAX_PROMPT_LENGTH} 字符`);
  }
  const models = params.models && params.models.length > 0 ? Array.from(new Set(params.models)) : (["chat_gpt"] as AiPromptModel[]);
  for (const model of models) {
    // 白名单硬门槛：invalid model 不产生 provider task（不扣费）
    assertAiModelAllowed(model, AI_PROMPT_MODELS[model]);
  }
  const highlightBrand = params.highlightBrand?.trim() || null;
  const warnings: string[] = [];
  const results: AiPromptModelResult[] = [];

  for (const model of models) {
    const cacheParams = {
      v: AI_SEARCH_PROVIDER_VERSION,
      model,
      prompt, // 归一化（collapse whitespace + trim）；保留大小写
      webSearch: String(params.webSearch ?? true),
      country: params.countryCode ?? "",
    };
    const cached = await readCache<AiPromptModelResult>(PROMPT_CACHE_NAMESPACE, cacheParams);
    if (cached) {
      results.push({ ...cached, fromCache: true });
      continue;
    }
    try {
      const quota = await consumeQuota(params.userId, "dataforseo", params.plan); // 1 unit = 1 模型响应
      void quota;
      const response = await fetchAiLlmResponse({
        platform: model,
        modelName: AI_PROMPT_MODELS[model],
        userPrompt: prompt,
        webSearch: params.webSearch ?? true,
        webSearchCountryCode: params.countryCode,
      });
      const citations: AiCitation[] = [];
      for (const citation of response.citations) {
        const url = safeCitationUrl(citation.url);
        if (!url) continue;
        citations.push({ url, domain: extractRegistrableDomain(url) ?? "", platform: model, title: citation.title, sourceType: "mention_sources" });
      }
      const brandNeedle = highlightBrand?.toLowerCase() ?? null;
      const mentionsBrand = brandNeedle
        ? citations.some((citation) => citation.url.toLowerCase().includes(brandNeedle) || (citation.title ?? "").toLowerCase().includes(brandNeedle)) ||
          brandMentionRegex(highlightBrand as string).test(response.text)
        : null;
      const modelResult: AiPromptModelResult = {
        model,
        status: "success",
        modelName: response.modelName,
        answerExcerpt: response.text.slice(0, 1200) || null,
        mentionsBrand,
        citations: citations.slice(0, 25),
        outputTokens: response.outputTokens,
        webSearch: response.webSearch,
        fromCache: false,
      };
      results.push(modelResult);
      // 成功响应进 7 天缓存；失败不缓存（可重试）
      try {
        await writeCache(PROMPT_CACHE_NAMESPACE, cacheParams, modelResult, PROMPT_CACHE_TTL_MS);
      } catch {
        // 缓存写失败不影响结果
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("额度已用尽")) throw e; // QuotaExceededError 透传
      results.push({
        model, status: "error", modelName: null, answerExcerpt: null, mentionsBrand: null,
        citations: [], outputTokens: null, webSearch: false, fromCache: false,
        error: (e as Error).message,
      });
      warnings.push(`model ${model} 查询失败：${(e as Error).message}`);
    }
  }

  // 持久化 prompt run（answer 只存 ≤1200 字符摘要）
  let runId: number | null = null;
  try {
    runId = await createAiSearchRun(params.userId, {
      user_id: params.userId,
      project_id: params.projectId,
      run_type: "prompt",
      target: highlightBrand ?? "prompt",
      target_type: highlightBrand ? "brand" : "brand",
      platforms: models,
      models: results.filter((r) => r.status === "success").map((r) => `${r.model}:${r.modelName}`),
      requested_location_code: params.countryCode ? null : AI_SEARCH_DEFAULT_LOCATION_CODE,
      requested_language: null,
      effective_location_code: null,
      effective_language: null,
      summary: {
        prompt,
        mentionsBrand: results.map((r) => ({ model: r.model, status: r.status, mentionsBrand: r.mentionsBrand })),
        citationCount: results.reduce((sum, r) => sum + r.citations.length, 0),
        warnings,
      },
      provider_cost_usd: null,
    });
  } catch {
    warnings.push("run 持久化失败（结果不受影响）");
  }

  return { prompt, results, warnings, runId };
}

// ===== History（run 列表 + 相邻 run 对比基础） =====

export async function aiSearchRunHistory(userId: string, params: {
  projectId: number;
  runType?: string;
  target?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  return listAiSearchRuns(userId, params);
}

// ===== Prompt 生成（纯函数，不自动执行；New capability 地基） =====

const PROMPT_TEMPLATES = [
  (keyword: string) => `best ${keyword}`,
  (keyword: string) => `top ${keyword} tools`,
  (keyword: string) => `${keyword} recommendations`,
  (keyword: string) => `what is the best tool for ${keyword}`,
  (keyword: string) => `${keyword} alternatives`,
];

/** Keyword → AI Search prompt 候选（确定性模板，去重；执行由用户/后续 automation 决定） */
export function generateAiSearchPrompts(keywords: string[], limit = 10): string[] {
  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) continue;
    for (const template of PROMPT_TEMPLATES) {
      const prompt = template(normalized);
      const key = prompt.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      prompts.push(prompt);
      if (prompts.length >= limit) return prompts;
    }
  }
  return prompts;
}

// ===== 白名单导出（供 API 层校验展示） =====
export { AI_SEARCH_MODEL_WHITELIST, AI_SEARCH_PLATFORMS };
