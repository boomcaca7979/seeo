// ===== SerpApi 数据源类型定义 =====
// 字段参考 SerpApi Google organic_results / related_searches / related_questions

/** 自然搜索结果（SERP Top 10） */
export interface OrganicResult {
  position: number; // 1-based
  title: string;
  link: string;
  domain: string;
  snippet: string;
  date?: string;
  displayedLink?: string;
}

/** 相关搜索（bottom-of-page related searches） */
export interface RelatedSearch {
  query: string;
}

/** People Also Ask（相关问题） */
export interface RelatedQuestion {
  question: string;
  snippet?: string;
  title?: string;
}

/** SERP feature 块（仅记录 provider 真实返回的块，绝不推测） */
export interface SerpFeature {
  /** provider 原始块名，如 featured_snippet / local_pack / ai_overview */
  featureType: string;
  /** provider 块位置（部分块 provider 不提供则为 null） */
  position: number | null;
  /** 块主标题（如 featured snippet 标题、knowledge panel 名称） */
  title: string | null;
  /** 块主链接（如 featured snippet 来源 URL） */
  url: string | null;
}

/** 单次 SERP 查询的聚合结果 */
export interface SerpResult {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  fetchedAt: string; // ISO
  organic: OrganicResult[];
  relatedSearches: RelatedSearch[];
  relatedQuestions: RelatedQuestion[];
  /** SERP feature 块（P0-02-B 起提供；旧缓存条目可能缺失，读取端须容忍 undefined） */
  features?: SerpFeature[];
  /** SerpApi hl 语言码（P0-02-B 起提供；缺省 zh-cn 保持既有行为） */
  language?: string;
  /** 是否命中本地缓存（不消耗 API 额度） */
  fromCache?: boolean;
}

/** 排名查询结果 */
export interface RankResult {
  keyword: string;
  domain: string;
  location: string;
  device: "PC" | "移动端";
  fetchedAt: string; // ISO
  /** 在 SERP 前 100 名中的真实位置（1-based），未进前 100 返回 null */
  rank: number | null;
  /** 命中页面的 URL */
  matchedUrl: string | null;
  matchedTitle?: string | null;
  fromCache?: boolean;
}

/** API 用量统计 */
export interface ApiUsage {
  used: number;
  limit: number; // 100
  month: string; // YYYY-MM
}

/** 统一错误返回 */
export interface SeoApiError {
  error: string;
  code: "QUOTA_EXCEEDED" | "INVALID_KEY" | "UPSTREAM_ERROR" | "TIMEOUT" | "BAD_REQUEST";
}

/** 统一成功响应外壳（带用量字段） */
export interface SeoApiResponse<T> {
  data: T;
  usage: ApiUsage;
}
