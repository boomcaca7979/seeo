// ===== Compact SERP Snapshot（随策略持久化的种子级竞争证据） =====
//
// 目的：策略创建时已拿到完整 SerpApi 响应（一次调用的产物），把其中可长期引用的
// 竞争证据提炼成紧凑快照随策略保存，消除「完整 Top 10 只活在 24h api_cache」的问题。
//
// 边界：
//   - 只存摘要数据（title/url/domain/snippet 截断/feature 名），绝不复制完整原始响应；
//   - 快照是「当时抓到的证据」，刷新语义由 UI 明示（缺失 = 历史数据不可用，绝不自动补抓）。

import type { SerpResult } from "./types";

export interface CompactSerpRow {
  position: number;
  title: string;
  url: string;
  domain: string;
  /** 截断到 240 字符的摘要；空串 = 供应商未返回摘要 */
  snippet: string;
  /** 仅当供应商真实返回的展示日期 */
  date?: string;
}

export interface CompactSerpSnapshot {
  keyword: string;
  market: string;
  language: string;
  device: string;
  fetchedAt: string;
  /** 抓取时是否命中缓存（证据元数据，UI 展示用） */
  fromCache: boolean;
  /** Google 自报总结果数（仅展示口径，绝不作为搜索量） */
  totalResults: number | null;
  adsCount: number;
  results: CompactSerpRow[];
  features: string[];
  paa: string[];
  related: string[];
}

const SNIPPET_MAX = 240;

export function extractCompactSnapshot(
  seed: string,
  market: string,
  result: SerpResult,
): CompactSerpSnapshot {
  return {
    keyword: seed,
    market,
    language: result.language ?? "zh-cn",
    device: result.device,
    fetchedAt: result.fetchedAt,
    fromCache: result.fromCache ?? false,
    totalResults: result.totalResults ?? null,
    adsCount: result.adsCount ?? 0,
    results: (result.organic ?? []).slice(0, 10).map((r) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      domain: r.domain,
      snippet: (r.snippet ?? "").slice(0, SNIPPET_MAX),
      ...(r.date ? { date: r.date } : {}),
    })),
    features: (result.features ?? []).map((f) => f.featureType),
    paa: (result.relatedQuestions ?? []).map((q) => q.question),
    related: (result.relatedSearches ?? []).map((r) => r.query),
  };
}

/** snapshot map 的 key：归一后的种子词（与 normalizeKeyword 同口径由调用方处理） */
export type SerpSnapshotMap = Record<string, CompactSerpSnapshot>;
