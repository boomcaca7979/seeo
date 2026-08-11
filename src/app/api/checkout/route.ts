// ===== /api/checkout =====
// POST { plan: "lite" | "pro" }：创建 Stripe Checkout Session（subscription 模式）
// 安全要点：
//   - 必须登录（requireAuthOrDemo）
//   - price_id 不来自客户端，由服务端根据 plan 映射
//   - 演示模式下返回明确提示，不创建真实 Checkout Session

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { getStripe, getStripePriceId } from "@/lib/stripe";
import { createServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutPlan = "lite" | "pro";

function isValidPlan(plan: unknown): plan is CheckoutPlan {
  return plan === "lite" || plan === "pro";
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = auth.user.id;

  // 演示模式：不创建真实 Checkout Session
  if (auth.skip) {
    return NextResponse.json(
      { error: "演示模式下不支持支付，请在生产环境开启鉴权后使用" },
      { status: 503 }
    );
  }

  let body: { plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const { plan } = body;
  if (!isValidPlan(plan)) {
    return NextResponse.json(
      { error: "plan 必须是 lite 或 pro" },
      { status: 400 }
    );
  }

  // price_id 由服务端映射，客户端不可传入
  const priceId = getStripePriceId(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: `未配置套餐 ${plan} 的 Stripe Price ID（STRIPE_PRICE_${plan.toUpperCase()}）` },
      { status: 503 }
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "未配置 STRIPE_SECRET_KEY，Stripe 支付不可用" },
      { status: 503 }
    );
  }

  // 获取用户邮箱用于 Stripe Customer
  let customerEmail: string | undefined;
  try {
    const supabase = await createServer();
    const { data: { user } } = await supabase.auth.getUser();
    customerEmail = user?.email ?? undefined;
  } catch {
    // 邮箱获取失败不阻止 checkout，Stripe 会用 checkout 表单收集
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const successUrl = appUrl
    ? `${appUrl}/settings?checkout=success`
    : "/settings?checkout=success";
  const cancelUrl = appUrl
    ? `${appUrl}/pricing?checkout=cancel`
    : "/pricing?checkout=cancel";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customerEmail,
      metadata: {
        user_id: userId,
        plan,
      },
      subscription_data: {
        metadata: {
          user_id: userId,
          plan,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Stripe Checkout 创建失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
