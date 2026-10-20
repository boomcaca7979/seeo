// ===== 支付结果页接线契约（BUG-02）=====
// 状态机本身的行为由 status-monitor.test.ts 覆盖；本文件只锁定页面接线：
// 页面必须走真实 API 与状态机、必须清理监听、必须为每种终止状态提供动作，
// 且不得把 401/5xx 当作「支付处理中」继续轮询。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const EN = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../../messages/en.json", import.meta.url)), "utf-8")
) as { paymentResult: Record<string, string> };
const ZH = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../../messages/zh.json", import.meta.url)), "utf-8")
) as { paymentResult: Record<string, string> };

/** 页面用到的 paymentResult 文案键（t("…") 字面量） */
function usedKeys(src: string): string[] {
  return [...src.matchAll(/\bt\("([a-zA-Z]+)"/g)].map((m) => m[1]);
}

describe("页面接线：真实 API + 状态机", () => {
  it("只通过状态机读取 /api/payment/creem/status，页面内不再自行写死判定", () => {
    expect(PAGE).toContain('from "./status-monitor"');
    expect(PAGE).toContain("deriveResultView");
    expect(PAGE).toContain("PaymentStatusMonitor");
    // 真实的支付状态字段判定发生在状态机里，页面不再读 res.ok / 不再自行推断
    expect(PAGE).not.toMatch(/res\.ok|payment_status|paymentStatus\s*===\s*"paid"/);
    expect(PAGE).toContain("canRetry(view)");
  });

  it("URL 缺少 order 参数时不发起任何请求，直接按无效订单展示", () => {
    expect(PAGE).toMatch(/if \(!orderNo\) return;/);
    expect(PAGE).toContain('orderNo ? deriveResultView(state) : "invalidOrder"');
  });

  it("卸载时 dispose（清定时器 + 中止在途请求），并清理 ref", () => {
    expect(PAGE).toMatch(/return \(\) => \{\s*monitor\.dispose\(\);/);
    expect(PAGE).toContain("monitorRef.current = null");
  });

  it("手动重试只调用 checkOnce（一次有界检查），不使用 setInterval 循环", () => {
    expect(PAGE).toContain("monitorRef.current?.checkOnce()");
    expect(PAGE).not.toContain("setInterval");
  });

  it("401 提供登录入口，并按登录页真实契约携带 redirect（保留订单号）", () => {
    expect(PAGE).toContain("/login?redirect=");
    expect(PAGE).toContain("encodeURIComponent");
    expect(PAGE).toContain("/payment/result?order=${orderNo ?? \"\"}");
    expect(PAGE).toContain('view === "authRequired"');
    expect(PAGE).toContain('t("loginAction")');
  });

  it("状态图标/文案全部来自文案表，不存在写死的中文提示", () => {
    const codeOnly = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const literals = codeOnly.match(/[\u4e00-\u9fff]+/g) ?? [];
    expect(literals, `页面残留硬编码文案：${literals.join(", ")}`).toEqual([]);
    expect(PAGE).toContain("<Navbar");
    expect(PAGE).toContain("<Footer");
  });
});

describe("状态 → 文案一一对应，且中英齐备", () => {
  const REQUIRED = [
    "pendingTitle",
    "pendingDesc",
    "paidTitle",
    "paidDesc",
    "failedTitle",
    "failedDesc",
    "refundedTitle",
    "refundedDesc",
    "notFoundTitle",
    "notFoundDesc",
    "processingTitle",
    "processingDesc",
    "timeoutTitle",
    "timeoutDesc",
    "authTitle",
    "authDesc",
    "forbiddenTitle",
    "forbiddenDesc",
    "serviceTitle",
    "serviceDesc",
    "retryAction",
    "loginAction",
    "polledTimes",
    "orderNo",
    "customService",
    "backPricing",
    "backApp",
    "webhookNote",
  ];

  it("页面用到的键在 en/zh 都存在且非空", () => {
    const used = [...new Set(usedKeys(PAGE))];
    expect(used.length).toBeGreaterThanOrEqual(15);
    for (const key of used) {
      expect(EN.paymentResult[key], `en 缺失 paymentResult.${key}`).toBeTruthy();
      expect(ZH.paymentResult[key], `zh 缺失 paymentResult.${key}`).toBeTruthy();
    }
  });

  it("新增终止状态文案齐备（不遗漏任何一种可展示状态）", () => {
    for (const key of REQUIRED) {
      expect(EN.paymentResult[key], `en 缺失 paymentResult.${key}`).toBeTruthy();
      expect(ZH.paymentResult[key], `zh 缺失 paymentResult.${key}`).toBeTruthy();
      // 中英文键集合必须完全一致
      expect(Object.keys(EN.paymentResult).sort()).toEqual(Object.keys(ZH.paymentResult).sort());
    }
  });

  it("查询服务失败与支付失败是分开的文案，不会把 5xx 说成付款失败", () => {
    expect(EN.paymentResult.serviceTitle).not.toMatch(/payment failed/i);
    expect(EN.paymentResult.timeoutTitle).not.toMatch(/payment failed/i);
    expect(ZH.paymentResult.timeoutDesc).toContain("不代表支付失败");
    expect(ZH.paymentResult.serviceDesc).toContain("不受影响");
  });

  it("polledTimes 使用 ICU count 插值（数字来自真实查询次数）", () => {
    expect(EN.paymentResult.polledTimes).toContain("{count}");
    expect(ZH.paymentResult.polledTimes).toContain("{count}");
    expect(PAGE).toContain('t("polledTimes", { count: state.polls })');
  });
});
