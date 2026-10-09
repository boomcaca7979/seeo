// ===== Creem 本地经营快照（Owner Console 数据层）=====
//
// 定位：Creem 是支付事实的 **source of truth**，SeeO 侧只保存**快照**，
// 让 /admin 页面不必每次实时请求 Creem。权益（会员开通/续期）仍然只由
// `src/lib/orders/service.ts` 的 completeOrder / syncSubscriptionPeriod 决定 ——
// 本模块**不改变任何权益逻辑**，只做记录与对账。
//
// 幂等（三层，缺一不可）：
//   1. `creem_webhook_events.id`（event id）唯一：同一事件重投直接跳过；
//   2. `creem_transactions.creem_transaction_id` 主键（payment=order id / refund=refund id）：
//      即使事件 id 不同也不会生成第二行 → 收入永不重复计算；
//   3. `creem_subscriptions` / `creem_customers` 走 upsert（幂等覆盖）。
//
// 收入口径（唯一实现，读时计算，不在写入时累加）：
//   gross   = Σ amount_cents WHERE type='payment' AND status='paid'
//   refunds = Σ amount_cents WHERE type='refund'
//   net     = gross - refunds

import { getAdapter } from "@/lib/db/migrations";
import { planFromProductId, type CreemCheckoutPlan } from "./config";

/** 事件账本状态 */
export type WebhookEventStatus = "received" | "processed" | "ignored" | "failed";

export type ClaimResult =
  /** 首次到达，调用方应处理 */
  | "claimed"
  /** 此前已成功处理/明确忽略，应直接跳过（幂等命中） */
  | "duplicate"
  /** 此前处理失败，允许重试 */
  | "retry";

/**
 * 抢占一个 webhook 事件。
 * - 首次：写入 received 行，返回 "claimed"
 * - 重复且此前 processed/ignored：返回 "duplicate"（调用方直接 200 返回）
 * - 重复但此前 failed：返回 "retry"（Creem 重投时允许重新处理）
 */
export async function claimWebhookEvent(args: {
  eventId: string;
  eventType: string;
  objectId?: string | null;
}): Promise<ClaimResult> {
  const db = await getAdapter();
  const res = await db.run(
    `INSERT OR IGNORE INTO creem_webhook_events (id, event_type, object_id, status)
     VALUES (?, ?, ?, 'received')`,
    [args.eventId, args.eventType, args.objectId ?? null]
  );
  if (Number(res.changes ?? 0) > 0) return "claimed";

  const row = (await db.get(
    `SELECT status FROM creem_webhook_events WHERE id = ?`,
    [args.eventId]
  )) as { status: string } | undefined;
  // received（上次处理中崩溃/超时）与 failed 都允许重试，避免事件被永久丢失；
  // 仅 processed / ignored 视为已完成（幂等命中）。
  if (row?.status === "processed" || row?.status === "ignored") return "duplicate";
  return "retry";
}

/** 标记事件处理结果（失败时 detail 记录原因，便于人工排查） */
export async function finishWebhookEvent(
  eventId: string,
  status: Exclude<WebhookEventStatus, "received">,
  detail?: string | null
): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE creem_webhook_events
        SET status = ?, detail = ?, processed_at = datetime('now')
      WHERE id = ?`,
    [status, detail ? detail.slice(0, 500) : null, eventId]
  );
}

/** Creem 客户快照（email ↔ SeeO user 的桥梁） */
export async function upsertCreemCustomer(args: {
  customerId: string;
  email?: string | null;
  userId?: string | null;
}): Promise<void> {
  if (!args.customerId) return;
  const db = await getAdapter();
  await db.run(
    `INSERT INTO creem_customers (creem_customer_id, email, user_id)
     VALUES (?, ?, ?)
     ON CONFLICT(creem_customer_id) DO UPDATE SET
       email = COALESCE(excluded.email, creem_customers.email),
       user_id = COALESCE(excluded.user_id, creem_customers.user_id),
       updated_at = datetime('now')`,
    [args.customerId, args.email ?? null, args.userId ?? null]
  );
}

/** Creem 订阅快照（upsert；status 以 Creem 事件为准） */
export async function upsertCreemSubscription(args: {
  subscriptionId: string;
  status: string;
  userId?: string | null;
  customerId?: string | null;
  productId?: string | null;
  plan?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  lastTransactionId?: string | null;
}): Promise<{ created: boolean; previousStatus: string | null; statusChanged: boolean }> {
  if (!args.subscriptionId) {
    return { created: false, previousStatus: null, statusChanged: false };
  }
  const db = await getAdapter();
  const plan = args.plan ?? planFromProductId(args.productId);
  const before = (await db.get(
    `SELECT status FROM creem_subscriptions WHERE creem_subscription_id = ?`,
    [args.subscriptionId]
  )) as { status: string } | undefined;
  // canceled_at 只在首次进入 canceled 状态时写入（保留历史取消时间）
  const canceledAt = args.status === "canceled" ? `datetime('now')` : "NULL";
  await db.run(
    `INSERT INTO creem_subscriptions
       (creem_subscription_id, user_id, creem_customer_id, product_id, plan, status,
        current_period_start, current_period_end, last_transaction_id, canceled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${canceledAt})
     ON CONFLICT(creem_subscription_id) DO UPDATE SET
       user_id = COALESCE(excluded.user_id, creem_subscriptions.user_id),
       creem_customer_id = COALESCE(excluded.creem_customer_id, creem_subscriptions.creem_customer_id),
       product_id = COALESCE(excluded.product_id, creem_subscriptions.product_id),
       plan = COALESCE(excluded.plan, creem_subscriptions.plan),
       status = excluded.status,
       current_period_start = COALESCE(excluded.current_period_start, creem_subscriptions.current_period_start),
       current_period_end = COALESCE(excluded.current_period_end, creem_subscriptions.current_period_end),
       last_transaction_id = COALESCE(excluded.last_transaction_id, creem_subscriptions.last_transaction_id),
       canceled_at = COALESCE(creem_subscriptions.canceled_at, excluded.canceled_at),
       updated_at = datetime('now')`,
    [
      args.subscriptionId,
      args.userId ?? null,
      args.customerId ?? null,
      args.productId ?? null,
      plan ?? null,
      args.status,
      args.currentPeriodStart ?? null,
      args.currentPeriodEnd ?? null,
      args.lastTransactionId ?? null,
    ]
  );
  return {
    created: !before,
    previousStatus: before?.status ?? null,
    statusChanged: !before || before.status !== args.status,
  };
}

/** 收款快照（PK = Creem order id → 重投不会产生第二行） */
export async function recordCreemPayment(args: {
  transactionId: string;
  status: string;
  amountCents: number;
  currency?: string | null;
  userId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  outTradeNo?: string | null;
  plan?: CreemCheckoutPlan | string | null;
  paidAt?: string | null;
  eventId?: string | null;
  raw?: unknown;
}): Promise<void> {
  if (!args.transactionId) return;
  const db = await getAdapter();
  await db.run(
    `INSERT INTO creem_transactions
       (creem_transaction_id, user_id, creem_customer_id, creem_subscription_id,
        out_trade_no, parent_transaction_id, plan, amount_cents, currency, type,
        status, paid_at, occurred_at, event_id, raw_json)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'payment', ?, ?, ?, ?, ?)
     ON CONFLICT(creem_transaction_id) DO UPDATE SET
       user_id = COALESCE(excluded.user_id, creem_transactions.user_id),
       creem_customer_id = COALESCE(excluded.creem_customer_id, creem_transactions.creem_customer_id),
       creem_subscription_id = COALESCE(excluded.creem_subscription_id, creem_transactions.creem_subscription_id),
       out_trade_no = COALESCE(excluded.out_trade_no, creem_transactions.out_trade_no),
       plan = COALESCE(excluded.plan, creem_transactions.plan),
       amount_cents = excluded.amount_cents,
       currency = excluded.currency,
       status = excluded.status,
       paid_at = COALESCE(excluded.paid_at, creem_transactions.paid_at),
       occurred_at = COALESCE(excluded.occurred_at, creem_transactions.occurred_at),
       updated_at = datetime('now')`,
    [
      args.transactionId,
      args.userId ?? null,
      args.customerId ?? null,
      args.subscriptionId ?? null,
      args.outTradeNo ?? null,
      args.plan ?? null,
      Math.max(0, Math.round(args.amountCents)),
      (args.currency ?? "USD").toUpperCase(),
      args.status,
      args.paidAt ?? null,
      args.paidAt ?? null,
      args.eventId ?? null,
      args.raw ? JSON.stringify(args.raw).slice(0, 4000) : null,
    ]
  );
}

/** 退款快照（PK = Creem refund id → 重投不会重复计退款） */
export async function recordCreemRefund(args: {
  refundId: string;
  amountCents: number;
  currency?: string | null;
  status?: string | null;
  userId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  outTradeNo?: string | null;
  parentTransactionId?: string | null;
  plan?: CreemCheckoutPlan | string | null;
  refundedAt?: string | null;
  eventId?: string | null;
  raw?: unknown;
}): Promise<void> {
  if (!args.refundId) return;
  const db = await getAdapter();
  await db.run(
    `INSERT INTO creem_transactions
       (creem_transaction_id, user_id, creem_customer_id, creem_subscription_id,
        out_trade_no, parent_transaction_id, plan, amount_cents, currency, type,
        status, paid_at, occurred_at, event_id, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'refund', ?, NULL, ?, ?, ?)
     ON CONFLICT(creem_transaction_id) DO UPDATE SET
       amount_cents = excluded.amount_cents,
       status = excluded.status,
       parent_transaction_id = COALESCE(excluded.parent_transaction_id, creem_transactions.parent_transaction_id),
       occurred_at = COALESCE(excluded.occurred_at, creem_transactions.occurred_at),
       updated_at = datetime('now')`,
    [
      args.refundId,
      args.userId ?? null,
      args.customerId ?? null,
      args.subscriptionId ?? null,
      args.outTradeNo ?? null,
      args.parentTransactionId ?? null,
      args.plan ?? null,
      Math.max(0, Math.round(args.amountCents)),
      (args.currency ?? "USD").toUpperCase(),
      args.status ?? "refunded",
      args.refundedAt ?? null,
      args.eventId ?? null,
      args.raw ? JSON.stringify(args.raw).slice(0, 4000) : null,
    ]
  );
}

// ---------- 读取（Owner Console 唯一收入口径实现） ----------

export interface CreemRevenueSnapshot {
  currency: string;
  grossCents: number;
  refundCents: number;
  netCents: number;
  payments: number;
  refunds: number;
}

/** 订阅收入快照（本地表读取，绝不实时请求 Creem） */
export async function getCreemRevenueSnapshot(): Promise<CreemRevenueSnapshot> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'payment' AND status = 'paid' THEN amount_cents ELSE 0 END), 0) AS gross,
       COALESCE(SUM(CASE WHEN type = 'refund' THEN amount_cents ELSE 0 END), 0) AS refunds,
       COUNT(CASE WHEN type = 'payment' AND status = 'paid' THEN 1 END) AS payments,
       COUNT(CASE WHEN type = 'refund' THEN 1 END) AS refund_count,
       COALESCE(MAX(currency), 'USD') AS currency
     FROM creem_transactions`
  )) as
    | { gross: number; refunds: number; payments: number; refund_count: number; currency: string }
    | undefined;
  const grossCents = Number(row?.gross ?? 0);
  const refundCents = Number(row?.refunds ?? 0);
  return {
    currency: String(row?.currency ?? "USD"),
    grossCents,
    refundCents,
    netCents: grossCents - refundCents,
    payments: Number(row?.payments ?? 0),
    refunds: Number(row?.refund_count ?? 0),
  };
}

export interface CreemSubscriptionCounts {
  active: number;
  trialing: number;
  pastDue: number;
  canceled: number;
  unpaid: number;
  incomplete: number;
  expired: number;
  total: number;
}

/** 订阅状态计数（来源：creem_subscriptions 本地快照） */
export async function getCreemSubscriptionCounts(): Promise<CreemSubscriptionCounts> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT status, COUNT(*) AS n FROM creem_subscriptions GROUP BY status`
  )) as Array<{ status: string; n: number }>;
  const pick = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  const total = rows.reduce((sum, r) => sum + Number(r.n ?? 0), 0);
  return {
    active: pick("active"),
    trialing: pick("trialing"),
    pastDue: pick("past_due"),
    canceled: pick("canceled"),
    unpaid: pick("unpaid"),
    incomplete: pick("incomplete"),
    expired: pick("expired"),
    total,
  };
}

/** 新建订阅数（created_at 在窗口内；窗口以天计） */
export async function countNewSubscriptions(days: number): Promise<number> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT COUNT(*) AS n FROM creem_subscriptions
      WHERE created_at >= datetime('now', ?)`,
    [`-${days} days`]
  )) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 窗口内取消的订阅数（canceled_at 在窗口内） */
export async function countCanceledSubscriptions(days: number): Promise<number> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT COUNT(*) AS n FROM creem_subscriptions
      WHERE canceled_at IS NOT NULL AND canceled_at >= datetime('now', ?)`,
    [`-${days} days`]
  )) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 按 user_id 查 Creem 关联信息（客户详情页排查支付问题用） */
export async function listCreemRecordsForUser(userId: string): Promise<{
  customers: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
}> {
  const db = await getAdapter();
  const [customers, subscriptions, transactions] = await Promise.all([
    db.query(`SELECT * FROM creem_customers WHERE user_id = ?`, [userId]),
    db.query(
      `SELECT * FROM creem_subscriptions WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    ),
    db.query(
      `SELECT * FROM creem_transactions WHERE user_id = ? ORDER BY COALESCE(paid_at, occurred_at, created_at) DESC`,
      [userId]
    ),
  ]);
  return {
    customers: customers as Array<Record<string, unknown>>,
    subscriptions: subscriptions as Array<Record<string, unknown>>,
    transactions: transactions as Array<Record<string, unknown>>,
  };
}
