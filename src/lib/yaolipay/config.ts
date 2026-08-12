// ===== 耀立支付 V2 配置（仅服务端，不暴露密钥） =====
// 从环境变量读取，私钥仅服务端使用，不向前端暴露

import type { PaymentChannel, PayMethod } from "./types";

export interface YaolipayConfig {
  pid: number;
  privateKey: string;
  publicKey: string;
  apiBase: string;
  notifyUrl: string;
}

let cached: YaolipayConfig | null | undefined;

/**
 * 读取耀立支付配置。
 * 任一必需变量未配置时返回 null（调用方应返回 503）。
 * 仅在服务端调用。
 */
export function getYaolipayConfig(): YaolipayConfig | null {
  if (cached !== undefined) return cached;
  const pidStr = process.env.YAOLIPAY_PID;
  const privateKey = process.env.YAOLIPAY_PRIVATE_KEY;
  const publicKey = process.env.YAOLIPAY_PUBLIC_KEY;
  const apiBase = process.env.YAOLIPAY_API_BASE ?? "https://www.yaolipay.com";
  const notifyUrl = process.env.YAOLIPAY_NOTIFY_URL ?? "";

  if (!pidStr || !privateKey || !publicKey || !notifyUrl) {
    cached = null;
    return null;
  }

  const pid = Number(pidStr);
  if (!Number.isFinite(pid) || pid <= 0) {
    cached = null;
    return null;
  }

  cached = { pid, privateKey, publicKey, apiBase, notifyUrl };
  return cached;
}

/**
 * 构造 return_url（支付成功后的页面跳转地址）
 * 复用 NEXT_PUBLIC_APP_URL，避免重复配置
 */
export function getReturnUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const path = "/payment/result";
  return appUrl ? `${appUrl}${path}` : path;
}

/** 默认使用 web 方式调用（自动返回二维码/跳转 URL） */
export const DEFAULT_PAY_METHOD: PayMethod = "web";

/** 校验支付方式是否合法 */
export function isValidPaymentChannel(value: unknown): value is PaymentChannel {
  return value === "alipay" || value === "wxpay";
}
