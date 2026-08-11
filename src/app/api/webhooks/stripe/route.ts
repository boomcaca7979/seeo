// ===== /api/webhooks/stripe =====
// POST：接收 Stripe Webhook 事件，验证签名后更新 profiles 表
// 安全要点：
//   - 不走 auth middleware（Stripe 服务器调用，无用户 session）
//   - 必须验证 Stripe 签名（STRIPE_WEBHOOK_SECRET）
//   - 必须使用 SUPABASE_SERVICE_ROLE_KEY 写 profiles（绕过 RLS）

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isHandledEvent, type StripeWebhookEvent } from "@/lib/stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import type { PlanTier } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe 订阅状态 → SeeO subscription_status 映射 */
function mapSubscriptionStatus(
  stripeStatus: string
): "active" | "trialing" | "past_due" | "canceled" | "expired" | "inactive" {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
    case "incomplete_expired":
      return "expired";
    default:
      return "inactive";
  }
}

/** 从 subscription 对象提取 plan（来自 metadata） */
function extractPlanFromMetadata(
  metadata: Stripe.Metadata | null | undefined
): PlanTier | null {
  const plan = metadata?.plan;
  if (plan === "free" || plan === "lite" || plan === "pro") {
    return plan;
  }
  return null;
}

/** 安全地将时间戳（秒）转换为 ISO 字符串 */
function toIsoFromUnix(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/** 更新 profiles 表（使用 admin client 绕过 RLS） */
async function updateProfile(
  userId: string,
  fields: {
    plan?: PlanTier;
    subscription_status?: "active" | "trialing" | "past_due" | "canceled" | "expired" | "inactive";
    subscription_id?: string | null;
    current_period_end?: string | null;
  }
): Promise<boolean> {
  const admin = getAdminClient();
  if (!admin) {
    console.error("[Stripe Webhook] SUPABASE_SERVICE_ROLE_KEY 未配置，无法更新 profiles");
    return false;
  }
  try {
    const { error } = await admin
      .from("profiles")
      .update(fields)
      .eq("id", userId);
    if (error) {
      console.error("[Stripe Webhook] 更新 profiles 失败:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Stripe Webhook] 更新 profiles 异常:", err);
    return false;
  }
}

/** 处理 checkout.session.completed 事件 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<boolean> {
  const userId = session.metadata?.user_id;
  const plan = extractPlanFromMetadata(session.metadata);
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;

  if (!userId || !plan || !subscriptionId) {
    console.error("[Stripe Webhook] checkout.session.completed 缺少 metadata:", {
      userId,
      plan,
      subscriptionId,
    });
    return false;
  }

  return updateProfile(userId, {
    plan,
    subscription_status: "active",
    subscription_id: subscriptionId,
  });
}

/** 处理 customer.subscription.updated 事件 */
async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription
): Promise<boolean> {
  const userId = subscription.metadata?.user_id;
  if (!userId) {
    console.error("[Stripe Webhook] subscription.updated 缺少 user_id metadata");
    return false;
  }

  const status = mapSubscriptionStatus(subscription.status);
  // current_period_end 位于 subscription items 中（Stripe SDK 类型定义）
  const firstItem = subscription.items?.data?.[0];
  const currentPeriodEnd = toIsoFromUnix(firstItem?.current_period_end);
  const plan = extractPlanFromMetadata(subscription.metadata);

  return updateProfile(userId, {
    ...(plan ? { plan } : {}),
    subscription_status: status,
    subscription_id: subscription.id,
    current_period_end: currentPeriodEnd,
  });
}

/** 处理 customer.subscription.deleted 事件 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<boolean> {
  const userId = subscription.metadata?.user_id;
  if (!userId) {
    console.error("[Stripe Webhook] subscription.deleted 缺少 user_id metadata");
    return false;
  }

  return updateProfile(userId, {
    plan: "free",
    subscription_status: "canceled",
    subscription_id: subscription.id,
    current_period_end: null,
  });
}

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "未配置 STRIPE_SECRET_KEY" },
      { status: 503 }
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "未配置 STRIPE_WEBHOOK_SECRET" },
      { status: 503 }
    );
  }

  // 读取原始 body 用于签名验证
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "缺少 stripe-signature 头" },
      { status: 400 }
    );
  }

  // 验证签名
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "签名验证失败";
    console.error("[Stripe Webhook] 签名验证失败:", msg);
    return NextResponse.json({ error: `Webhook 签名验证失败: ${msg}` }, { status: 400 });
  }

  // 仅处理订阅相关事件
  if (!isHandledEvent(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const eventType: StripeWebhookEvent = event.type;
  let success = false;

  try {
    switch (eventType) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        success = await handleCheckoutCompleted(session);
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        success = await handleSubscriptionUpdated(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        success = await handleSubscriptionDeleted(subscription);
        break;
      }
    }
  } catch (err) {
    console.error(`[Stripe Webhook] 处理 ${eventType} 异常:`, err);
    success = false;
  }

  if (!success) {
    // 返回 500 让 Stripe 重试
    return NextResponse.json(
      { error: `处理事件 ${eventType} 失败` },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true, processed: eventType });
}
