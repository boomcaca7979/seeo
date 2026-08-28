// ===== SEO 数据源 Provider 抽象 =====
// 以后新增 DataForSEO 时只需新增一个实现文件，业务代码（API 路由）不改

import type { SerpResult, RankResult } from "./types";

export interface SeoQueryParams {
  keyword: string;
  location: string; // 国家名，如「中国」「美国」
  device: "PC" | "移动端";
  /** SerpApi hl 语言码（如 zh-cn / en / ja），缺省 zh-cn 保持既有行为 */
  language?: string;
}

export interface RankQueryParams extends SeoQueryParams {
  domain: string;
}

export interface SeoProvider {
  /** 拉取关键词的 SERP Top 10、相关搜索、相关问题 */
  searchSerp(params: SeoQueryParams): Promise<SerpResult>;

  /** 查询某域名在该关键词 SERP 前 100 名中的真实位置 */
  checkRank(params: RankQueryParams): Promise<RankResult>;
}

/** 自定义错误：携带 code 便于 API 路由映射 HTTP 状态 */
export class SeoProviderError extends Error {
  code: "QUOTA_EXCEEDED" | "INVALID_KEY" | "UPSTREAM_ERROR" | "TIMEOUT" | "BAD_REQUEST";
  constructor(
    code: "QUOTA_EXCEEDED" | "INVALID_KEY" | "UPSTREAM_ERROR" | "TIMEOUT" | "BAD_REQUEST",
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = "SeoProviderError";
  }
}
