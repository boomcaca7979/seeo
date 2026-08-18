// ===== POST /api/payment/yaolipay/query =====
// 订单查询
// 1. 必须登录
// 2. 只能查询当前用户自己的订单
// 3. 先查本地订单
// 4. 对 pending 订单可调用耀立 query API 获取最新状态
// 5. 若耀立确认支付成功，通过 completeOrder 统一逻辑开通会员
// 6. 不允许查询其他用户订单

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { getYaolipayConfig } from "@/lib/yaolipay/config";
import { queryOrder } from "@/lib/yaolipay/client";
import {
  getOrderByOutTradeNoForUser,
  completeOrder,
  retryMembershipActivation,
} from "@/lib/orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user.id;

  let body: { out_trade_no?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "INVALID_JSON" }, { status: 400 });
  }

  const outTradeNo = body.out_trade_no?.trim();
  if (!outTradeNo) {
    return NextResponse.json({ error: "out_trade_no 必填", code: "OUT_TRADE_NO_REQUIRED" }, { status: 400 });
  }

  // 1. 查询本地订单（限制只能查自己的）
  const order = await getOrderByOutTradeNoForUser(outTradeNo, userId);
  if (!order) {
    return NextResponse.json({ error: "订单不存在", code: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  // 2. 如果已经是终态（paid/refunded/failed），直接返回
  //    但对 paid 且 period_end 为 null 的订单，尝试重试 extend_membership
  //    （completeOrder 中 RPC 失败的恢复路径）
  if (order.payment_status !== "pending") {
    if (order.payment_status === "paid" && !order.period_end) {
      const recovered = await retryMembershipActivation(order);
      if (recovered) {
        const refreshed = await getOrderByOutTradeNoForUser(outTradeNo, userId);
        if (refreshed) {
          return NextResponse.json({
            data: { order: refreshed, payment_status: "paid", sync: true },
          });
        }
      }
    }
    return NextResponse.json({
      data: {
        order,
        payment_status: order.payment_status,
        sync: false,
      },
    });
  }

  // 3. pending 订单：调用耀立 query API 同步状态
  const config = getYaolipayConfig();
  if (!config) {
    return NextResponse.json({ data: { order, payment_status: "pending", sync: false } });
  }

  try {
    const yaolipayResp = await queryOrder({ out_trade_no: outTradeNo });

    // 耀立 status: 0=未支付, 1=已支付, 2=已退款, 3=已冻结, 4=预授权
    if (yaolipayResp.code === 0 && yaolipayResp.status === 1) {
      // 耀立确认已支付，调用 completeOrder 开通会员
      const money = parseFloat(yaolipayResp.money ?? order.amount.toFixed(2));
      const result = await completeOrder({
        outTradeNo: outTradeNo,
        tradeNo: yaolipayResp.trade_no,
        apiTradeNo: yaolipayResp.api_trade_no,
        paidAmount: money,
      });

      if (!result.ok || !result.order) {
        return NextResponse.json({
          data: {
            order,
            payment_status: "pending",
            sync: false,
            error: result.error,
          },
        });
      }

      return NextResponse.json({
        data: {
          order: result.order,
          payment_status: result.order.payment_status,
          sync: true,
          opened: result.opened,
        },
      });
    }

    // 耀立状态为已退款
    if (yaolipayResp.code === 0 && yaolipayResp.status === 2) {
      const admin = (await import("@/lib/supabase/admin")).getAdminClient();
      if (admin) {
        await admin
          .from("orders")
          .update({ payment_status: "refunded" })
          .eq("out_trade_no", outTradeNo)
          .eq("payment_status", "pending");
      }
      const refreshed = await getOrderByOutTradeNoForUser(outTradeNo, userId);
      return NextResponse.json({
        data: { order: refreshed ?? order, payment_status: "refunded", sync: true },
      });
    }

    // 其他状态：返回耀立原始响应
    return NextResponse.json({
      data: {
        order,
        payment_status: "pending",
        sync: false,
        yaolipay_status: yaolipayResp.status,
      },
    });
  } catch (err) {
    console.error("[Yaolipay Query] 调用耀立查询异常:", err);
    return NextResponse.json({
      data: { order, payment_status: "pending", sync: false },
    });
  }
}
