// ===== Rank Tracking Service（P0-02-D Rank Tracking Intelligence） =====
// 统一的排名时间维度业务层：Web API 与 MCP 共用。
//
//   Tracking API / MCP get_rank_history
//     ↓
//   本 Service（current/previous/change/status/history/trend/summary/movement）
//     ↓
//   DB（tracked_keywords + rank_history + competitor_ranks，均为既有模型，无 v2 表）
//     ↓
//   刷新（refresh.ts）→ serp-service.searchRank（rank 缓存 + serpapi 计费单点）
//
// 约定：
// - rankChange = previousRank - currentRank（正 = 上升），与 tracking UI 现有 change 口径一致；
//   注意 automation 报告的 getRankChangesSince 是相反方向（正 = 下降），两处口径互不改动。
// - null 不当作 100：current=null 且 previous 非 null → status=lost；反之 → new。
// - 排名序列按 (keyword, location, device) 天然隔离（tracked_keywords 唯一约束）。
// - 历史读取零 provider 成本；只有 refresh（manual/cron/automation）经 searchRank 产生真实调用。

import {
  getRankHistory,
  getRankWindow,
  getCompetitorRankMovement,
  type RankHistoryRow,
  type RankWindowRow,
  type CompetitorMovementRow,
} from "@/lib/db";
import { getTrackedKeywordById, listTrackedKeywords } from "@/lib/db";

// ===== 纯函数：change / status / trend =====

export type RankStatus = "improved" | "declined" | "stable" | "new" | "lost" | "not_ranked";

/** rankChange = previousRank - currentRank（正 = 上升）；任一侧 null 返回 null */
export function computeRankChange(previousRank: number | null, currentRank: number | null): number | null {
  if (previousRank === null || currentRank === null) return null;
  return previousRank - currentRank;
}

/**
 * 状态判定（不把 null 当 100）：
 * - 双方有排名：current < previous → improved；> → declined；= → stable
 * - previous 非 null 且 current = null → lost（跌出前 100 或未检查到排名）
 * - previous = null 且 current 非 null → new
 * - 双方均 null → not_ranked
 */
export function classifyRankStatus(previousRank: number | null, currentRank: number | null): RankStatus {
  if (previousRank !== null && currentRank !== null) {
    if (currentRank < previousRank) return "improved";
    if (currentRank > previousRank) return "declined";
    return "stable";
  }
  if (previousRank !== null && currentRank === null) return "lost";
  if (previousRank === null && currentRank !== null) return "new";
  return "not_ranked";
}

export type RankTrend = "improving" | "declining" | "stable";

/**
 * deterministic 趋势（公式固定、可复现，不用 LLM）：
 * 将最近 rankTrendWindow 次有排名记录对半分，median(后半) - median(前半)：
 *   <= -1 → improving（排名数字变小 = 上升）；>= +1 → declining；否则 stable。
 * 有排名记录不足 4 条时返回 null（样本不足不下结论）。
 */
export const RANK_TREND_WINDOW = 8;

export function computeRankTrend(
  history: Array<{ position: number | null }>,
  window: number = RANK_TREND_WINDOW
): RankTrend | null {
  const ranked = history.filter((row) => row.position !== null).map((row) => row.position as number);
  if (ranked.length < 4) return null;
  const slice = ranked.slice(-window);
  const half = Math.floor(slice.length / 2);
  const firstHalf = slice.slice(0, half);
  const secondHalf = slice.slice(slice.length - half);
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };
  const delta = median(secondHalf) - median(firstHalf);
  if (delta <= -1) return "improving";
  if (delta >= 1) return "declining";
  return "stable";
}

function medianRank(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ===== 单个关键词的 Rank Intelligence =====

export interface RankSnapshotView {
  date: string;
  rank: number | null;
  rankingUrl: string | null;
  featureTypes: string[];
}

export interface KeywordRankIntelligence {
  keywordId: number;
  current: RankSnapshotView | null;
  previous: RankSnapshotView | null;
  /** previousRank - currentRank（正 = 上升） */
  change: number | null;
  status: RankStatus;
  /** Google 是否更换了 ranking page（current 与 previous 的 URL 不同） */
  rankingUrlChanged: boolean | null;
  history: RankSnapshotView[];
  trend: RankTrend | null;
  /** 竞品排名变动（复用 P0-02-C 的 competitor_ranks 历史） */
  competitorMovement: CompetitorMovementRow[];
}

export interface GetKeywordRankIntelligenceParams {
  keywordId: number;
  userId: string;
  /** 历史窗口天数（默认 30，最大 365） */
  days?: number;
}

function toSnapshotView(row: RankHistoryRow): RankSnapshotView {
  return { date: row.date, rank: row.position, rankingUrl: row.url, featureTypes: row.featureTypes };
}

/**
 * 单关键词 Rank Intelligence：current/previous/change/status/rankingUrl 历史/趋势/竞品变动。
 * 纯 DB 读取，零 provider 成本。
 */
export async function getKeywordRankIntelligence(
  params: GetKeywordRankIntelligenceParams
): Promise<KeywordRankIntelligence> {
  const days = Math.min(365, Math.max(1, params.days ?? 30));
  const history = await getRankHistory(params.userId, params.keywordId, days);
  const snapshots = history.map(toSnapshotView);
  const current = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const change = computeRankChange(previous?.rank ?? null, current?.rank ?? null);
  const rankingUrlChanged = current && previous && current.rankingUrl && previous.rankingUrl
    ? current.rankingUrl !== previous.rankingUrl
    : null;

  return {
    keywordId: params.keywordId,
    current,
    previous,
    change,
    status: classifyRankStatus(previous?.rank ?? null, current?.rank ?? null),
    rankingUrlChanged,
    history: snapshots,
    trend: computeRankTrend(history),
    competitorMovement: await getCompetitorRankMovement(params.userId, params.keywordId),
  };
}

// ===== 项目级 Rank Summary（distribution / visibility 原始统计） =====

export interface RankDistribution {
  trackedCount: number;
  /** 有任何历史记录的 tracked keywords 数 */
  rankedCount: number;
  top3Count: number;
  top10Count: number;
  top20Count: number;
  top50Count: number;
  /** 最新快照无排名记录（含未检查与未进前 100） */
  notRankingCount: number;
  averageRank: number | null;
  medianRank: number | null;
}

export interface TrackedKeywordRankRow {
  keywordId: number;
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  currentRank: number | null;
  previousRank: number | null;
  change: number | null;
  status: RankStatus;
  rankingUrl: string | null;
  featureTypes: string[];
}

export interface ProjectRankSummary {
  domain: string;
  distribution: RankDistribution;
  keywords: TrackedKeywordRankRow[];
}

/**
 * 项目级排名汇总：从既有 rank_history 聚合，不产生任何 provider 调用。
 * 每 (keyword, location, device) 视为独立排名序列——tracked_keywords 唯一约束保证维度隔离。
 */
export async function getProjectRankSummary(
  userId: string,
  domain: string,
  days = 30
): Promise<ProjectRankSummary> {
  const window = await getRankWindow(userId, domain, Math.min(365, Math.max(1, days)));

  // 按 keyword 分组，组内按日期升序 → current = 最后一条，previous = 倒数第二条
  const byKeyword = new Map<number, RankWindowRow[]>();
  for (const row of window) {
    const list = byKeyword.get(row.keyword_id) ?? [];
    list.push(row);
    byKeyword.set(row.keyword_id, list);
  }

  const keywords: TrackedKeywordRankRow[] = [];
  for (const [keywordId, rows] of byKeyword) {
    const current = rows[rows.length - 1];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    keywords.push({
      keywordId,
      keyword: current.keyword,
      location: current.location,
      device: current.device,
      currentRank: current.position,
      previousRank: previous?.position ?? null,
      change: computeRankChange(previous?.position ?? null, current.position),
      status: classifyRankStatus(previous?.position ?? null, current.position),
      rankingUrl: current.url,
      featureTypes: current.featureTypes,
    });
  }
  keywords.sort((a, b) =>
    (a.currentRank ?? 999) - (b.currentRank ?? 999) ||
    a.keyword.localeCompare(b.keyword)
  );

  const latestRanks = keywords.map((k) => k.currentRank).filter((r): r is number => r !== null);
  const distribution: RankDistribution = {
    trackedCount: keywords.length,
    rankedCount: latestRanks.length,
    top3Count: latestRanks.filter((r) => r <= 3).length,
    top10Count: latestRanks.filter((r) => r <= 10).length,
    top20Count: latestRanks.filter((r) => r <= 20).length,
    top50Count: latestRanks.filter((r) => r <= 50).length,
    notRankingCount: keywords.length - latestRanks.length,
    averageRank: latestRanks.length > 0
      ? Math.round((latestRanks.reduce((a, b) => a + b, 0) / latestRanks.length) * 10) / 10
      : null,
    medianRank: medianRank(latestRanks),
  };

  return { domain, distribution, keywords };
}

/** 供 MCP tool 使用的项目 tracked keyword 列表（含 location/device 维度） */
export async function listTrackedKeywordsForProject(userId: string, domain: string) {
  const all = await listTrackedKeywords(userId);
  return all.filter((k) => k.domain === domain);
}

/** 单关键词归属校验（tracked keyword 必须属于该用户） */
export { getTrackedKeywordById };
