// ===== Owner Console：Revenue 数据层 =====
//
// 两个**互相独立**的收入来源，只在最后统一汇总（任务要求第五条）：
//   A. 订阅收入 —— 权威来源 = Supabase `orders`（含历史 Yaolipay CNY 订单，
//      因此按币种分开统计，绝不跨币种相加）
//   B. 广告收入 —— 权威来源 = Turso `ad_revenue_daily`（AdSense API / CSV / 手工导入）
//
// `creem_transactions` 是 Creem 侧的对账快照：用于核对与排查支付问题，
// **不参与**收入口径计算（否则与 orders 重复计算同一笔钱）。

import { PLAN_PRICING, isSubscriptionActive } from "@/lib/billing";
import type { SubscriptionStatus } from "@/lib/auth";
import { getAdapter } from "@/lib/db/migrations";
import {
  getCreemRevenueSnapshot,
  countCanceledSubscriptions,
  countNewSubscriptions,
  getCreemSubscriptionCounts,
  type CreemSubscriptionCounts,
} from "@/lib/creem/snapshot";
import { getAdRevenueSummary, type AdRevenueSummary } from "./ads";
import { getProfilesSnapshot, getOrdersSnapshot, withinWindow, type OrderRow } from "./snapshot";
import { dedupeOrdersById } from "./customers";

export interface CurrencyAmount {
  currency: string;
  cents: number;
}

export interface SubscriptionRevenue {
  /** orders（Supabase）是否可读 */
  available: boolean;
  error?: string;
  truncated: boolean;
  windowDays: number;
  /** 按币种分组的毛/退/净（不跨币种换算） */
  breakdown: Array<{ currency: string; grossCents: number; refundCents: number; netCents: number }>;
  /** 窗口内有成功支付的去重用户数 */
  payingCustomers: number;
  newPaidOrders: number;
  refundedOrders: number;
  /** 窗口内新购买与退款明细计数（含未支付订单） */
  checkoutOrders: number;
}

/** 订阅收入（窗口；来源 = Supabase orders） */
export async function getSubscriptionRevenue(days: number): Promise<SubscriptionRevenue> {
  const snap = await getOrdersSnapshot();
  const base: SubscriptionRevenue = {
    available: snap.available,
    error: snap.error,
    truncated: snap.truncated,
    windowDays: days,
    breakdown: [],
    payingCustomers: 0,
    newPaidOrders: 0,
    refundedOrders: 0,
    checkoutOrders: 0,
  };
  if (!snap.available) return base;

  const acc = new Map<string, { grossCents: number; refundCents: number }>();
  const payers = new Set<string>();
  let newPaidOrders = 0;
  let refundedOrders = 0;
  let checkoutOrders = 0;

  for (const o of dedupeOrdersById(snap.rows)) {
    const currency = String(o.currency ?? "USD").toUpperCase();
    const bucket = acc.get(currency) ?? { grossCents: 0, refundCents: 0 };

    if (withinWindow(o.created_at, days)) checkoutOrders++;
    if (o.payment_status === "paid" && withinWindow(o.paid_at, days)) {
      bucket.grossCents += Math.round(Number(o.amount ?? 0) * 100);
      newPaidOrders++;
      payers.add(o.user_id);
    }
    // 退款以退款发生时间为准（历史退款不计入本窗口）
    if (o.refund_amount && withinWindow(o.refunded_at, days)) {
      bucket.refundCents += Math.round(Number(o.refund_amount) * 100);
      refundedOrders++;
    }
    if (bucket.grossCents !== 0 || bucket.refundCents !== 0) acc.set(currency, bucket);
  }

  return {
    ...base,
    breakdown: [...acc.entries()]
      .map(([currency, v]) => ({
        currency,
        grossCents: v.grossCents,
        refundCents: v.refundCents,
        netCents: v.grossCents - v.refundCents,
      }))
      .sort((a, b) => b.netCents - a.netCents),
    payingCustomers: payers.size,
    newPaidOrders,
    refundedOrders,
    checkoutOrders,
  };
}

export interface MrrSnapshot {
  available: boolean;
  error?: string;
  currency: string;
  mrrCents: number;
  payingUsers: number;
  byPlan: Array<{ plan: string; users: number; unitCents: number; mrrCents: number }>;
  /** 口径说明（UI 直接展示，避免"这个 MRR 怎么算的"） */
  basis: string;
  /** 是否有历史 CNY 订单（提示 MRR 只覆盖 USD 订阅） */
  hasLegacyNonUsd: boolean;
}

/**
 * MRR：活跃订阅用户数 × 对应套餐月费。
 * 口径 = Supabase profiles 的 effectivePlan（subscription_status ∈ active/trialing 且未过期）。
 * Custom 是一次性服务（PLAN_PRICING.custom.periodDays = 0），**不计入 MRR**。
 */
export async function getMrr(): Promise<MrrSnapshot> {
  const snap = await getProfilesSnapshot();
  const emptyBasis =
    "MRR = Σ(活跃 SUB 用户数 × 套餐月费)，来源 profiles.plan + subscription_status + current_period_end；Custom 为一次性服务不计入。";
  if (!snap.available) {
    return {
      available: false,
      error: snap.error,
      currency: "USD",
      mrrCents: 0,
      payingUsers: 0,
      byPlan: [],
      basis: emptyBasis,
      hasLegacyNonUsd: false,
    };
  }

  const counts = new Map<string, number>();
  let payingUsers = 0;
  let hasLegacyNonUsd = false;
  for (const p of snap.rows) {
    const active = isSubscriptionActive(
      p.subscription_status as SubscriptionStatus,
      p.current_period_end
    );
    if (!active) continue;
    if (p.plan === "lite" || p.plan === "pro") {
      counts.set(p.plan, (counts.get(p.plan) ?? 0) + 1);
      payingUsers++;
    } else if (p.plan === "custom") {
      // 一次性服务：不产生月度经常性收入，仅记录不影响 MRR
      hasLegacyNonUsd = hasLegacyNonUsd || false;
    }
  }

  const orders = await getOrdersSnapshot();
  if (orders.available) {
    hasLegacyNonUsd = orders.rows.some(
      (o) => String(o.currency).toUpperCase() !== "USD" && o.payment_status === "paid"
    );
  }

  const byPlan = ["lite", "pro"].map((plan) => {
    const users = counts.get(plan) ?? 0;
    const unitCents = PLAN_PRICING[plan as "lite" | "pro"].amountCents;
    return { plan, users, unitCents, mrrCents: users * unitCents };
  });

  return {
    available: true,
    currency: "USD",
    mrrCents: byPlan.reduce((s, p) => s + p.mrrCents, 0),
    payingUsers,
    byPlan,
    basis: emptyBasis,
    hasLegacyNonUsd,
  };
}

/** ARPU = 窗口内订阅净收入 / 窗口内付费用户数；分母为 0 时返回 null（不伪造） */
export async function getArpu(days: number): Promise<{ value: number | null; currency: string; basis: string }> {
  const rev = await getSubscriptionRevenue(days);
  const usd = rev.breakdown.find((b) => b.currency === "USD") ?? rev.breakdown[0];
  if (!usd || rev.payingCustomers <= 0) {
    return {
      value: null,
      currency: usd?.currency ?? "USD",
      basis: "付费用户数为 0，ARPU 无意义（不显示估值）",
    };
  }
  return {
    value: usd.netCents / rev.payingCustomers,
    currency: usd.currency,
    basis: `${usd.currency} 订阅净收入 ÷ 窗口内付费用户数`,
  };
}

export interface CreemSubscriptionLifecycle {
  counts: CreemSubscriptionCounts;
  newInWindow: number;
  canceledInWindow: number;
}

/** 订阅生命周期计数（Creem 本地快照；无数据时为全 0 —— UI 需以 hasData 判断） */
export async function getSubscriptionLifecycle(days: number): Promise<CreemSubscriptionLifecycle> {
  const [counts, newInWindow, canceledInWindow] = await Promise.all([
    getCreemSubscriptionCounts(),
    countNewSubscriptions(days),
    countCanceledSubscriptions(days),
  ]);
  return { counts, newInWindow, canceledInWindow };
}

export interface RevenueReconciliation {
  /** Creem 本地快照是否已有数据 */
  hasCreemData: boolean;
  creemGrossCents: number;
  creemRefundCents: number;
  /** orders 表中 creem 渠道的毛/退（USD） */
  ordersGrossCents: number;
  ordersRefundCents: number;
  /** 差额 = Creem 快照 - orders（仅 USD 口径）；非 0 说明两侧需要人工核对 */
  deltaGrossCents: number;
  deltaRefundCents: number;
  currency: string;
}

/**
 * Creem 侧快照 vs orders 对账（只用于排查，不参与收入口径）。
 */
export async function getRevenueReconciliation(): Promise<RevenueReconciliation> {
  const [creem, orders] = await Promise.all([getCreemRevenueSnapshot(), getOrdersSnapshot()]);
  let ordersGrossCents = 0;
  let ordersRefundCents = 0;
  if (orders.available) {
    for (const o of orders.rows) {
      if (o.payment_channel !== "creem") continue;
      if (String(o.currency).toUpperCase() !== "USD") continue;
      if (o.payment_status === "paid" || o.payment_status === "refunded") {
        ordersGrossCents += Math.round(Number(o.amount ?? 0) * 100);
      }
      if (o.refund_amount) {
        ordersRefundCents += Math.round(Number(o.refund_amount ?? 0) * 100);
      }
    }
  }
  return {
    hasCreemData: creem.grossCents > 0 || creem.refunds > 0,
    creemGrossCents: creem.grossCents,
    creemRefundCents: creem.refundCents,
    ordersGrossCents,
    ordersRefundCents,
    deltaGrossCents: creem.grossCents - ordersGrossCents,
    deltaRefundCents: creem.refundCents - ordersRefundCents,
    currency: "USD",
  };
}

export interface CreemSnapshotGap {
  /** 订单已支付（creem 渠道）但本地快照缺行 → 历史快照缺失，可用此清单人工核对/回补 */
  missingSnapshot: Array<{
    outTradeNo: string;
    userId: string;
    cents: number;
    currency: string;
    paidAt: string | null;
  }>;
  /** 快照有 payment 行但 orders 无对应订单号 → 孤立快照（需人工排查） */
  orphan: Array<{
    creemTransactionId: string;
    outTradeNo: string | null;
    cents: number;
    currency: string;
  }>;
  /** 两侧金额不一致（同单号）→ 对账差异 */
  mismatch: Array<{
    outTradeNo: string;
    orderCents: number;
    snapshotCents: number;
    currency: string;
  }>;
}

/**
 * 订单 vs Creem 快照逐单对账（纯函数，可单测）。
 * 口径：只比对 creem 渠道、已支付（paid/refunded）订单 与 type='payment' AND status='paid' 快照行；
 * 退款在 orders 侧以 refund_amount 体现，Creem 侧 type='refund' 行不参与本对账。
 */
export function diffOrdersVsCreemTransactions(
  orders: OrderRow[],
  txns: Array<{
    creem_transaction_id: string;
    out_trade_no: string | null;
    amount_cents: number;
    currency: string;
    type: string;
    status: string;
  }>
): CreemSnapshotGap {
  const paidTxnByOrder = new Map<string, { cents: number; currency: string; id: string }>();
  for (const t of txns) {
    if (t.type !== "payment" || t.status !== "paid") continue;
    const key = (t.out_trade_no ?? "").trim();
    if (!key) continue;
    paidTxnByOrder.set(key, {
      cents: Number(t.amount_cents ?? 0),
      currency: String(t.currency ?? "USD").toUpperCase(),
      id: t.creem_transaction_id,
    });
  }

  const orderNos = new Set<string>();
  const missingSnapshot: CreemSnapshotGap["missingSnapshot"] = [];
  const mismatch: CreemSnapshotGap["mismatch"] = [];

  for (const o of orders) {
    if (o.payment_channel !== "creem") continue;
    if (o.payment_status !== "paid" && o.payment_status !== "refunded") continue;
    const no = (o.out_trade_no ?? "").trim();
    if (!no) continue;
    orderNos.add(no);
    const txn = paidTxnByOrder.get(no);
    const orderCents = Math.round(Number(o.amount ?? 0) * 100);
    if (!txn) {
      missingSnapshot.push({
        outTradeNo: no,
        userId: o.user_id,
        cents: orderCents,
        currency: String(o.currency ?? "USD").toUpperCase(),
        paidAt: o.paid_at,
      });
    } else if (txn.cents !== orderCents) {
      mismatch.push({
        outTradeNo: no,
        orderCents,
        snapshotCents: txn.cents,
        currency: String(o.currency ?? "USD").toUpperCase(),
      });
    }
  }

  const orphan = [...paidTxnByOrder.entries()]
    .filter(([no]) => !orderNos.has(no))
    .map(([no, t]) => ({
      creemTransactionId: t.id,
      outTradeNo: no,
      cents: t.cents,
      currency: t.currency,
    }));

  return { missingSnapshot, orphan, mismatch };
}

/** 读取 Creem 快照支付行并执行逐单对账（orders 不可读时如实返回空报告） */
export async function getCreemSnapshotGap(): Promise<CreemSnapshotGap & { ordersAvailable: boolean; hasCreemData: boolean }> {
  const [ordersSnap, txns] = await Promise.all([
    getOrdersSnapshot(),
    (async () => {
      const db = await getAdapter();
      return (await db.query(
        `SELECT creem_transaction_id, out_trade_no, amount_cents, currency, type, status
           FROM creem_transactions`
      )) as Array<{
        creem_transaction_id: string;
        out_trade_no: string | null;
        amount_cents: number;
        currency: string;
        type: string;
        status: string;
      }>;
    })().catch(() => [] as Array<{
      creem_transaction_id: string;
      out_trade_no: string | null;
      amount_cents: number;
      currency: string;
      type: string;
      status: string;
    }>),
  ]);
  const gap = diffOrdersVsCreemTransactions(ordersSnap.rows, txns);
  const hasCreemData = txns.length > 0;
  return { ...gap, ordersAvailable: ordersSnap.available, hasCreemData };
}

export interface RevenueSummary {
  windowDays: number;
  subscription: SubscriptionRevenue;
  mrr: MrrSnapshot;
  arpu: { value: number | null; currency: string; basis: string };
  lifecycle: CreemSubscriptionLifecycle;
  reconciliation: RevenueReconciliation;
  /** 逐单对账缺口：orders 已支付但快照缺失 / 孤立快照 / 金额不一致 */
  snapshotGap: CreemSnapshotGap & { ordersAvailable: boolean; hasCreemData: boolean };
  ads: AdRevenueSummary;
  /** 汇总：订阅净额 + 广告收入（按 USD 口径；其它币种单独列出，不换算） */
  totalNetCents: number;
  totalCurrency: string;
  /** 非 USD 的订阅净额（历史订单），单独展示，绝不并入 totalNetCents */
  otherCurrencyNet: CurrencyAmount[];
}

/** Revenue 页唯一数据入口（订阅 + 广告分别统计后统一汇总） */
export async function getRevenueSummary(days: number): Promise<RevenueSummary> {
  const [subscription, mrr, arpu, lifecycle, reconciliation, ads, snapshotGap] = await Promise.all([
    getSubscriptionRevenue(days),
    getMrr(),
    getArpu(days),
    getSubscriptionLifecycle(days),
    getRevenueReconciliation(),
    getAdRevenueSummary(days),
    getCreemSnapshotGap(),
  ]);

  const usd = subscription.breakdown.find((b) => b.currency === "USD");
  const usdSubNet = usd?.netCents ?? 0;
  // 非 USD 订阅净额 + 非 USD 广告收入：合并列出，绝不换算、绝不并入 totalNetCents
  const otherMap = new Map<string, number>();
  for (const b of subscription.breakdown) {
    if (b.currency !== "USD" && b.netCents !== 0) {
      otherMap.set(b.currency, (otherMap.get(b.currency) ?? 0) + b.netCents);
    }
  }
  for (const a of ads.nonUsd) {
    if (a.cents !== 0) {
      otherMap.set(a.currency, (otherMap.get(a.currency) ?? 0) + a.cents);
    }
  }
  const otherCurrencyNet = [...otherMap.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([currency, cents]) => ({ currency, cents }))
    .sort((a, b) => b.cents - a.cents);

  return {
    windowDays: days,
    subscription,
    mrr,
    arpu,
    lifecycle,
    reconciliation,
    snapshotGap,
    ads,
    // 广告收入 revenueCents 已是 USD 口径（非 USD 在 ads.nonUsd），与 USD 订阅净额相加合法
    totalNetCents: usdSubNet + ads.revenueCents,
    totalCurrency: "USD",
    otherCurrencyNet,
  };
}
