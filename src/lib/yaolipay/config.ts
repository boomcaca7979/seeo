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
  const pidStr = (process.env.YAOLIPAY_PID ?? "").trim();
  const privateKey = (process.env.YAOLIPAY_PRIVATE_KEY ?? "").trim();
  const publicKey = (process.env.YAOLIPAY_PUBLIC_KEY ?? "").trim();
  const apiBase = (process.env.YAOLIPAY_API_BASE ?? "https://www.yaolipay.com").trim();
  const notifyUrl = (process.env.YAOLIPAY_NOTIFY_URL ?? "").trim();

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
 *
 * 优先级：
 *   1. NEXT_PUBLIC_APP_URL（手动配置，Production 推荐用 https://www.seeo.asia）
 *   2. VERCEL_URL（Vercel 自动注入，Preview/Production 都有，格式 seeo-xxx.vercel.app）
 *   3. 都缺失时返回相对路径（本地开发环境）
 *
 * 必须返回完整 URL（带 https://），否则耀立支付页会把相对路径当成自己域名下的路径，
 * 导致支付完成后跳转到 https://www.yaolipay.com/payment/result → 404
 */
export function getReturnUrl(): string {
  const path = "/payment/result";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (appUrl) {
    return `${appUrl.replace(/\/$/, "")}${path}`;
  }
  const vercelUrl = (process.env.VERCEL_URL ?? "").trim();
  if (vercelUrl) {
    // VERCEL_URL 格式可能是 "seeo-xxx.vercel.app" 或 "seeo-xxx.vercel.app:443"
    // 确保带 https:// 前缀
    const withProto = vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
    return `${withProto.replace(/\/$/, "").replace(/:443$/, "")}${path}`;
  }
  // 本地开发：返回相对路径（浏览器同源跳转）
  return path;
}

/** 默认使用 web 方式调用（自动返回二维码/跳转 URL） */
export const DEFAULT_PAY_METHOD: PayMethod = "web";

/** 校验支付方式是否合法 */
export function isValidPaymentChannel(value: unknown): value is PaymentChannel {
  return value === "alipay" || value === "wxpay";
}
