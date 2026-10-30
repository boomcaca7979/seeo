// ===== keyword-expand 工作台共享类型（页面与子组件共用，与 API 响应字段一致）=====

/** SERP 快照中的自然结果行（provider 真实返回；date 可缺失） */
export interface OrganicResultRow {
  position: number;
  title: string;
  link: string;
  domain: string;
  snippet: string;
  date?: string;
}

/** SERP feature 块标准化行 */
export interface SerpFeatureRow {
  featureType: string;
  position: number | null;
  title: string | null;
  url: string | null;
}

/** /api/keywords/expand 响应中的 serpSnapshot（同一次 searchSerp 调用的第一页快照） */
export interface SerpSnapshot {
  fetchedAt: string;
  fromCache: boolean;
  language: string | null;
  /** Google 自报结果总数（估计值，不等于实际获得条数） */
  totalResults: number | null;
  /** 快照中真实捕获的广告条数（null = 旧缓存无此字段，按不可用展示） */
  adsCount: number | null;
  organic: OrganicResultRow[];
  features: SerpFeatureRow[];
  /** PAA 问题列表（P7 起携带 provider 真实返回的 next_page_token；旧缓存无此字段则无深度展开入口） */
  relatedQuestions?: { question: string; snippet?: string; title?: string; nextPageToken?: string }[];
}
