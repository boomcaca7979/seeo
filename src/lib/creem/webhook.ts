// ===== Creem Webhook 签名验证 + 事件类型 =====
// 官方机制：每个 webhook 请求带 creem-signature 头，
// 签名 = HMAC-SHA256(rawBody, webhookSecret) 的 hex。
// 验证方式：本地对 raw body 计算 HMAC 并与头部做 timing-safe 比较。
// （https://docs.creem.io/code/webhooks）

import { createHmac, timingSafeEqual } from "node:crypto";

/** 签名头名称 */
export const CREEM_SIGNATURE_HEADER = "creem-signature";

/**
 * 验证 webhook 签名
 * @param rawBody       原始请求体字符串（必须是未解析的 raw text）
 * @param signatureHeader creem-signature 头的值（hex）
 * @param secret        webhook secret
 */
export function verifyCreemSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.trim().toLowerCase();
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
  } catch {
    return false;
  }
}

// ---------- 事件类型（按官方文档 payload 定义，字段防御性可选） ----------

export type CreemEventType =
  | "checkout.completed"
  | "subscription.active"
  | "subscription.paid"
  | "subscription.canceled"
  | "subscription.scheduled_cancel"
  | "subscription.past_due"
  | "subscription.unpaid"
  | "subscription.expired"
  | "subscription.update"
  | "subscription.trialing"
  | "subscription.paused"
  | "refund.created"
  | "dispute.created";

export interface CreemWebhookEvent<T = unknown> {
  id: string;
  eventType: CreemEventType | string;
  created_at: number;
  object: T;
}

export interface CreemCustomerObject {
  id?: string;
  email?: string;
}

export interface CreemProductObject {
  id?: string;
  name?: string;
  billing_type?: string;
  billing_period?: string;
}

export interface CreemOrderObject {
  id?: string;
  customer?: string;
  product?: string;
  amount?: number;
  currency?: string;
  status?: string;
  type?: string;
  metadata?: Record<string, unknown> | null;
}

export interface CreemSubscriptionObject {
  id?: string;
  status?: string;
  last_transaction_id?: string;
  current_period_start_date?: string;
  current_period_end_date?: string;
  metadata?: Record<string, unknown> | null;
}

/** checkout.completed 的 object */
export interface CreemCheckoutCompletedObject {
  id?: string;
  request_id?: string | null;
  status?: string;
  order?: CreemOrderObject | null;
  product?: CreemProductObject | null;
  customer?: CreemCustomerObject | null;
  subscription?: CreemSubscriptionObject | null;
  metadata?: Record<string, unknown> | null;
}

/** subscription.* 事件的 object */
export interface CreemSubscriptionEventObject {
  id?: string;
  status?: string;
  product?: CreemProductObject | null;
  customer?: CreemCustomerObject | null;
  last_transaction_id?: string;
  current_period_start_date?: string;
  current_period_end_date?: string;
  metadata?: Record<string, unknown> | null;
}

/** refund.created 的 object */
export interface CreemRefundObject {
  id?: string;
  status?: string;
  refund_amount?: number;
  refund_currency?: string;
  reason?: string;
  order_id?: string;
  order?: CreemOrderObject | null;
  metadata?: Record<string, unknown> | null;
}

/** 从 metadata / request_id 提取 SeeO 订单号 */
export function extractOutTradeNo(
  metadata: Record<string, unknown> | null | undefined,
  requestId?: string | null
): string | null {
  const fromMeta = metadata?.out_trade_no;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  if (typeof requestId === "string" && requestId) return requestId;
  return null;
}
