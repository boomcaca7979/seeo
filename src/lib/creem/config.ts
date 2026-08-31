// ===== Creem 支付配置 =====
// 环境变量（仅服务端，不带 NEXT_PUBLIC_ 前缀）：
//   CREEM_API_KEY        Creem API Key（test/live 两套，不互通）
//   CREEM_WEBHOOK_SECRET Webhook 签名密钥（Developers > Webhook 页面）
//   CREEM_API_MODE       test | live（默认 test；Creem 店铺审核通过前只能用 test）
//
// Base URL（官方文档）：
//   live: https://api.creem.io/v1
//   test: https://test-api.creem.io/v1
//
// 安全要求：
//   - secret 只存在环境变量，不得写入 Git / 前端代码
//   - Product ID 是非敏感常量，允许服务端硬编码

export interface CreemConfig {
  apiKey: string;
  /** API base URL（含 /v1，末尾不带斜杠） */
  apiBase: string;
  /** test | live */
  mode: "test" | "live";
}

/**
 * Creem 产品 ID（服务端固定映射，前端不可传 Product ID）
 * 注意：Creem 的 test / live 是两套独立数据，产品 ID 不互通，
 * 必须按 CREEM_API_MODE 选择对应环境的产品映射。
 */
const CREEM_PRODUCT_IDS_LIVE = {
  lite: "prod_1lm34wwaIsim962h2ibpmx",
  pro: "prod_1uiX5hulyy4gpKIATnl1As",
  custom: "prod_3bBTaiAZHIEICNYuJPYu2r",
} as const;

const CREEM_PRODUCT_IDS_TEST = {
  lite: "prod_4kaNaABVOIgWfY62MkbnTf",
  pro: "prod_3vqPHkGoGs1HmwYkfUbZCu",
  custom: "prod_3WjbqCM6SoKyPROytpuWIB",
} as const;

/** 按当前配置返回 plan → Product ID 映射（测试模式用测试产品） */
export function getCreemProductIds(
  mode: "test" | "live"
): Record<CreemCheckoutPlan, string> {
  return mode === "live" ? CREEM_PRODUCT_IDS_LIVE : CREEM_PRODUCT_IDS_TEST;
}

export type CreemCheckoutPlan = "lite" | "pro" | "custom";

export const CREEM_LIVE_API_BASE = "https://api.creem.io/v1";
export const CREEM_TEST_API_BASE = "https://test-api.creem.io/v1";

/**
 * 读取 Creem 配置；任一必填项缺失返回 null（调用方返回 503）
 */
export function getCreemConfig(): CreemConfig | null {
  const apiKey = (process.env.CREEM_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const mode =
    (process.env.CREEM_API_MODE ?? "").trim().toLowerCase() === "live"
      ? ("live" as const)
      : ("test" as const);
  return {
    apiKey,
    mode,
    apiBase: mode === "live" ? CREEM_LIVE_API_BASE : CREEM_TEST_API_BASE,
  };
}

/** Webhook secret（未配置返回空字符串，由调用方决定拒绝策略） */
export function getCreemWebhookSecret(): string {
  return (process.env.CREEM_WEBHOOK_SECRET ?? "").trim();
}
