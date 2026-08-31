// ===== POST /api/payment/creem/create 测试 =====
// 覆盖：
//   - Lite / Pro / Custom 三个套餐成功创建 Checkout（Product ID 由服务端映射）
//   - 非法 plan → 400
//   - 金额篡改 / 前端传 Product ID → 一律忽略（服务端定价与映射决定）
//   - 未登录 → 401
//   - 降级购买 → 409
//   - Creem API 失败 → 502 且本地订单标记 failed

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const h = vi.hoisted(() => {
  const authState = {
    allowed: true,
    user: { id: "user-1", email: "u@example.com" } as { id: string; email: string } | null,
  };
  const billingState = { effectivePlan: "free" as string };
  const ordersState = {
    order: {
      id: "order-uuid-1",
      out_trade_no: "S20260831120000ABCDEF",
      plan: "lite",
      amount: 1.49,
      currency: "USD",
      payment_channel: "creem",
      payment_status: "pending",
      param: null,
    } as Record<string, unknown> | null,
    createError: null as string | null,
  };
  const creemCheckoutState = {
    result: { id: "ch_test_123", checkoutUrl: "https://test-checkout.creem.io/ch_test_123" },
    error: null as Error | null,
  };
  return { authState, billingState, ordersState, creemCheckoutState };
});

const { authState, billingState, ordersState, creemCheckoutState } = h;

vi.mock("@/lib/auth-config", () => ({ isAuthEnabled: true }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    allowed: authState.allowed,
    skip: false,
    user: authState.user,
    plan: "free",
    subscriptionStatus: "inactive",
    limits: {},
    error: undefined,
  })),
}));

vi.mock("@/lib/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing")>();
  return {
    ...actual,
    getUserPlan: vi.fn(async () => ({
      plan: billingState.effectivePlan,
      effectivePlan: billingState.effectivePlan,
      subscriptionStatus: "inactive",
      currentPeriodEnd: null,
    })),
  };
});

vi.mock("@/lib/orders/service", () => ({
  createPendingOrder: vi.fn(async (args: { plan: string }) => {
    if (ordersState.createError) {
      return { order: null, error: ordersState.createError };
    }
    return {
      order: {
        ...ordersState.order,
        plan: args.plan,
        amount:
          args.plan === "lite" ? 1.49 : args.plan === "pro" ? 4.49 : 89.99,
      },
    };
  }),
  markOrderFailed: vi.fn(async () => {}),
  parseOrderParam: vi.fn(() => ({})),
}));

vi.mock("@/lib/creem/client", () => ({
  createCreemCheckout: vi.fn(async () => {
    if (creemCheckoutState.error) throw creemCheckoutState.error;
    return creemCheckoutState.result;
  }),
  CreemApiError: class CreemApiError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  })),
}));

import { POST } from "./route";
import { createCreemCheckout } from "@/lib/creem/client";
import { createPendingOrder, markOrderFailed } from "@/lib/orders/service";
import { getCreemProductIds } from "@/lib/creem/config";

// 测试环境 CREEM_API_MODE=test，应使用 test 模式产品映射
const CREEM_PRODUCT_IDS = getCreemProductIds("test");

const mockCreateCheckout = vi.mocked(createCreemCheckout);
const mockCreatePending = vi.mocked(createPendingOrder);
const mockMarkFailed = vi.mocked(markOrderFailed);

function makeRequest(body: unknown): Request {
  return new Request("https://www.seeo.asia/api/payment/creem/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.allowed = true;
  authState.user = { id: "user-1", email: "u@example.com" };
  billingState.effectivePlan = "free";
  ordersState.order = {
    id: "order-uuid-1",
    out_trade_no: "S20260831120000ABCDEF",
    plan: "lite",
    amount: 1.49,
    currency: "USD",
    payment_channel: "creem",
    payment_status: "pending",
    param: null,
  };
  ordersState.createError = null;
  creemCheckoutState.result = {
    id: "ch_test_123",
    checkoutUrl: "https://test-checkout.creem.io/ch_test_123",
  };
  creemCheckoutState.error = null;
  process.env.CREEM_API_KEY = "test-api-key";
  process.env.CREEM_API_MODE = "test";
});

describe("POST /api/payment/creem/create", () => {
  it("Lite：创建 pending 订单并返回 Creem checkout URL", async () => {
    const res = await POST(makeRequest({ plan: "lite" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.checkoutUrl).toBe("https://test-checkout.creem.io/ch_test_123");

    expect(mockCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", plan: "lite", paymentChannel: "creem" })
    );
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: CREEM_PRODUCT_IDS.lite })
    );
    // metadata 包含订单匹配信息
    const call = mockCreateCheckout.mock.calls[0][1];
    expect(call.metadata).toMatchObject({
      out_trade_no: "S20260831120000ABCDEF",
      plan: "lite",
      user_id: "user-1",
    });
    // success_url 仅展示用，携带 SeeO 订单号
    expect(call.successUrl).toContain("/payment/result?order=S20260831120000ABCDEF");
  });

  it("Pro：使用服务端 Pro Product ID", async () => {
    const res = await POST(makeRequest({ plan: "pro" }));
    expect(res.status).toBe(200);
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: CREEM_PRODUCT_IDS.pro })
    );
  });

  it("Custom：使用服务端 Custom Product ID（one-time）", async () => {
    const res = await POST(makeRequest({ plan: "custom" }));
    expect(res.status).toBe(200);
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: CREEM_PRODUCT_IDS.custom })
    );
  });

  it("test / live 模式使用各自的 Product ID 映射（两套产品不互通）", async () => {
    // 默认 test 模式
    await POST(makeRequest({ plan: "lite" }));
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: getCreemProductIds("test").lite })
    );

    // 切到 live 模式：应使用 live 产品 ID
    mockCreateCheckout.mockClear();
    process.env.CREEM_API_MODE = "live";
    try {
      await POST(makeRequest({ plan: "lite" }));
      expect(mockCreateCheckout).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ productId: getCreemProductIds("live").lite })
      );
    } finally {
      process.env.CREEM_API_MODE = "test";
    }
  });

  it("非法 plan → 400，不创建订单", async () => {
    for (const plan of ["free", "enterprise", "", null, 42]) {
      const res = await POST(makeRequest({ plan }));
      expect(res.status).toBe(400);
    }
    expect(mockCreatePending).not.toHaveBeenCalled();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("金额篡改 / 前端传 Product ID → 全部忽略，以服务端为准", async () => {
    const res = await POST(
      makeRequest({
        plan: "pro",
        amount: 0.01, // 伪造金额
        amountCents: 1,
        currency: "CNY",
        product_id: "prod_evil", // 伪造 Product ID
        productId: "prod_evil2",
      })
    );
    expect(res.status).toBe(200);
    // Product ID 用服务端映射，绝不用前端值
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: CREEM_PRODUCT_IDS.pro })
    );
    // 金额由服务端定价表决定（createPendingOrder 内部读 PLAN_PRICING，
    // 请求体中的金额字段不会传入任何参数）
    const call = mockCreatePending.mock.calls[0][0];
    expect(call).not.toHaveProperty("amount");
  });

  it("未登录 → 401", async () => {
    authState.allowed = false;
    authState.user = null;
    const res = await POST(makeRequest({ plan: "lite" }));
    expect(res.status).toBe(401);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("Pro 用户购买 Lite（降级）→ 409", async () => {
    billingState.effectivePlan = "pro";
    const res = await POST(makeRequest({ plan: "lite" }));
    expect(res.status).toBe(409);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("CREEM_API_KEY 缺失 → 503", async () => {
    delete process.env.CREEM_API_KEY;
    const res = await POST(makeRequest({ plan: "lite" }));
    expect(res.status).toBe(503);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("Creem 下单失败 → 502 且本地订单标记 failed", async () => {
    creemCheckoutState.error = new Error("Creem API 500");
    const res = await POST(makeRequest({ plan: "lite" }));
    expect(res.status).toBe(502);
    expect(mockMarkFailed).toHaveBeenCalledWith("S20260831120000ABCDEF");
  });

  it("本地订单创建失败 → 500", async () => {
    ordersState.createError = "数据库插入失败";
    const res = await POST(makeRequest({ plan: "lite" }));
    expect(res.status).toBe(500);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });
});
