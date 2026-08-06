// ===== SerpApi 实现（服务端专用，绝不可被客户端引用） =====
// 仅在 API Route 中通过 import 调用，确保 SERPAPI_KEY 不暴露到前端 bundle

import type { OrganicResult, RelatedQuestion, SerpResult, RankResult } from "./types";
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
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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
    hl: "zh-cn",
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
    };
  }
}

// 单例
export const serpApiProvider = new SerpApiProvider();
