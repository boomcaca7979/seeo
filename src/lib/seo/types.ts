// ===== SerpApi 数据源类型定义 =====
// 字段参考 SerpApi Google organic_results / related_searches / related_questions

/** 自然搜索结果（SERP Top 10） */
export interface OrganicResult {
  position: number; // 1-based
  title: string;
  /** provider 原始 link（可能是 /goto?url= 内部跳转串，禁止直接当外链用） */
  link: string;
  /** provider 原始 domain（可能是 /goto?url= 跳转串，禁止直接展示） */
  domain: string;
  snippet: string;
  date?: string;
  displayedLink?: string;
  /** 规范化后可安全打开的真实地址（见 seo/serp-normalize）；不可还原为 null */
  resolvedUrl?: string | null;
  /** 规范化后的真实域名；不可知为 null（绝不回退成 /goto 串） */
  resolvedDomain?: string | null;
  /** 链接解析状态：ok / google_redirect_token / unresolvable / missing */
  linkStatus?: "ok" | "google_redirect_token" | "unresolvable" | "missing";
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
  /** SerpApi 真实返回的 next_page_token：可用 engine=google_related_questions 继续展开该问题分支；
      provider 未返回时为 undefined（UI 必须明确显示无法继续，绝不猜测性请求） */
  nextPageToken?: string;
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
  /** Google 自报的结果总数（search_information.total_results）；provider 未返回为 null。
      注意：这是 Google 的估计值，不等于实际获得的 URL 条数，UI 必须区分口径 */
  totalResults?: number | null;
  /** 本次快照中真实捕获的广告条数（SerpApi ads 块）；块不存在=0。
      旧缓存条目可能缺失（undefined），读取端须容忍并按不可用展示 */
  adsCount?: number;
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
  /** SERP feature 块（P0-02-D 起随排名检查捕获；旧缓存条目可能缺失） */
  features?: SerpFeature[];
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
  code: "QUOTA_EXCEEDED" | "INVALID_KEY" | "UPSTREAM_ERROR" | "TIMEOUT" | "BAD_REQUEST"
    // 上游 SERP 服务（如 SerpApi 账户）自身额度耗尽——非用户套餐配额，升级不可解除
    | "UPSTREAM_QUOTA";
}

/** 统一成功响应外壳（带用量字段） */
export interface SeoApiResponse<T> {
  data: T;
  usage: ApiUsage;
}
