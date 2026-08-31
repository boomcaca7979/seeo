// ===== POST /api/payment/creem/create =====
// Creem Checkout 创建入口（pricing 页购买按钮调用）
//
// 安全设计：
//   - 登录校验（演示模式无真实用户，直接 401）
//   - plan 仅接受 lite / pro / custom，Product ID 由服务端常量映射，
//     前端传入的任何 product_id / amount / currency 字段一律忽略
//   - 订单金额由服务端 PLAN_PRICING 定价表决定（USD cents）
//   - purchaseType / Creem checkout_id 写入 orders.param（JSON），不改表结构
//
// 链路：创建本地 pending order → 调 Creem POST /checkouts → 返回 checkout_url
// 支付成功以 Creem webhook（/api/payment/creem/webhook）为准，success_url 仅展示用

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { canPurchasePlan, getUserPlan } from "@/lib/billing";
import {
  createPendingOrder,
  markOrderFailed,
  parseOrderParam,
  type OrderRecord,
} from "@/lib/orders/service";
import { getCreemConfig, CREEM_PRODUCT_IDS } from "@/lib/creem/config";
import { createCreemCheckout, CreemApiError } from "@/lib/creem/client";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 将 Creem checkout_id 合并进订单 param JSON（复用现有列，不改表结构） */
async function recordCheckoutId(order: OrderRecord, checkoutId: string) {
  const admin = getAdminClient();
  if (!admin) return;
  const merged = { ...parseOrderParam(order) };
  merged.creem = {
    ...(typeof merged.creem === "object" && merged.creem !== null
      ? (merged.creem as Record<string, unknown>)
      : {}),
    checkout_id: checkoutId,
  };
  try {
    await admin
      .from("orders")
      .update({ param: JSON.stringify(merged) })
      .eq("out_trade_no", order.out_trade_no);
  } catch (err) {
    // 仅影响可追溯性，不影响支付链路
    console.error("[CreemCreate] 记录 checkout_id 失败:", err);
  }
}

export async function POST(req: Request) {
  // 1. 登录校验（演示模式 requireAuth 放行但无真实用户，同样拒绝）
  const auth = await requireAuth();
  if (!auth.allowed || !auth.user?.id) {
    return NextResponse.json(
      { error: "请先登录后再购买", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }
  const userId = auth.user.id;

  // 2. plan 校验：仅接受服务端映射表中的 key
  let body: { plan?: unknown };
  try {
    body = (await req.json()) as { plan?: unknown };
  } catch {
    body = {};
  }
  const plan = body.plan;
  if (typeof plan !== "string" || !(plan in CREEM_PRODUCT_IDS)) {
    return NextResponse.json(
      { error: "非法的套餐参数", code: "INVALID_PLAN" },
      { status: 400 }
    );
  }
  const checkoutPlan = plan as keyof typeof CREEM_PRODUCT_IDS;

  // 3. Creem 配置（secret 只在服务端环境变量中）
  const config = getCreemConfig();
  if (!config) {
    return NextResponse.json(
      { error: "支付通道未配置", code: "PAYMENT_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  // 4. 购买规则校验（防降级；currentPlan 由服务端查询，不信任前端）
  const userPlan = await getUserPlan(userId);
  const check = canPurchasePlan(userPlan.effectivePlan, checkoutPlan);
  if (!check.allowed) {
    return NextResponse.json(
      {
        error: "当前套餐不支持此购买，请刷新页面后重试",
        code: check.errorCode ?? "PURCHASE_NOT_ALLOWED",
      },
      { status: 409 }
    );
  }

  // 5. 创建本地 pending 订单（金额由服务端定价表决定）
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const pending = await createPendingOrder({
    userId,
    plan: checkoutPlan,
    paymentChannel: "creem",
    clientIp,
    purchaseType: check.purchaseType,
  });
  if (!pending?.order?.id) {
    return NextResponse.json(
      { error: pending?.error ?? "订单创建失败", code: "ORDER_CREATE_FAILED" },
      { status: 500 }
    );
  }
  const order = pending.order;

  // 6. 调 Creem 创建 Checkout
  //    success_url 仅用于浏览器回跳展示，支付成功以 webhook 为准
  const origin = new URL(req.url).origin;
  try {
    const checkout = await createCreemCheckout(config, {
      productId: CREEM_PRODUCT_IDS[checkoutPlan],
      requestId: order.out_trade_no,
      successUrl: `${origin}/payment/result?order=${order.out_trade_no}`,
      metadata: {
        order_id: order.id,
        out_trade_no: order.out_trade_no,
        plan: checkoutPlan,
        user_id: userId,
      },
    });

    await recordCheckoutId(order, checkout.id);

    return NextResponse.json({
      data: {
        checkoutUrl: checkout.checkoutUrl,
        outTradeNo: order.out_trade_no,
        checkoutId: checkout.id,
      },
    });
  } catch (err) {
    // Creem 下单失败：本地订单标记 failed，避免悬挂 pending
    await markOrderFailed(order.out_trade_no);
    const status = err instanceof CreemApiError ? err.status : 0;
    console.error("[CreemCreate] 创建 checkout 失败:", { outTradeNo: order.out_trade_no, status, err });
    return NextResponse.json(
      { error: "创建支付失败，请稍后重试", code: "CREEM_CHECKOUT_FAILED" },
      { status: 502 }
    );
  }
}
