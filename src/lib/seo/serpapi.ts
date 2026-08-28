// ===== SerpApi 实现（服务端专用，绝不可被客户端引用） =====
// 仅在 API Route 中通过 import 调用，确保 SERPAPI_KEY 不暴露到前端 bundle

import { domainToUnicode as nodeDomainToUnicode } from "node:url";
import type { OrganicResult, RelatedQuestion, SerpFeature, SerpResult, RankResult } from "./types";
import { SeoProvider, SeoProviderError, type SeoQueryParams, type RankQueryParams } from "./provider";

// 国家名 → SerpApi gl 代码
const LOCATION_GL: Record<string, string> = {
  中国: "cn",
  美国: "us",
  日本: "jp",
  英国: "uk",
  德国: "de",
};
const DEFAULT_GL = "cn";

// 默认语言码（保持 P0-02-B 之前的行为：hl 固定 zh-cn）
const DEFAULT_HL = "zh-cn";
// 合法 hl 形如 zh-cn / en / ja / pt-br
const HL_PATTERN = /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/;

// 国家名 → SerpApi location 参数（SerpApi 文档：location 字符串）
const LOCATION_STR: Record<string, string> = {
  中国: "China",
  美国: "United States",
  日本: "Japan",
  英国: "United Kingdom",
  德国: "Germany",
};

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
  }>;
  search_information?: {
    total_results?: number;
    query_displayed?: string;
  };
  error?: string;
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

async function fetchSerpApi(params: Record<string, string>): Promise<SerpApiRawResponse> {
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
    const json = (await res.json()) as SerpApiRawResponse;

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

function buildBaseParams(p: SeoQueryParams): Record<string, string> {
  const gl = LOCATION_GL[p.location] ?? DEFAULT_GL;
  const params: Record<string, string> = {
    engine: "google",
    q: p.keyword,
    hl: p.language && HL_PATTERN.test(p.language.trim()) ? p.language.trim().toLowerCase() : DEFAULT_HL,
    gl,
    google_domain: "google.com",
    no_cache: "true", // SerpApi 侧不再二次缓存，由我们自己的 cache.ts 控制
  };
  const locStr = LOCATION_STR[p.location];
  if (locStr) params.location = locStr;
  if (p.device === "移动端") {
    params.device = "mobile";
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
      language: params.language && HL_PATTERN.test(params.language.trim())
        ? params.language.trim().toLowerCase()
        : DEFAULT_HL,
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
