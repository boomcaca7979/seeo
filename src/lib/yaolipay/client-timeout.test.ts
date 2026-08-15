// P1: Yaolipay fetch timeout 测试
// 覆盖：AbortController 超时 → 明确业务错误

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock 耀立配置（避免依赖真实环境变量和 RSA 密钥）
vi.mock("@/lib/yaolipay/config", () => ({
  getYaolipayConfig: () => ({
    pid: 1000,
    privateKey: "dummy-private-key",
    publicKey: "dummy-public-key",
    apiBase: "https://yaolipay.test",
    notifyUrl: "https://seeo.test/api/payment/notify",
  }),
  DEFAULT_PAY_METHOD: "web" as const,
}));

// Mock 签名工具（避免真实 RSA 运算）
vi.mock("@/lib/yaolipay/sign", () => ({
  signParams: () => "dummy-sign",
  verifyParams: () => true,
  buildSignString: () => "",
  verifyWithPublicKey: () => true,
}));

import { createOrder, queryOrder, refundOrder } from "@/lib/yaolipay/client";

describe("P1: Yaolipay fetch timeout", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetch 抛出 AbortError 时返回明确超时错误", async () => {
    // 模拟 AbortController 触发后的 AbortError
    const abortError = new DOMException("The user aborted a request", "AbortError");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(abortError)));

    await expect(
      createOrder({
        type: "alipay",
        out_trade_no: "TEST001",
        name: "测试订单",
        money: "0.01",
        clientip: "127.0.0.1",
      })
    ).rejects.toThrow("耀立接口请求超时（15s）");
  });

  it("createOrder 在超时时返回明确业务错误", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(abortError)));

    await expect(
      createOrder({
        type: "alipay",
        out_trade_no: "TEST002",
        name: "测试下单",
        money: "9.90",
        clientip: "127.0.0.1",
      })
    ).rejects.toThrow(/耀立接口请求超时/);
  });

  it("queryOrder 在超时时返回明确业务错误", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(abortError)));

    await expect(
      queryOrder({ out_trade_no: "TEST003" })
    ).rejects.toThrow(/耀立接口请求超时/);
  });

  it("refundOrder 在超时时返回明确业务错误", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(abortError)));

    await expect(
      refundOrder({ out_trade_no: "TEST004", money: "0.01" })
    ).rejects.toThrow(/耀立接口请求超时/);
  });

  it("非 Abort 错误不包装为超时（透传原始错误）", async () => {
    const networkError = new Error("Network connection refused");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(networkError)));

    await expect(
      createOrder({
        type: "alipay",
        out_trade_no: "TEST005",
        name: "测试",
        money: "0.01",
        clientip: "127.0.0.1",
      })
    ).rejects.toThrow("Network connection refused");
  });

  it("HTTP 非 200 响应返回 HTTP 错误（非超时）", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      })
    ));

    await expect(
      createOrder({
        type: "alipay",
        out_trade_no: "TEST006",
        name: "测试",
        money: "0.01",
        clientip: "127.0.0.1",
      })
    ).rejects.toThrow(/耀立接口 HTTP 500/);
  });
});
