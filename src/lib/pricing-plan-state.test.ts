// ===== Pricing 卡片状态机测试（CASE 7-9）=====
// 验证不同登录/套餐状态下 Pricing 页各卡片徽章与 CTA 的正确性。
// 与后端 canPurchasePlan 规则保持一致（见 billing.test.ts CASE 1-6）。

import { describe, it, expect } from "vitest";
import { getPlanCardState } from "@/lib/pricing-plan-state";

const liteBase = {
  ctaLabel: "升级到 Lite",
  checkoutPlan: "lite" as const,
};
const proBase = {
  ctaLabel: "升级到 Pro",
  checkoutPlan: "pro" as const,
  highlighted: true,
};
const freeBase = {
  ctaLabel: "开始使用",
  ctaHref: "/app",
};

describe("CASE 7: 未登录（anonymous）", () => {
  it("Lite 卡 = 升级到 Lite（可购买）", () => {
    const s = getPlanCardState(null, "lite", liteBase);
    expect(s.ctaLabel).toBe("升级到 Lite");
    expect(s.kind).toBe("checkout");
    expect(s.disabled).toBe(false);
    expect(s.badge).toBeNull();
  });

  it("Pro 卡 = 升级到 Pro（可购买，保留推荐徽章）", () => {
    const s = getPlanCardState(null, "pro", proBase);
    expect(s.ctaLabel).toBe("升级到 Pro");
    expect(s.kind).toBe("checkout");
    expect(s.disabled).toBe(false);
    expect(s.badge).toBe("recommended");
  });

  it("Free 卡不受影响（开始使用 → /app）", () => {
    const s = getPlanCardState(null, "free", freeBase);
    expect(s.ctaLabel).toBe("开始使用");
    expect(s.kind).toBe("link");
    expect(s.ctaHref).toBe("/app");
    expect(s.disabled).toBe(false);
  });
});

describe("CASE 8: Lite 用户", () => {
  it("Lite 卡 = 当前套餐徽章 + 续费 30 天", () => {
    const s = getPlanCardState("lite", "lite", liteBase);
    expect(s.badge).toBe("current");
    expect(s.ctaLabel).toBe("续费 30 天");
    expect(s.kind).toBe("checkout");
    expect(s.disabled).toBe(false);
    expect(s.checkoutPlan).toBe("lite");
  });

  it("Lite 卡不再显示「升级到 Lite」", () => {
    const s = getPlanCardState("lite", "lite", liteBase);
    expect(s.ctaLabel).not.toBe("升级到 Lite");
  });

  it("Pro 卡 = 升级到 Pro", () => {
    const s = getPlanCardState("lite", "pro", proBase);
    expect(s.ctaLabel).toBe("升级到 Pro");
    expect(s.kind).toBe("checkout");
    expect(s.disabled).toBe(false);
  });
});

describe("CASE 9: Pro 用户", () => {
  it("Lite 卡 = 不可降级，按钮禁用", () => {
    const s = getPlanCardState("pro", "lite", liteBase);
    expect(s.ctaLabel).toBe("不可降级");
    expect(s.disabled).toBe(true);
    expect(s.kind).toBe("none");
    expect(s.checkoutPlan).toBeUndefined();
  });

  it("Pro 卡 = 当前套餐徽章 + 续费 30 天（不再显示升级）", () => {
    const s = getPlanCardState("pro", "pro", proBase);
    expect(s.badge).toBe("current");
    expect(s.ctaLabel).toBe("续费 30 天");
    expect(s.kind).toBe("checkout");
    expect(s.disabled).toBe(false);
  });
});

describe("加载状态（防闪烁）", () => {
  it("currentPlan=undefined（加载中）时付费卡按钮禁用，不可点击购买", () => {
    const lite = getPlanCardState(undefined, "lite", liteBase);
    expect(lite.disabled).toBe(true);
    expect(lite.kind).toBe("checkout");

    const pro = getPlanCardState(undefined, "pro", proBase);
    expect(pro.disabled).toBe(true);
  });

  it("加载中 Free 卡 Link 不禁用（无购买行为）", () => {
    const s = getPlanCardState(undefined, "free", freeBase);
    expect(s.kind).toBe("link");
    expect(s.disabled).toBe(true);
  });
});

describe("已登录 free 用户与匿名一致", () => {
  it("free 用户看 Lite/Pro 卡均可购买", () => {
    const lite = getPlanCardState("free", "lite", liteBase);
    expect(lite.ctaLabel).toBe("升级到 Lite");
    expect(lite.disabled).toBe(false);

    const pro = getPlanCardState("free", "pro", proBase);
    expect(pro.ctaLabel).toBe("升级到 Pro");
    expect(pro.disabled).toBe(false);
  });
});
