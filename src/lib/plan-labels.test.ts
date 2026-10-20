// ===== BUG-06 回归测试：订阅状态显示名（UI 层映射，不改业务判定）=====
// 根因：设置页把 API 原始枚举 usageData.subscriptionStatus 直接插进 currentStatusLine，
// 中文界面因此显示「状态：inactive」。
// 修复：plan-labels 增加 SUBSCRIPTION_STATUS_LABELS（键类型 = SubscriptionStatus，
// 枚举新增会编译期报错）+ subscriptionStatusLabel，未知值回退通用文案而非原始枚举。

import { describe, it, expect } from "vitest";
import {
  SUBSCRIPTION_STATUS_LABELS,
  UNKNOWN_SUBSCRIPTION_STATUS,
  subscriptionStatusLabel,
} from "@/lib/plan-labels";
import type { SubscriptionStatus } from "@/lib/auth";

// 取值域 = profiles.subscription_status 的 DB CHECK 六值（supabase/migrations/0003_subscription.sql）
const ALL: SubscriptionStatus[] = ["active", "trialing", "past_due", "canceled", "expired", "inactive"];

describe("BUG-06：subscriptionStatusLabel", () => {
  it("六个已知状态在 en/zh 都有非空且互不相同的文案", () => {
    for (const locale of ["en", "zh"] as const) {
      const labels = ALL.map((s) => subscriptionStatusLabel(s, locale));
      labels.forEach((l) => expect(l.length, `${locale} 标签非空`).toBeGreaterThan(0));
      expect(new Set(labels).size, `${locale} 标签互不重复`).toBe(ALL.length);
    }
  });

  it("用户可见文案不暴露原始枚举值", () => {
    for (const s of ALL) {
      // 大小写敏感的原文回显才算泄漏（en 的 "Active" 是正常英文状态词，不是枚举 token）
      expect(subscriptionStatusLabel(s, "zh")).not.toBe(s);
      expect(subscriptionStatusLabel(s, "en")).not.toBe(s);
      expect(subscriptionStatusLabel(s, "en")).not.toMatch(/_/);
      expect(subscriptionStatusLabel(s, "en")).not.toMatch(/^[a-z]+_[a-z]+$/);
    }
  });

  it("inactive ≠ canceled ≠ expired：未订阅 / 已取消 / 已到期 不合并成一条", () => {
    for (const locale of ["en", "zh"] as const) {
      const [inactive, canceled, expired] = ["inactive", "canceled", "expired"].map((s) =>
        subscriptionStatusLabel(s, locale)
      );
      expect(inactive).not.toBe(canceled);
      expect(inactive).not.toBe(expired);
      expect(canceled).not.toBe(expired);
    }
    // inactive 是注册默认态（从未订阅），文案不得宣称「已退订」这类过度推断
    expect(subscriptionStatusLabel("inactive", "zh")).not.toContain("退订");
    expect(subscriptionStatusLabel("inactive", "zh")).toBe("未订阅");
  });

  it("未知状态安全回退：返回通用文案，不回显原始值、不抛错、不为空", () => {
    for (const locale of ["en", "zh"] as const) {
      for (const weird of ["paused", "unpaid", "", "ACTIVE", "in active", "🙃"]) {
        const label = subscriptionStatusLabel(weird, locale);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toBe(weird);
        expect(label).toBe(UNKNOWN_SUBSCRIPTION_STATUS[locale]);
      }
    }
  });

  it("中英文含义一一对应（同一状态两种语言，不同状态不撞词）", () => {
    const en = Object.fromEntries(ALL.map((s) => [s, SUBSCRIPTION_STATUS_LABELS.en[s]]));
    const zh = Object.fromEntries(ALL.map((s) => [s, SUBSCRIPTION_STATUS_LABELS.zh[s]]));
    for (const s of ALL) {
      expect(Object.values(zh).indexOf(zh[s])).toBe(Object.values(en).indexOf(en[s]));
    }
    // 生效语义只有 active/trialing 两个（与 isSubscriptionActive 判定口径一致）
    expect(ALL.filter((s) => /生效|试用/.test(zh[s])).sort()).toEqual(["active", "trialing"].sort());
  });

  it("映射表键集合与 DB CHECK 六值完全一致（多一少一都不行）", () => {
    for (const locale of ["en", "zh"] as const) {
      expect(Object.keys(SUBSCRIPTION_STATUS_LABELS[locale]).sort()).toEqual([...ALL].sort());
    }
  });
});
