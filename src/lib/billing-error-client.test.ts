// ===== Phase 4：billing-error-client locale 感知测试 =====
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock UpgradeModal（避免引入 React 组件链）
vi.mock("@/components/billing/UpgradeModal", () => ({
  triggerUpgradeModal: vi.fn(),
}));

import {
  handleBillingError,
  isBillingError,
  resolveApiErrorMessage,
  readUiLocale,
} from "./billing-error-client";
import { triggerUpgradeModal } from "@/components/billing/UpgradeModal";

describe("resolveApiErrorMessage", () => {
  it("EN locale：code 命中 catalog 返回英文", () => {
    const msg = resolveApiErrorMessage({ code: "INVALID_DOMAIN", error: "域名格式无效，如 example.com" }, "en");
    expect(msg).toBe("Invalid domain format, e.g. example.com");
  });

  it("ZH locale：code 命中 catalog 返回中文", () => {
    const msg = resolveApiErrorMessage({ code: "INVALID_DOMAIN", error: "域名格式无效，如 example.com" }, "zh");
    expect(msg).toBe("域名格式无效，如 example.com");
  });

  it("AUTH_REQUIRED EN/ZH", () => {
    expect(resolveApiErrorMessage({ code: "AUTH_REQUIRED", error: "Unauthorized" }, "en")).toBe("Please log in to continue.");
    expect(resolveApiErrorMessage({ code: "AUTH_REQUIRED", error: "Unauthorized" }, "zh")).toBe("请登录后继续操作。");
  });

  it("billing QUOTA_EXCEEDED 插值 used/limit", () => {
    const en = resolveApiErrorMessage({ code: "QUOTA_EXCEEDED", used: 5, limit: 5 }, "en");
    expect(en).toBe("Monthly API quota exhausted (5/5). Resets on the 1st of next month.");
    const zh = resolveApiErrorMessage({ code: "QUOTA_EXCEEDED", used: 5, limit: 5 }, "zh");
    expect(zh).toBe("本月 API 额度已用尽（5/5），下月 1 日自动重置");
  });

  it("FEATURE_NOT_AVAILABLE 插值 plan/feature（EN 用友好 feature 名）", () => {
    const en = resolveApiErrorMessage({ code: "FEATURE_NOT_AVAILABLE", plan: "free", feature: "pdf_export" }, "en");
    expect(en).toBe("Your current plan (free) does not include this feature: PDF export.");
    const zh = resolveApiErrorMessage({ code: "FEATURE_NOT_AVAILABLE", plan: "free", feature: "pdf_export" }, "zh");
    expect(zh).toBe("当前套餐（free）不支持该功能：pdf_export");
  });

  it("无 code 旧响应 fallback 到 error", () => {
    expect(resolveApiErrorMessage({ error: "旧错误" }, "en", "fallback")).toBe("旧错误");
  });

  it("未知 code fallback 到 error", () => {
    expect(resolveApiErrorMessage({ code: "SOMETHING_NEW", error: "新错误" }, "en")).toBe("新错误");
  });

  it("无 error 无 code fallback 到 fallbackMessage", () => {
    expect(resolveApiErrorMessage({}, "en", "默认文案")).toBe("默认文案");
  });
});

describe("readUiLocale", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it("非浏览器环境默认 en", () => {
    expect(readUiLocale()).toBe("en");
  });

  it("NEXT_LOCALE=zh cookie → zh", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: { cookie: "other=1; NEXT_LOCALE=zh; x=2" },
    });
    expect(readUiLocale()).toBe("zh");
  });

  it("NEXT_LOCALE=en cookie → en", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: { cookie: "NEXT_LOCALE=en" },
    });
    expect(readUiLocale()).toBe("en");
  });
});

describe("handleBillingError", () => {
  beforeEach(() => {
    vi.mocked(triggerUpgradeModal).mockClear();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: { cookie: "NEXT_LOCALE=zh" },
    });
  });

  it("billing 错误：触发 UpgradeModal 且 message 按 locale 翻译", () => {
    const r = handleBillingError(
      { code: "PROJECT_LIMIT_REACHED", message: "当前套餐（free）项目上限为 3，请升级套餐", plan: "free", limit: 3 },
      "创建失败"
    );
    expect(r.isBillingError).toBe(true);
    expect(r.message).toBe("当前套餐（free）项目上限为 3，请升级套餐");
    expect(triggerUpgradeModal).toHaveBeenCalledWith(
      expect.objectContaining({ currentPlan: "free", limit: 3 })
    );
  });

  it("EN cookie 下 billing 错误显示英文", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: { cookie: "NEXT_LOCALE=en" },
    });
    const r = handleBillingError(
      { code: "PROJECT_LIMIT_REACHED", message: "当前套餐（free）项目上限为 3，请升级套餐", plan: "free", limit: 3 },
      "Create failed"
    );
    expect(r.isBillingError).toBe(true);
    expect(r.message).toBe("Your current plan (free) allows at most 3 projects. Please upgrade.");
  });

  it("非 billing 错误：不触发 UpgradeModal，按 code 翻译", () => {
    const r = handleBillingError({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, "操作失败");
    expect(r.isBillingError).toBe(false);
    expect(r.message).toBe("未找到该项目"); // zh cookie
    expect(triggerUpgradeModal).not.toHaveBeenCalled();
  });

  it("非 billing 无 code：fallback error", () => {
    const r = handleBillingError({ error: "任意旧错误" }, "操作失败");
    expect(r).toEqual({ isBillingError: false, message: "任意旧错误" });
  });
});

describe("isBillingError", () => {
  it("billing code 识别", () => {
    expect(isBillingError({ code: "QUOTA_EXCEEDED" })).toBe(true);
    expect(isBillingError({ code: "KEYWORD_GROUP_LIMIT_REACHED" })).toBe(true);
  });

  it("非 billing code 不识别", () => {
    expect(isBillingError({ code: "PROJECT_NOT_FOUND" })).toBe(false);
    expect(isBillingError({})).toBe(false);
  });
});
