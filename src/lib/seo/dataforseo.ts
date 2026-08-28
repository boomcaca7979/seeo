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
