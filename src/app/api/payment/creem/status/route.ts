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

  // 带 user_id 校验：只能查询自己的订单。
  // 三态必须分开处理：服务故障绝不能伪装成「订单不存在」（404），
  // 否则支付结果页会在数据库抖动时告诉用户「未找到订单，请重新购买」。
  const lookup = await getOrderByOutTradeNoForUser(orderNo, auth.user.id);
  if (lookup.kind === "failure") {
    console.error("[PaymentStatus] 订单查询失败:", lookup.reason);
    return NextResponse.json(
      { error: "暂时无法确认订单状态", code: "ORDER_QUERY_FAILED" },
      { status: 503 }
    );
  }
  if (lookup.kind === "foreign") {
    // 订单存在但不属于当前账号：403（不返回任何订单内容，仅说明无权查看）。
    // 与 404 分开是为了让支付结果页能区分「订单号有误」与「这不是你的订单」，
    // 两者都不会泄露订单金额、套餐、状态。
    console.warn("[PaymentStatus] 订单不属于当前用户，拒绝查看:", orderNo);
    return NextResponse.json(
      { error: "无权查看该订单", code: "ORDER_FORBIDDEN" },
      { status: 403 }
    );
  }
  if (lookup.kind === "absent") {
    return NextResponse.json(
      { error: "订单不存在", code: "ORDER_NOT_FOUND" },
      { status: 404 }
    );
  }

  const order = lookup.order;

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
