// ===== 耀立支付 V2 类型定义 =====
// 与官方文档 https://www.yaolipay.com/doc/index.html 接口字段一一对应

/** 支付方式 */
export type PaymentChannel = "alipay" | "wxpay";

/** 接口类型（method 字段） */
export type PayMethod = "web" | "jump" | "jsapi" | "app" | "scan" | "applet";

/** 发起支付类型（响应 pay_type 字段） */
export type PayType =
  | "jump"
  | "html"
  | "qrcode"
  | "urlscheme"
  | "jsapi"
  | "app"
  | "scan"
  | "wxplugin"
  | "wxapp";

/** 订单支付状态（本地 orders.payment_status） */
export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

/** 耀立 trade_status（异步通知固定为 TRADE_SUCCESS） */
export type TradeStatus = "TRADE_SUCCESS";

/** 统一下单请求参数 */
export interface CreateOrderParams {
  pid: number;
  method: PayMethod;
  type: PaymentChannel;
  out_trade_no: string;
  notify_url: string;
  return_url?: string;
  name: string;
  money: string;
  clientip: string;
  param?: string;
  timestamp: string;
  sign: string;
  sign_type: "RSA";
}

/** 统一下单响应 */
export interface CreateOrderResponse {
  code: number;
  msg?: string;
  trade_no?: string;
  pay_type?: PayType;
  pay_info?: string;
  timestamp?: string;
  sign?: string;
  sign_type?: "RSA";
}

/** 异步通知参数（GET query string） */
export interface NotifyParams {
  pid: string;
  trade_no: string;
  out_trade_no: string;
  api_trade_no?: string;
  type: PaymentChannel;
  trade_status: TradeStatus;
  addtime?: string;
  endtime?: string;
  name?: string;
  money: string;
  param?: string;
  buyer?: string;
  timestamp: string;
  sign: string;
  sign_type: "RSA";
}

/** 订单查询请求参数 */
export interface QueryOrderParams {
  pid: number;
  trade_no?: string;
  out_trade_no?: string;
  timestamp: string;
  sign: string;
  sign_type: "RSA";
}

/** 订单查询响应 */
export interface QueryOrderResponse {
  code: number;
  msg?: string;
  trade_no?: string;
  out_trade_no?: string;
  api_trade_no?: string;
  type?: PaymentChannel;
  status?: number; // 0=未支付, 1=已支付, 2=已退款, 3=已冻结, 4=预授权
  pid?: number;
  addtime?: string;
  endtime?: string;
  name?: string;
  money?: string;
  refundmoney?: string;
  param?: string;
  buyer?: string;
  clientip?: string;
  timestamp?: string;
  sign?: string;
  sign_type?: "RSA";
}

/** 退款请求参数 */
export interface RefundOrderParams {
  pid: number;
  trade_no?: string;
  out_trade_no?: string;
  money: string;
  out_refund_no?: string;
  timestamp: string;
  sign: string;
  sign_type: "RSA";
}

/** 退款响应 */
export interface RefundOrderResponse {
  code: number;
  msg?: string;
  refund_no?: string;
  out_refund_no?: string;
  trade_no?: string;
  money?: string;
  reducemoney?: string;
  timestamp?: string;
  sign?: string;
  sign_type?: "RSA";
}
