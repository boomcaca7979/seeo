// ===== Owner Console：概览指标 + 核心漏斗 + 趋势 =====
//
// 口径唯一来源见 event-catalog.ts 的 ADMIN_FUNNEL_DEFINITION。
// 关键取舍：**能用权威表就不用埋点** ——
//   Visit    → analytics_events（唯一来源）
//   Signup   → Supabase profiles.created_at（权威，含历史）
//   Activation → analytics_events.activation_completed（唯一来源）
//   Checkout / Paid → Supabase orders（权威，含历史）
// 这样即使埋点是新上线的，注册/结账/付费三个节点也不会"看起来一直是 0"。

import { getAnalyticsReadAdapter, getAnalyticsReadSource, ANALYTICS_READ_SOURCE_NOTES, type AnalyticsReadSource } from "@/lib/analytics/readonly";
import { ADMIN_FUNNEL_DEFINITION, type FunnelStepKey } from "./event-catalog";
import {
  deriveCtrOpportunities,
  getGscDaily,
  getGscQueries,
  getGscTotals,
} from "./gsc-metrics";
import { getGscLastSync } from "./gsc-sync";
import { getProfilesSnapshot, getOrdersSnapshot, withinWindow } from "./snapshot";
import { dedupeOrdersById } from "./customers";
import { getAdRevenueDaily, getAdRevenueSummary } from "./ads";
import { getMrr } from "./revenue";
import { diagnoseFunnel, type BottleneckDiagnosis } from "./diagnose";

export const ADMIN_WINDOWS = [1, 7, 30] as const;
export type AdminWindow = (typeof ADMIN_WINDOWS)[number];

export const ADMIN_WINDOW_LABELS: Record<number, string> = {
  1: "近 24 小时",
  7: "近 7 天",
  30: "近 30 天",
};

export function normalizeWindow(raw: string | undefined): AdminWindow {
  const n = Number(raw ?? "7");
  return (ADMIN_WINDOWS as readonly number[]).includes(n) ? (n as AdminWindow) : 7;
}

export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  source: string;
  measure: string;
  count: number;
  /** 相对上一节点的转化率（0–1）；首节点 null；上一节点为 0 时 null */
  conversionFromPrevious: number | null;
  /** 该节点数据源是否可用（false = unavailable，不是 0） */
  available: boolean;
}

export interface HeadlineMetrics {
  visitors: number;
  searchClicks: number;
  signups: number;
  activatedUsers: number;
  checkoutStarted: number;
  paidCustomers: number;
  mrrCents: number;
  adRevenueCents: number;
  totalRevenueCents: number;
  /** 窗口内订阅毛收入（USD，成功支付金额合计） */
  subscriptionGrossCents: number;
  /** 窗口内退款金额（USD） */
  refundCents: number;
  /** 非 USD 订阅净额（历史订单），单独列出不并入 total */
  otherCurrencyNet: Array<{ currency: string; cents: number }>;
}

/** 上一周期（同长度、整体前移一个窗口）的同口径指标，用于首页环比 */
export interface WindowMetrics {
  visitors: number;
  searchClicks: number;
  signups: number;
  activatedUsers: number;
  checkoutStarted: number;
  paidCustomers: number;
  subscriptionGrossCents: number;
  refundCents: number;
  adRevenueCents: number;
}

export interface DailyPoint {
  day: string;
  visitors: number;
  signups: number;
  activated: number;
  checkout: number;
  paid: number;
  searchClicks: number;
  adRevenueCents: number;
}

export interface SourceAvailability {
  analytics: boolean;
  gscConnected: boolean;
  profiles: boolean;
  orders: boolean;
  ads: boolean;
  /** MRR 快照是否可读（false = 未接通，UI 显示「尚未接通」而不是 $0.00） */
  mrr: boolean;
}

export interface AdminOverview {
  windowDays: number;
  metrics: HeadlineMetrics;
  funnel: FunnelStep[];
  diagnosis: BottleneckDiagnosis;
  availability: SourceAvailability;
  series: DailyPoint[];
  /** 广告收入本地表最近导入时间（null = 从未导入） */
  adsLastImportedAt: string | null;
  gscLastSyncAt: string | null;
  /** 访客/激活/趋势数据来源（生产只读通道 or 本地隔离库），UI 必须如实标注 */
  analyticsSource: AnalyticsReadSource;
  analyticsSourceNote: string;
}

// ---------- 基础查询 ----------

async function queryVisitors(days: number): Promise<number> {
  const db = await getAnalyticsReadAdapter();
  const row = (await db.get(
    `SELECT COUNT(DISTINCT COALESCE(i.user_id, e.anonymous_id)) AS n
       FROM analytics_events e
       LEFT JOIN analytics_identities i ON i.anonymous_id = e.anonymous_id
      WHERE e.event_name = 'page_view' AND e.created_at >= datetime('now', ?)`,
    [`-${days} days`]
  )) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

async function queryActivated(days: number): Promise<number> {
  const db = await getAnalyticsReadAdapter();
  const row = (await db.get(
    `SELECT COUNT(DISTINCT user_id) AS n FROM analytics_events
      WHERE event_name = 'activation_completed' AND created_at >= datetime('now', ?)`,
    [`-${days} days`]
  )) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 行为分析链路是否有任何数据（决定 activation 类判断是否可信） */
async function analyticsHasData(): Promise<boolean> {
  try {
    const db = await getAnalyticsReadAdapter();
    const row = (await db.get(`SELECT COUNT(*) AS n FROM analytics_events`)) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

async function queryDailyAnalytics(days: number): Promise<Map<string, { visitors: number; activated: number }>> {
  try {
    const db = await getAnalyticsReadAdapter();
    const rows = (await db.query(
      `SELECT date(e.created_at) AS day,
              COUNT(DISTINCT CASE WHEN e.event_name = 'page_view'
                    THEN COALESCE(i.user_id, e.anonymous_id) END) AS visitors,
              COUNT(DISTINCT CASE WHEN e.event_name = 'activation_completed'
                    THEN e.user_id END) AS activated
         FROM analytics_events e
         LEFT JOIN analytics_identities i ON i.anonymous_id = e.anonymous_id
        WHERE e.created_at >= datetime('now', ?)
        GROUP BY date(e.created_at)`,
      [`-${days} days`]
    )) as Array<{ day: string; visitors: number; activated: number }>;
    const map = new Map<string, { visitors: number; activated: number }>();
    for (const r of rows) {
      map.set(String(r.day), {
        visitors: Number(r.visitors ?? 0),
        activated: Number(r.activated ?? 0),
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/** UTC 日序列骨架（从 days-1 天前到今天） */
function dayKeys(days: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

function utcDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

// ---------- 主入口 ----------

export async function getAdminOverview(days: number): Promise<AdminOverview> {
  const [
    visitors,
    activated,
    hasAnalytics,
    dailyAnalytics,
    profiles,
    orders,
    gscTotals,
    gscQueries,
    gscDaily,
    gscLastSyncAt,
    adsSummary,
    adsDaily,
    mrr,
  ] = await Promise.all([
    queryVisitors(days).catch(() => 0),
    queryActivated(days).catch(() => 0),
    analyticsHasData(),
    queryDailyAnalytics(days),
    getProfilesSnapshot(),
    getOrdersSnapshot(),
    getGscTotals(days).catch(() => null),
    getGscQueries(days).catch(() => []),
    getGscDaily(days).catch(() => []),
    getGscLastSync().catch(() => null),
    getAdRevenueSummary(days),
    getAdRevenueDaily(days),
    getMrr(),
  ]);

  const gscConnected = gscLastSyncAt !== null;

  // ---- 权威表口径 ----
  const signups = profiles.available
    ? profiles.rows.filter((p) => withinWindow(p.created_at, days)).length
    : 0;
  let checkoutStarted = 0;
  const payers = new Set<string>();
  let grossCents = 0;
  let refundCents = 0;
  const otherCurrency = new Map<string, number>();

  if (orders.available) {
    for (const o of dedupeOrdersById(orders.rows)) {
      if (withinWindow(o.created_at, days)) checkoutStarted++;
      if (o.payment_status === "paid" && withinWindow(o.paid_at, days)) {
        payers.add(o.user_id);
        const cur = String(o.currency ?? "USD").toUpperCase();
        const cents = Math.round(Number(o.amount ?? 0) * 100);
        if (cur === "USD") grossCents += cents;
        else otherCurrency.set(cur, (otherCurrency.get(cur) ?? 0) + cents);
      }
      if (o.refund_amount && withinWindow(o.refunded_at, days)) {
        const cur = String(o.currency ?? "USD").toUpperCase();
        const cents = Math.round(Number(o.refund_amount ?? 0) * 100);
        if (cur === "USD") refundCents += cents;
        else otherCurrency.set(cur, (otherCurrency.get(cur) ?? 0) - cents);
      }
    }
  }

  const subscriptionNetCents = grossCents - refundCents;
  // 广告收入 revenueCents 为 USD 口径（非 USD 在 nonUsd 单独列出，不换算）
  const adsCents = adsSummary.revenueCents;
  const adsNonUsd = adsSummary.nonUsd;

  // ---- 漏斗 ----
  const counts: Record<FunnelStepKey, { count: number; available: boolean }> = {
    impression: {
      count: gscTotals?.impressions ?? 0,
      available: gscConnected,
    },
    click: { count: gscTotals?.clicks ?? 0, available: gscConnected },
    visit: { count: visitors, available: hasAnalytics },
    signup: { count: signups, available: profiles.available },
    activation: { count: activated, available: hasAnalytics },
    checkout: { count: checkoutStarted, available: orders.available },
    paid: { count: payers.size, available: orders.available },
  };

  const funnel: FunnelStep[] = ADMIN_FUNNEL_DEFINITION.map((def, i) => {
    const prevKey = i > 0 ? ADMIN_FUNNEL_DEFINITION[i - 1].key : null;
    const cur = counts[def.key];
    const prev = prevKey ? counts[prevKey] : null;
    const conversionFromPrevious =
      prev && prev.count > 0 ? Math.round((cur.count / prev.count) * 10000) / 10000 : null;
    return {
      key: def.key,
      label: def.label,
      source: def.source,
      measure: def.measure,
      count: cur.count,
      conversionFromPrevious,
      available: cur.available,
    };
  });

  // ---- 趋势 ----
  const signupByDay = new Map<string, number>();
  if (profiles.available) {
    for (const p of profiles.rows) {
      const d = utcDayOf(p.created_at);
      if (d) signupByDay.set(d, (signupByDay.get(d) ?? 0) + 1);
    }
  }
  const checkoutByDay = new Map<string, number>();
  const paidByDay = new Map<string, number>();
  if (orders.available) {
    for (const o of dedupeOrdersById(orders.rows)) {
      const dc = utcDayOf(o.created_at);
      if (dc) checkoutByDay.set(dc, (checkoutByDay.get(dc) ?? 0) + 1);
      if (o.payment_status === "paid") {
        const dp = utcDayOf(o.paid_at);
        if (dp) paidByDay.set(dp, (paidByDay.get(dp) ?? 0) + 1);
      }
    }
  }
  const clicksByDay = new Map<string, number>();
  for (const row of gscDaily) clicksByDay.set(row.date, row.clicks);
  const adByDay = new Map<string, number>();
  for (const r of adsDaily) adByDay.set(r.date, r.revenueCents);

  const series: DailyPoint[] = dayKeys(days).map((day) => ({
    day,
    visitors: dailyAnalytics.get(day)?.visitors ?? 0,
    signups: signupByDay.get(day) ?? 0,
    activated: dailyAnalytics.get(day)?.activated ?? 0,
    checkout: checkoutByDay.get(day) ?? 0,
    paid: paidByDay.get(day) ?? 0,
    searchClicks: clicksByDay.get(day) ?? 0,
    adRevenueCents: adByDay.get(day) ?? 0,
  }));

  // ---- 诊断 ----
  const opp = deriveCtrOpportunities(gscQueries);
  const diagnosis = diagnoseFunnel({
    impressions: gscTotals?.impressions ?? 0,
    clicks: gscTotals?.clicks ?? 0,
    visits: visitors,
    signups,
    activated,
    checkoutStarted,
    paid: payers.size,
    subscriptionNetCents,
    adRevenueCents: adsCents,
    gscConnected,
    impressionFloor: opp.basis?.impressionFloor ?? null,
    ctrCeiling: opp.basis?.ctrCeiling ?? null,
    analyticsHasData: hasAnalytics,
    profilesAvailable: profiles.available,
    ordersAvailable: orders.available,
  });

  return {
    windowDays: days,
    metrics: {
      visitors,
      searchClicks: gscTotals?.clicks ?? 0,
      signups,
      activatedUsers: activated,
      checkoutStarted,
      paidCustomers: payers.size,
      mrrCents: mrr.available ? mrr.mrrCents : 0,
      subscriptionGrossCents: grossCents,
      refundCents,
      adRevenueCents: adsCents,
      totalRevenueCents: subscriptionNetCents + adsCents,
      otherCurrencyNet: (() => {
        // 订阅侧非 USD（orders）+ 广告侧非 USD（ad_revenue_daily）合并列出，不换算
        const merged = new Map<string, number>();
        for (const [cur, cents] of otherCurrency) {
          if (cents !== 0) merged.set(cur, (merged.get(cur) ?? 0) + cents);
        }
        for (const a of adsNonUsd) {
          if (a.cents !== 0) merged.set(a.currency, (merged.get(a.currency) ?? 0) + a.cents);
        }
        return [...merged.entries()]
          .filter(([, cents]) => cents !== 0)
          .map(([currency, cents]) => ({ currency, cents }))
          .sort((a, b) => b.cents - a.cents);
      })(),
    },
    funnel,
    diagnosis,
    availability: {
      analytics: hasAnalytics,
      gscConnected,
      profiles: profiles.available,
      orders: orders.available,
      ads: adsSummary.hasData,
      mrr: mrr.available,
    },
    series,
    adsLastImportedAt: adsSummary.lastImportedAt,
    gscLastSyncAt,
    analyticsSource: getAnalyticsReadSource(),
    analyticsSourceNote: ANALYTICS_READ_SOURCE_NOTES[getAnalyticsReadSource()],
  };
}
