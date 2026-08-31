// ===== GET /api/payment/creem/status?order=<out_trade_no> =====
// 支付结果页轮询接口：查询 SeeO 自己的订单状态
//
// 重要：支付结果页只能通过本接口读取订单当前状态，
// 用户浏览器回到 success_url 本身不构成支付成功凭证
//（支付成功由 /api/payment/creem/webhook 驱动 completeOrder 写入）。

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getOrderByOutTradeNoForUser } from "@/lib/orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.allowed || !auth.user?.id) {
    return NextResponse.json(
      { error: "请先登录", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }

  const orderNo = new URL(req.url).searchParams.get("order");
  if (!orderNo) {
    return NextResponse.json(
      { error: "缺少订单号参数", code: "MISSING_ORDER" },
      { status: 400 }
    );
  }

  // 带 user_id 校验：只能查询自己的订单
  const order = await getOrderByOutTradeNoForUser(orderNo, auth.user.id);
  if (!order) {
    return NextResponse.json(
      { error: "订单不存在", code: "ORDER_NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    data: {
      outTradeNo: order.out_trade_no,
      plan: order.plan,
      amount: order.amount,
      currency: order.currency,
      paymentStatus: order.payment_status,
      paymentChannel: order.payment_channel,
      paidAt: order.paid_at,
      periodEnd: order.period_end,
    },
  });
}
