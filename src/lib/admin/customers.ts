// ===== Owner Console：Customers 数据层 =====
//
// 数据来源（全部复用，不新建 CRM）：
//   - 身份/套餐：Supabase `profiles`（权威，含历史）
//   - 收入：Supabase `orders`（权威）
//   - 行为/归因/功能使用：Turso `analytics_events` + `analytics_identities`
//   - 支付排查：Turso `creem_customers` / `creem_subscriptions` / `creem_transactions`
//
// 注意：客户是「注册用户」。匿名访客只出现在漏斗的 Visit 节点，不进入客户列表。

import { getAnalyticsReadAdapter } from "@/lib/analytics/readonly";
import { isSubscriptionActive } from "@/lib/billing";
import type { SubscriptionStatus } from "@/lib/auth";
import {
  getOrdersSnapshot,
  getProfilesSnapshot,
  type OrderRow,
  type ProfileRow,
  withinWindow,
} from "./snapshot";
import { timelineLabel, type TimelineSourceKind } from "./event-catalog";

// ---------- 状态分类（纯函数，可单测） ----------

export const CUSTOMER_STATUS_FILTERS = [
  "all",
  "free",
  "trial",
  "paying",
  "canceled",
  "inactive",
] as const;
export type CustomerStatusFilter = (typeof CUSTOMER_STATUS_FILTERS)[number];
export type CustomerStatus = Exclude<CustomerStatusFilter, "all">;

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatusFilter, string> = {
  all: "全部",
  free: "免费",
  trial: "试用中",
  paying: "付费",
  canceled: "已取消",
  inactive: "不活跃",
};

/** 超过该天数没有站内活动视为 Inactive */
export const INACTIVE_AFTER_DAYS = 30;

/**
 * 客户经营状态分类。
 * 判定顺序（互斥，前者优先）：Trial → Paying → Canceled → Inactive → Free。
 * 「从未活跃」不算 Inactive（新注册用户不应被判为流失）。
 */
export function classifyCustomer(args: {
  plan: string;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  lastActiveAt: string | null;
  now?: number;
}): CustomerStatus {
  const status = args.subscriptionStatus as SubscriptionStatus;
  const active = isSubscriptionActive(status, args.currentPeriodEnd);
  if (active && status === "trialing") return "trial";
  if (active && args.plan !== "free") return "paying";
  if (status === "canceled" || status === "expired") return "canceled";
  if (args.lastActiveAt) {
    const t = Date.parse(args.lastActiveAt);
    const now = args.now ?? Date.now();
    if (!Number.isNaN(t) && now - t > INACTIVE_AFTER_DAYS * 86_400_000) return "inactive";
  }
  return "free";
}

// ---------- Turso 聚合 ----------

export interface CustomerAggregate {
  userId: string;
  lastActiveAt: string | null;
  eventCount: number;
  auditCount: number;
  projectCount: number;
  featureUses: number;
  features: string[];
}

interface AttributionRow {
  user_id: string;
  first_touch_source: string | null;
  first_touch_medium: string | null;
  first_touch_campaign: string | null;
  first_landing_page: string | null;
  last_landing_page: string | null;
  last_seen_at: string | null;
}

async function safeQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const db = await getAnalyticsReadAdapter();
    return (await db.query(sql, params as never)) as T[];
  } catch {
    // 单条聚合失败不应让整个客户列表不可用（如实返回空，UI 显示 0 并在数据源页标注）
    return [];
  }
}

/** 每个用户的站内活动聚合（last active / 事件数 / 审计数 / 项目数 / 功能使用） */
export async function getCustomerAggregates(): Promise<Map<string, CustomerAggregate>> {
  const [events, audits, projects, features] = await Promise.all([
    safeQuery<{ user_id: string; last_active: string | null; events: number }>(
      `SELECT user_id, MAX(created_at) AS last_active, COUNT(*) AS events
         FROM analytics_events WHERE user_id IS NOT NULL AND user_id != ''
        GROUP BY user_id`
    ),
    safeQuery<{ user_id: string; n: number }>(
      `SELECT user_id, COUNT(*) AS n FROM audits
        WHERE user_id IS NOT NULL AND user_id != '' GROUP BY user_id`
    ),
    safeQuery<{ user_id: string; n: number }>(
      `SELECT user_id, COUNT(*) AS n FROM projects
        WHERE user_id IS NOT NULL AND user_id != '' GROUP BY user_id`
    ),
    safeQuery<{ user_id: string; feature: string | null; n: number }>(
      `SELECT user_id, json_extract(props, '$.feature') AS feature, COUNT(*) AS n
         FROM analytics_events
        WHERE event_name = 'feature_used' AND user_id IS NOT NULL AND user_id != ''
        GROUP BY user_id, feature`
    ),
  ]);

  const map = new Map<string, CustomerAggregate>();
  const ensure = (userId: string): CustomerAggregate => {
    let row = map.get(userId);
    if (!row) {
      row = {
        userId,
        lastActiveAt: null,
        eventCount: 0,
        auditCount: 0,
        projectCount: 0,
        featureUses: 0,
        features: [],
      };
      map.set(userId, row);
    }
    return row;
  };

  for (const e of events) {
    const row = ensure(String(e.user_id));
    row.lastActiveAt = e.last_active ? String(e.last_active) : null;
    row.eventCount = Number(e.events ?? 0);
  }
  for (const a of audits) ensure(String(a.user_id)).auditCount = Number(a.n ?? 0);
  for (const p of projects) ensure(String(p.user_id)).projectCount = Number(p.n ?? 0);
  for (const f of features) {
    const row = ensure(String(f.user_id));
    row.featureUses += Number(f.n ?? 0);
    if (f.feature && !row.features.includes(String(f.feature))) {
      row.features.push(String(f.feature));
    }
  }
  return map;
}

/** 每个用户的首触归因（取最早建立的身份行） */
export async function getCustomerAttribution(): Promise<Map<string, AttributionRow>> {
  const rows = await safeQuery<AttributionRow>(
    `SELECT i.user_id, i.first_touch_source, i.first_touch_medium, i.first_touch_campaign,
            i.first_landing_page, i.last_landing_page, i.last_seen_at
       FROM analytics_identities i
       JOIN (
         SELECT user_id, MIN(first_seen_at) AS fs
           FROM analytics_identities
          WHERE user_id IS NOT NULL AND user_id != ''
          GROUP BY user_id
       ) m ON m.user_id = i.user_id AND i.first_seen_at = m.fs`
  );
  const map = new Map<string, AttributionRow>();
  for (const r of rows) map.set(String(r.user_id), r);
  return map;
}

// ---------- 客户行 ----------

export interface RevenueByCurrency {
  currency: string;
  cents: number;
}

export interface CustomerRow {
  userId: string;
  email: string;
  displayName: string | null;
  signupAt: string;
  status: CustomerStatus;
  plan: string;
  effectivePlan: string;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landingPage: string | null;
  lastActiveAt: string | null;
  lastSeenAt: string | null;
  projects: number;
  audits: number;
  featureUses: number;
  features: string[];
  revenue: RevenueByCurrency[];
  paidOrders: number;
  lastPaidAt: string | null;
}

/** 订单金额（分，按币种分组；退款扣减，不跨币种换算） */
export function aggregateOrderRevenue(orders: OrderRow[]): {
  byCurrency: Map<string, number>;
  paidOrders: number;
  lastPaidAt: string | null;
} {
  const byCurrency = new Map<string, number>();
  let paidOrders = 0;
  let lastPaidAt: string | null = null;
  for (const o of orders) {
    if (o.payment_status === "paid" || o.payment_status === "refunded") {
      const cents = Math.round(Number(o.amount ?? 0) * 100);
      const cur = String(o.currency ?? "USD").toUpperCase();
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + cents);
      paidOrders++;
      if (o.paid_at && (!lastPaidAt || o.paid_at > lastPaidAt)) lastPaidAt = o.paid_at;
    }
    if (o.refund_amount) {
      const cents = Math.round(Number(o.refund_amount) * 100);
      const cur = String(o.currency ?? "USD").toUpperCase();
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) - cents);
    }
  }
  return { byCurrency, paidOrders, lastPaidAt };
}

function toRevenueList(map: Map<string, number>): RevenueByCurrency[] {
  return [...map.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([currency, cents]) => ({ currency, cents }))
    .sort((a, b) => b.cents - a.cents);
}

export interface CustomersSnapshot {
  /** profiles（权威表）是否可读；false 时 UI 必须显示 unavailable */
  available: boolean;
  error?: string;
  truncated: boolean;
  rows: CustomerRow[];
  /** 全部订单（供详情页与收入页复用，避免重复查询） */
  orders: OrderRow[];
  ordersAvailable: boolean;
}

/** 按订单 id 去重（防分页区间重叠把同一订单读两遍 → 收入翻倍）；无 id 的行原样保留 */
export function dedupeOrdersById(orders: OrderRow[]): OrderRow[] {
  const seen = new Set<string>();
  const out: OrderRow[] = [];
  for (const o of orders) {
    if (o.id) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
    }
    out.push(o);
  }
  return out;
}

/** 汇总全部客户行（profiles × 站内聚合 × 归因 × 订单） */
export async function listCustomers(): Promise<CustomersSnapshot> {
  const [profiles, ordersSnap, aggregates, attribution] = await Promise.all([
    getProfilesSnapshot(),
    getOrdersSnapshot(),
    getCustomerAggregates(),
    getCustomerAttribution(),
  ]);

  const ordersByUser = new Map<string, OrderRow[]>();
  for (const o of dedupeOrdersById(ordersSnap.rows)) {
    const list = ordersByUser.get(o.user_id) ?? [];
    list.push(o);
    ordersByUser.set(o.user_id, list);
  }

  const rows: CustomerRow[] = profiles.rows.map((p: ProfileRow) => {
    const agg = aggregates.get(p.id);
    const attr = attribution.get(p.id);
    const revenue = aggregateOrderRevenue(ordersByUser.get(p.id) ?? []);
    const status = classifyCustomer({
      plan: p.plan,
      subscriptionStatus: p.subscription_status,
      currentPeriodEnd: p.current_period_end,
      lastActiveAt: agg?.lastActiveAt ?? null,
    });
    const effectivePlan = isSubscriptionActive(
      p.subscription_status as SubscriptionStatus,
      p.current_period_end
    )
      ? p.plan
      : "free";
    return {
      userId: p.id,
      email: p.email,
      displayName: p.display_name,
      signupAt: p.created_at,
      status,
      plan: p.plan,
      effectivePlan,
      subscriptionStatus: p.subscription_status,
      currentPeriodEnd: p.current_period_end,
      source: attr?.first_touch_source ?? null,
      medium: attr?.first_touch_medium ?? null,
      campaign: attr?.first_touch_campaign ?? null,
      landingPage: attr?.first_landing_page ?? null,
      lastActiveAt: agg?.lastActiveAt ?? null,
      lastSeenAt: attr?.last_seen_at ?? null,
      projects: agg?.projectCount ?? 0,
      audits: agg?.auditCount ?? 0,
      featureUses: agg?.featureUses ?? 0,
      features: agg?.features ?? [],
      revenue: toRevenueList(revenue.byCurrency),
      paidOrders: revenue.paidOrders,
      lastPaidAt: revenue.lastPaidAt,
    };
  });

  return {
    available: profiles.available,
    error: profiles.error,
    truncated: profiles.truncated,
    rows,
    orders: ordersSnap.rows,
    ordersAvailable: ordersSnap.available,
  };
}

export type CustomerSortKey = "signup" | "lastActive" | "revenue";

/** 搜索 / 筛选 / 排序（服务端渲染用纯函数，便于测试） */
export function filterCustomers(
  rows: CustomerRow[],
  args: {
    status?: CustomerStatusFilter;
    search?: string;
    sort?: CustomerSortKey;
  }
): CustomerRow[] {
  const status = args.status ?? "all";
  const q = (args.search ?? "").trim().toLowerCase();
  let out = rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (!q) return true;
    return (
      r.email.toLowerCase().includes(q) ||
      (r.displayName ?? "").toLowerCase().includes(q) ||
      r.userId.toLowerCase().includes(q)
    );
  });
  const ts = (v: string | null) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? 0 : t;
  };
  const revenueOf = (r: CustomerRow) => r.revenue[0]?.cents ?? 0;
  const sort = args.sort ?? "signup";
  out = out.sort((a, b) => {
    if (sort === "lastActive") return ts(b.lastActiveAt) - ts(a.lastActiveAt);
    if (sort === "revenue") return revenueOf(b) - revenueOf(a) || ts(b.signupAt) - ts(a.signupAt);
    return ts(b.signupAt) - ts(a.signupAt);
  });
  return out;
}

// ---------- 客户详情 ----------

export interface TimelineEntry {
  at: string;
  key: string;
  label: string;
  kind: TimelineSourceKind;
  path: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  refId: string | null;
  detail: string | null;
}

const TIMELINE_LIMIT = 500;

/**
 * 完整 activity timeline：站内事件（含注册前匿名行为）+ 订单 + Creem 记录。
 * 已按时间升序，最多 500 条（超出时 UI 提示）。
 */
export async function getCustomerTimeline(userId: string): Promise<{
  entries: TimelineEntry[];
  truncated: boolean;
}> {
  const [events, subscriptions, transactions] = await Promise.all([
    safeQuery<{
      event_name: string;
      created_at: string;
      path: string | null;
      source: string | null;
      medium: string | null;
      campaign: string | null;
      referrer: string | null;
      ref_id: string | null;
      props: string | null;
    }>(
      `SELECT event_name, created_at, path, source, medium, campaign, referrer, ref_id, props
         FROM analytics_events
        WHERE user_id = ?
           OR anonymous_id IN (SELECT anonymous_id FROM analytics_identities WHERE user_id = ?)
        ORDER BY created_at DESC
        LIMIT ?`,
      [userId, userId, TIMELINE_LIMIT]
    ),
    safeQuery<Record<string, unknown>>(
      `SELECT * FROM creem_subscriptions WHERE user_id = ?`,
      [userId]
    ),
    safeQuery<Record<string, unknown>>(
      `SELECT * FROM creem_transactions WHERE user_id = ?`,
      [userId]
    ),
  ]);

  const ordersSnap = await getOrdersSnapshot();
  const orders = ordersSnap.rows.filter((o) => o.user_id === userId);

  const entries: TimelineEntry[] = [];

  for (const e of events) {
    const meta = timelineLabel(String(e.event_name));
    entries.push({
      at: String(e.created_at),
      key: String(e.event_name),
      label: meta.label,
      kind: meta.kind,
      path: e.path ? String(e.path) : null,
      source: e.source ? String(e.source) : null,
      medium: e.medium ? String(e.medium) : null,
      campaign: e.campaign ? String(e.campaign) : null,
      referrer: e.referrer ? String(e.referrer) : null,
      refId: e.ref_id ? String(e.ref_id) : null,
      detail: e.props ? String(e.props) : null,
    });
  }

  for (const o of orders) {
    const meta = timelineLabel("order_created");
    entries.push({
      at: String(o.created_at),
      key: "order_created",
      label: `${meta.label} · ${o.out_trade_no}`,
      kind: "order",
      path: null,
      source: null,
      medium: null,
      campaign: null,
      referrer: null,
      refId: o.out_trade_no,
      detail: `${o.plan} · ${o.amount} ${o.currency} · ${o.payment_status} · channel=${o.payment_channel ?? "—"}`,
    });
    if (o.paid_at) {
      entries.push({
        at: String(o.paid_at),
        key: "checkout_completed",
        label: `结账成功（订单 ${o.out_trade_no}）`,
        kind: "order",
        path: null,
        source: null,
        medium: null,
        campaign: null,
        referrer: null,
        refId: o.out_trade_no,
        detail: `paid_at · ${o.amount} ${o.currency}`,
      });
    }
    if (o.refunded_at || o.refund_amount) {
      entries.push({
        at: String(o.refunded_at ?? o.created_at),
        key: "refund_created",
        label: `退款（订单 ${o.out_trade_no}）`,
        kind: "order",
        path: null,
        source: null,
        medium: null,
        campaign: null,
        referrer: null,
        refId: o.out_trade_no,
        detail: `refund_amount=${o.refund_amount ?? "—"} · status=${o.refund_status ?? "—"}`,
      });
    }
  }

  for (const s of subscriptions) {
    const subId = String(s.creem_subscription_id ?? "");
    entries.push({
      at: String(s.created_at ?? ""),
      key: "creem_subscription_created",
      label: `创建订阅（Creem ${subId}）`,
      kind: "creem",
      path: null,
      source: null,
      medium: null,
      campaign: null,
      referrer: null,
      refId: subId || null,
      detail: `plan=${s.plan ?? "—"} · product=${s.product_id ?? "—"} · customer=${s.creem_customer_id ?? "—"}`,
    });
    if (s.updated_at && s.updated_at !== s.created_at) {
      entries.push({
        at: String(s.updated_at),
        key: "creem_subscription_updated",
        label: `订阅状态变更（Creem ${subId}）`,
        kind: "creem",
        path: null,
        source: null,
        medium: null,
        campaign: null,
        referrer: null,
        refId: subId || null,
        detail: `status=${s.status ?? "—"} · period_end=${s.current_period_end ?? "—"} · canceled_at=${s.canceled_at ?? "—"}`,
      });
    }
  }

  for (const t of transactions) {
    const isRefund = String(t.type ?? "") === "refund";
    const key = isRefund ? "creem_refund_recorded" : "creem_payment_recorded";
    entries.push({
      at: String((isRefund ? t.occurred_at : t.paid_at) ?? t.created_at ?? ""),
      key,
      label: `${timelineLabel(key).label}（${String(t.creem_transaction_id ?? "")}）`,
      kind: "creem",
      path: null,
      source: null,
      medium: null,
      campaign: null,
      referrer: null,
      refId: t.creem_transaction_id ? String(t.creem_transaction_id) : null,
      detail: `${t.amount_cents ?? 0} 分 ${t.currency ?? ""} · status=${t.status ?? "—"} · out_trade_no=${t.out_trade_no ?? "—"}`,
    });
  }

  // 去掉空时间戳（数据异常行），按时间升序
  const clean = entries
    .filter((e) => e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return {
    entries: clean.slice(0, TIMELINE_LIMIT),
    truncated: clean.length > TIMELINE_LIMIT || events.length >= TIMELINE_LIMIT,
  };
}

export { withinWindow };
