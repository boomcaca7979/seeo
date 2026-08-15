// ===== 支付结果页状态判定（纯逻辑，供 /payment/result 复用） =====
//
// 安全要点：
//   - paid 判定唯一依据是服务端 /api/payment/yaolipay/query 返回的 payment_status
//   - 浏览器 URL 参数（pay_type / pay_info / channel / trade_no 等）只用于展示，
//     不参与 paid/failed 状态判定
//   - 未带订单号 → not_found；query 返回 404 → not_found

export type PaymentPageStatus =
  | "loading"
  | "pending"
  | "paid"
  | "failed"
  | "not_found"
  | "refunded";

/**
 * 根据订单号存在性与服务端查询结果，判定支付结果页应展示的状态
 *
 * @param input.hasOrderNo          URL 中是否携带订单号（order / out_trade_no）
 * @param input.queryHttpStatus     query API 的 HTTP 状态码（未发起请求时为 undefined）
 * @param input.serverPaymentStatus query API 返回的订单 payment_status（未返回时为 undefined）
 */
export function resolvePaymentPageStatus(input: {
  hasOrderNo: boolean;
  queryHttpStatus?: number;
  serverPaymentStatus?: string;
}): PaymentPageStatus {
  // 无订单号：直接视为不存在，不发起查询
  if (!input.hasOrderNo) return "not_found";

  // query 返回 404：订单不存在
  if (input.queryHttpStatus === 404) return "not_found";

  // 服务端返回的订单状态是唯一可信来源
  switch (input.serverPaymentStatus) {
    case "paid":
      return "paid";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    default:
      // 未返回 / 仍 pending / 查询暂时失败 → 继续等待（轮询）
      return "pending";
  }
}
