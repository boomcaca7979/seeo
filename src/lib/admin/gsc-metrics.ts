// ===== GSC 指标读取 + 运营机会派生（纯读本地表）=====
//
// 三个运营表的判定全部**从站点自身数据派生**，不引入外部行业基准常量：
//   - High Impression / Low CTR：impressions ≥ 本窗口「中位数 impressions」且
//     CTR < 站点自身 position ≤ 3 行的中位 CTR（没有这种行时退回全体中位 CTR）。
//   - Position 5–20 Opportunities：position ∈ [5, 20]，按 impressions 降序。
//   - Top Search Queries：按 clicks 降序。
// 派生依据（basis）随结果返回并由 UI 明示，避免「黑盒阈值」。

import { getAdapter } from "@/lib/db/migrations";

export interface GscTotals {
  clicks: number;
  impressions: number;
  /** 0–1 小数（与 GSC 原生口径一致，展示层再转百分比） */
  ctr: number;
  /** 平均位置（浮点）；无数据为 null */
  position: number | null;
}

export interface GscDailyRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

export interface GscDimensionRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  /** 来源窗口（天） */
  windowDays: number;
}

function toTotals(r: Record<string, unknown> | undefined): GscTotals {
  const clicks = Number(r?.clicks ?? 0);
  const impressions = Number(r?.impressions ?? 0);
  const avgPosition = r?.position;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position:
      avgPosition === null || avgPosition === undefined
        ? null
        : Math.round(Number(avgPosition) * 100) / 100,
  };
}

/** 窗口内总览（日序列求和，位置按 impressions 加权平均） */
export async function getGscTotals(windowDays: number): Promise<GscTotals> {
  const db = await getAdapter();
  const r = (await db.get(
    `SELECT COALESCE(SUM(clicks),0) AS clicks,
            COALESCE(SUM(impressions),0) AS impressions,
            CASE WHEN SUM(impressions) > 0
                 THEN SUM(position * impressions) / SUM(impressions) ELSE NULL END AS position
       FROM gsc_daily_metrics
      WHERE date >= date('now', ?)`,
    [`-${Math.max(1, Math.floor(windowDays)) - 1} days`]
  )) as Record<string, unknown> | undefined;
  return toTotals(r);
}

/** 日序列（趋势图） */
export async function getGscDaily(days: number): Promise<GscDailyRow[]> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT date, clicks, impressions, ctr, position
       FROM gsc_daily_metrics
      WHERE date >= date('now', ?)
      ORDER BY date ASC`,
    [`-${Math.max(1, Math.floor(days)) - 1} days`]
  )) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    date: String(r.date),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: r.position === null || r.position === undefined ? null : Number(r.position),
  }));
}

/** 取某窗口**最近一次**抓取的快照行 */
async function latestSnapshot(
  table: "gsc_query_metrics" | "gsc_page_metrics",
  windowDays: number,
  dimensionColumn: "query" | "page"
): Promise<Array<Record<string, unknown>>> {
  const db = await getAdapter();
  return (await db.query(
    `SELECT ${dimensionColumn} AS key, clicks, impressions, ctr, position
       FROM ${table}
      WHERE window_days = ?
        AND captured_on = (SELECT MAX(captured_on) FROM ${table} WHERE window_days = ?)
        AND ${dimensionColumn} != ''
      ORDER BY clicks DESC`,
    [windowDays, windowDays]
  )) as Array<Record<string, unknown>>;
}

function mapRows(rows: Array<Record<string, unknown>>, windowDays: number): GscDimensionRow[] {
  return rows.map((r) => ({
    key: String(r.key ?? ""),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: r.position === null || r.position === undefined ? null : Number(r.position),
    windowDays,
  }));
}

export async function getGscQueries(windowDays: number): Promise<GscDimensionRow[]> {
  return mapRows(await latestSnapshot("gsc_query_metrics", windowDays, "query"), windowDays);
}

export async function getGscPages(windowDays: number): Promise<GscDimensionRow[]> {
  return mapRows(await latestSnapshot("gsc_page_metrics", windowDays, "page"), windowDays);
}

/** country / device 明细存在 gsc_query_metrics 中（query='' 的行，见 gsc-sync 表约定） */
export async function getGscBreakdown(
  windowDays: number,
  dimension: "country" | "device"
): Promise<GscDimensionRow[]> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT ${dimension} AS key, clicks, impressions, ctr, position
       FROM gsc_query_metrics
      WHERE window_days = ?
        AND query = ''
        AND ${dimension} != ''
        AND captured_on = (SELECT MAX(captured_on) FROM gsc_query_metrics WHERE window_days = ? AND query = '')
      ORDER BY clicks DESC`,
    [windowDays, windowDays]
  )) as Array<Record<string, unknown>>;
  return mapRows(rows, windowDays);
}

// ---------- 机会派生（纯函数，可单测） ----------

export function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

export interface OpportunityBasis {
  /** impressions 门槛 = 本窗口 impressions 中位数 */
  impressionFloor: number;
  /** CTR 上限 = 站点自身 position ≤ 3 行的中位 CTR */
  ctrCeiling: number;
  /** CTR 上限的取数依据 */
  ctrBasis: "position-1-3" | "all-rows";
  /** 参与派生的行数 */
  sampleSize: number;
}

export interface CtrOpportunity extends GscDimensionRow {
  /** 相对基准的差距（百分点，0–100 口径） */
  ctrGapPct: number;
  /** 若达到 ctrCeiling，可多获得的点击（估算，仅基于本站自身 CTR） */
  potentialClicks: number;
}

/** 样本不足时不产出结论（避免用 2 行数据编造机会） */
export const MIN_OPPORTUNITY_SAMPLE = 5;

/**
 * High Impression / Low CTR：impressions 高于本站中位数、CTR 低于本站 position ≤ 3 的中位 CTR。
 * 全部阈值来自**站点自身**数据；任一取数失败（样本不足）则返回空列表 + basis.
 */
export function deriveCtrOpportunities(
  rows: GscDimensionRow[],
  limit = 25
): { basis: OpportunityBasis | null; items: CtrOpportunity[] } {
  if (rows.length < MIN_OPPORTUNITY_SAMPLE) return { basis: null, items: [] };

  const impressionFloor = median(rows.map((r) => r.impressions));
  const topRows = rows.filter((r) => r.position !== null && r.position <= 3 && r.impressions > 0);
  const ctrCeiling = median(topRows.map((r) => r.ctr)) ?? median(rows.map((r) => r.ctr));
  if (impressionFloor === null || ctrCeiling === null || ctrCeiling <= 0) {
    return { basis: null, items: [] };
  }

  const items = rows
    .filter(
      (r) =>
        r.impressions >= impressionFloor &&
        r.impressions > 0 &&
        r.ctr < ctrCeiling
    )
    .map((r) => ({
      ...r,
      ctrGapPct: Math.round((ctrCeiling - r.ctr) * 10000) / 100,
      potentialClicks: Math.max(0, Math.round(r.impressions * ctrCeiling - r.clicks)),
    }))
    .sort((a, b) => b.potentialClicks - a.potentialClicks || b.impressions - a.impressions)
    .slice(0, limit);

  return {
    basis: {
      impressionFloor: Math.round(impressionFloor),
      ctrCeiling: Math.round(ctrCeiling * 1e6) / 1e6,
      ctrBasis: topRows.length > 0 ? "position-1-3" : "all-rows",
      sampleSize: rows.length,
    },
    items,
  };
}

/** Position 5–20：已有排名、最值得优化（按 impressions 降序） */
export const POSITION_OPPORTUNITY_RANGE = { min: 5, max: 20 } as const;

export function derivePositionOpportunities(
  rows: GscDimensionRow[],
  limit = 25
): GscDimensionRow[] {
  return rows
    .filter(
      (r) =>
        r.position !== null &&
        r.position >= POSITION_OPPORTUNITY_RANGE.min &&
        r.position <= POSITION_OPPORTUNITY_RANGE.max
    )
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, limit);
}

/** Top Search Queries：带来实际点击的搜索词（clicks 降序，clicks > 0） */
export function deriveTopQueries(rows: GscDimensionRow[], limit = 25): GscDimensionRow[] {
  return rows
    .filter((r) => r.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}
