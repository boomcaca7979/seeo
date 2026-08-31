// ===== POST /api/payment/yaolipay/create 套餐权限校验测试 =====
// 验证后端 checkout 拦截规则（lightweight mocks，不连接任何真实服务）：
//   - Pro 用户直接构造请求购买 Lite → 400 PLAN_DOWNGRADE_NOT_ALLOWED
//   - free/lite 用户合法购买 → 通过校验并记录 purchaseType
//   - currentPlan 一律来自服务端 auth.plan，不信任请求体
//
// Mock 边界：
//   - @/lib/auth：requireAuthOrDemo 返回可控的 AuthResult（含服务端 plan）
//   - @/lib/yaolipay/config|client、@/lib/orders/service：拦截外部副作用
//   - @/lib/billing：保持真实（canPurchasePlan / PLAN_PRICING 为被测规则的一部分）

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(),
}));

vi.mock("@/lib/yaolipay/config", () => ({
  getYaolipayConfig: vi.fn(() => ({
    pid: 1001,
    privateKey: "mock-private-key",
    publicKey: "mock-public-key",
    apiBase: "https://www.yaolipay.com",
    notifyUrl: "https://www.seeo.asia/api/payment/yaolipay/notify",
  })),
  getReturnUrl: vi.fn(() => "https://www.seeo.asia/payment/result"),
  isValidPaymentChannel: vi.fn((c: unknown) => c === "alipay" || c === "wxpay"),
}));

vi.mock("@/lib/yaolipay/client", () => ({
  createOrder: vi.fn(async () => ({
    code: 0,
    trade_no: null,
    pay_type: "qrcode",
    pay_info: "mock-pay-info",
  })),
  queryOrder: vi.fn(async () => ({ code: 0, status: 0 })),
  refundOrder: vi.fn(async () => ({ code: 0 })),
}));

vi.mock("@/lib/yaolipay/sign", () => ({
  signParams: vi.fn(() => "mock-sign"),
  verifyParams: vi.fn(() => true),
  buildSignString: vi.fn(() => ""),
}));

vi.mock("@/lib/orders/service", () => ({
  createPendingOrder: vi.fn(async (args: { plan: string; purchaseType?: string }) => ({
    order: {
      id: "order-1",
      out_trade_no: "S20260817TEST01",
      plan: args.plan,
      param: args.purchaseType ? JSON.stringify({ purchase_type: args.purchaseType }) : null,
    },
  })),
}));

import { requireAuthOrDemo } from "@/lib/auth";
import { createPendingOrder } from "@/lib/orders/service";
import { POST } from "./route";

const mockAuth = vi.mocked(requireAuthOrDemo);
const mockCreatePending = vi.mocked(createPendingOrder);

function makeAuthResult(plan: "free" | "lite" | "pro") {
  return {
    user: { id: "user-1" },
    plan,
    subscriptionStatus: "active" as const,
    limits: {} as Record<string, never>,
    allowed: true,
    skip: false,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("https://www.seeo.asia/api/payment/yaolipay/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("后端降级拦截（绕过 UI 直接调用）", () => {
  it("Pro 用户购买 Lite → 400 + PLAN_DOWNGRADE_NOT_ALLOWED，不创建订单", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("pro") as never);

    const res = await POST(makeRequest({ plan: "lite", payment_channel: "alipay" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("PLAN_DOWNGRADE_NOT_ALLOWED");
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("请求体携带 currentPlan=free 伪字段不能绕过（服务端 plan=pro 仍拒绝）", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("pro") as never);

    const res = await POST(
      makeRequest({ plan: "lite", payment_channel: "alipay", currentPlan: "free" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("PLAN_DOWNGRADE_NOT_ALLOWED");
  });
});

describe("合法购买通过校验并记录 purchaseType", () => {
  it("free → lite：PURCHASE", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("free") as never);

    const res = await POST(makeRequest({ plan: "lite", payment_channel: "alipay" }));
    expect(res.status).toBe(200);
    expect(mockCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "lite", purchaseType: "PURCHASE" })
    );

    // 客户端表单直提模式：返回已签名参数而非服务端下单结果
    const json = await res.json();
    expect(json.data.pay_mode).toBe("form_submit");
    expect(json.data.submit_url).toBe("https://www.yaolipay.com/submit.php");
    expect(json.data.submit_method).toBe("POST");
    expect(json.data.params.sign).toBe("mock-sign");
    expect(json.data.params.sign_type).toBe("RSA");
    expect(json.data.params.out_trade_no).toBe("S20260817TEST01");
    expect(json.data.params.money).toBe("9.90");
    // 私钥绝不能出现在响应中
    expect(JSON.stringify(json)).not.toContain("mock-private-key");
  });

  it("free → pro：PURCHASE", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("free") as never);

    const res = await POST(makeRequest({ plan: "pro", payment_channel: "wxpay" }));
    expect(res.status).toBe(200);
    expect(mockCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "pro", purchaseType: "PURCHASE" })
    );
  });

  it("lite → lite：RENEWAL", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("lite") as never);

    const res = await POST(makeRequest({ plan: "lite", payment_channel: "alipay" }));
    expect(res.status).toBe(200);
    expect(mockCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "lite", purchaseType: "RENEWAL" })
    );
  });

  it("lite → pro：UPGRADE", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("lite") as never);

    const res = await POST(makeRequest({ plan: "pro", payment_channel: "alipay" }));
    expect(res.status).toBe(200);
    expect(mockCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "pro", purchaseType: "UPGRADE" })
    );
  });

  it("pro → pro：RENEWAL", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("pro") as never);

    const res = await POST(makeRequest({ plan: "pro", payment_channel: "wxpay" }));
    expect(res.status).toBe(200);
    expect(mockCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "pro", purchaseType: "RENEWAL" })
    );
  });
});

describe("鉴权与既有行为保持不变", () => {
  it("未登录 → 401", async () => {
    mockAuth.mockResolvedValue({
      user: null,
      plan: "free",
      subscriptionStatus: "inactive",
      limits: {} as Record<string, never>,
      allowed: false,
      skip: false,
      error: "Unauthorized",
    } as never);

    const res = await POST(makeRequest({ plan: "lite", payment_channel: "alipay" }));
    expect(res.status).toBe(401);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("非法 plan → 400（原有校验不受影响）", async () => {
    mockAuth.mockResolvedValue(makeAuthResult("free") as never);

    const res = await POST(makeRequest({ plan: "enterprise", payment_channel: "alipay" }));
    expect(res.status).toBe(400);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });
});
