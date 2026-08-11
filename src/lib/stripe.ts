// ===== Stripe 服务端客户端（仅服务端使用） =====
// 单例初始化，复用 Stripe 实例
// 未配置 STRIPE_SECRET_KEY 时返回 null，调用方需处理

import Stripe from "stripe";

let cached: Stripe | null | undefined;

/**
 * 获取 Stripe server client。
 * 未配置 STRIPE_SECRET_KEY 时返回 null。
 */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    cached = null;
    return null;
  }
  cached = new Stripe(secretKey, {
    apiVersion: "2026-07-29.dahlia" as Stripe.LatestApiVersion,
    typescript: true,
  });
  return cached;
}

/**
 * 套餐 → Stripe Price ID 映射（仅服务端使用）
 * price_id 不来自客户端，防止用户篡改
 */
export function getStripePriceId(plan: "lite" | "pro"): string | null {
  const envKey = plan === "lite" ? "STRIPE_PRICE_LITE" : "STRIPE_PRICE_PRO";
  return process.env[envKey] ?? null;
}

/** Stripe Webhook 事件类型（仅监听以下三种） */
export type StripeWebhookEvent =
  | "checkout.session.completed"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

/** 判断是否为需要处理的订阅事件 */
export function isHandledEvent(eventType: string): eventType is StripeWebhookEvent {
  return (
    eventType === "checkout.session.completed" ||
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.deleted"
  );
}
