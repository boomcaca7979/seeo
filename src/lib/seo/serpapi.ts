// ===== SerpApi 实现（服务端专用，绝不可被客户端引用） =====
// 仅在 API Route 中通过 import 调用，确保 SERPAPI_KEY 不暴露到前端 bundle

import { domainToUnicode as nodeDomainToUnicode } from "node:url";
import type { OrganicResult, RelatedQuestion, SerpFeature, SerpResult, RankResult } from "./types";
import { SeoProvider, SeoProviderError, type SeoQueryParams, type RankQueryParams } from "./provider";

// ===== 市场参数映射（gl 国家码 / location 地区名 / 默认 hl 搜索语言码）=====
// 参数定义参考 SerpApi 官方文档：https://serpapi.com/search-api（gl / location / hl，
// hl 合法值见 https://serpapi.com/google-languages）。
//
// 地区与语言分离：hl 只是各市场的合理默认值（与 dataforseo.ts DFS_KEYWORD_LOCATIONS
// 的语言默认保持一致），显式 language 参数仍可覆盖；绝不因缺少映射静默回落到其他地区
// （修复记录：香港/台湾此前不在映射内，会回落 gl=cn 且丢失 location 参数）。
interface SerpMarket {
  gl: string;
  location: string;
  /** 该市场默认搜索语言（SerpApi hl 码） */
  hl: string;
  /** 该市场 Google 域名（SerpApi google_domain），取值核实自 https://serpapi.com/google-domains */
  googleDomain: string;
}

const SERP_MARKETS: Record<string, SerpMarket> = {
  // 中国：google.cn 已从 Google 域名体系退役，SerpApi 域名列表中不存在 google.cn，
  // 保留 google.com + gl=cn + location=China 作为该市场的实际可行组合。
  中国: { gl: "cn", location: "China", hl: "zh-cn", googleDomain: "google.com" },
  美国: { gl: "us", location: "United States", hl: "en", googleDomain: "google.com" },
  日本: { gl: "jp", location: "Japan", hl: "ja", googleDomain: "google.co.jp" },
  英国: { gl: "uk", location: "United Kingdom", hl: "en", googleDomain: "google.co.uk" },
  德国: { gl: "de", location: "Germany", hl: "de", googleDomain: "google.de" },
  香港: { gl: "hk", location: "Hong Kong", hl: "zh-tw", googleDomain: "google.com.hk" },
  台湾: { gl: "tw", location: "Taiwan", hl: "zh-tw", googleDomain: "google.com.tw" },
};

// 未知市场兜底（UI 不提供这些选项，仅防御性保留；中国为历史默认行为）
const DEFAULT_GL = "cn";
const DEFAULT_HL = "zh-cn";
const DEFAULT_GOOGLE_DOMAIN = "google.com";

/** 市场解析结果：fallback=true 表示该市场无精确映射，实际请求使用了兜底参数 */
export interface ResolvedSerpMarket {
  market: SerpMarket | null;
  gl: string;
  hl: string;
  googleDomain: string;
  fallback: boolean;
}

/**
 * 解析市场配置：gl / hl（默认值，显式 language 仍可覆盖）/ google_domain 一致取自同一份映射。
 * 未映射市场不静默伪装定位：fallback=true，由调用方决定是否向用户明示。
 */
export function resolveSerpMarket(location: string): ResolvedSerpMarket {
  const market = SERP_MARKETS[location];
  if (market) {
    return { market, gl: market.gl, hl: market.hl, googleDomain: market.googleDomain, fallback: false };
  }
  return { market: null, gl: DEFAULT_GL, hl: DEFAULT_HL, googleDomain: DEFAULT_GOOGLE_DOMAIN, fallback: true };
}

// 合法 hl 形如 zh-cn / en / ja / pt-br
const HL_PATTERN = /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/;

/**
 * 解析最终生效的 SerpApi hl：显式 language 参数优先，否则使用所选市场的默认语言。
 * 修复记录：旧实现无 language 时一律 zh-cn——美国等英文市场会以中文界面抓取 Google，
 * 导致 SERP 组成（相关搜索/PAA）与英文市场不符。现在按市场取默认，不再永久固定。
 */
export function resolveSerpHl(location: string, language?: string): string {
  if (language && HL_PATTERN.test(language.trim())) {
    return language.trim().toLowerCase();
  }
  return resolveSerpMarket(location).hl;
}

const UPSTREAM_TIMEOUT_MS = 10_000;

interface SerpApiRawResponse {
  organic_results?: Array<{
    position?: number;
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
    displayed_link?: string;
  }>;
  related_searches?: Array<{ query: string }>;
  related_questions?: Array<{
    question?: string;
    snippet?: string;
    title?: string;
    /** 普通搜索响应中每个问题自带的可继续展开 token（google_related_questions 用） */
    next_page_token?: string;
  }>;
  search_information?: {
    total_results?: number;
    query_displayed?: string;
  };
  error?: string;
  /** 广告块（真实存在时返回数组；不存在=无广告，不是「未捕获」） */
  ads?: Array<Record<string, unknown>>;
  // SERP feature 块（P0-02-B）：仅声明真实存在的 provider 字段
  featured_snippet?: SerpApiBlockBase;
  ai_overview?: SerpApiBlockBase;
  local_pack?: SerpApiBlockBase;
  knowledge_graph?: SerpApiBlockBase;
  top_stories?: SerpApiBlockBase;
  video_results?: SerpApiBlockBase;
  images_results?: SerpApiBlockBase;
  shopping_results?: SerpApiBlockBase;
  twitter_results?: SerpApiBlockBase;
  events_results?: SerpApiBlockBase;
}

// ===== SERP feature 块提取（P0-02-B） =====
// 只提取 SerpApi 真实返回的块字段；块不存在即不记录，绝不推测。
// 字段参考：https://serpapi.com/organic-results（各 feature block 结构）

interface SerpApiBlockBase {
  position?: number;
  title?: string;
  link?: string;
  items?: Array<{
    position?: number;
    title?: string;
    link?: string;
  }>;
}

/**
 * 提取单个 feature 块的标准化表示。
 * - position：块级 position 优先，缺失时退回首个 item 的 position
 * - title/url：块级字段优先，缺失时退回首个 item
 */
function extractBlock(
  featureType: string,
  block: SerpApiBlockBase | undefined
): SerpFeature | null {
  if (!block || typeof block !== "object") return null;
  const firstItem = Array.isArray(block.items) ? block.items[0] : undefined;
  const position = typeof block.position === "number"
    ? block.position
    : typeof firstItem?.position === "number" ? firstItem.position : null;
  const title = typeof block.title === "string" && block.title.trim()
    ? block.title
    : typeof firstItem?.title === "string" ? firstItem.title : null;
  const url = typeof block.link === "string" && block.link
    ? block.link
    : typeof firstItem?.link === "string" ? firstItem.link : null;
  if (position === null && title === null && url === null) return null;
  return { featureType, position, title, url };
}

function extractFeatures(raw: SerpApiRawResponse): SerpFeature[] {
  const candidates: [string, SerpApiBlockBase | undefined][] = [
    ["featured_snippet", raw.featured_snippet],
    ["ai_overview", raw.ai_overview],
    ["local_pack", raw.local_pack],
    ["knowledge_graph", raw.knowledge_graph],
    ["top_stories", raw.top_stories],
    ["video_results", raw.video_results],
    ["images_results", raw.images_results],
    ["shopping_results", raw.shopping_results],
    ["twitter_results", raw.twitter_results],
    ["events_results", raw.events_results],
  ];
  const features: SerpFeature[] = [];
  for (const [featureType, block] of candidates) {
    const feature = extractBlock(featureType, block);
    if (feature) features.push(feature);
  }
  return features;
}

function extractDomain(url: string): string {
  const registrable = extractRegistrableDomain(url);
  return registrable ?? url;
}

// 常见多段公共后缀（无 PSL 依赖的可解释近似）：命中时 registrable domain 取 3 段
const MULTI_PART_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.hk", "org.hk", "edu.hk",
  "com.tw", "org.tw", "edu.tw",
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  "com.au", "net.au", "org.au",
  "co.kr", "or.kr",
  "com.br", "com.mx", "com.sg", "co.nz", "com.tr", "co.in",
]);

/**
 * 从 URL 稳定提取 registrable domain（eTLD+1 近似，无 PSL 依赖）：
 * - 协议 / 端口 / 路径 / query / fragment / 尾部斜杠全部剥离
 * - 大小写归一；punycode 域名转回 Unicode（url.domainToUnicode）
 * - 去掉 www. 前缀（与既有 domain identity 口径一致）
 * - 子域名归并到 registrable domain（blog.example.com → example.com）
 * - 国家多段后缀（如 co.uk）按 MULTI_PART_SUFFIXES 处理
 * 解析失败时退回「协议剥离 + 小写 + 去 www.」的字符串清理，保证不抛错。
 */
export function extractRegistrableDomain(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  let hostname = "";
  try {
    hostname = new URL(url.trim()).hostname;
  } catch {
    // 非 URL 输入：字符串清理兜底
    hostname = url.trim()
      .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
      .split("/")[0]
      .split("?")[0]
      .split("#")[0];
  }
  if (!hostname) return null;
  // 端口剥离（URL.hostname 已含处理，字符串兜底路径需手动处理）
  hostname = hostname.split(":")[0].toLowerCase();
  // punycode → Unicode（hostname 是 ASCII punycode；转 Unicode 便于与项目域名一致比较）
  try {
    hostname = domainToUnicode(hostname);
  } catch {
    // 保留原 hostname
  }
  // 尾部根点
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  // IP 地址或单标签：原样返回
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || !hostname.includes(".")) return hostname || null;
  // 去掉 www. 前缀
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join(".");
  const suffixLength = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-suffixLength).join(".");
}

/**
 * punycode（xn--）hostname → Unicode 形式。
 */
function domainToUnicode(hostname: string): string {
  // Node 内置 url.domainToUnicode；异常输入返回空串，调用方保留原值
  const unicode = nodeDomainToUnicode(hostname);
  return unicode && unicode.includes(".") ? unicode : hostname;
}

/**
 * 通用 SerpApi JSON 请求 + 错误映射（search / google_autocomplete 等引擎共用）。
 * 错误契约一致：INVALID_KEY / QUOTA_EXCEEDED / UPSTREAM_ERROR / TIMEOUT。
 */
async function fetchSerpApiJson(params: Record<string, string>): Promise<Record<string, unknown>> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new SeoProviderError("INVALID_KEY", "服务端未配置 SERPAPI_KEY，请在 .env.local 中填入");
  }

  const url = new URL("https://serpapi.com/search.json");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("api_key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const json = (await res.json()) as Record<string, unknown> & Partial<SerpApiRawResponse>;

    if (json.error) {
      // SerpApi 错误信息样例："Error: \"Invalid API\""
      const msg = String(json.error).toLowerCase();
      if (msg.includes("invalid api") || msg.includes("api key")) {
        throw new SeoProviderError("INVALID_KEY", `SerpApi Key 无效：${json.error}`);
      }
      if (msg.includes("rate limit") || msg.includes("quota")) {
        throw new SeoProviderError("QUOTA_EXCEEDED", `SerpApi 额度已耗尽：${json.error}`);
      }
      throw new SeoProviderError("UPSTREAM_ERROR", `SerpApi 返回错误：${json.error}`);
    }
    return json;
  } catch (e) {
    if (e instanceof SeoProviderError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new SeoProviderError("TIMEOUT", "SerpApi 请求超时（10s）");
    }
    throw new SeoProviderError("UPSTREAM_ERROR", `SerpApi 请求失败：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSerpApi(params: Record<string, string>): Promise<SerpApiRawResponse> {
  return (await fetchSerpApiJson(params)) as SerpApiRawResponse;
}

// ===== Google Autocomplete（engine=google_autocomplete）=====
// 参数与响应结构核实自官方文档 https://serpapi.com/google-autocomplete-api：
// 请求：q（必需）、gl、hl（可选，无 google_domain 参数——市场定位只走 gl/hl）；
// 响应：{ search_information?, suggestions?: [{ value, relevance?, type? }] }，无分页字段。

export interface AutocompleteSuggestion {
  /** Google 返回的原始建议文本（保留原文，由上层统一去重合并） */
  value: string;
  /** SerpApi relevance 分值；缺失为 null（不猜测） */
  relevance: number | null;
  /** SerpApi type（如 "QUERY"）；缺失为 null */
  type: string | null;
}

/**
 * 拉取 Google Autocomplete 建议词。gl/hl 由市场配置解析（与 SERP 同一份映射）；
 * 未映射市场同样走兜底 gl/hl——调用方通过 resolveSerpMarket 自行决定是否提示用户。
 */
export async function fetchAutocompleteSuggestions(
  keyword: string,
  location: string,
  language?: string
): Promise<AutocompleteSuggestion[]> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new SeoProviderError("BAD_REQUEST", "关键词不能为空");
  }
  const resolved = resolveSerpMarket(location);
  const raw = await fetchSerpApiJson({
    engine: "google_autocomplete",
    q: trimmed,
    gl: resolved.gl,
    hl: resolveSerpHl(location, language),
    no_cache: "true", // 与 search 同惯例：SerpApi 侧不缓存，由 cache.ts 统一控制
  });

  const suggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const normalized: AutocompleteSuggestion[] = [];
  for (const item of suggestions) {
    if (!item || typeof item !== "object") continue;
    const value = (item as { value?: unknown }).value;
    if (typeof value !== "string" || !value.trim()) continue;
    const relevance = (item as { relevance?: unknown }).relevance;
    const type = (item as { type?: unknown }).type;
    normalized.push({
      value: value.trim(),
      relevance: typeof relevance === "number" ? relevance : null,
      type: typeof type === "string" ? type : null,
    });
  }
  return normalized;
}

// ===== Google Trends（engine=google_trends，P4 趋势与相关需求维度）=====
// 参数与响应结构核实自官方文档 https://serpapi.com/google-trends-api：
// 请求：q（必需）、data_type（必需）、date、geo、hl、no_cache；
// 一个 data_type = 一次独立引擎调用（单独计费、单独缓存）：
//   TIMESERIES      → interest_over_time.timeline_data（相对热度 0-100 时间线）
//   GEO_MAP_0       → interest_by_subregion（单查询地区兴趣）
//   RELATED_QUERIES → related_queries.top / rising（{query, value, extracted_value}）
//   RELATED_TOPICS  → related_topics.top / rising（{topic:{title,type}, value, extracted_value}）
// 数据口径硬约束：value 是 Google Trends 相对指数（0-100 / 上升百分比 / Breakout），
// 绝不是月搜索量——展示层必须按相对指数标注，不得换算成绝对搜索量。

export type TrendsDataType = "TIMESERIES" | "GEO_MAP_0" | "RELATED_QUERIES" | "RELATED_TOPICS";

const TRENDS_DATA_TYPES: ReadonlySet<string> = new Set([
  "TIMESERIES", "GEO_MAP_0", "RELATED_QUERIES", "RELATED_TOPICS",
]);

/** 允许的时间范围（白名单，避免任意字符串透传到上游） */
export const TRENDS_DATE_OPTIONS = ["today 12-m", "today 5-y"] as const;
export type TrendsDateRange = (typeof TRENDS_DATE_OPTIONS)[number];
export const TRENDS_DEFAULT_DATE: TrendsDateRange = "today 12-m";

/** 市场名 → Google Trends geo（ISO-3166 alpha-2 口径；英国在 Trends 是 GB，与 Google gl 的 uk 不同） */
const TRENDS_GEO: Record<string, string> = {
  中国: "CN", 美国: "US", 日本: "JP", 英国: "GB", 德国: "DE", 香港: "HK", 台湾: "TW",
};

export interface TrendsTimelinePoint {
  date: string;
  /** 单查询时 values 内 query 可能为 null；调用方以关键词标注 */
  values: { query: string | null; value: number | null; extractedValue: number | null }[];
}

/** RELATED_QUERIES / RELATED_TOPICS 的条目（rising 的 value 可为增长数值或 "Breakout" 字符串） */
export interface TrendsRankedItem {
  /** 查询词或主题标题 */
  label: string;
  /** 仅 RELATED_TOPICS：主题类型（如 "Search term"） */
  topicType: string | null;
  /** Trends 相对值：top 为 0-100；rising 为增长率数值或 "Breakout" */
  value: number | string | null;
  extractedValue: number | null;
}

export interface TrendsGeoPoint {
  geoName: string;
  value: number | null;
  extractedValue: number | null;
}

export interface TrendsResult {
  dataType: TrendsDataType;
  keyword: string;
  /** Trends geo（ISO alpha-2）；未映射市场为 null = 全球范围（UI 须明示） */
  geo: string | null;
  /** 实际生效的 Trends hl */
  hl: string;
  /** 实际使用的时间范围（如 "today 12-m"） */
  dateRange: string;
  fetchedAt: string;
  /** 仅 TIMESERIES */
  timeline?: TrendsTimelinePoint[];
  /** 仅 RELATED_QUERIES / RELATED_TOPICS */
  top?: TrendsRankedItem[];
  rising?: TrendsRankedItem[];
  /** 仅 GEO_MAP_0 */
  geoInterest?: TrendsGeoPoint[];
}

interface TrendsRawTopic {
  title?: unknown;
  type?: unknown;
}

interface TrendsRawResponse {
  interest_over_time?: {
    timeline_data?: Array<{
      date?: unknown;
      values?: Array<{ query?: unknown; value?: unknown; extracted_value?: unknown }>;
    }>;
  };
  related_queries?: { top?: unknown[]; rising?: unknown[] };
  related_topics?: { top?: unknown[]; rising?: unknown[] };
  interest_by_subregion?: Array<{
    geo?: unknown;
    geo_name?: unknown;
    value?: unknown;
    extracted_value?: unknown;
  }>;
  error?: string;
}

function trendsNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function trendsValue(v: unknown): number | string | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function trendsRankedItems(rows: unknown[] | undefined, kind: "query" | "topic"): TrendsRankedItem[] {
  if (!Array.isArray(rows)) return [];
  const items: TrendsRankedItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const rawLabel = kind === "topic" ? (rec.topic as TrendsRawTopic | undefined)?.title : rec.query;
    if (typeof rawLabel !== "string" || !rawLabel.trim()) continue;
    const rawType = kind === "topic" ? (rec.topic as TrendsRawTopic | undefined)?.type : null;
    items.push({
      label: rawLabel.trim(),
      topicType: typeof rawType === "string" && rawType.trim() ? rawType.trim() : null,
      value: trendsValue(rec.value),
      extractedValue: trendsNumber(rec.extracted_value),
    });
  }
  return items;
}

/**
 * 拉取 Google Trends 数据（一个 data_type 一次引擎调用）。
 * geo 由市场映射解析（TRENDS_GEO）；未映射市场不传 geo=全球范围，由调用方明示。
 * hl 沿用与 SERP 同一份 resolveSerpHl（显式 language 优先，否则市场默认语言）。
 */
export async function fetchGoogleTrends(
  keyword: string,
  location: string,
  dataType: TrendsDataType,
  options?: { date?: string; language?: string }
): Promise<TrendsResult> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new SeoProviderError("BAD_REQUEST", "关键词不能为空");
  }
  if (!TRENDS_DATA_TYPES.has(dataType)) {
    throw new SeoProviderError("BAD_REQUEST", `不支持的 Trends data_type：${dataType}`);
  }
  const date = (TRENDS_DATE_OPTIONS as readonly string[]).includes(options?.date ?? "")
    ? (options?.date as TrendsDateRange)
    : TRENDS_DEFAULT_DATE;
  const geo = TRENDS_GEO[location] ?? null;
  const params: Record<string, string> = {
    engine: "google_trends",
    q: trimmed,
    data_type: dataType,
    date,
    hl: resolveSerpHl(location, options?.language),
    no_cache: "true",
  };
  if (geo) params.geo = geo;

  const raw = (await fetchSerpApiJson(params)) as TrendsRawResponse;
  const result: TrendsResult = {
    dataType,
    keyword: trimmed,
    geo,
    hl: params.hl,
    dateRange: date,
    fetchedAt: new Date().toISOString(),
  };
  if (dataType === "TIMESERIES") {
    const timelineData = raw.interest_over_time?.timeline_data;
    result.timeline = Array.isArray(timelineData)
      ? timelineData
          .filter((point) => point && typeof point === "object")
          .map((point) => ({
            date: typeof point.date === "string" ? point.date : "",
            values: Array.isArray(point.values)
              ? point.values.map((v) => ({
                  query: typeof v?.query === "string" ? v.query : null,
                  // 真实 SerpApi 的 value 是字符串（如 "47"），数值口径回退 extracted_value
                  value: trendsNumber(v?.value) ?? trendsNumber(v?.extracted_value),
                  extractedValue: trendsNumber(v?.extracted_value),
                }))
              : [],
          }))
      : [];
  } else if (dataType === "RELATED_QUERIES") {
    result.top = trendsRankedItems(raw.related_queries?.top, "query");
    result.rising = trendsRankedItems(raw.related_queries?.rising, "query");
  } else if (dataType === "RELATED_TOPICS") {
    result.top = trendsRankedItems(raw.related_topics?.top, "topic");
    result.rising = trendsRankedItems(raw.related_topics?.rising, "topic");
  } else if (dataType === "GEO_MAP_0") {
    const rows = raw.interest_by_subregion;
    result.geoInterest = Array.isArray(rows)
      ? rows
          .filter((row) => row && typeof row === "object")
          .map((row) => ({
            geoName: typeof row.geo_name === "string" && row.geo_name.trim()
              ? row.geo_name.trim()
              : typeof row.geo === "string" ? row.geo : "",
            // 与 TIMESERIES 同口径：真实 value 可能是字符串，数值回退 extracted_value
            value: trendsNumber(row.value) ?? trendsNumber(row.extracted_value),
            extractedValue: trendsNumber(row.extracted_value),
          }))
          .filter((row) => row.geoName)
      : [];
  }
  return result;
}

/**
 * PAA 深度展开（P7）：用普通搜索响应中真实返回的 next_page_token 调用
 * engine=google_related_questions，取回该问题分支的更多相关问题。
 * 只接受真实存在的 token——调用方必须在 UI 上对无 token 的问题明确显示无法继续，
 * 绝不猜测或构造 token。响应里每个问题可能继续携带 next_page_token，原样透传。
 */
export async function fetchRelatedQuestions(
  nextPageToken: string
): Promise<{ questions: RelatedQuestion[] }> {
  const token = nextPageToken.trim();
  if (!token) {
    throw new SeoProviderError("BAD_REQUEST", "缺少 next_page_token");
  }
  const raw = (await fetchSerpApiJson({
    engine: "google_related_questions",
    next_page_token: token,
    no_cache: "true",
  })) as { related_questions?: Array<{ question?: string; title?: string; snippet?: string; next_page_token?: string }> };
  const questions: RelatedQuestion[] = (raw.related_questions ?? [])
    .map((q) => ({
      question: q.question ?? q.title ?? "",
      snippet: q.snippet,
      title: q.title,
      ...(typeof q.next_page_token === "string" && q.next_page_token.trim()
        ? { nextPageToken: q.next_page_token.trim() }
        : {}),
    }))
    .filter((q) => q.question);
  return { questions };
}

function buildBaseParams(p: SeoQueryParams): Record<string, string> {
  const resolved = resolveSerpMarket(p.location);
  const params: Record<string, string> = {
    engine: "google",
    q: p.keyword,
    hl: resolveSerpHl(p.location, p.language),
    gl: resolved.gl,
    google_domain: resolved.googleDomain,
    no_cache: "true", // SerpApi 侧不再二次缓存，由我们自己的 cache.ts 控制
  };
  if (resolved.market) params.location = resolved.market.location;
  if (p.device === "移动端") {
    params.device = "mobile";
  }
  // SERP 分页：SerpApi 官方 start 偏移（0=第一页；10=第二条结果起）。官方不保证每页
  // 恰好返回 num 条——加载更多后以实际返回条数展示，绝不用自报总数补齐。
  if (typeof p.start === "number" && Number.isInteger(p.start) && p.start > 0) {
    params.start = String(p.start);
  }
  return params;
}

export class SerpApiProvider implements SeoProvider {
  async searchSerp(params: SeoQueryParams): Promise<SerpResult> {
    if (!params.keyword.trim()) {
      throw new SeoProviderError("BAD_REQUEST", "关键词不能为空");
    }
    const raw = await fetchSerpApi(buildBaseParams(params));

    const organic: OrganicResult[] = (raw.organic_results ?? [])
      .filter((r) => r.link)
      .map((r, i) => ({
        position: r.position ?? i + 1,
        title: r.title ?? "(无标题)",
        link: r.link as string,
        domain: extractDomain(r.link as string),
        snippet: r.snippet ?? "",
        date: r.date,
        displayedLink: r.displayed_link,
      }))
      .slice(0, 10);

    const relatedSearches = (raw.related_searches ?? []).map((r) => ({ query: r.query }));
    const relatedQuestions: RelatedQuestion[] = (raw.related_questions ?? [])
      .map((q) => ({
        question: q.question ?? q.title ?? "",
        snippet: q.snippet,
        title: q.title,
        ...(typeof q.next_page_token === "string" && q.next_page_token.trim()
          ? { nextPageToken: q.next_page_token.trim() }
          : {}),
      }))
      .filter((q) => q.question);

    return {
      keyword: params.keyword,
      location: params.location,
      device: params.device,
      fetchedAt: new Date().toISOString(),
      organic,
      relatedSearches,
      relatedQuestions,
      features: extractFeatures(raw),
      language: resolveSerpHl(params.location, params.language),
      totalResults: typeof raw.search_information?.total_results === "number"
        ? raw.search_information.total_results
        : null,
      adsCount: Array.isArray(raw.ads) ? raw.ads.length : 0,
    };
  }

  async checkRank(params: RankQueryParams): Promise<RankResult> {
    if (!params.keyword.trim()) {
      throw new SeoProviderError("BAD_REQUEST", "关键词不能为空");
    }
    if (!params.domain.trim()) {
      throw new SeoProviderError("BAD_REQUEST", "域名不能为空");
    }
    const base = buildBaseParams(params);
    // 排名检查需要前 100 名，SerpApi 默认只返回 10 条
    base.num = "100";
    const raw = await fetchSerpApi(base);

    const target = params.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
    const all = (raw.organic_results ?? []).filter((r) => r.link);
    const hit = all.find((r) => {
      const d = extractDomain(r.link as string).toLowerCase();
      return d === target || d.endsWith(`.${target}`);
    });

    const rank = hit?.position ?? null;
    return {
      keyword: params.keyword,
      domain: params.domain,
      location: params.location,
      device: params.device,
      fetchedAt: new Date().toISOString(),
      rank,
      matchedUrl: hit?.link ?? null,
      matchedTitle: hit?.title ?? null,
      // Top-100 响应同样包含 SERP feature 块——排名变化时可解释「是不是 SERP 结构变了」
      features: extractFeatures(raw),
    };
  }
}

// 单例
export const serpApiProvider = new SerpApiProvider();
