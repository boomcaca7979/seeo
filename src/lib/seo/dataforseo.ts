// ===== DataForSEO 实现（服务端专用） =====
// Backlinks：https://docs.dataforseo.com/v3/seo/backlinks/api/
// Keyword metrics：
//   - https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
//   - https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/
// 仅在 API Route / Service 中通过 import 调用，确保 DATAFORSEO_LOGIN/PASSWORD 不暴露到前端 bundle

export interface BacklinkSummary {
  total_backlinks: number | null;
  referring_domains: number | null;
  domain_rank: number | null;
  dofollow_pct: number | null;
}

export interface BacklinkItem {
  source_url: string | null;
  anchor: string | null;
  target_url: string | null;
  dofollow: number | null; // 0/1
  source_rank: number | null;
  first_seen: string | null; // ISO YYYY-MM-DD
}

export interface BacklinkData {
  summary: BacklinkSummary;
  backlinks: BacklinkItem[];
  rawJson: { summary: unknown; backlinks: unknown };
}

/** 未配置凭证时的明确错误 */
export class DataForSeoNotConfiguredError extends Error {
  constructor() {
    super("未配置 DataForSEO 凭证（DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD）");
    this.name = "DataForSeoNotConfiguredError";
  }
}

/** DataForSEO 业务错误（透传 status_message） */
export class DataForSeoApiError extends Error {
  status_code: number;
  status_message: string;
  constructor(status_code: number, status_message: string) {
    super(`DataForSEO 错误 [${status_code}]: ${status_message}`);
    this.name = "DataForSeoApiError";
    this.status_code = status_code;
    this.status_message = status_message;
  }
}

const UPSTREAM_TIMEOUT_MS = 30_000;
const API_BASE = "https://api.dataforseo.com/v3";

function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new DataForSeoNotConfiguredError();
  }
  const token = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${token}`;
}

interface DfsTask<T> {
  status_code: number;
  status_message: string;
  /** DataForSEO 每任务真实成本（USD），AI Optimization 响应携带，用于 run 记录 */
  cost?: number;
  result?: T[];
}

interface DfsResponse<T> {
  version: string;
  status_code: number;
  status_message: string;
  tasks: DfsTask<T>[];
}

interface DfsSummaryItem {
  type: string;
  total_backlinks?: number;
  referring_domains?: number;
  domain_rank?: number;
  backlinks?: {
    dofollow?: number;
    nofollow?: number;
  };
  info?: {
    backlinks?: number;
    referring_domains?: number;
    domain_rank?: number;
  };
}

interface DfsSummaryResult {
  total_count: number;
  items_count?: number;
  items?: DfsSummaryItem[];
}

interface DfsBacklinkItem {
  type: string;
  rank?: number;
  domain_from?: string;
  url_from?: string;
  url_to?: string;
  anchor?: string;
  is_dofollow?: boolean;
  first_seen?: string;
}

interface DfsBacklinksResult {
  total_count: number;
  items?: DfsBacklinkItem[];
}

function extractSummary(raw: DfsResponse<DfsSummaryResult>): BacklinkSummary {
  const item = raw.tasks?.[0]?.result?.[0]?.items?.[0];
  if (!item) {
    return {
      total_backlinks: null,
      referring_domains: null,
      domain_rank: null,
      dofollow_pct: null,
    };
  }
  // DataForSEO 返回结构兼容多版本：直接字段或 info 嵌套
  const total = item.total_backlinks ?? item.info?.backlinks ?? null;
  const refDomains = item.referring_domains ?? item.info?.referring_domains ?? null;
  const rank = item.domain_rank ?? item.info?.domain_rank ?? null;
  const dofollow = item.backlinks?.dofollow ?? null;
  const nofollow = item.backlinks?.nofollow ?? null;
  let dofollowPct: number | null = null;
  if (dofollow !== null && nofollow !== null && dofollow + nofollow > 0) {
    dofollowPct = Math.round((dofollow / (dofollow + nofollow)) * 1000) / 10;
  }
  return {
    total_backlinks: total !== null ? Number(total) : null,
    referring_domains: refDomains !== null ? Number(refDomains) : null,
    domain_rank: rank !== null ? Number(rank) : null,
    dofollow_pct: dofollowPct,
  };
}

function extractBacklinks(raw: DfsResponse<DfsBacklinksResult>): BacklinkItem[] {
  const items = raw.tasks?.[0]?.result?.[0]?.items ?? [];
  return items
    .filter((it) => it.type === "backlink")
    .map((it) => ({
      source_url: it.url_from ?? null,
      anchor: it.anchor ?? null,
      target_url: it.url_to ?? null,
      dofollow: it.is_dofollow === undefined ? null : (it.is_dofollow ? 1 : 0),
      source_rank: it.rank ?? null,
      first_seen: it.first_seen ?? null,
    }));
}

async function dfsFetch<T>(path: string, payload: unknown): Promise<DfsResponse<T>> {
  const authHeader = getAuthHeader();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json: DfsResponse<T>;
    try {
      json = JSON.parse(text) as DfsResponse<T>;
    } catch {
      throw new Error(`DataForSEO 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    // HTTP 层错误
    if (!res.ok) {
      const msg = json.status_message || `HTTP ${res.status}`;
      throw new DataForSeoApiError(res.status, msg);
    }
    // 顶层业务错误
    if (json.status_code !== 20000) {
      throw new DataForSeoApiError(json.status_code, json.status_message || "未知错误");
    }
    // task 层错误
    const task = json.tasks?.[0];
    if (task && task.status_code !== 20000) {
      throw new DataForSeoApiError(task.status_code, task.status_message || "任务错误");
    }
    return json;
  } catch (e) {
    if (e instanceof DataForSeoNotConfiguredError) throw e;
    if (e instanceof DataForSeoApiError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("DataForSEO 请求超时（30s）");
    }
    throw new Error(`DataForSEO 请求失败：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchBacklinksOptions {
  limit?: number; // 外链列表条数，默认 100
}

/**
 * 并行拉取 summary + backlinks 两个端点。
 * 返回标准化数据 + 原始 JSON（存 raw_json 便于后续回溯）。
 */
export async function fetchBacklinks(
  domain: string,
  options?: FetchBacklinksOptions
): Promise<BacklinkData> {
  const limit = options?.limit ?? 100;
  const target = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();

  const [summaryRes, backlinksRes] = await Promise.all([
    dfsFetch<DfsSummaryResult>("/backlinks/summary/live", {
      target: target,
      include_subdomains: false,
      internal_list_limit: 1,
    }),
    dfsFetch<DfsBacklinksResult>("/backlinks/backlinks/live", {
      target: target,
      include_subdomains: false,
      limit,
      order_by: ["rank,desc"],
    }),
  ]);

  return {
    summary: extractSummary(summaryRes),
    backlinks: extractBacklinks(backlinksRes),
    rawJson: { summary: summaryRes, backlinks: backlinksRes },
  };
}

/** 是否已配置凭证（供路由层提前判断） */
export function isDataForSeoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

// ===== Keyword Metrics（P0-02-A Keyword Intelligence） =====
// 数据来源（均为 provider 真实数据，缺失即返回 null，绝不推算）：
//   - searchVolume / cpc / competition / trend → keywords_data/google_ads/search_volume/live
//   - difficulty → dataforseo_labs/google/bulk_keyword_difficulty/live
//   - intent → DataForSEO 仅在 Labs keyword_data（suggestions/related）中提供 intent，
//     精确关键词批量补全没有对应 endpoint，V1 统一返回 null（由上层标记 unavailable）

export interface KeywordTrendPoint {
  year: number;
  month: number;
  searchVolume: number;
}

/** 单个关键词的 provider 指标（无数据的字段为 null） */
export interface KeywordMetricRow {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  /** 付费竞争度 0-1，来自 competition_index / 100（单位换算，非推算） */
  competition: number | null;
  /** Google Ads 原生竞争度枚举（LOW/MEDIUM/HIGH） */
  competitionLevel: string | null;
  difficulty: number | null;
  /** DataForSEO 不为精确关键词批量补全提供 intent，固定 null */
  intent: null;
  trend: KeywordTrendPoint[] | null;
  currency: string | null;
}

export interface KeywordMetricsOptions {
  /** SeeO 地点名（中文），如「中国」「美国」；未收录时返回不可用原因 */
  location: string;
  /** DataForSEO language_name，缺省用地点默认语言 */
  language?: string;
}

export interface KeywordMetricsResult {
  rows: KeywordMetricRow[];
  /** difficulty 端点是否成功返回（失败时 difficulty 全为 null） */
  difficultyAvailable: boolean;
  /** 非致命告警（difficulty 失败、地点未收录等） */
  warnings: string[];
}

/** SeeO 地点名 → DataForSEO location_name + 默认 language_name */
export const DFS_KEYWORD_LOCATIONS: Record<string, { locationName: string; languageName: string }> = {
  中国: { locationName: "China", languageName: "Chinese (Simplified)" },
  美国: { locationName: "United States", languageName: "English" },
  日本: { locationName: "Japan", languageName: "Japanese" },
  英国: { locationName: "United Kingdom", languageName: "English" },
  德国: { locationName: "Germany", languageName: "German" },
  香港: { locationName: "Hong Kong", languageName: "Chinese (Traditional)" },
  台湾: { locationName: "Taiwan", languageName: "Chinese (Traditional)" },
};

/** DataForSEO 批量端点单次最多 700 个关键词 */
export const DFS_KEYWORD_BATCH_LIMIT = 700;

interface DfsSearchVolumeItem {
  keyword?: string | null;
  search_volume?: number | null;
  competition?: string | null;
  competition_index?: number | null;
  cpc?: number | null;
  currency?: string | null;
  monthly_searches?: Array<{
    year?: number | null;
    month?: number | null;
    search_volume?: number | null;
  }> | null;
}

interface DfsKeywordDifficultyItem {
  keyword?: string | null;
  keyword_difficulty?: number | null;
}

interface DfsResultEnvelope {
  items?: DfsSearchVolumeItem[] | DfsKeywordDifficultyItem[];
  [key: string]: unknown;
}

/**
 * DataForSEO result 兼容两种形态：items 数组包裹，或 result 本身就是 item 数组。
 * 统一提取，避免对响应形态做过强假设。
 */
function extractDfsItems<T>(raw: DfsResponse<T>): unknown[] {
  const result = raw.tasks?.[0]?.result;
  if (!Array.isArray(result) || result.length === 0) return [];
  const first = result[0] as DfsResultEnvelope | undefined;
  if (first && Array.isArray(first.items)) return first.items;
  if (result[0] && typeof result[0] === "object" && "keyword" in (result[0] as object)) {
    return result as unknown[];
  }
  return [];
}

function normalizeTrend(
  monthly: DfsSearchVolumeItem["monthly_searches"],
): KeywordTrendPoint[] | null {
  if (!monthly || monthly.length === 0) return null;
  const points = monthly
    .map((entry) => ({
      year: typeof entry.year === "number" ? entry.year : 0,
      month: typeof entry.month === "number" ? entry.month : 0,
      searchVolume: typeof entry.search_volume === "number" ? entry.search_volume : 0,
    }))
    .filter((point) => point.year > 0 || point.month > 0 || point.searchVolume > 0);
  return points.length > 0 ? points : null;
}

function normalizeSearchVolumeItems(items: unknown[]): Map<string, DfsSearchVolumeItem> {
  const byKeyword = new Map<string, DfsSearchVolumeItem>();
  for (const item of items) {
    const row = item as DfsSearchVolumeItem;
    if (typeof row.keyword !== "string" || !row.keyword.trim()) continue;
    byKeyword.set(row.keyword.trim().toLowerCase(), row);
  }
  return byKeyword;
}

function normalizeDifficultyItems(items: unknown[]): Map<string, number | null> {
  const byKeyword = new Map<string, number | null>();
  for (const item of items) {
    const row = item as DfsKeywordDifficultyItem;
    if (typeof row.keyword !== "string" || !row.keyword.trim()) continue;
    const kd = typeof row.keyword_difficulty === "number" ? row.keyword_difficulty : null;
    byKeyword.set(row.keyword.trim().toLowerCase(), kd);
  }
  return byKeyword;
}

function normalizeMetricRow(
  keyword: string,
  volume: DfsSearchVolumeItem | undefined,
  difficulty: number | null,
): KeywordMetricRow {
  const competitionIndex = typeof volume?.competition_index === "number" ? volume.competition_index : null;
  return {
    keyword,
    searchVolume: typeof volume?.search_volume === "number" ? volume.search_volume : null,
    cpc: typeof volume?.cpc === "number" ? volume.cpc : null,
    competition: competitionIndex !== null ? Math.round((competitionIndex / 100) * 1000) / 1000 : null,
    competitionLevel: typeof volume?.competition === "string" ? volume.competition : null,
    difficulty,
    intent: null,
    trend: volume ? normalizeTrend(volume.monthly_searches) : null,
    currency: typeof volume?.currency === "string" ? volume.currency : null,
  };
}

/**
 * 为精确关键词列表批量补全真实 provider 指标。
 * keywords 顺序即返回行顺序；provider 未覆盖的关键词字段为 null。
 * 抛出 DataForSeoNotConfiguredError / DataForSeoApiError / QuotaExceededError（由上层决定降级策略）。
 */
export async function fetchKeywordMetrics(
  keywords: string[],
  options: KeywordMetricsOptions
): Promise<KeywordMetricsResult> {
  const batch = keywords.map((k) => k.trim()).filter(Boolean).slice(0, DFS_KEYWORD_BATCH_LIMIT);
  if (batch.length === 0) {
    return { rows: [], difficultyAvailable: false, warnings: [] };
  }
  const market = DFS_KEYWORD_LOCATIONS[options.location];
  if (!market) {
    return {
      rows: batch.map((keyword) => normalizeMetricRow(keyword, undefined, null)),
      difficultyAvailable: false,
      warnings: [`location 不受 DataForSEO keyword metrics 支持：${options.location}`],
    };
  }
  const languageName = options.language?.trim() || market.languageName;

  const volumeRes = await dfsFetch<DfsSearchVolumeItem>("/keywords_data/google_ads/search_volume/live", {
    keywords: batch,
    location_name: market.locationName,
    language_name: languageName,
    search_partners: false,
  });
  const volumes = normalizeSearchVolumeItems(extractDfsItems(volumeRes));

  // difficulty 依赖 Labs；失败不影响 volume/cpc/competition，仅记录告警
  let difficultyAvailable = false;
  const difficultyWarnings: string[] = [];
  const difficulties = new Map<string, number | null>();
  try {
    const difficultyRes = await dfsFetch<DfsKeywordDifficultyItem>(
      "/dataforseo_labs/google/bulk_keyword_difficulty/live",
      {
        keywords: batch,
        location_name: market.locationName,
        language_name: languageName,
      }
    );
    for (const [keyword, kd] of normalizeDifficultyItems(extractDfsItems(difficultyRes))) {
      difficulties.set(keyword, kd);
    }
    difficultyAvailable = difficulties.size > 0;
    if (!difficultyAvailable) {
      difficultyWarnings.push("keyword difficulty 端点未返回数据");
    }
  } catch (e) {
    if (e instanceof DataForSeoNotConfiguredError) throw e;
    difficultyWarnings.push(`keyword difficulty 不可用：${(e as Error).message}`);
  }

  const rows = batch.map((keyword) =>
    normalizeMetricRow(keyword, volumes.get(keyword.toLowerCase()), difficulties.get(keyword.toLowerCase()) ?? null)
  );
  return { rows, difficultyAvailable, warnings: difficultyWarnings };
}

// ===== AI Optimization（P0-03-B AI Search Intelligence） =====
// 数据来源：DataForSEO AI Optimization API（LLM Mentions 库 + 实时 LLM Responses）。
// 端点路径 Verified at 2026-08-29（官方文档）：
//   - /ai_optimization/llm_mentions/search_mentions/live      （~$0.103/task，legacy search/live 的当前版）
//   - /ai_optimization/llm_mentions/target_metrics/live        （~$0.101/task，legacy aggregated_metrics 的当前版）
//   - /ai_optimization/llm_mentions/top_mentioned_pages/live   （~$0.101/task，legacy top_pages 的当前版）
//   - /ai_optimization/llm_mentions/multi_target_metrics/live  （2-10 targets 同场对比，~$0.101/task）
//   - /ai_optimization/{platform}/llm_responses/live           （实时 LLM 回答，成本 = base + token 费）
// 平台限制（官方文档明确）：llm_mentions 的 chat_gpt 数据仅 US(2840)/en；
// platform 只支持 "chat_gpt" | "google"（google = Google AI Overview）。
// 本节只做 HTTP + 归一 + 错误分类；缓存/配额/持久化在 ai-search-service。

/** AI Search 稳定错误码（进 api-error-catalog / MCP normalizeMcpError） */
export type AiSearchErrorCode =
  | "AI_SEARCH_INVALID_MODEL"          // model_name 不在白名单——派发前拦截，避免失败任务扣费
  | "AI_SEARCH_UNSUPPORTED_PLATFORM"
  | "AI_SEARCH_PROVIDER_ERROR"
  | "AI_SEARCH_BILLING_ISSUE";         // 余额/计费类致命错误，不可被平台降级吞掉

export class AiSearchProviderError extends Error {
  code: AiSearchErrorCode;
  constructor(code: AiSearchErrorCode, message: string) {
    super(message);
    this.name = "AiSearchProviderError";
    this.code = code;
  }
}

/**
 * 实时 LLM Responses 模型白名单（官方 /models 端点目录，Verified at 2026-08-29）。
 * DataForSEO 对 `Invalid Field: 'model_name'` 的失败任务也扣费——任何 model_name
 * 必须先过此白名单再派发。更新方式：核对 /v3/ai_optimization/{platform}/llm_responses/models。
 */
export const AI_SEARCH_MODEL_WHITELIST: Record<string, ReadonlySet<string>> = {
  chat_gpt: new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"]),
  perplexity: new Set(["sonar-reasoning-pro", "sonar-pro", "sonar"]),
};

/** reasoning 模型的 max_output_tokens 下限（隐藏思维链计入预算） */
const AI_REASONING_MODELS = new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano", "sonar-reasoning-pro"]);

export type AiSearchPlatform = "chat_gpt" | "google";
export const AI_SEARCH_PLATFORMS: readonly AiSearchPlatform[] = ["chat_gpt", "google"];

export interface AiSearchTargetEntity {
  /** domain（不含 https:// 和 www.）或 keyword（≤250 字符） */
  domain?: string;
  keyword?: string;
  include_subdomains?: boolean;
  match_type?: "word_match" | "partial_match";
}

/** provider 原始 mention 源引用（URL 在 service 层做安全过滤） */
export interface AiMentionSource {
  url: string | null;
  domain: string | null;
  title: string | null;
  position: number | null;
}

export interface AiMentionItem {
  platform: string;
  modelName: string | null;
  question: string | null;
  aiSearchVolume: number | null;
  monthlySearches: Array<{ year: number; month: number; searchVolume: number }>;
  sources: AiMentionSource[];
  brandEntities: string[];
  isWebSearchBased: boolean | null;
}

export interface AiGroupElement {
  key: string;
  mentions: number | null;
  aiSearchVolume: number | null;
}

export interface AiTopPageItem {
  url: string;
  platformGroups: AiGroupElement[];
}

export interface AiMultiTargetItem {
  key: string;
  totalMentions: number | null;
  totalAiSearchVolume: number | null;
  platformGroups: AiGroupElement[];
}

export interface AiProviderCost {
  /** 本次任务 DataForSEO 真实成本（USD，响应 cost 字段），缺失为 null */
  usd: number | null;
}

function aiTaskCost(raw: DfsResponse<unknown>): number | null {
  const cost = raw.tasks?.[0]?.cost;
  return typeof cost === "number" ? cost : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeMentionItem(item: any): AiMentionItem {
  return {
    platform: str(item?.platform) ?? "unknown",
    modelName: str(item?.model_name),
    question: str(item?.question),
    aiSearchVolume: num(item?.ai_search_volume),
    monthlySearches: Array.isArray(item?.monthly_searches)
      ? item.monthly_searches.map((entry: any) => ({
          year: num(entry?.year) ?? 0,
          month: num(entry?.month) ?? 0,
          searchVolume: num(entry?.search_volume) ?? 0,
        }))
      : [],
    sources: Array.isArray(item?.sources)
      ? item.sources.map((source: any) => ({
          url: str(source?.url),
          domain: str(source?.domain),
          title: str(source?.title),
          position: num(source?.position),
        }))
      : [],
    brandEntities: Array.isArray(item?.brand_entities)
      ? item.brand_entities.map((entity: any) => str(entity?.title)).filter((title: string | null): title is string => Boolean(title))
      : [],
    isWebSearchBased: typeof item?.is_web_search_based === "boolean" ? item.is_web_search_based : null,
  };
}

function normalizeGroupElements(value: any): AiGroupElement[] {
  return Array.isArray(value)
    ? value.map((entry: any) => ({
        key: str(entry?.key) ?? "",
        mentions: num(entry?.mentions),
        aiSearchVolume: num(entry?.ai_search_volume),
      }))
    : [];
}

function buildTargetPayload(entities: AiSearchTargetEntity[]): unknown[] {
  return entities.map((entity) =>
    entity.domain !== undefined
      ? { domain: entity.domain, search_filter: "include", include_subdomains: entity.include_subdomains ?? false }
      : { keyword: entity.keyword, search_filter: "include", match_type: entity.match_type ?? "word_match" }
  );
}

async function assertAiTaskOk(raw: DfsResponse<unknown>, endpoint: string): Promise<void> {
  const message = str((raw as { status_message?: unknown }).status_message) ?? "";
  // 余额/计费类错误必须上抛为 fatal（不可被 per-platform 降级吞掉）
  if (/balance|billing|money/i.test(message)) {
    throw new AiSearchProviderError("AI_SEARCH_BILLING_ISSUE", `DataForSEO AI Search 计费问题：${message}`);
  }
  void endpoint;
}

/** Mentions Search（当前端点 search_mentions/live）：目标相关的 LLM 答案行 */
export async function fetchAiMentionsSearch(params: {
  entities: AiSearchTargetEntity[];
  platform: AiSearchPlatform;
  locationCode: number;
  languageCode: string;
  limit?: number;
}): Promise<{ items: AiMentionItem[]; cost: AiProviderCost }> {
  const raw = await dfsFetch<any>("/ai_optimization/llm_mentions/search_mentions/live", {
    target: buildTargetPayload(params.entities),
    platform: params.platform,
    location_code: params.locationCode,
    language_code: params.languageCode,
    limit: Math.min(1000, Math.max(1, params.limit ?? 100)),
  });
  await assertAiTaskOk(raw, "search_mentions");
  const items = Array.isArray(raw.tasks?.[0]?.result?.[0]?.items)
    ? raw.tasks[0].result[0].items.map(normalizeMentionItem)
    : [];
  return { items, cost: { usd: aiTaskCost(raw) } };
}

/** Target Metrics（当前端点）：单目标 mention 总量/平台分组/被引域名 */
export async function fetchAiTargetMetrics(params: {
  entities: AiSearchTargetEntity[];
  platform: AiSearchPlatform;
  locationCode: number;
  languageCode: string;
}): Promise<{ platformGroups: AiGroupElement[]; totalMentions: number | null; totalAiSearchVolume: number | null; cost: AiProviderCost }> {
  const raw = await dfsFetch<any>("/ai_optimization/llm_mentions/target_metrics/live", {
    target: buildTargetPayload(params.entities),
    platform: params.platform,
    location_code: params.locationCode,
    language_code: params.languageCode,
    internal_list_limit: 10,
  });
  await assertAiTaskOk(raw, "target_metrics");
  const result = raw.tasks?.[0]?.result?.[0] ?? {};
  const total = result.total ?? {};
  return {
    platformGroups: normalizeGroupElements(result.aggregated_metrics?.platform),
    totalMentions: num(total?.mentions),
    totalAiSearchVolume: num(total?.ai_search_volume),
    cost: { usd: aiTaskCost(raw) },
  };
}

/** Top Mentioned Pages（当前端点）：被引用最多的页面（citation 排名行） */
export async function fetchAiTopMentionedPages(params: {
  entities: AiSearchTargetEntity[];
  platform: AiSearchPlatform;
  locationCode: number;
  languageCode: string;
  itemsListLimit?: number;
}): Promise<{ items: AiTopPageItem[]; cost: AiProviderCost }> {
  const raw = await dfsFetch<any>("/ai_optimization/llm_mentions/top_mentioned_pages/live", {
    target: buildTargetPayload(params.entities),
    platform: params.platform,
    location_code: params.locationCode,
    language_code: params.languageCode,
    links_scope: "sources",
    items_list_limit: Math.min(10, Math.max(1, params.itemsListLimit ?? 10)),
    internal_list_limit: 5,
  });
  await assertAiTaskOk(raw, "top_mentioned_pages");
  const items = Array.isArray(raw.tasks?.[0]?.result?.[0]?.items)
    ? raw.tasks[0].result[0].items.map((item: any) => ({
        url: str(item?.key) ?? "",
        platformGroups: normalizeGroupElements(item?.platform),
      }))
    : [];
  return { items, cost: { usd: aiTaskCost(raw) } };
}

/** Multi-Target Metrics（当前端点）：2-10 个 target 同场对比（AI SOV 基础） */
export async function fetchAiMultiTargetMetrics(params: {
  groups: Array<{ key: string; entities: AiSearchTargetEntity[] }>;
  platform: AiSearchPlatform;
  locationCode: number;
  languageCode: string;
}): Promise<{ items: AiMultiTargetItem[]; cost: AiProviderCost }> {
  if (params.groups.length < 2 || params.groups.length > 10) {
    throw new AiSearchProviderError("AI_SEARCH_PROVIDER_ERROR", "multi_target_metrics 需要 2-10 个 target 组");
  }
  const raw = await dfsFetch<any>("/ai_optimization/llm_mentions/multi_target_metrics/live", {
    targets: params.groups.map((group) => ({
      key: group.key,
      target: buildTargetPayload(group.entities),
    })),
    platform: params.platform,
    location_code: params.locationCode,
    language_code: params.languageCode,
    internal_list_limit: 5,
  });
  await assertAiTaskOk(raw, "multi_target_metrics");
  const items = Array.isArray(raw.tasks?.[0]?.result?.[0]?.items)
    ? raw.tasks[0].result[0].items.map((item: any) => ({
        key: str(item?.key) ?? "",
        totalMentions: num(item?.total?.mentions),
        totalAiSearchVolume: num(item?.total?.ai_search_volume),
        platformGroups: normalizeGroupElements(item?.platform),
      }))
    : [];
  return { items, cost: { usd: aiTaskCost(raw) } };
}

// ===== 实时 LLM Responses（Prompt Explorer） =====

export interface AiLlmCitation {
  url: string;
  title: string | null;
}

export interface AiLlmResponseResult {
  platform: string;
  modelName: string | null;
  /** 答案可见文本（拼接 message sections） */
  text: string;
  citations: AiLlmCitation[];
  fanOutQueries: string[];
  outputTokens: number | null;
  webSearch: boolean;
  cost: AiProviderCost;
}

/** 白名单校验：不通过直接拒绝，绝不派发（避免失败任务扣费） */
export function assertAiModelAllowed(platform: string, modelName: string): void {
  const allowed = AI_SEARCH_MODEL_WHITELIST[platform];
  if (!allowed) {
    throw new AiSearchProviderError("AI_SEARCH_UNSUPPORTED_PLATFORM", `不支持的 AI Search platform：${platform}`);
  }
  if (!allowed.has(modelName)) {
    throw new AiSearchProviderError("AI_SEARCH_INVALID_MODEL", `model "${modelName}" 不在 ${platform} 白名单中（白名单来自 DataForSEO /models 目录，Verified 2026-08-29）`);
  }
}

export async function fetchAiLlmResponse(params: {
  platform: "chat_gpt" | "perplexity";
  modelName: string;
  userPrompt: string;
  webSearch?: boolean;
  webSearchCountryCode?: string;
}): Promise<AiLlmResponseResult> {
  // 白名单硬门槛：invalid model 不产生 provider task
  assertAiModelAllowed(params.platform, params.modelName);

  const prompt = params.userPrompt.trim();
  if (!prompt) {
    throw new AiSearchProviderError("AI_SEARCH_PROVIDER_ERROR", "prompt 不能为空");
  }
  if (prompt.length > 500) {
    throw new AiSearchProviderError("AI_SEARCH_PROVIDER_ERROR", "prompt 长度不能超过 500 字符（DataForSEO 限制）");
  }
  const reasoning = AI_REASONING_MODELS.has(params.modelName);
  const fields: Record<string, unknown> = {
    user_prompt: prompt,
    model_name: params.modelName,
    web_search: params.webSearch ?? true,
    // reasoning 模型（gpt-5 等）的隐藏思维链计入预算，1024 经常只剩空文本 → 给足 4096
    max_output_tokens: reasoning ? 4096 : 2048,
  };
  if (params.webSearchCountryCode) {
    fields.web_search_country_iso_code = params.webSearchCountryCode;
  }

  const raw = await dfsFetch<any>(`/ai_optimization/${params.platform}/llm_responses/live`, [fields]);
  await assertAiTaskOk(raw, "llm_responses");
  const result = raw.tasks?.[0]?.result?.[0] ?? {};

  const textParts: string[] = [];
  const citations: AiLlmCitation[] = [];
  const seenUrls = new Set<string>();
  if (Array.isArray(result.items)) {
    for (const item of result.items) {
      if (item?.type !== "message") continue;
      for (const section of item.sections ?? []) {
        if (typeof section?.text === "string" && section.text) textParts.push(section.text);
        for (const annotation of section?.annotations ?? []) {
          const url = str(annotation?.url);
          if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            citations.push({ url, title: str(annotation?.title) });
          }
        }
      }
    }
  }

  return {
    platform: params.platform,
    modelName: str(result.model_name) ?? params.modelName,
    text: textParts.join("\n\n").trim(),
    citations,
    fanOutQueries: Array.isArray(result.fan_out_queries)
      ? result.fan_out_queries.filter((q: unknown): q is string => typeof q === "string").slice(0, 20)
      : [],
    outputTokens: num(result.output_tokens),
    webSearch: result.web_search === true,
    cost: { usd: aiTaskCost(raw) },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
