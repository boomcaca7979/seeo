// ===== POST /api/payment/yaolipay/create =====
// 创建耀立支付订单
//
// 安全要点：
//   - 必须登录（requireAuthOrDemo）
//   - 客户端只能传 plan + payment_channel
//   - amount 由服务端从 PLAN_PRICING 读取
//   - period_end 由服务端计算
//   - out_trade_no 由服务端生成
//
// 演示模式返回 503

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { getYaolipayConfig, getReturnUrl, isValidPaymentChannel } from "@/lib/yaolipay/config";
import { createOrder } from "@/lib/yaolipay/client";
import { formatAmountYuan, PLAN_PRICING, getEffectivePaymentAmountCents, isTestPaymentMisconfigured } from "@/lib/billing";
import { createPendingOrder } from "@/lib/orders/service";
import type { PaymentChannel } from "@/lib/yaolipay/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutPlan = "lite" | "pro";

function isValidPlan(plan: unknown): plan is CheckoutPlan {
  return plan === "lite" || plan === "pro";
}

/** 从请求头提取客户端真实 IP */
function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();
  return "127.0.0.1";
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = auth.user.id;

  // 演示模式：不创建真实订单
  if (auth.skip) {
    return NextResponse.json(
      { error: "演示模式下不支持支付，请在生产环境开启鉴权后使用" },
      { status: 503 }
    );
  }

  // 校验配置
  const config = getYaolipayConfig();
  if (!config) {
    return NextResponse.json(
      { error: "耀立支付配置缺失，请联系管理员" },
      { status: 503 }
    );
  }

  // 测试支付开关误配置保护：
  // 若 PAYMENT_TEST_MODE=true 但当前环境不是 Vercel Preview，
  // 直接拒绝创建订单，防止 Production 误配置导致错误价格订单。
  if (isTestPaymentMisconfigured()) {
    return NextResponse.json(
      { error: "测试支付开关在非 Preview 环境启用，已拒绝创建订单" },
      { status: 503 }
    );
  }

  // 解析请求体
  let body: { plan?: unknown; payment_channel?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const { plan, payment_channel } = body;
  if (!isValidPlan(plan)) {
    return NextResponse.json(
      { error: "plan 必须是 lite 或 pro" },
      { status: 400 }
    );
  }
  if (!isValidPaymentChannel(payment_channel)) {
    return NextResponse.json(
      { error: "payment_channel 必须是 alipay 或 wxpay" },
      { status: 400 }
    );
  }

  // 从服务端价格表获取金额（不信任客户端）
  // Preview 测试模式：getEffectivePaymentAmountCents 可能返回 1（¥0.01）
  // 正常模式/Production：始终返回 PLAN_PRICING[plan].amountCents
  const pricing = PLAN_PRICING[plan];
  if (!pricing) {
    return NextResponse.json(
      { error: `套餐 ${plan} 价格未配置` },
      { status: 503 }
    );
  }
  const effectiveAmountCents = getEffectivePaymentAmountCents(plan);
  const moneyStr = formatAmountYuan(effectiveAmountCents);
  const clientIp = getClientIp(req);
  const returnUrl = getReturnUrl();

  // 1. 先创建本地 pending 订单
  const pendingResult = await createPendingOrder({
    userId,
    plan,
    paymentChannel: payment_channel as PaymentChannel,
    clientIp,
  });
  if (!pendingResult) {
    return NextResponse.json(
      { error: "创建本地订单失败" },
      { status: 500 }
    );
  }
  const { order } = pendingResult;

  // 2. 调用耀立统一下单接口
  try {
    const yaolipayResp = await createOrder({
      type: payment_channel as PaymentChannel,
      out_trade_no: order.out_trade_no,
      name: `SeeO ${plan === "lite" ? "Lite" : "Pro"} 30天会员`,
      money: moneyStr,
      clientip: clientIp,
      return_url: returnUrl,
      param: JSON.stringify({ user_id: userId, plan }),
    });

    // 失败：标记订单为 failed
    if (yaolipayResp.code !== 0) {
      const { markOrderFailed } = await import("@/lib/orders/service");
      await markOrderFailed(order.out_trade_no);
      return NextResponse.json(
        { error: yaolipayResp.msg ?? "耀立下单失败" },
        { status: 500 }
      );
    }

    // 3. 保存耀立返回的 trade_no（如果在响应中）
    if (yaolipayResp.trade_no) {
      const admin = (await import("@/lib/supabase/admin")).getAdminClient();
      if (admin) {
        await admin
          .from("orders")
          .update({ trade_no: yaolipayResp.trade_no })
          .eq("out_trade_no", order.out_trade_no);
      }
    }

    // 4. 返回前端支付所需信息
    return NextResponse.json({
      data: {
        out_trade_no: order.out_trade_no,
        trade_no: yaolipayResp.trade_no ?? null,
        pay_type: yaolipayResp.pay_type ?? null,
        pay_info: yaolipayResp.pay_info ?? null,
        money: moneyStr,
        payment_channel: payment_channel,
      },
    });
  } catch (err) {
    // 异常：标记订单为 failed
    const { markOrderFailed } = await import("@/lib/orders/service");
    await markOrderFailed(order.out_trade_no);
    const msg = err instanceof Error ? err.message : "耀立下单异常";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
