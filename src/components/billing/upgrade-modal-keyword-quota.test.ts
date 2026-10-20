// ===== 升级弹窗「关键词额度」口径契约 =====
// 根因：位置追踪页面主体已分列展示（当前项目 / 账号总计 / 套餐上限），
// 但弹窗仍把两个不同含义的数字拼成一行「用量：24 / 3」，用户会当成单一指标、
// 甚至误读成 SerpApi 的 API 用量。
// 契约：KEYWORD_LIMIT_REACHED 走 keywordQuota 分列展示（超出时才显示超出量）；
// 其余 code（SerpApi 每日/每月额度、项目数、竞品数、分组数）保持原通用单行口径。
// 测试框架限制：无 @testing-library/react，按仓库惯例采用「源码契约断言」。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PlanLimitError, QuotaExceededError } from "@/lib/errors/billing-errors";

const MODAL_SRC = readFileSync(fileURLToPath(new URL("./UpgradeModal.tsx", import.meta.url)), "utf-8");
const PT_SRC = readFileSync(
  fileURLToPath(new URL("../../app/(default)/(dashboard)/app/position-tracking/page.tsx", import.meta.url)),
  "utf-8"
);
const TRACKING_API_SRC = readFileSync(
  fileURLToPath(new URL("../../app/api/tracking/route.ts", import.meta.url)),
  "utf-8"
);
const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../messages/zh.json", import.meta.url)), "utf-8"));

const upgradeKeys = Object.keys(EN.dashboard.upgrade as Record<string, string>);

describe("UpgradeModal 关键词额度分列展示", () => {
  it("state 携带 keywordQuota（total = 账号总数，limit = 套餐上限），triggerUpgradeModal 透传", () => {
    expect(MODAL_SRC).toMatch(/keywordQuota\?: \{ total: number; limit: number \};/);
    expect(MODAL_SRC).toMatch(/const \{ open, currentPlan, requiredPlan, reason, feature, limit, used, keywordQuota \} = state;/);
  });

  it("关键词分支渲染三行独立项目：账号总数 / 套餐上限 / 共享说明", () => {
    for (const key of ["keywordUsageTotal", "keywordUsageLimit", "keywordUsageShared"]) {
      expect(MODAL_SRC).toContain(`t("${key}")`);
    }
    expect(MODAL_SRC).toMatch(
      /\{formatNumber\(keywordQuota\.total, locale\)\}/,
    );
    expect(MODAL_SRC).toMatch(
      /\{formatNumber\(keywordQuota\.limit, locale\)\}/,
    );
  });

  it("超出量只在真正超限时出现，数字由 total - limit 现算而不是写死", () => {
    expect(MODAL_SRC).toMatch(/\{keywordQuota\.total > keywordQuota\.limit && \(/);
    expect(MODAL_SRC).toMatch(/keywordQuota\.total - keywordQuota\.limit/);
    expect(MODAL_SRC).toMatch(/t\("keywordUsageOver",/);
  });

  it("关键词分支与通用「用量」单行互斥：非关键词口径仍走 t(\"usage\", { used, limit })", () => {
    expect(MODAL_SRC).toMatch(/\{keywordQuota \? \(/);
    expect(MODAL_SRC).toMatch(
      /\{t\("usage", \{ used: formatNumber\(used, locale\), limit: formatNumber\(limit, locale\) \}\)\}/,
    );
  });

  it("既有升级原因 / 套餐推荐 / 升级 CTA / 关闭逻辑保留（只改额度展示）", () => {
    expect(MODAL_SRC).toMatch(/t\("reason"\)/);
    expect(MODAL_SRC).toMatch(/requiredPlan \?\? getNextPlan\(currentPlan\)/);
    expect(MODAL_SRC).toMatch(/t\("recommended"\)/);
    expect(MODAL_SRC).toMatch(/href="\/pricing"/);
    expect(MODAL_SRC).toMatch(/t\("later"\)/);
    // BUG-24：Escape 上移到共享 useDialogA11y（同时补 role=dialog / 焦点管理）。
    // 这里断言的是"Esc 仍可关"这一行为契约，不是当年的那行监听代码。
    expect(MODAL_SRC).toMatch(/useDialogA11y\(open, onClose\)/);
    expect(MODAL_SRC).toMatch(/role="dialog"/);
  });
});

describe("数字来源必须是真实数据，不写死", () => {
  it("页面手动打开弹窗：total 取 tracked.length、limit 取接口返回的 trackingLimit", () => {
    expect(PT_SRC).toMatch(
      /keywordQuota: \{ total: tracked\.length, limit: trackingLimit \?\? 0 \}/,
    );
    expect(PT_SRC).not.toMatch(/keywordQuota: \{ total: \d+, limit: \d+ \}/);
  });

  it("接口路径：KEYWORD_LIMIT_REACHED 带上账号真实关键词计数", () => {
    expect(TRACKING_API_SRC).toMatch(
      /new PlanLimitError\(\s*"追踪关键词",\s*auth\.plan,\s*trackingLimit,\s*"KEYWORD_LIMIT_REACHED",\s*count,?\s*\)/,
    );
  });

  it("PlanLimitError：只在调用方给出真实计数时序列化 used，否则字段缺席（前端不猜数字）", () => {
    const withUsed = new PlanLimitError("追踪关键词", "free", 3, "KEYWORD_LIMIT_REACHED", 24);
    expect(withUsed.toJSON()).toEqual({
      code: "KEYWORD_LIMIT_REACHED",
      message: withUsed.message,
      plan: "free",
      limit: 3,
      used: 24,
    });
    const withoutUsed = new PlanLimitError("项目", "free", 3, "PROJECT_LIMIT_REACHED");
    expect("used" in withoutUsed.toJSON()).toBe(false);
  });

  it("QuotaExceededError（SerpApi 每日/每月）序列化口径未被改动", () => {
    const daily = new QuotaExceededError(3, 3, "serpapi", "2026-10", "free", "daily");
    expect(daily.toJSON()).toMatchObject({ code: "QUOTA_EXCEEDED", used: 3, limit: 3, scope: "daily" });
    const monthly = new QuotaExceededError(30, 30, "serpapi", "2026-10", "lite");
    expect(monthly.toJSON()).toMatchObject({ code: "QUOTA_EXCEEDED", used: 30, limit: 30, scope: "monthly" });
  });
});

describe("dashboard.upgrade 双语齐备", () => {
  const keys = [
    "keywordUsageTotal",
    "keywordUsageLimit",
    "keywordUsageOverLabel",
    "keywordUsageOver",
    "keywordUsageShared",
  ];

  it("5 个新键 en/zh 均存在且非空", () => {
    for (const key of keys) {
      expect(upgradeKeys, `en missing ${key}`).toContain(key);
      expect((EN.dashboard.upgrade as Record<string, string>)[key].trim()).not.toBe("");
      expect((ZH.dashboard.upgrade as Record<string, string>)[key].trim()).not.toBe("");
    }
  });

  it("超出量模板使用 {count} 占位符，en/zh 一致", () => {
    expect(EN.dashboard.upgrade.keywordUsageOver).toContain("{count}");
    expect(ZH.dashboard.upgrade.keywordUsageOver).toContain("{count}");
  });

  it("共享口径说明与页面主体文案一致（避免两处说法不同）", () => {
    expect(EN.dashboard.upgrade.keywordUsageShared).toBe(EN.dashboard.positionTracking.planKeywordsSharedHint);
    expect(ZH.dashboard.upgrade.keywordUsageShared).toBe(ZH.dashboard.positionTracking.planKeywordsSharedHint);
  });
});
