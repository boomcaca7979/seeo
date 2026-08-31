// ===== POST /api/payment/yaolipay/create =====
// 创建支付订单（客户端表单直提模式）
//
// 背景：耀立支付（腾讯云源站）封锁 Vercel/AWS 等云厂商出口 IP，
// 服务端调用 https://www.yaolipay.com/api/pay/create 会被 TCP 重置。
// 改用耀立 V1 页面跳转支付端点 submit.php：
//
//   浏览器 → POST https://www.yaolipay.com/submit.php（带服务端签名参数）
//   → 耀立收银台 → 支付 → notify_url 异步回调 SeeO → completeOrder
//
// 安全要点：
//   - 必须登录（requireAuthOrDemo）
//   - 客户端只能传 plan + payment_channel
//   - amount 由服务端从 PLAN_PRICING 读取
//   - out_trade_no 由服务端生成
//   - RSA 私钥仅服务端使用，签名在服务端完成后才返回前端
//   - 前端只提交服务端返回的已签名字段；任何篡改都会导致耀立验签失败
//
// 演示模式返回 503

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { getYaolipayConfig, getReturnUrl, isValidPaymentChannel } from "@/lib/yaolipay/config";
import { signParams } from "@/lib/yaolipay/sign";
import { formatAmountYuan, PLAN_PRICING, getEffectivePaymentAmountCents, isTestPaymentMisconfigured, canPurchasePlan, CUSTOM_SERVICE_PLAN, type CheckoutPlan } from "@/lib/billing";
import { createPendingOrder } from "@/lib/orders/service";
import type { PaymentChannel } from "@/lib/yaolipay/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 耀立页面跳转支付端点（接受 V2 RSA 签名，浏览器表单直提） */
export const YAOLIPAY_SUBMIT_URL = "https://www.yaolipay.com/submit.php";

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

  // 1. 创建本地 pending 订单（param 记录购买类型，供后续对账/分析）
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

  // 2. 服务端构造支付参数并 RSA 签名（不调用耀立 API，不受出口封锁影响）
  const productName =
    plan === CUSTOM_SERVICE_PLAN
      ? "SeeO 定制服务"
      : `SeeO ${plan === "lite" ? "Lite" : "Pro"} 30天会员`;

  const payParams: Record<string, string> = {
    pid: String(config.pid),
    type: payment_channel as string,
    out_trade_no: order.out_trade_no,
    notify_url: config.notifyUrl,
    return_url: returnUrl,
    name: productName,
    money: moneyStr,
    param: JSON.stringify({ user_id: userId, plan }),
  };

  let sign: string;
  try {
    sign = signParams(payParams, config.privateKey);
  } catch (err) {
    // 签名失败（私钥格式错误等）：标记订单失败，不返回可提交的参数
    const { markOrderFailed } = await import("@/lib/orders/service");
    await markOrderFailed(order.out_trade_no);
    console.error("[Payment Create] RSA 签名失败:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "支付签名生成失败，请联系管理员", code: "PAYMENT_SIGN_FAILED" },
      { status: 500 }
    );
  }

  // 3. 返回前端已签名参数（浏览器构建表单 POST 到 submit.php）
  //    pay_mode 标识客户端表单直提模式
  return NextResponse.json({
    data: {
      pay_mode: "form_submit",
      submit_url: YAOLIPAY_SUBMIT_URL,
      submit_method: "POST",
      params: {
        ...payParams,
        sign,
        sign_type: "RSA",
      },
      out_trade_no: order.out_trade_no,
      trade_no: null,
      money: moneyStr,
      payment_channel: payment_channel,
    },
  });
}
