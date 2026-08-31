// ===== Creem HTTP client（官方 REST API，标准 fetch，无第三方 SDK 依赖）=====
// 仅实现当前业务需要的 Checkout 创建；金额由 Creem 产品定价决定，
// SeeO 不向 Creem 传金额，只记录自己的期望金额用于 webhook 校验。

import type { CreemConfig } from "./config";

export interface CreemCheckoutParams {
  /** Creem 产品 ID（服务端常量映射，非前端输入） */
  productId: string;
  /** 商户请求号：SeeO 的 out_trade_no（webhook 回传 request_id / metadata 匹配订单） */
  requestId: string;
  /** 支付成功后浏览器跳转地址（仅展示用，支付成功以 webhook 为准） */
  successUrl: string;
  /** 随 checkout 携带的 metadata（webhook 原样回传，用于订单匹配） */
  metadata?: Record<string, string>;
  /** 预填客户邮箱（可选） */
  customerEmail?: string;
}

export interface CreemCheckoutResult {
  /** checkout session id（ch_ 开头） */
  id: string;
  /** 跳转支付的 URL */
  checkoutUrl: string;
}

export class CreemApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly traceId?: string
  ) {
    super(message);
    this.name = "CreemApiError";
  }
}

/**
 * 创建 Creem Checkout Session
 * POST {apiBase}/checkouts，x-api-key 认证
 * 官方响应字段：{ id, checkout_url, product_id, status }
 */
export async function createCreemCheckout(
  config: CreemConfig,
  params: CreemCheckoutParams
): Promise<CreemCheckoutResult> {
  const body: Record<string, unknown> = {
    product_id: params.productId,
    request_id: params.requestId,
    success_url: params.successUrl,
  };
  if (params.metadata) body.metadata = params.metadata;
  if (params.customerEmail) {
    body.customer = { email: params.customerEmail };
  }

  let res: Response;
  try {
    res = await fetch(`${config.apiBase}/checkouts`, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new CreemApiError(
      `Creem API 网络错误: ${err instanceof Error ? err.message : String(err)}`,
      0
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new CreemApiError(
      `Creem API ${res.status}: ${text.slice(0, 500)}`,
      res.status
    );
  }

  const json = (await res.json().catch(() => null)) as {
    id?: string;
    checkout_url?: string;
  } | null;
  if (!json?.id || !json?.checkout_url) {
    throw new CreemApiError("Creem API 响应缺少 id / checkout_url", res.status);
  }
  return { id: json.id, checkoutUrl: json.checkout_url };
}
