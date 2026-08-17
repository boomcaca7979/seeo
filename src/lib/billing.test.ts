// ===== Billing 商业化回归测试 =====
// 覆盖：PLAN_PRICING 价格表、Preview 测试价格隔离、误配置拦截、金额格式化
//
// 安全目标：
//   - Production 永远不会进入测试金额
//   - 测试金额仅在三重条件（preview + 开关 + 合法值）全满足时生效

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("PLAN_PRICING 服务端权威价格表", () => {
  it("lite：990 分 / 30 天 / CNY", async () => {
    const { PLAN_PRICING } = await import("@/lib/billing");
    expect(PLAN_PRICING.lite).toEqual({
      amountCents: 990,
      currency: "CNY",
      periodDays: 30,
    });
  });

  it("pro：2990 分 / 30 天 / CNY", async () => {
    const { PLAN_PRICING } = await import("@/lib/billing");
    expect(PLAN_PRICING.pro).toEqual({
      amountCents: 2990,
      currency: "CNY",
      periodDays: 30,
    });
  });
});

describe("getEffectivePaymentAmountCents 测试金额隔离", () => {
  const ENV_KEYS = ["VERCEL_ENV", "PAYMENT_TEST_MODE", "PAYMENT_TEST_AMOUNT_CENTS"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("Production：即使误配置全部测试开关，也返回正常价格", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PAYMENT_TEST_MODE = "true";
    process.env.PAYMENT_TEST_AMOUNT_CENTS = "1";
    const { getEffectivePaymentAmountCents } = await import("@/lib/billing");
    expect(getEffectivePaymentAmountCents("lite")).toBe(990);
    expect(getEffectivePaymentAmountCents("pro")).toBe(2990);
  });

  it("Preview + 测试开关 + 合法金额 → 返回 1 分（¥0.01）", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYMENT_TEST_MODE = "true";
    process.env.PAYMENT_TEST_AMOUNT_CENTS = "1";
    const { getEffectivePaymentAmountCents } = await import("@/lib/billing");
    expect(getEffectivePaymentAmountCents("lite")).toBe(1);
    expect(getEffectivePaymentAmountCents("pro")).toBe(1);
  });

  it("Preview 但未开启测试开关 → 正常价格", async () => {
    process.env.VERCEL_ENV = "preview";
    const { getEffectivePaymentAmountCents } = await import("@/lib/billing");
    expect(getEffectivePaymentAmountCents("lite")).toBe(990);
    expect(getEffectivePaymentAmountCents("pro")).toBe(2990);
  });

  it("Preview + 开关但测试金额非法（非 1）→ 正常价格", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYMENT_TEST_MODE = "true";
    process.env.PAYMENT_TEST_AMOUNT_CENTS = "100"; // 非法：只允许 1
    const { getEffectivePaymentAmountCents } = await import("@/lib/billing");
    expect(getEffectivePaymentAmountCents("lite")).toBe(990);
    expect(getEffectivePaymentAmountCents("pro")).toBe(2990);
  });

  it("development/local：不自动启用测试价格", async () => {
    process.env.VERCEL_ENV = "development";
    process.env.PAYMENT_TEST_MODE = "true";
    process.env.PAYMENT_TEST_AMOUNT_CENTS = "1";
    const { getEffectivePaymentAmountCents } = await import("@/lib/billing");
    expect(getEffectivePaymentAmountCents("lite")).toBe(990);
    expect(getEffectivePaymentAmountCents("pro")).toBe(2990);
  });
});

describe("isTestPaymentMisconfigured 误配置拦截", () => {
  const ENV_KEYS = ["VERCEL_ENV", "PAYMENT_TEST_MODE"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("Production 误开启测试开关 → 判定为误配置（create API 应 503 拒单）", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PAYMENT_TEST_MODE = "true";
    const { isTestPaymentMisconfigured } = await import("@/lib/billing");
    expect(isTestPaymentMisconfigured()).toBe(true);
  });

  it("Preview 开启测试开关 → 不是误配置", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYMENT_TEST_MODE = "true";
    const { isTestPaymentMisconfigured } = await import("@/lib/billing");
    expect(isTestPaymentMisconfigured()).toBe(false);
  });

  it("未开启测试开关 → 永远不是误配置", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.PAYMENT_TEST_MODE;
    const { isTestPaymentMisconfigured } = await import("@/lib/billing");
    expect(isTestPaymentMisconfigured()).toBe(false);
  });
});

describe("formatAmountYuan 金额格式化", () => {
  it("分转元，保留 2 位小数", async () => {
    const { formatAmountYuan } = await import("@/lib/billing");
    expect(formatAmountYuan(990)).toBe("9.90");
    expect(formatAmountYuan(2990)).toBe("29.90");
    expect(formatAmountYuan(1)).toBe("0.01");
  });
});

describe("isSubscriptionActive 订阅有效性", () => {
  it("active + 未到期 → 有效", async () => {
    const { isSubscriptionActive } = await import("@/lib/billing");
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isSubscriptionActive("active", future)).toBe(true);
  });

  it("active + 已到期 → 无效（effectivePlan 降为 free）", async () => {
    const { isSubscriptionActive } = await import("@/lib/billing");
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isSubscriptionActive("active", past)).toBe(false);
  });

  it("expired / canceled / inactive 状态 → 无效", async () => {
    const { isSubscriptionActive } = await import("@/lib/billing");
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isSubscriptionActive("expired", future)).toBe(false);
    expect(isSubscriptionActive("canceled", future)).toBe(false);
    expect(isSubscriptionActive("inactive", future)).toBe(false);
  });
});

describe("canPurchasePlan 套餐购买规则（CASE 1-6）", () => {
  it("CASE 1: free → lite 允许，类型 PURCHASE", async () => {
    const { canPurchasePlan } = await import("@/lib/billing");
    expect(canPurchasePlan("free", "lite")).toEqual({
      allowed: true,
      purchaseType: "PURCHASE",
    });
  });

  it("CASE 2: free → pro 允许，类型 PURCHASE", async () => {
    const { canPurchasePlan } = await import("@/lib/billing");
    expect(canPurchasePlan("free", "pro")).toEqual({
      allowed: true,
      purchaseType: "PURCHASE",
    });
  });

  it("CASE 3: lite → lite 允许，类型 RENEWAL", async () => {
    const { canPurchasePlan } = await import("@/lib/billing");
    expect(canPurchasePlan("lite", "lite")).toEqual({
      allowed: true,
      purchaseType: "RENEWAL",
    });
  });

  it("CASE 4: lite → pro 允许，类型 UPGRADE", async () => {
    const { canPurchasePlan } = await import("@/lib/billing");
    expect(canPurchasePlan("lite", "pro")).toEqual({
      allowed: true,
      purchaseType: "UPGRADE",
    });
  });

  it("CASE 5: pro → pro 允许，类型 RENEWAL", async () => {
    const { canPurchasePlan } = await import("@/lib/billing");
    expect(canPurchasePlan("pro", "pro")).toEqual({
      allowed: true,
      purchaseType: "RENEWAL",
    });
  });

  it("CASE 6: pro → lite 必须拒绝，错误码 PLAN_DOWNGRADE_NOT_ALLOWED", async () => {
    const { canPurchasePlan } = await import("@/lib/billing");
    const result = canPurchasePlan("pro", "lite");
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("PLAN_DOWNGRADE_NOT_ALLOWED");
    expect(result.purchaseType).toBeUndefined();
  });
});
