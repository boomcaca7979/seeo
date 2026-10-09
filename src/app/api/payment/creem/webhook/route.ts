// ===== POST /api/payment/creem/webhook =====
// Creem Webhook 处理（支付成功的唯一权威来源）
//
// 官方签名机制：请求头 creem-signature = HMAC-SHA256(rawBody, webhookSecret) 的 hex
// 验证失败一律 400（Creem 会按官方策略重试投递）
//
// 事件处理（以官方文档事件名为准）：
//   checkout.completed          一次性支付 / 订阅首付成功 → completeOrder
//   subscription.paid/active    订阅续费/激活 → syncSubscriptionPeriod（周期以 Creem 返回为准）
//   subscription.canceled 等    状态事件仅记录，会员到期由 cron 自然降级
//   refund.created              → handleRefundSuccess（recompute RPC 原子重算权益）
//   dispute.created             仅记录告警
//
// 幂等：
//   - 事件账本：creem_webhook_events.id（event id）唯一，已处理事件直接跳过
//     （账本不可用时降级为无账本处理，**不阻塞权益** —— 见 tryClaimWebhookEvent）
//   - completeOrder：条件 UPDATE(payment_status='pending')，重复投递不重复开通
//   - syncSubscriptionPeriod：RPC 内部 greatest(current_period_end, p_period_end)
//   - handleRefundSuccess：条件 UPDATE(payment_status='paid')，重复退款事件幂等
//   - 本地经营快照：creem_transactions 主键为 Creem 侧 external id，重投不重复计收入

import { NextResponse } from "next/server";
import {
  verifyCreemSignature,
  CREEM_SIGNATURE_HEADER,
  extractOutTradeNo,
  type CreemWebhookEvent,
  type CreemCheckoutCompletedObject,
  type CreemSubscriptionEventObject,
  type CreemRefundObject,
} from "@/lib/creem/webhook";
import { getCreemWebhookSecret } from "@/lib/creem/config";
import {
  claimWebhookEvent,
  finishWebhookEvent,
  recordCreemPayment,
  recordCreemRefund,
  upsertCreemCustomer,
  upsertCreemSubscription,
  type ClaimResult,
} from "@/lib/creem/snapshot";
import { CUSTOM_SERVICE_PLAN } from "@/lib/billing";
import type { PlanTier } from "@/lib/auth";
import {
  completeOrder,
  getOrderByOutTradeNo,
  findOrderByCreemSubscriptionId,
  findOrderByCreemOrderId,
  syncSubscriptionPeriod,
  handleRefundSuccess,
  markOrderFailed,
  amountsMatch,
  type OrderRecord,
} from "@/lib/orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 订阅状态事件集合（全部只做快照记录，不改变会员权益） */
const SUBSCRIPTION_STATUS_EVENTS = new Set([
  "subscription.active",
  "subscription.paid",
  "subscription.canceled",
  "subscription.scheduled_cancel",
  "subscription.past_due",
  "subscription.unpaid",
  "subscription.expired",
  "subscription.update",
  "subscription.trialing",
  "subscription.paused",
]);

/**
 * 事件账本（creem_webhook_events）是**可观测性记录，不是权益的前置条件**。
 * 账本不可用时（Turso 瞬时故障、本地未配置等）不能让整个支付 webhook 失败 ——
 * 否则已付费用户的权益将无法开通（Creem 重试期过后就永久丢失）。
 * 降级为「无账本处理」：
 *   - 权益仍由 completeOrder / syncSubscriptionPeriod 自身的条件更新保证不重复开通；
 *   - 收入仍由 creem_transactions 主键（Creem 侧 external id）保证不重复计；
 *   - 代价仅是可能重复一条 analytics 事件（可接受的噪声，好过丢权益）。
 */
async function tryClaimWebhookEvent(args: {
  eventId: string;
  eventType: string;
  objectId?: string | null;
}): Promise<ClaimResult> {
  try {
    return await claimWebhookEvent(args);
  } catch (err) {
    console.error("[CreemWebhook] 事件账本不可用，降级处理（不阻塞权益）:", err);
    return "claimed";
  }
}

/** 同 tryClaimWebhookEvent：标记失败只记录日志，绝不再抛（否则成功处理后仍会 500 触发重投） */
async function tryFinishWebhookEvent(
  eventId: string | undefined,
  status: "processed" | "ignored" | "failed",
  detail?: string | null
): Promise<void> {
  if (!eventId) return;
  try {
    await finishWebhookEvent(eventId, status, detail);
  } catch (err) {
    console.error("[CreemWebhook] 事件账本写入失败（不阻塞处理）:", err);
  }
}

export async function POST(req: Request) {
  // 1. Webhook secret 必须配置
  const secret = getCreemWebhookSecret();
  if (!secret) {
    console.error("[CreemWebhook] CREEM_WEBHOOK_SECRET 未配置，拒绝处理");
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }

  // 2. 签名验证（必须基于未解析的 raw body）
  const rawBody = await req.text();
  const signature = req.headers.get(CREEM_SIGNATURE_HEADER);
  if (!verifyCreemSignature(rawBody, signature, secret)) {
    console.warn("[CreemWebhook] 签名校验失败，拒绝请求");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // 3. 解析事件
  let event: CreemWebhookEvent;
  try {
    event = JSON.parse(rawBody) as CreemWebhookEvent;
    if (!event || typeof event.eventType !== "string") {
      throw new Error("missing eventType");
    }
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  // 4. 事件级幂等：已成功处理过的事件直接 200 返回（不再重复计收入）
  const objectId =
    (event.object as { id?: string } | null)?.id ?? null;
  if (event.id) {
    const claim = await tryClaimWebhookEvent({
      eventId: event.id,
      eventType: event.eventType,
      objectId,
    });
    if (claim === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  // 5. 分发处理（异常返回 500 让 Creem 重试，并登记 failed 允许重放开）
  try {
    switch (event.eventType) {
      case "checkout.completed":
        await handleCheckoutCompleted(event.object as CreemCheckoutCompletedObject);
        break;
      case "refund.created":
        await handleRefundCreated(event.object as CreemRefundObject, event.id);
        break;
      case "dispute.created":
        console.warn("[CreemWebhook] 收到争议事件，需人工处理:", {
          eventId: event.id,
        });
        break;
      default:
        if (SUBSCRIPTION_STATUS_EVENTS.has(event.eventType)) {
          await handleSubscriptionSync(
            event.object as CreemSubscriptionEventObject,
            event.eventType,
            event.id
          );
        } else {
          console.log("[CreemWebhook] 未处理事件类型:", event.eventType);
          await tryFinishWebhookEvent(
            event.id,
            "ignored",
            `unhandled: ${event.eventType}`
          );
          return NextResponse.json({ received: true });
        }
    }
  } catch (err) {
    console.error("[CreemWebhook] 事件处理异常:", event.eventType, err);
    await tryFinishWebhookEvent(
      event.id,
      "failed",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "processing error" }, { status: 500 });
  }

  await tryFinishWebhookEvent(event.id, "processed");
  return NextResponse.json({ received: true });
}

/** 订单渠道防线：只处理 Creem 渠道订单（历史 Yaolipay 订单不可被 Creem webhook 触碰） */
function isCreemChannel(order: OrderRecord | null): boolean {
  return order !== null && order.payment_channel === "creem";
}

/** checkout.completed：一次性支付 / 订阅首付成功 */
async function handleCheckoutCompleted(obj: CreemCheckoutCompletedObject) {
  const outTradeNo = extractOutTradeNo(obj.metadata, obj.request_id);
  if (!outTradeNo) {
    console.warn("[CreemWebhook] checkout.completed 缺少订单标识，无法匹配", {
      checkoutId: obj.id,
    });
    return;
  }

  const order = await getOrderByOutTradeNo(outTradeNo);
  if (!order) {
    console.warn("[CreemWebhook] 订单不存在:", outTradeNo);
    return;
  }
  if (!isCreemChannel(order)) {
    console.error(
      "[CreemWebhook] 非 Creem 渠道订单拒绝处理:",
      outTradeNo,
      order.payment_channel
    );
    return;
  }

  const creemOrder = obj.order;
  // 支付失败态：不 completeOrder，标记 failed（Creem order.status: paid/refunded/failed 等）
  if (creemOrder?.status && creemOrder.status !== "paid") {
    if (creemOrder.status === "failed") {
      await markOrderFailed(outTradeNo);
      console.warn("[CreemWebhook] 支付失败，订单标记 failed:", outTradeNo);
    } else {
      console.warn(
        "[CreemWebhook] 订单状态非 paid，跳过开通:",
        outTradeNo,
        creemOrder.status
      );
    }
    return;
  }

  // 金额校验（Creem amount 为最小货币单位，换算为元后比对）
  const paidAmount =
    typeof creemOrder?.amount === "number" ? creemOrder.amount / 100 : order.amount;
  if (!amountsMatch(order.amount, paidAmount)) {
    console.error("[CreemWebhook] 金额不匹配，拒绝开通:", {
      outTradeNo,
      expected: order.amount,
      actual: paidAmount,
    });
    return;
  }
  // 币种校验
  if (
    creemOrder?.currency &&
    creemOrder.currency.toUpperCase() !== order.currency.toUpperCase()
  ) {
    console.error("[CreemWebhook] 币种不匹配，拒绝开通:", {
      outTradeNo,
      expected: order.currency,
      actual: creemOrder.currency,
    });
    return;
  }

  // 订阅产品：周期以 Creem 返回的 current_period_end_date 为准（不自行换算 Monthly→N 天）
  const isCustom = order.plan === CUSTOM_SERVICE_PLAN;
  const subscription = isCustom ? null : (obj.subscription ?? null);
  const periodEndIso =
    subscription?.current_period_end_date &&
    !Number.isNaN(Date.parse(subscription.current_period_end_date))
      ? subscription.current_period_end_date
      : undefined;

  const result = await completeOrder({
    outTradeNo,
    tradeNo: creemOrder?.id,
    apiTradeNo: subscription?.id ?? creemOrder?.id,
    paidAmount,
    periodEndIso,
    creem: {
      checkoutId: obj.id,
      customerId: obj.customer?.id,
      subscriptionId: subscription?.id,
    },
  });

  if (!result.ok) {
    console.error("[CreemWebhook] completeOrder 失败:", {
      outTradeNo,
      error: result.error,
    });
    throw new Error(result.error ?? "completeOrder failed"); // 返回 500 让 Creem 重试
  }

  // ===== 本地经营快照（Owner Console）=====
  // 纯记录，不影响权益；失败不阻塞支付链路（权益已由 completeOrder 落库）
  try {
    await upsertCreemCustomer({
      customerId: obj.customer?.id ?? "",
      email: obj.customer?.email ?? null,
      userId: order.user_id,
    });
    let subscriptionCreated = false;
    if (subscription?.id) {
      const upserted = await upsertCreemSubscription({
        subscriptionId: subscription.id,
        status: subscription.status ?? "active",
        userId: order.user_id,
        customerId: obj.customer?.id ?? null,
        productId: obj.product?.id ?? null,
        plan: order.plan,
        currentPeriodStart: subscription.current_period_start_date ?? null,
        currentPeriodEnd: subscription.current_period_end_date ?? null,
        lastTransactionId: subscription.last_transaction_id ?? null,
      });
      subscriptionCreated = upserted.created;
    }
    await recordCreemPayment({
      transactionId: creemOrder?.id ?? obj.id ?? outTradeNo,
      status: creemOrder?.status ?? "paid",
      amountCents:
        typeof creemOrder?.amount === "number"
          ? creemOrder.amount
          : Math.round(order.amount * 100),
      currency: creemOrder?.currency ?? order.currency,
      userId: order.user_id,
      customerId: obj.customer?.id ?? null,
      subscriptionId: subscription?.id ?? null,
      outTradeNo,
      plan: order.plan,
      paidAt: new Date().toISOString(),
      eventId: null,
    });
    // 订阅类订单：首付成功即视为一次 subscription_active（新订阅才记，避免续费重复抬高漏斗）
    if (subscription?.id && subscriptionCreated) {
      const { recordSubscriptionActive } = await import("@/lib/analytics/server");
      await recordSubscriptionActive({
        userId: order.user_id,
        subscriptionId: subscription.id,
        plan: order.plan,
      });
    }
  } catch (snapshotErr) {
    console.error("[CreemWebhook] 本地快照写入失败（不影响权益）:", snapshotErr);
  }

  // Analytics（B 阶段）：仅在本次真实开通（opened=true，幂等重投不会重复触发）时
  // 记录 checkout_completed / payment_completed —— 点击/创建 intent/访问 checkout 均不算付费。
  if (result.opened) {
    try {
      const { recordCheckoutCompleted, recordPaymentCompleted } = await import("@/lib/analytics/server");
      await recordCheckoutCompleted({
        userId: order.user_id,
        outTradeNo,
        plan: order.plan,
      });
      await recordPaymentCompleted({
        userId: order.user_id,
        outTradeNo,
        plan: order.plan,
      });
    } catch (analyticsErr) {
      console.error("[CreemWebhook] analytics 事件记录失败:", analyticsErr);
    }
  }

  // ===== 老板付款通知（首付款）=====
  // 仅 result.opened=true（本次真实开通）触发；独立 try/catch，失败绝不影响支付链路。
  if (result.opened) {
    try {
      const notify = await import("@/lib/payments/notify");
      const accountEmail = obj.customer?.email
        ? null
        : await notify.getAccountEmail(order.user_id);
      const notificationId = await notify.queuePaymentNotification({
        paidAt: new Date().toISOString(),
        customerEmail: obj.customer?.email ?? accountEmail ?? null,
        plan: order.plan,
        productName: obj.product?.name ?? null,
        amount: paidAmount,
        currency: (creemOrder?.currency ?? order.currency).toUpperCase(),
        outTradeNo,
        transactionId: creemOrder?.id ?? null,
        subscriptionId: subscription?.id ?? null,
        kind: "first_payment",
        periodEndIso: null,
      });
      if (notificationId !== null) {
        await notify.deliverPaymentNotification(notificationId);
      }
    } catch (notifyErr) {
      console.error("[CreemWebhook] 付款通知入队/发送失败（不影响支付）:", notifyErr);
    }
  }
  console.log("[CreemWebhook] checkout.completed 处理完成:", {
    outTradeNo,
    plan: order.plan,
    opened: result.opened,
  });
}

/**
 * 订阅事件：creem_subscriptions 快照 + （active/paid 时）同步会员周期。
 * 状态迁移只在**发生变化**时发射 analytics 事件，保证重投不重复计数。
 */
async function handleSubscriptionSync(
  obj: CreemSubscriptionEventObject,
  eventType: string,
  eventId?: string
) {
  const outTradeNo = extractOutTradeNo(obj.metadata);
  let order = outTradeNo ? await getOrderByOutTradeNo(outTradeNo) : null;
  if (!order && obj.id) {
    order = await findOrderByCreemSubscriptionId(obj.id);
  }
  if (!order) {
    console.warn("[CreemWebhook] 订阅事件未匹配到订单:", obj.id, eventType);
    return;
  }
  if (!isCreemChannel(order)) {
    console.error(
      "[CreemWebhook] 非 Creem 渠道订单拒绝订阅同步:",
      order.out_trade_no,
      order.payment_channel
    );
    return;
  }
  // 定制服务无订阅周期
  if (order.plan === CUSTOM_SERVICE_PLAN) return;

  // ===== 快照（含所有订阅状态事件，含未支付态的 unpaid / incomplete）=====
  const status = obj.status ?? statusFromEventType(eventType);
  let created = false;
  let statusChanged = false;
  let snapshotOk = true;
  if (obj.id) {
    try {
      const upserted = await upsertCreemSubscription({
        subscriptionId: obj.id,
        status,
        userId: order.user_id,
        customerId: obj.customer?.id ?? null,
        productId: obj.product?.id ?? null,
        plan: order.plan,
        currentPeriodStart: obj.current_period_start_date ?? null,
        currentPeriodEnd: obj.current_period_end_date ?? null,
        lastTransactionId: obj.last_transaction_id ?? null,
      });
      created = upserted.created;
      statusChanged = upserted.statusChanged;
    } catch (snapshotErr) {
      // 快照不可用时不发射 analytics：读不到上一状态就无法区分「首次」与「重投」，
      // 宁可少记一条也不能重复抬高漏斗（诚实边界：不确定的数据不写）。
      snapshotOk = false;
      console.error("[CreemWebhook] 订阅快照写入失败（不影响权益）:", snapshotErr);
    }
  }

  // 状态迁移 → analytics（仅迁移时发射，幂等）
  if (snapshotOk) {
    try {
      const { recordSubscriptionActive, recordSubscriptionCanceled } = await import("@/lib/analytics/server");
      if (obj.id && (created || statusChanged)) {
        if (status === "active" || status === "paid" || status === "trialing") {
          await recordSubscriptionActive({
            userId: order.user_id,
            subscriptionId: obj.id,
            plan: order.plan,
          });
        } else if (status === "canceled") {
          await recordSubscriptionCanceled({
            userId: order.user_id,
            subscriptionId: obj.id,
            plan: order.plan,
          });
        }
      }
    } catch (analyticsErr) {
      console.error("[CreemWebhook] 订阅 analytics 记录失败:", analyticsErr);
    }
  }

  // 首付订单尚未由 checkout.completed 处理时，等待其投递（Creem 按顺序重试）
  if (order.payment_status !== "paid") {
    console.warn(
      "[CreemWebhook] 订单未支付，跳过订阅周期同步:",
      order.out_trade_no,
      order.payment_status
    );
    return;
  }

  // 只有 active/paid 事件携带新周期时才推动会员周期（canceled/unpaid 等不改权益）
  if (status !== "active" && status !== "paid") {
    console.log("[CreemWebhook] 订阅状态事件（不改变会员权益）:", eventType, {
      subscriptionId: obj.id,
      status,
      eventId,
    });
    return;
  }

  const periodEnd = obj.current_period_end_date;
  if (!periodEnd || Number.isNaN(Date.parse(periodEnd))) {
    console.warn("[CreemWebhook] 订阅事件缺少有效周期结束时间:", obj.id);
    return;
  }

  const ok = await syncSubscriptionPeriod({
    userId: order.user_id,
    plan: order.plan as PlanTier,
    periodEndIso: periodEnd,
    outTradeNo: order.out_trade_no,
    transactionId: obj.last_transaction_id,
  });
  if (!ok) {
    throw new Error("syncSubscriptionPeriod failed"); // 返回 500 让 Creem 重试
  }
  console.log("[CreemWebhook] 订阅周期同步完成:", {
    outTradeNo: order.out_trade_no,
    periodEnd,
  });

  // ===== 老板付款通知（续费）=====
  // 判定条件与「宁可漏一封也不发错一封」原则见 shouldNotifyRenewal（notify.ts，纯函数）。
  const previousPeriodEnd = order.period_end;
  const periodAdvanced =
    !previousPeriodEnd ||
    (Number.isNaN(Date.parse(periodEnd))
      ? false
      : Date.parse(periodEnd) > Date.parse(previousPeriodEnd));
  const isFirstTransaction =
    !!obj.last_transaction_id && !!order.trade_no && obj.last_transaction_id === order.trade_no;
  const { shouldNotifyRenewal } = await import("@/lib/payments/notify");
  if (shouldNotifyRenewal({ subscriptionId: obj.id, snapshotOk, snapshotCreated: created, isFirstTransaction, periodAdvanced })) {
    try {
      const notify = await import("@/lib/payments/notify");
      const accountEmail = obj.customer?.email
        ? null
        : await notify.getAccountEmail(order.user_id);
      const notificationId = await notify.queuePaymentNotification({
        paidAt: new Date().toISOString(),
        customerEmail: obj.customer?.email ?? accountEmail ?? null,
        plan: order.plan,
        productName: obj.product?.name ?? null,
        // subscription.* 事件不携带金额 —— 用订单套餐价如实标注（邮件注明以 Creem 实际扣款为准）
        amount: order.amount,
        currency: order.currency.toUpperCase(),
        outTradeNo: order.out_trade_no,
        transactionId: obj.last_transaction_id ?? null,
        subscriptionId: obj.id ?? null,
        kind: "renewal",
        periodEndIso: periodEnd,
      });
      if (notificationId !== null) {
        await notify.deliverPaymentNotification(notificationId);
      }
    } catch (notifyErr) {
      console.error("[CreemWebhook] 续费通知入队/发送失败（不影响支付）:", notifyErr);
    }
  }
}

/** 事件名 → 订阅状态（payload 未带 status 时的兜底映射） */
function statusFromEventType(eventType: string): string {
  if (eventType === "subscription.paid") return "active";
  if (eventType === "subscription.scheduled_cancel") return "scheduled_cancel";
  return eventType.replace(/^subscription\./, "");
}

/** refund.created：退款成功处理 */
async function handleRefundCreated(obj: CreemRefundObject, eventId?: string) {
  // 匹配订单：metadata.out_trade_no → refund.order.metadata → Creem order id（trade_no 列）
  const outTradeNo =
    extractOutTradeNo(obj.metadata) ??
    extractOutTradeNo(obj.order?.metadata ?? null) ??
    null;
  let order = outTradeNo ? await getOrderByOutTradeNo(outTradeNo) : null;
  if (!order && obj.order?.id) order = await findOrderByCreemOrderId(obj.order.id);
  if (!order && obj.order_id) order = await findOrderByCreemOrderId(obj.order_id);
  if (!order) {
    console.warn("[CreemWebhook] 退款事件未匹配到订单:", obj.id);
    return;
  }
  if (!isCreemChannel(order)) {
    console.error(
      "[CreemWebhook] 非 Creem 渠道订单拒绝退款处理:",
      order.out_trade_no,
      order.payment_channel
    );
    return;
  }

  const refundAmount =
    typeof obj.refund_amount === "number" ? obj.refund_amount / 100 : order.amount;

  // ===== 本地退款快照（PK = refund id → 重投不重复计退款）=====
  try {
    await recordCreemRefund({
      refundId: obj.id ?? `${outTradeNo}-refund`,
      amountCents:
        typeof obj.refund_amount === "number"
          ? obj.refund_amount
          : Math.round(order.amount * 100),
      currency: obj.refund_currency ?? order.currency,
      status: obj.status ?? "refunded",
      userId: order.user_id,
      customerId: obj.order?.customer ?? null,
      outTradeNo: order.out_trade_no,
      parentTransactionId: obj.order?.id ?? obj.order_id ?? null,
      plan: order.plan,
      refundedAt: new Date().toISOString(),
      eventId: eventId ?? null,
    });
  } catch (snapshotErr) {
    console.error("[CreemWebhook] 退款快照写入失败（不影响退款处理）:", snapshotErr);
  }

  const result = await handleRefundSuccess({
    outTradeNo: order.out_trade_no,
    refundAmount,
    outRefundNo: obj.id,
  });
  if (!result.ok) {
    console.error("[CreemWebhook] 退款处理失败:", order.out_trade_no, result.error);
    throw new Error(result.error ?? "refund handling failed");
  }
  console.log("[CreemWebhook] 退款处理完成:", {
    outTradeNo: order.out_trade_no,
    refundAmount,
  });
}
