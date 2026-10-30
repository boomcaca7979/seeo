// ===== Google Trends Service（P4：趋势与相关需求维度）=====
// 与 serp-service 单点惯例一致：缓存与配额只在 service 层完成，Web API 层不重复记账。
// 一个 data_type = 一次独立引擎调用 = 1 个 serpapi 配额单位（SerpApi google_trends 的
// TIMESERIES / GEO_MAP_0 / RELATED_QUERIES / RELATED_TOPICS 是四次独立请求）。
// 全部入口都是用户主动触发（UI 层保证）；本服务不做任何自动/批量调用，不递归扩词。

import type { PlanTier } from "@/lib/auth";
import { consumeQuota, peekUsage, readCache, writeCache } from "./cache";
import {
  fetchGoogleTrends,
  TRENDS_DATE_OPTIONS,
  TRENDS_DEFAULT_DATE,
  type TrendsDataType,
  type TrendsResult,
} from "./serpapi";

export const TRENDS_PROVIDER_VERSION = "serpapi-trends-v1";

export interface TrendsServiceParams {
  keyword: string;
  location: string;
  dataType: TrendsDataType;
  /** 时间范围（白名单见 serpapi.TRENDS_DATE_OPTIONS）；缺省 today 12-m */
  date?: string;
  /** SerpApi hl 语言码（可选）；缺省按市场默认语言 */
  language?: string;
}

export type TrendsServiceResult = TrendsResult & { fromCache: boolean };

/** 每个 data_type 独立缓存命名空间（响应结构不同，不可混存） */
function trendsNamespace(dataType: TrendsDataType): string {
  return `trends-${dataType.toLowerCase()}`;
}

function trendsDate(date?: string): string {
  return (TRENDS_DATE_OPTIONS as readonly string[]).includes(date ?? "")
    ? (date as string)
    : TRENDS_DEFAULT_DATE;
}

function trendsCacheParams(p: TrendsServiceParams): Record<string, string> {
  return {
    provider: TRENDS_PROVIDER_VERSION,
    dataType: p.dataType,
    keyword: p.keyword.trim().toLowerCase(),
    location: p.location,
    date: trendsDate(p.date),
    language: p.language ?? "",
  };
}

/** 并发去重：同一 data_type/关键词/市场/时间范围的进行中请求共享同一个 Promise（双击不重复扣费） */
const inFlightTrends = new Map<string, Promise<TrendsServiceResult>>();

async function loadTrends(
  userId: string,
  plan: PlanTier,
  params: TrendsServiceParams
): Promise<TrendsServiceResult> {
  const namespace = trendsNamespace(params.dataType);
  const cacheParams = trendsCacheParams(params);
  const cached = await readCache<TrendsResult>(namespace, cacheParams);
  if (cached) {
    return { ...cached, fromCache: true };
  }
  await consumeQuota(userId, "serpapi", plan);
  const result = await fetchGoogleTrends(params.keyword, params.location, params.dataType, {
    date: params.date,
    language: params.language,
  });
  try { await writeCache(namespace, cacheParams, result); } catch { /* cache failure does not fail a provider result */ }
  return { ...result, fromCache: false };
}

export async function fetchTrendsData(
  userId: string,
  plan: PlanTier,
  params: TrendsServiceParams
): Promise<TrendsServiceResult> {
  const cacheParams = trendsCacheParams(params);
  const key = `${trendsNamespace(params.dataType)}:${JSON.stringify(cacheParams)}`;
  const existing = inFlightTrends.get(key);
  if (existing) return existing;
  const promise = loadTrends(userId, plan, params).finally(() => {
    inFlightTrends.delete(key);
  });
  inFlightTrends.set(key, promise);
  return promise;
}

export async function getTrendsUsage(userId: string, plan: PlanTier) {
  return peekUsage(userId, "serpapi", plan);
}
