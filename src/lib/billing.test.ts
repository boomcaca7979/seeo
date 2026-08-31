// ===== Billing 商业化回归测试 =====
// 覆盖：PLAN_PRICING 价格表（Creem USD）、订阅有效性、套餐购买规则
//
// 说明：旧 PAYMENT_TEST_MODE / 测试价格机制已随 Yaolipay 移除废弃，
// Creem 测试通过官方 Test Mode（test-api.creem.io + 测试卡）完成，
// 无需本地价格覆盖，相关测试一并删除。

import { describe, it, expect } from "vitest";

describe("PLAN_PRICING 服务端权威价格表（Creem USD）", () => {
  it("lite：149 分（$1.49）/ 30 天兜底 / USD", async () => {
    const { PLAN_PRICING } = await import("@/lib/billing");
    expect(PLAN_PRICING.lite).toEqual({
      amountCents: 149,
      currency: "USD",
      periodDays: 30,
    });
  });

  it("pro：449 分（$4.49）/ 30 天兜底 / USD", async () => {
    const { PLAN_PRICING } = await import("@/lib/billing");
    expect(PLAN_PRICING.pro).toEqual({
      amountCents: 449,
      currency: "USD",
      periodDays: 30,
    });
  });

  it("custom：8999 分（$89.99）/ 一次性（periodDays=0）/ USD", async () => {
    const { PLAN_PRICING } = await import("@/lib/billing");
    expect(PLAN_PRICING.custom).toEqual({
      amountCents: 8999,
      currency: "USD",
      periodDays: 0,
    });
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

describe("canPurchasePlan 套餐购买规则（CASE 1-7）", () => {
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

  it("CASE 7: 任意套餐（含 pro）→ custom 均允许（一次性服务）", async () => {
    const { canPurchasePlan } = await import("@/lib/billing");
    expect(canPurchasePlan("free", "custom")).toEqual({
      allowed: true,
      purchaseType: "PURCHASE",
    });
    expect(canPurchasePlan("pro", "custom")).toEqual({
      allowed: true,
      purchaseType: "PURCHASE",
    });
  });
});
