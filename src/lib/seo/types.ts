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

/** 单次 SERP 查询的聚合结果 */
export interface SerpResult {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  fetchedAt: string; // ISO
  organic: OrganicResult[];
  relatedSearches: RelatedSearch[];
  relatedQuestions: RelatedQuestion[];
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
