// ===== GET /api/payment/yaolipay/notify =====
// 耀立支付异步通知接收
// 文档：https://www.yaolipay.com/doc/pay_notify.html
//
// 处理顺序：
//   1. 接收通知参数（GET query string）
//   2. 检查必填字段
//   3. RSA 验签
//   4. 验证 pid
//   5. 验证 timestamp 新鲜度（B2 修复，±5 分钟窗口）
//   6. 验证 trade_status === TRADE_SUCCESS
//   7. 根据 out_trade_no 查询 orders
//   8. 校验订单金额
//   9. 调用 completeOrder 幂等完成订单
//  10. 返回 "success"
//
// 注意：必须返回纯文本 "success"（不是 JSON）

import { getYaolipayConfig } from "@/lib/yaolipay/config";
import { verifyNotifySign } from "@/lib/yaolipay/client";
import { completeOrder, getOrderByOutTradeNo, amountsMatch } from "@/lib/orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** timestamp 新鲜度窗口（毫秒），允许 ±5 分钟 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/** 解析 URLSearchParams 为对象（值转字符串） */
function parseParams(searchParams: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

/**
 * 解析耀立 timestamp 参数为毫秒时间戳
 * 支持：
 *   - Unix 秒级时间戳（10 位数字）
 *   - Unix 毫秒级时间戳（13 位数字）
 * 返回 null 表示格式非法
 */
function parseTimestampToMs(ts: string): number | null {
  // 移除可能的空白
  const trimmed = ts.trim();
  // 必须是纯数字
  if (!/^\d+$/.test(trimmed)) return null;
  const num = parseInt(trimmed, 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  // 10 位 → 秒级，乘 1000
  // 13 位 → 毫秒级，直接用
  if (trimmed.length <= 10) return num * 1000;
  return num;
}

export async function GET(req: Request) {
  const config = getYaolipayConfig();
  if (!config) {
    console.error("[Yaolipay Notify] 配置缺失");
    return new Response("fail", { status: 503 });
  }

  // 1. 接收通知参数
  const url = new URL(req.url);
  const params = parseParams(url.searchParams);

  // 2. 必需字段检查
  const requiredFields = ["pid", "trade_no", "out_trade_no", "trade_status", "money", "timestamp", "sign", "sign_type"];
  for (const field of requiredFields) {
    if (!params[field]) {
      console.error("[Yaolipay Notify] 缺少字段:", field);
      return new Response("fail", { status: 400 });
    }
  }

  const sign = params.sign;
  const pid = Number(params.pid);

  // 3. RSA 验签
  const verified = verifyNotifySign(params as unknown as Record<string, unknown>, sign);
  if (!verified) {
    console.error("[Yaolipay Notify] 验签失败", { out_trade_no: params.out_trade_no });
    return new Response("fail", { status: 400 });
  }

  // 4. 验证 pid
  if (pid !== config.pid) {
    console.error("[Yaolipay Notify] pid 不匹配", { expected: config.pid, actual: pid });
    return new Response("fail", { status: 400 });
  }

  // 5. 验证 timestamp 新鲜度（B2 修复）
  //    防止重放攻击：timestamp 必须在服务器时间 ±5 分钟内
  const notifyTsMs = parseTimestampToMs(params.timestamp);
  if (notifyTsMs === null) {
    console.error("[Yaolipay Notify] timestamp 格式非法", { out_trade_no: params.out_trade_no });
    return new Response("fail", { status: 400 });
  }
  const nowMs = Date.now();
  const diffMs = Math.abs(nowMs - notifyTsMs);
  if (diffMs > TIMESTAMP_TOLERANCE_MS) {
    console.error("[Yaolipay Notify] timestamp 超出容差", {
      out_trade_no: params.out_trade_no,
      diff_seconds: Math.round(diffMs / 1000),
    });
    return new Response("fail", { status: 400 });
  }

  // 6. 验证 trade_status === TRADE_SUCCESS
  if (params.trade_status !== "TRADE_SUCCESS") {
    console.error("[Yaolipay Notify] trade_status 非 SUCCESS", { trade_status: params.trade_status });
    return new Response("fail", { status: 400 });
  }

  // 7. 根据 out_trade_no 查询 orders
  const order = await getOrderByOutTradeNo(params.out_trade_no);
  if (!order) {
    console.error("[Yaolipay Notify] 订单不存在:", params.out_trade_no);
    // 仍然返回 success 防止重发，但记录日志
    return new Response("success", { status: 200 });
  }

  // 8. 校验订单金额（整数 cents 比较，避免浮点精度问题）
  const notifyMoney = parseFloat(params.money);
  if (!Number.isFinite(notifyMoney) || !amountsMatch(order.amount, notifyMoney)) {
    console.error("[Yaolipay Notify] 金额不匹配", {
      out_trade_no: params.out_trade_no,
      expected: order.amount,
      actual: notifyMoney,
    });
    return new Response("fail", { status: 400 });
  }

  // 9. 调用 completeOrder 幂等完成订单（含会员开通）
  const result = await completeOrder({
    outTradeNo: params.out_trade_no,
    tradeNo: params.trade_no,
    apiTradeNo: params.api_trade_no,
    paidAmount: notifyMoney,
  });

  if (!result.ok) {
    console.error("[Yaolipay Notify] 订单完成失败:", result.error);
    // 返回 500 让耀立重试
    return new Response("fail", { status: 500 });
  }

  // 10. 返回耀立要求的成功响应
  return new Response("success", { status: 200 });
}
