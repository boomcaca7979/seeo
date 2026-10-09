// ===== 环比数据层（独立模块；不改动 funnel.ts 既有实现）=====
//
// 设计约束（任务硬性要求）：
//   1. 当前窗口与上一窗口**同长度、不重叠**：
//        当前 [now − d×86400, now)      ← 既有 getAdminOverview 口径
//        上一 [now − 2d×86400, now − d×86400)
//   2. SQL 侧 created_at 边界一律用 CAST(strftime('%s', …) AS INTEGER) 数值比较。
//      绝不用 ISO 字符串与 datetime() 字符串直接比较——ISO 的 'T' 分隔符在字典序上
//      大于空格，曾导致"当天访客被上界条件整体漏算"。SQLite 的 strftime('%s') 对
//      'YYYY-MM-DD HH:MM:SS' 与 ISO-8601（T / Z / 毫秒）两种格式都能正确解析为
//      Unix 秒，数值比较无格式歧义、无时区歧义（均为 UTC）。
//   3. JS 侧（Supabase 快照行）用 Date.parse 数值比较并向下取整到秒。
//   4. 诚实环比：数据源不可用 → 该指标 available=false，UI 不显示环比；
//      基数为 0 → 不伪造百分比（见 deltaBadge）。

import { getAnalyticsReadAdapter } from "@/lib/analytics/readonly";
import { getAdRevenueDaily } from "./ads";
import { getAdminOverview, type AdminOverview } from "./funnel";
import { getGscDaily } from "./gsc-metrics";
import { getOrdersSnapshot, getProfilesSnapshot } from "./snapshot";

const DAY_SECONDS = 86_400;

/** 上一周期（与当前窗口同长度、不重叠）的同口径指标 */
export interface WindowMetrics {
  visitors: number;
  activated: number;
  signups: number;
  checkouts: number;
  paid: number;
  searchClicks: number;
  adRevenueCents: number;
  /**
   * 各指标环比是否可信（数据源可用且查询成功）。
   * false = UI 不显示该指标的环比，绝不伪造百分比。
   */
  available: {
    visitors: boolean;
    activated: boolean;
    signups: boolean;
    checkouts: boolean;
    paid: boolean;
    searchClicks: boolean;
    adRevenue: boolean;
  };
}

export interface OverviewWithPrevious extends AdminOverview {
  previous: WindowMetrics;
}

// ---------- 时间窗口工具 ----------

/** ISO 字符串 → Unix 秒（无法解析返回 null） */
export function toUnixSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
}

/**
 * JS 侧判断：时间点是否落在上一窗口 [now − 2d×86400, now − d×86400) 内。
 * 秒级数值比较（Date.parse），与 SQL 侧 strftime 口径一致、窗口不重叠。
 */
export function withinPreviousWindow(
  iso: string | null | undefined,
  days: number
): boolean {
  const s = toUnixSeconds(iso);
  if (s === null) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return (
    s >= nowSec - 2 * days * DAY_SECONDS && s < nowSec - days * DAY_SECONDS
  );
}

/**
 * 上一周期覆盖的日历日（'YYYY-MM-DD' 集合）。
 * 当前窗口日 = i ∈ [0, d)；上一周期日 = i ∈ [d, 2d)。纯日期字符串匹配，
 * 无时间成分、无格式歧义（GSC / 广告日表均按此粒度存储）。
 */
export function previousDayKeys(days: number): Set<string> {
  const out = new Set<string>();
  const now = Date.now();
  for (let i = 2 * days - 1; i >= days; i--) {
    out.add(new Date(now - i * DAY_SECONDS * 1000).toISOString().slice(0, 10));
  }
  return out;
}

// ---------- SQL 查询（strftime 数值比较） ----------

/**
 * 上一周期去重访客数（与 funnel.ts queryVisitors 同口径：page_view，
 * 经 identities 合并登录前后身份）。查询失败 → null（环比不显示）。
 */
export async function queryVisitorsPrevious(
  days: number
): Promise<number | null> {
  try {
    const db = await getAnalyticsReadAdapter();
    const row = (await db.get(
      `SELECT COUNT(DISTINCT COALESCE(i.user_id, e.anonymous_id)) AS n
         FROM analytics_events e
         LEFT JOIN analytics_identities i ON i.anonymous_id = e.anonymous_id
        WHERE e.event_name = 'page_view'
          AND CAST(strftime('%s', e.created_at) AS INTEGER)
                >= CAST(strftime('%s', 'now') AS INTEGER) - ?
          AND CAST(strftime('%s', e.created_at) AS INTEGER)
                <  CAST(strftime('%s', 'now') AS INTEGER) - ?`,
      [2 * days * DAY_SECONDS, days * DAY_SECONDS]
    )) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}

/** 上一周期完成首次使用（activation_completed）的去重用户数。失败 → null。 */
export async function queryActivatedPrevious(
  days: number
): Promise<number | null> {
  try {
    const db = await getAnalyticsReadAdapter();
    const row = (await db.get(
      `SELECT COUNT(DISTINCT user_id) AS n FROM analytics_events
        WHERE event_name = 'activation_completed'
          AND CAST(strftime('%s', created_at) AS INTEGER)
                >= CAST(strftime('%s', 'now') AS INTEGER) - ?
          AND CAST(strftime('%s', created_at) AS INTEGER)
                <  CAST(strftime('%s', 'now') AS INTEGER) - ?`,
      [2 * days * DAY_SECONDS, days * DAY_SECONDS]
    )) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}

// ---------- 诚实环比徽章 ----------

export type DeltaTone = "good" | "bad" | "muted";

export interface DeltaBadge {
  text: string;
  tone: DeltaTone;
}

/**
 * 环比徽章。诚实规则：
 *   - previous 为 null/undefined（数据源不可用）→ undefined，UI 不显示环比；
 *   - previous = 0 且 current = 0 → 「与上一周期持平」（muted，不是伪造的 0%）；
 *   - previous = 0 且 current > 0 → 「上一周期无数据」（muted，绝不显示 +∞% 或虚构百分比）；
 *   - 其余 → 「较上一周期 +X% / −X%」；lowerIsBetter 时方向反向着色（如退款增加是坏事）。
 */
export function deltaBadge(
  current: number,
  previous: number | null | undefined,
  opts: { lowerIsBetter?: boolean } = {}
): DeltaBadge | undefined {
  if (previous === null || previous === undefined) return undefined;
  if (previous === 0) {
    if (current === 0) return { text: "与上一周期持平", tone: "muted" };
    return { text: "上一周期无数据", tone: "muted" };
  }
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return { text: "与上一周期持平", tone: "muted" };
  const improved = opts.lowerIsBetter ? rounded < 0 : rounded > 0;
  return {
    text: `较上一周期 ${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`,
    tone: improved ? "good" : "bad",
  };
}

// ---------- 主入口 ----------

/**
 * 在既有 getAdminOverview 之上叠加上一周期同口径指标。
 * 不修改 funnel.ts：本函数包装其返回值，页面层按需改用本入口。
 */
export async function getAdminOverviewWithPrevious(
  days: number
): Promise<OverviewWithPrevious> {
  const [overview, prevVisitors, prevActivated, gscDaily, adsDaily, profiles, orders] =
    await Promise.all([
      getAdminOverview(days),
      queryVisitorsPrevious(days),
      queryActivatedPrevious(days),
      getGscDaily(2 * days).catch(() => []),
      getAdRevenueDaily(2 * days).catch(() => []),
      getProfilesSnapshot(),
      getOrdersSnapshot(),
    ]);

  const dayKeys = previousDayKeys(days);

  // GSC / 广告：2× 窗口日序列按日切分，只累计上一周期日期（与当前窗口不重叠）
  let prevSearchClicks = 0;
  for (const row of gscDaily) {
    if (dayKeys.has(String(row.date))) prevSearchClicks += Number(row.clicks ?? 0);
  }
  let prevAdCents = 0;
  for (const row of adsDaily) {
    if (dayKeys.has(String(row.date))) prevAdCents += Number(row.revenueCents ?? 0);
  }

  // 权威表（Supabase 快照全量在内存）：JS 秒级数值过滤
  let prevSignups = 0;
  if (profiles.available) {
    for (const p of profiles.rows) {
      if (withinPreviousWindow(p.created_at, days)) prevSignups++;
    }
  }
  let prevCheckouts = 0;
  const prevPayers = new Set<string>();
  if (orders.available) {
    for (const o of orders.rows) {
      if (withinPreviousWindow(o.created_at, days)) prevCheckouts++;
      if (
        o.payment_status === "paid" &&
        withinPreviousWindow(o.paid_at, days)
      ) {
        prevPayers.add(o.user_id);
      }
    }
  }

  return {
    ...overview,
    previous: {
      visitors: prevVisitors ?? 0,
      activated: prevActivated ?? 0,
      signups: prevSignups,
      checkouts: prevCheckouts,
      paid: prevPayers.size,
      searchClicks: prevSearchClicks,
      adRevenueCents: prevAdCents,
      available: {
        visitors: overview.availability.analytics && prevVisitors !== null,
        activated: overview.availability.analytics && prevActivated !== null,
        signups: overview.availability.profiles,
        checkouts: overview.availability.orders,
        paid: overview.availability.orders,
        searchClicks: overview.availability.gscConnected,
        adRevenue: overview.availability.ads,
      },
    },
  };
}
