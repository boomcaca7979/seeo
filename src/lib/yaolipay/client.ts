// ===== 耀立支付 V2 HTTP 客户端 =====
// 封装统一下单 / 订单查询 / 退款三个接口
// 签名自动注入；调用方只需提供业务参数

import { getYaolipayConfig } from "./config";
import { signParams, verifyParams, buildSignString } from "./sign";
import { DEFAULT_PAY_METHOD } from "./config";
import type {
  CreateOrderParams,
  CreateOrderResponse,
  QueryOrderParams,
  QueryOrderResponse,
  RefundOrderParams,
  RefundOrderResponse,
  PaymentChannel,
  PayMethod,
} from "./types";

/** 生成 10 位 Unix 时间戳（秒） */
function timestampSeconds(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/** 调用耀立接口的统一封装 */
async function callYaolipayApi<T>(
  path: string,
  params: Record<string, unknown>
): Promise<T> {
  const config = getYaolipayConfig();
  if (!config) {
    throw new Error("耀立支付配置缺失（YAOLIPAY_PID/PRIVATE_KEY/PUBLIC_KEY/NOTIFY_URL）");
  }

  // 注入公共参数
  const finalParams: Record<string, unknown> = {
    ...params,
    pid: config.pid,
    timestamp: timestampSeconds(),
    sign_type: "RSA",
  };

  // 签名
  finalParams.sign = signParams(finalParams, config.privateKey);

  // 调用耀立接口（application/x-www-form-urlencoded）
  const url = `${config.apiBase}${path}`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(finalParams)) {
    if (v !== null && v !== undefined) body.append(k, String(v));
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`耀立接口 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as T;

  // 验签响应（如果响应中包含 sign 字段）
  const responseObj = json as Record<string, unknown>;
  if (responseObj.sign && responseObj.sign_type === "RSA") {
    const signString = buildSignString(responseObj);
    const { verifyWithPublicKey } = await import("./sign");
    const ok = verifyWithPublicKey(signString, responseObj.sign as string, config.publicKey);
    if (!ok) {
      console.error("[Yaolipay] 响应验签失败", { path, response: json });
      throw new Error("耀立接口响应验签失败");
    }
  }

  return json;
}

/**
 * 统一下单
 * @param args 业务参数（不含签名/公共参数）
 */
export async function createOrder(args: {
  method?: PayMethod;
  type: PaymentChannel;
  out_trade_no: string;
  notify_url?: string;
  return_url?: string;
  name: string;
  money: string;
  clientip: string;
  param?: string;
}): Promise<CreateOrderResponse> {
  const config = getYaolipayConfig();
  if (!config) {
    throw new Error("耀立支付配置缺失");
  }

  const params: Record<string, unknown> = {
    method: args.method ?? DEFAULT_PAY_METHOD,
    type: args.type,
    out_trade_no: args.out_trade_no,
    notify_url: args.notify_url ?? config.notifyUrl,
    return_url: args.return_url ?? "",
    name: args.name,
    money: args.money,
    clientip: args.clientip,
  };
  if (args.param) params.param = args.param;

  return callYaolipayApi<CreateOrderResponse>("/api/pay/create", params);
}

/**
 * 订单查询
 */
export async function queryOrder(args: {
  trade_no?: string;
  out_trade_no?: string;
}): Promise<QueryOrderResponse> {
  if (!args.trade_no && !args.out_trade_no) {
    throw new Error("trade_no 或 out_trade_no 必填其一");
  }
  const params: Record<string, unknown> = {};
  if (args.trade_no) params.trade_no = args.trade_no;
  if (args.out_trade_no) params.out_trade_no = args.out_trade_no;

  return callYaolipayApi<QueryOrderResponse>("/api/pay/query", params);
}

/**
 * 退款
 */
export async function refundOrder(args: {
  trade_no?: string;
  out_trade_no?: string;
  money: string;
  out_refund_no?: string;
}): Promise<RefundOrderResponse> {
  if (!args.trade_no && !args.out_trade_no) {
    throw new Error("trade_no 或 out_trade_no 必填其一");
  }
  const params: Record<string, unknown> = {
    money: args.money,
  };
  if (args.trade_no) params.trade_no = args.trade_no;
  if (args.out_trade_no) params.out_trade_no = args.out_trade_no;
  if (args.out_refund_no) params.out_refund_no = args.out_refund_no;

  return callYaolipayApi<RefundOrderResponse>("/api/pay/refund", params);
}

/**
 * 验证异步通知签名
 * 通知是 GET 请求，参数在 query string 中
 */
export function verifyNotifySign(
  params: Record<string, unknown>,
  signature: string
): boolean {
  const config = getYaolipayConfig();
  if (!config) return false;
  return verifyParams(params, signature, config.publicKey);
}

export type {
  CreateOrderParams,
  CreateOrderResponse,
  QueryOrderParams,
  QueryOrderResponse,
  RefundOrderParams,
  RefundOrderResponse,
};
