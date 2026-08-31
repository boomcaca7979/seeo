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
//   - completeOrder：条件 UPDATE(payment_status='pending')，重复投递不重复开通
//   - syncSubscriptionPeriod：RPC 内部 greatest(current_period_end, p_period_end)
//   - handleRefundSuccess：条件 UPDATE(payment_status='paid')，重复退款事件幂等

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

  // 4. 分发处理（异常返回 500 让 Creem 重试）
  try {
    switch (event.eventType) {
      case "checkout.completed":
        await handleCheckoutCompleted(event.object as CreemCheckoutCompletedObject);
        break;
      case "subscription.paid":
      case "subscription.active":
        await handleSubscriptionSync(event.object as CreemSubscriptionEventObject);
        break;
      case "subscription.canceled":
      case "subscription.scheduled_cancel":
      case "subscription.past_due":
      case "subscription.unpaid":
      case "subscription.expired":
      case "subscription.update":
      case "subscription.trialing":
      case "subscription.paused":
        // 状态事件：会员到期由 /api/cron/membership-expire 按 current_period_end 自然处理
        console.log("[CreemWebhook] 订阅状态事件:", event.eventType, {
          eventId: event.id,
          subscriptionId: (event.object as CreemSubscriptionEventObject)?.id,
        });
        break;
      case "refund.created":
        await handleRefundCreated(event.object as CreemRefundObject);
        break;
      case "dispute.created":
        console.warn("[CreemWebhook] 收到争议事件，需人工处理:", {
          eventId: event.id,
        });
        break;
      default:
        console.log("[CreemWebhook] 未处理事件类型:", event.eventType);
    }
  } catch (err) {
    console.error("[CreemWebhook] 事件处理异常:", event.eventType, err);
    return NextResponse.json({ error: "processing error" }, { status: 500 });
  }

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
  console.log("[CreemWebhook] checkout.completed 处理完成:", {
    outTradeNo,
    plan: order.plan,
    opened: result.opened,
  });
}

/** subscription.paid / subscription.active：续费与激活，同步订阅周期 */
async function handleSubscriptionSync(obj: CreemSubscriptionEventObject) {
  const outTradeNo = extractOutTradeNo(obj.metadata);
  let order = outTradeNo ? await getOrderByOutTradeNo(outTradeNo) : null;
  if (!order && obj.id) {
    order = await findOrderByCreemSubscriptionId(obj.id);
  }
  if (!order) {
    console.warn("[CreemWebhook] 订阅事件未匹配到订单:", obj.id);
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

  // 首付订单尚未由 checkout.completed 处理时，等待其投递（Creem 按顺序重试）
  if (order.payment_status !== "paid") {
    console.warn(
      "[CreemWebhook] 订单未支付，跳过订阅周期同步:",
      order.out_trade_no,
      order.payment_status
    );
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
}

/** refund.created：退款成功处理 */
async function handleRefundCreated(obj: CreemRefundObject) {
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
