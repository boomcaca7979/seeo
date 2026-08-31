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
import { formatAmountYuan, PLAN_PRICING, getEffectivePaymentAmountCents, isTestPaymentMisconfigured, canPurchasePlan, CUSTOM_SERVICE_PLAN, type CheckoutPlan } from "@/lib/billing";
import { createPendingOrder } from "@/lib/orders/service";
import type { PaymentChannel } from "@/lib/yaolipay/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidPlan(plan: unknown): plan is CheckoutPlan {
  return plan === "lite" || plan === "pro" || plan === CUSTOM_SERVICE_PLAN;
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
    return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user.id;

  // 演示模式：不创建真实订单
  if (auth.skip) {
    return NextResponse.json(
      { error: "演示模式下不支持支付，请在生产环境开启鉴权后使用", code: "PAYMENT_DEMO_DISABLED" },
      { status: 503 }
    );
  }

  // 校验配置
  const config = getYaolipayConfig();
  if (!config) {
    return NextResponse.json(
      { error: "耀立支付配置缺失，请联系管理员", code: "YAOLIPAY_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  // 测试支付开关误配置保护：
  // 若 PAYMENT_TEST_MODE=true 但当前环境不是 Vercel Preview，
  // 直接拒绝创建订单，防止 Production 误配置导致错误价格订单。
  if (isTestPaymentMisconfigured()) {
    return NextResponse.json(
      { error: "测试支付开关在非 Preview 环境启用，已拒绝创建订单", code: "PAYMENT_TEST_MODE_FORBIDDEN" },
      { status: 503 }
    );
  }

  // 解析请求体
  let body: { plan?: unknown; payment_channel?: unknown };
  try {
    body = await req.json();
  } catch (parseErr) {
    console.error("[Payment Create] JSON 解析失败:", parseErr instanceof Error ? parseErr.message : String(parseErr));
    const rawText = await req.text().catch(() => "<unreadable>");
    console.error("[Payment Create] 原始 body:", rawText.slice(0, 500));
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const { plan, payment_channel } = body;
  if (!isValidPlan(plan)) {
    return NextResponse.json(
      { error: "plan 必须是 lite、pro 或 custom", code: "PLAN_PARAM_INVALID" },
      { status: 400 }
    );
  }
  if (!isValidPaymentChannel(payment_channel)) {
    return NextResponse.json(
      { error: "payment_channel 必须是 alipay 或 wxpay", code: "PAYMENT_CHANNEL_INVALID" },
      { status: 400 }
    );
  }

  // ===== 套餐权限校验（P0：防降级购买/绕过 UI 直接下单）=====
  // currentPlan 一律取服务端查询结果（auth.plan = requireAuth 内
  // getUserPlan 返回的 effectivePlan），绝不信任前端传来的任何套餐字段。
  // 规则：free→lite/pro 购买；lite→lite / pro→pro 续费；lite→pro 升级；
  //       pro→lite 拒绝（PLAN_DOWNGRADE_NOT_ALLOWED）
  const gate = canPurchasePlan(auth.plan, plan);
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: "当前套餐不支持该购买：Pro 会员不可降级购买 Lite",
        code: gate.errorCode,
      },
      { status: 400 }
    );
  }
  const purchaseType = gate.purchaseType!;

  // 从服务端价格表获取金额（不信任客户端）
  // Preview 测试模式：getEffectivePaymentAmountCents 可能返回 1（¥0.01）
  // 正常模式/Production：始终返回 PLAN_PRICING[plan].amountCents
  const pricing = PLAN_PRICING[plan];
  if (!pricing) {
    return NextResponse.json(
      { error: `套餐 ${plan} 价格未配置`, code: "PLAN_PRICE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  const effectiveAmountCents = getEffectivePaymentAmountCents(plan);
  const moneyStr = formatAmountYuan(effectiveAmountCents);
  const clientIp = getClientIp(req);
  const returnUrl = getReturnUrl();

  // 1. 先创建本地 pending 订单（param 记录购买类型，供后续对账/分析）
  const pendingResult = await createPendingOrder({
    userId,
    plan,
    paymentChannel: payment_channel as PaymentChannel,
    clientIp,
    purchaseType,
  });
  if (!pendingResult || !pendingResult.order) {
    console.error("[Payment Create] createPendingOrder 失败:", {
      userId,
      plan,
      channel: payment_channel,
      error: pendingResult?.error,
    });
    return NextResponse.json(
      { error: "创建本地订单失败", code: "PAYMENT_CREATE_FAILED", detail: pendingResult?.error ?? "未知错误" },
      { status: 500 }
    );
  }
  const { order } = pendingResult;

  // 2. 调用耀立统一下单接口
  try {
    const productName =
      plan === CUSTOM_SERVICE_PLAN
        ? "SeeO 定制服务"
        : `SeeO ${plan === "lite" ? "Lite" : "Pro"} 30天会员`;
    const yaolipayResp = await createOrder({
      type: payment_channel as PaymentChannel,
      out_trade_no: order.out_trade_no,
      name: productName,
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
        { error: yaolipayResp.msg ?? "耀立下单失败", code: "PAYMENT_FAILED" },
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
    return NextResponse.json({ error: msg, code: "PAYMENT_CREATE_FAILED" }, { status: 500 });
  }
}
