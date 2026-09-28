// ===== Marketing Analytics：漏斗统计 =====
// 口径定义（分母不混用）：
//   Visitors          = 窗口内 page_view 的去重身份数（COALESCE(user_id, anonymous_id)）
//   Audits started    = audit_started 的去重 ref_id（audit id）数
//   Audits completed  = audit_completed 的去重 ref_id 数
//   Signups           = signup_completed 事件数
//   Activated users   = activation_completed 的去重 user_id 数
//   Returning users   = returning_user 的去重 user_id 数
//   Pricing views     = pricing_viewed 事件数
//   Upgrade starts    = upgrade_started 事件数
//   Paid users        = payment_completed 的去重 user_id 数
// 转化率：
//   audit_conversion     = audits_completed_unique_ref / visitors        （人数 → 次数，见字段注释）
//   signup_conversion    = signup_completed / audits_completed（次数比）
//   activation_conversion = activated_users / signups                    （人数比）
//   paid_conversion      = paid_users / activated_users                  （人数比）

import { getAdapter } from "@/lib/db/migrations";

export interface FunnelWindow {
  /** 窗口长度（天） */
  days: number;
  visitors: number;
  auditsStarted: number;
  auditsCompleted: number;
  signups: number;
  activatedUsers: number;
  returningUsers: number;
  pricingViews: number;
  upgradeStarts: number;
  paidUsers: number;
}

export interface FunnelConversions {
  /** audit_completed 去重审计 / visitors */
  auditConversion: number | null;
  /** signup_completed / audits_completed */
  signupConversion: number | null;
  /** activated_users / signups */
  activationConversion: number | null;
  /** paid_users / activated_users */
  paidConversion: number | null;
}

export interface SourceRow {
  source: string;
  visitors: number;
  audits: number;
  signups: number;
  activated: number;
  paid: number;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

async function countEvent(db: Awaited<ReturnType<typeof getAdapter>>, event: string, days: number, distinct?: "user_id" | "ref_id"): Promise<number> {
  const agg = distinct ? `COUNT(DISTINCT ${distinct})` : "COUNT(*)";
  const row = await db.get(
    `SELECT ${agg} AS n FROM analytics_events
     WHERE event_name = ? AND created_at >= datetime('now', ?)`,
    [event, `-${days} days`]
  ) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 单个时间窗的漏斗指标 */
export async function getFunnelWindow(days: number): Promise<FunnelWindow> {
  const db = await getAdapter();
  const since = `-${days} days`;

  // 访客去重：经 identities 表把「注册前的匿名行为」与「注册后的账号」合并为同一访客
  const visitorsRow = await db.get(
    `SELECT COUNT(DISTINCT COALESCE(i.user_id, e.anonymous_id)) AS n
     FROM analytics_events e
     LEFT JOIN analytics_identities i ON i.anonymous_id = e.anonymous_id
     WHERE e.event_name = 'page_view' AND e.created_at >= datetime('now', ?)`,
    [since]
  ) as { n: number } | undefined;

  return {
    days,
    visitors: Number(visitorsRow?.n ?? 0),
    auditsStarted: await countEvent(db, "audit_started", days, "ref_id"),
    auditsCompleted: await countEvent(db, "audit_completed", days, "ref_id"),
    signups: await countEvent(db, "signup_completed", days),
    activatedUsers: await countEvent(db, "activation_completed", days, "user_id"),
    returningUsers: await countEvent(db, "returning_user", days, "user_id"),
    pricingViews: await countEvent(db, "pricing_viewed", days),
    upgradeStarts: await countEvent(db, "upgrade_started", days),
    paidUsers: await countEvent(db, "payment_completed", days, "user_id"),
  };
}

export function computeConversions(w: FunnelWindow): FunnelConversions {
  return {
    auditConversion: ratio(w.auditsCompleted, w.visitors),
    signupConversion: ratio(w.signups, w.auditsCompleted),
    activationConversion: ratio(w.activatedUsers, w.signups),
    paidConversion: ratio(w.paidUsers, w.activatedUsers),
  };
}

/** 按来源分组的核心漏斗（来源取各事件写入时的标准化 source） */
export async function getSourceBreakdown(days: number): Promise<SourceRow[]> {
  const db = await getAdapter();
  const since = `-${days} days`;

  const visitors = await db.query(
    `SELECT COALESCE(i.first_touch_source, e.source) AS source,
            COUNT(DISTINCT COALESCE(i.user_id, e.anonymous_id)) AS n
     FROM analytics_events e
     LEFT JOIN analytics_identities i ON i.anonymous_id = e.anonymous_id
     WHERE e.event_name = 'page_view' AND e.created_at >= datetime('now', ?)
     GROUP BY COALESCE(i.first_touch_source, e.source)`,
    [since]
  ) as Array<{ source: string; n: number }>;

  const audits = await db.query(
    `SELECT source, COUNT(DISTINCT ref_id) AS n
     FROM analytics_events
     WHERE event_name IN ('audit_started', 'audit_completed') AND created_at >= datetime('now', ?)
     GROUP BY source`,
    [since]
  ) as Array<{ source: string; n: number }>;

  const signups = await db.query(
    `SELECT source, COUNT(*) AS n
     FROM analytics_events
     WHERE event_name = 'signup_completed' AND created_at >= datetime('now', ?)
     GROUP BY source`,
    [since]
  ) as Array<{ source: string; n: number }>;

  const activated = await db.query(
    `SELECT source, COUNT(DISTINCT user_id) AS n
     FROM analytics_events
     WHERE event_name = 'activation_completed' AND created_at >= datetime('now', ?)
     GROUP BY source`,
    [since]
  ) as Array<{ source: string; n: number }>;

  const paid = await db.query(
    `SELECT source, COUNT(DISTINCT user_id) AS n
     FROM analytics_events
     WHERE event_name = 'payment_completed' AND created_at >= datetime('now', ?)
     GROUP BY source`,
    [since]
  ) as Array<{ source: string; n: number }>;

  const sources = new Set<string>();
  for (const rows of [visitors, audits, signups, activated, paid]) {
    for (const r of rows) sources.add(r.source);
  }

  const pick = (rows: Array<{ source: string; n: number }>, s: string) =>
    Number(rows.find((r) => r.source === s)?.n ?? 0);

  return [...sources]
    .map((source) => ({
      source,
      visitors: pick(visitors, source),
      audits: pick(audits, source),
      signups: pick(signups, source),
      activated: pick(activated, source),
      paid: pick(paid, source),
    }))
    .sort((a, b) => b.visitors - a.visitors || b.audits - a.audits);
}

/** 每日核心漏斗（近 N 天，按 UTC 日分组）—— 供每日推广复盘 */
export interface DailyFunnelRow {
  day: string;
  visitors: number;
  auditsStarted: number;
  auditsCompleted: number;
  signups: number;
  activatedUsers: number;
  returningUsers: number;
  pricingViews: number;
  upgradeStarts: number;
  paidUsers: number;
}

export async function getDailyFunnel(days: number): Promise<DailyFunnelRow[]> {
  const db = await getAdapter();
  const rows = await db.query(
    `SELECT date(created_at) AS day,
       COUNT(DISTINCT CASE WHEN event_name = 'page_view' THEN COALESCE(NULLIF(user_id, ''), anonymous_id) END) AS visitors, -- daily 粒度保留事件口径
       COUNT(DISTINCT CASE WHEN event_name = 'audit_started' THEN ref_id END) AS audits_started,
       COUNT(DISTINCT CASE WHEN event_name = 'audit_completed' THEN ref_id END) AS audits_completed,
       COUNT(CASE WHEN event_name = 'signup_completed' THEN 1 END) AS signups,
       COUNT(DISTINCT CASE WHEN event_name = 'activation_completed' THEN user_id END) AS activated_users,
       COUNT(DISTINCT CASE WHEN event_name = 'returning_user' THEN user_id END) AS returning_users,
       COUNT(CASE WHEN event_name = 'pricing_viewed' THEN 1 END) AS pricing_views,
       COUNT(CASE WHEN event_name = 'upgrade_started' THEN 1 END) AS upgrade_starts,
       COUNT(DISTINCT CASE WHEN event_name = 'payment_completed' THEN user_id END) AS paid_users
     FROM analytics_events
     WHERE created_at >= datetime('now', ?)
     GROUP BY date(created_at)
     ORDER BY day ASC`,
    [`-${days} days`]
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    day: String(r.day),
    visitors: Number(r.visitors ?? 0),
    auditsStarted: Number(r.audits_started ?? 0),
    auditsCompleted: Number(r.audits_completed ?? 0),
    signups: Number(r.signups ?? 0),
    activatedUsers: Number(r.activated_users ?? 0),
    returningUsers: Number(r.returning_users ?? 0),
    pricingViews: Number(r.pricing_views ?? 0),
    upgradeStarts: Number(r.upgrade_starts ?? 0),
    paidUsers: Number(r.paid_users ?? 0),
  }));
}
