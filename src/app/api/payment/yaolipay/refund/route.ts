// ===== POST /api/payment/yaolipay/refund =====
// 退款接口
// 1. 必须登录
// 2. 后端验证权限（只能退自己的订单）
// 3. 根据 out_trade_no 找订单
// 4. 只能退款 paid 订单
// 5. 退款金额不能超过订单金额
// 6. 调用耀立退款 API
// 7. 保存 refund_status / refund_amount / refunded_at
// 8. 防止重复退款
//
// 注意：第一阶段所有用户均可对自己订单发起退款
// 后续可加入"7天内"等业务规则

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { getYaolipayConfig } from "@/lib/yaolipay/config";
import { refundOrder } from "@/lib/yaolipay/client";
import {
  getOrderByOutTradeNoForUser,
  handleRefundSuccess,
} from "@/lib/orders/service";
import { formatAmountYuan } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user.id;

  // 演示模式
  if (auth.skip) {
    return NextResponse.json(
      { error: "演示模式下不支持退款", code: "REFUND_DEMO_DISABLED" },
      { status: 503 }
    );
  }

  const config = getYaolipayConfig();
  if (!config) {
    return NextResponse.json({ error: "耀立支付配置缺失", code: "YAOLIPAY_NOT_CONFIGURED" }, { status: 503 });
  }

  let body: { out_trade_no?: string; money?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "INVALID_JSON" }, { status: 400 });
  }

  const outTradeNo = body.out_trade_no?.trim();
  if (!outTradeNo) {
    return NextResponse.json({ error: "out_trade_no 必填", code: "OUT_TRADE_NO_REQUIRED" }, { status: 400 });
  }

  // 解析退款金额（可选；不传则全额退款）
  let refundAmountCents: number | null = null;
  if (body.money !== undefined && body.money !== null) {
    const moneyStr = String(body.money);
    const money = parseFloat(moneyStr);
    if (!Number.isFinite(money) || money <= 0) {
      return NextResponse.json({ error: "money 必须为正数", code: "MONEY_INVALID" }, { status: 400 });
    }
    refundAmountCents = Math.round(money * 100);
  }

  // 1. 查询订单（限制只能查自己的）
  const order = await getOrderByOutTradeNoForUser(outTradeNo, userId);
  if (!order) {
    return NextResponse.json({ error: "订单不存在", code: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  // 2. 只能退 paid 订单
  if (order.payment_status !== "paid") {
    return NextResponse.json(
      { error: `订单状态为 ${order.payment_status}，不可退款`, code: "REFUND_NOT_ALLOWED" },
      { status: 400 }
    );
  }

  // 3. 计算退款金额（不传则全额）
  const orderAmountCents = Math.round(order.amount * 100);
  const refundCents = refundAmountCents ?? orderAmountCents;
  if (refundCents > orderAmountCents) {
    return NextResponse.json(
      { error: "退款金额不能超过订单金额", code: "REFUND_AMOUNT_EXCEEDED" },
      { status: 400 }
    );
  }
  const refundMoneyStr = formatAmountYuan(refundCents);

  // 4. 生成商户退款单号（用于防止重复请求）
  const outRefundNo = `R${order.out_trade_no.slice(1)}${Date.now().toString().slice(-6)}`;

  // 5. 调用耀立退款 API
  try {
    const yaolipayResp = await refundOrder({
      out_trade_no: outTradeNo,
      money: refundMoneyStr,
      out_refund_no: outRefundNo,
    });

    if (yaolipayResp.code !== 0) {
      return NextResponse.json(
        { error: yaolipayResp.msg ?? "耀立退款失败", code: "REFUND_FAILED" },
        { status: 500 }
      );
    }

    // 6. 处理退款成功（更新订单状态 + 检查其他有效订单 + 降级会员）
    const result = await handleRefundSuccess({
      outTradeNo,
      refundAmount: parseFloat(refundMoneyStr),
      outRefundNo,
    });

    if (!result.ok) {
      console.error("[Yaolipay Refund] 处理退款成功失败:", result.error);
      return NextResponse.json({ error: result.error, code: "REFUND_FAILED" }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        out_trade_no: outTradeNo,
        refund_no: yaolipayResp.refund_no,
        out_refund_no: outRefundNo,
        refund_amount: refundMoneyStr,
        status: "succeeded",
      },
    });
  } catch (err) {
    console.error("[Yaolipay Refund] 异常:", err);
    const msg = err instanceof Error ? err.message : "退款异常";
    return NextResponse.json({ error: msg, code: "REFUND_FAILED" }, { status: 500 });
  }
}
