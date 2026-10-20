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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("BUG-44：TIMEOUT 文案自带完整语义，不再把服务端中文原文插进用户可见句子", () => {
    const upstream = "抓取超时（30s）：http://127.0.0.1:3411/pricing";
    const zh = resolveApiErrorMessage({ code: "TIMEOUT", error: upstream }, "zh");
    const en = resolveApiErrorMessage({ code: "TIMEOUT", error: upstream }, "en");
    expect(zh).toBe("页面响应超时，请稍后重试。");
    expect(en).toBe("The page took too long to respond. Please try again.");
    expect(en).not.toContain("抓取超时");
  });

  it("BUG-44：HTTP_ERROR 的 {detail} 取语言中立 detail，不取服务端 error", () => {
    expect(resolveApiErrorMessage({ code: "HTTP_ERROR", error: "页面返回错误：HTTP 503", detail: "HTTP 503" }, "en")).toBe(
      "The page returned an error: HTTP 503"
    );
    expect(resolveApiErrorMessage({ code: "HTTP_ERROR", error: "页面返回错误：HTTP 503", detail: "HTTP 503" }, "zh")).toBe(
      "页面返回错误：HTTP 503"
    );
  });

  it("BUG-44：detail 与 error 均缺失时用双语兜底，不出现空冒号", () => {
    expect(resolveApiErrorMessage({ code: "HTTP_ERROR" }, "zh")).toBe("页面返回错误：暂时无法获取详细信息");
    expect(resolveApiErrorMessage({ code: "HTTP_ERROR" }, "en")).toBe("The page returned an error: no further details available");
  });

  it.each([
    "TIMEOUT",
    "INVALID_URL",
    "UNKNOWN",
    "NETWORK",
    "INVALID_URL_FORMAT",
    "INVALID_URL_SCHEME",
    "PRIVATE_HOST",
  ])("BUG-44：%s 双语齐备且不依赖 {detail} 回显原文", (code) => {
    const zh = resolveApiErrorMessage({ code, error: "URL 无效：禁止访问私有/保留 IP：127.0.0.1" }, "zh");
    const en = resolveApiErrorMessage({ code, error: "URL 无效：禁止访问私有/保留 IP：127.0.0.1" }, "en");
    expect(zh).not.toBe("URL 无效：禁止访问私有/保留 IP：127.0.0.1");
    expect(en).not.toContain("禁止访问");
    expect(en).not.toMatch(/[一-鿿]/);
    expect(zh).toMatch(/[一-鿿]/);
  });

  it("QUOTA_EXCEEDED：used/limit 缺省显示「–」而不是空括号", () => {
    expect(resolveApiErrorMessage({ code: "QUOTA_EXCEEDED" }, "zh")).toBe("本月 API 额度已用尽（–/–），下月 1 日自动重置");
  });

  it("QUOTA_EXCEEDED scope=daily：显示今日额度与次日重置，不冒充月度", () => {
    const zh = resolveApiErrorMessage({ code: "QUOTA_EXCEEDED", used: 3, limit: 3, scope: "daily" }, "zh");
    expect(zh).toBe("今日 API 额度已用尽（3/3），明日自动重置");
    const en = resolveApiErrorMessage({ code: "QUOTA_EXCEEDED", used: 3, limit: 3, scope: "daily" }, "en");
    expect(en).toBe("Daily API quota used up (3/3). Resets tomorrow.");
  });

  it("QUOTA_EXCEEDED scope=monthly：沿用月度模板", () => {
    const zh = resolveApiErrorMessage({ code: "QUOTA_EXCEEDED", used: 6, limit: 30, scope: "monthly" }, "zh");
    expect(zh).toBe("本月 API 额度已用尽（6/30），下月 1 日自动重置");
  });

  it("UPSTREAM_QUOTA：上游服务自身额度耗尽，与套餐配额区分", () => {
    const zh = resolveApiErrorMessage({ code: "UPSTREAM_QUOTA", error: "SerpApi 额度已耗尽" }, "zh");
    expect(zh).toBe("数据服务额度暂时用尽，请稍后再试");
    const en = resolveApiErrorMessage({ code: "UPSTREAM_QUOTA", error: "SerpApi quota exhausted" }, "en");
    expect(en).toBe("The data provider's quota is temporarily exhausted. Please try again later.");
  });

  it("BUG-40：INVALID_KEY 命中 catalog，不再回显上游报错原文", () => {
    const upstream = "SerpApi Key 无效：Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key";
    const zh = resolveApiErrorMessage({ code: "INVALID_KEY", error: upstream }, "zh");
    const en = resolveApiErrorMessage({ code: "INVALID_KEY", error: upstream }, "en");
    expect(zh).toBe("当前部署的搜索数据服务密钥无效，暂时无法返回结果。请稍后重试或联系支持。");
    expect(en).toBe("This deployment's search data provider key is not valid, so results are unavailable right now. Please try again later or contact support.");
    for (const msg of [zh, en]) {
      expect(msg).not.toContain("serpapi.com");
      expect(msg).not.toContain("Invalid API key");
    }
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

  it("BUG-40：INVALID_KEY（上游密钥无效）不弹升级窗，且不回显上游原文", () => {
    const r = handleBillingError(
      { code: "INVALID_KEY", error: "SerpApi Key 无效：Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key" },
      "查询失败"
    );
    expect(r.isBillingError).toBe(false);
    expect(r.message).toBe("当前部署的搜索数据服务密钥无效，暂时无法返回结果。请稍后重试或联系支持。");
    expect(triggerUpgradeModal).not.toHaveBeenCalled();
  });

  it("非 billing 无 code：fallback error", () => {
    const r = handleBillingError({ error: "任意旧错误" }, "操作失败");
    expect(r).toEqual({ isBillingError: false, message: "任意旧错误" });
  });

  it("每日额度耗尽：billing 错误触发 UpgradeModal，理由为今日口径（升级 Lite 确实解除日度限制）", () => {
    const r = handleBillingError(
      { code: "QUOTA_EXCEEDED", used: 3, limit: 3, scope: "daily", error: "今日SerpApi额度已用尽（3/3），明日自动重置" },
      "查询失败"
    );
    expect(r.isBillingError).toBe(true);
    expect(r.message).toBe("今日 API 额度已用尽（3/3），明日自动重置"); // zh cookie
    expect(triggerUpgradeModal).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3, used: 3 })
    );
  });

  it("上游服务额度耗尽（UPSTREAM_QUOTA）：不触发 UpgradeModal，不诱导升级", () => {
    const r = handleBillingError(
      { code: "UPSTREAM_QUOTA", error: "SerpApi 额度已耗尽：plan limit reached" },
      "查询失败"
    );
    expect(r.isBillingError).toBe(false);
    expect(r.message).toBe("数据服务额度暂时用尽，请稍后再试"); // zh cookie
    expect(triggerUpgradeModal).not.toHaveBeenCalled();
  });
});

describe("keyword 数量上限的弹窗口径（与 SerpApi 日/月额度严格分开）", () => {
  beforeEach(() => {
    vi.mocked(triggerUpgradeModal).mockClear();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: { cookie: "NEXT_LOCALE=zh" },
    });
  });

  const firstCall = () => vi.mocked(triggerUpgradeModal).mock.calls[0]?.[0];

  it("KEYWORD_LIMIT_REACHED：used/limit 转成分列的 keywordQuota，不再留下单行比例数据", () => {
    handleBillingError(
      { code: "KEYWORD_LIMIT_REACHED", plan: "free", limit: 3, used: 24, message: "x" },
      "添加失败"
    );
    const call = firstCall();
    expect(call?.keywordQuota).toEqual({ total: 24, limit: 3 });
    // 通用「用量」行依赖顶层 used/limit；关键词口径必须不带它们，否则两种语义会同时出现
    expect(call?.used).toBeUndefined();
    expect(call?.limit).toBeUndefined();
    expect(call?.currentPlan).toBe("free");
    expect(call?.reason).toBe("当前套餐（free）追踪关键词上限为 3，请升级套餐");
  });

  it("KEYWORD_LIMIT_REACHED 响应无 used（旧/异常响应）：不猜数字，保持通用口径", () => {
    handleBillingError({ code: "KEYWORD_LIMIT_REACHED", plan: "free", limit: 3 }, "添加失败");
    const call = firstCall();
    expect(call?.keywordQuota).toBeUndefined();
    expect(call?.limit).toBe(3);
    expect(call?.used).toBeUndefined();
  });

  it("SerpApi 每日额度：保留 used/limit，绝不套用关键词文案", () => {
    handleBillingError({ code: "QUOTA_EXCEEDED", scope: "daily", plan: "free", used: 3, limit: 3 }, "查询失败");
    const call = firstCall();
    expect(call?.keywordQuota).toBeUndefined();
    expect(call?.used).toBe(3);
    expect(call?.limit).toBe(3);
  });

  it("SerpApi 每月配额：保留 used/limit，绝不套用关键词文案", () => {
    handleBillingError({ code: "QUOTA_EXCEEDED", scope: "monthly", plan: "lite", used: 30, limit: 30 }, "查询失败");
    const call = firstCall();
    expect(call?.keywordQuota).toBeUndefined();
    expect(call?.used).toBe(30);
    expect(call?.limit).toBe(30);
    expect(call?.currentPlan).toBe("lite");
  });

  it("项目数量上限：保留通用 used/limit 单行口径", () => {
    handleBillingError({ code: "PROJECT_LIMIT_REACHED", plan: "free", used: 3, limit: 3 }, "创建失败");
    const call = firstCall();
    expect(call?.keywordQuota).toBeUndefined();
    expect(call?.used).toBe(3);
    expect(call?.limit).toBe(3);
  });
});

describe("isBillingError", () => {
  it("billing code 识别", () => {
    expect(isBillingError({ code: "QUOTA_EXCEEDED" })).toBe(true);
    expect(isBillingError({ code: "KEYWORD_GROUP_LIMIT_REACHED" })).toBe(true);
  });

  it("非 billing code 不识别", () => {
    expect(isBillingError({ code: "PROJECT_NOT_FOUND" })).toBe(false);
    expect(isBillingError({ code: "UPSTREAM_QUOTA" })).toBe(false);
    expect(isBillingError({})).toBe(false);
  });
});

// ===== BUG-38：Pro 专属动作被后端 403 拒绝后没有升级出口 =====
// 实测（t11/i15-zh / t11/i15-en，:3411 demo=free，/app/settings → 自动化）：
//   点击「清理过期缓存」→ POST /api/cache/cleanup 403 → toast「需要 Pro 套餐权限才能执行该操作」
//   modal: null —— 只有一句拒绝，没有升级入口；而应用内其它付费墙都会弹 UpgradeModal。
describe("BUG-38：PLAN_REQUIRED 走升级出口", () => {
  beforeEach(() => {
    vi.mocked(triggerUpgradeModal).mockClear();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: { cookie: "NEXT_LOCALE=en" },
    });
  });

  it("PLAN_REQUIRED 识别为 billing 错误（与 FEATURE_NOT_AVAILABLE 同类）", () => {
    expect(isBillingError({ code: "PLAN_REQUIRED" })).toBe(true);
  });

  it("触发 UpgradeModal，并带上后端回传的真实当前套餐", () => {
    const r = handleBillingError(
      { code: "PLAN_REQUIRED", error: "需要 Pro 套餐权限才能执行缓存清理", plan: "free" },
      "清理失败"
    );
    expect(r.isBillingError).toBe(true);
    expect(r.message).toBe("This action requires the Pro plan.");
    expect(triggerUpgradeModal).toHaveBeenCalledWith(expect.objectContaining({ currentPlan: "free", reason: r.message }));
  });

  it("响应缺 plan 时不崩，按 free 兜底；且无 used/limit 时不伪造用量", () => {
    const r = handleBillingError({ code: "PLAN_REQUIRED" }, "清理失败");
    expect(r.isBillingError).toBe(true);
    expect(triggerUpgradeModal).toHaveBeenCalledWith(
      expect.objectContaining({ currentPlan: "free", used: undefined, limit: undefined })
    );
  });

  it("BUG-38b：requiredPlan 透传，推荐套餐必须是能解锁该动作的那一档（而不是默认升一级）", () => {
    handleBillingError({ code: "PLAN_REQUIRED", plan: "free", requiredPlan: "pro" }, "清理失败");
    expect(triggerUpgradeModal).toHaveBeenCalledWith(expect.objectContaining({ requiredPlan: "pro" }));
    // 未回传 requiredPlan 的旧响应：不注入该字段，保持「升一级」原行为
    vi.mocked(triggerUpgradeModal).mockClear();
    handleBillingError({ code: "PROJECT_LIMIT_REACHED", plan: "free", limit: 3 }, "创建失败");
    expect(vi.mocked(triggerUpgradeModal).mock.calls[0][0]).not.toHaveProperty("requiredPlan");
  });

  it("后端契约：缓存清理 403 必须回传 plan 与 requiredPlan，且仍是服务端拒绝", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cache/cleanup/route.ts"),
      "utf8"
    );
    expect(route).toContain('code: "PLAN_REQUIRED"');
    expect(route).toContain("plan: auth.plan");
    expect(route).toContain('requiredPlan: "pro"');
    // 后端保护不能被前端化掉：仍须是 403
    expect(route).toContain('{ status: 403 }');
  });
});
