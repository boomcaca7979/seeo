// ===== /api/payment/creem/status 的可观察结果 =====
// 覆盖：身份失效 401 / 缺订单号 400 / 订单不存在 404 / 属于他人 403 / 依赖故障 503 / 正常 200。
// 全部使用 mock（不创建或修改真实订单、不接触支付凭据、不触发真实支付请求）：
// 关键是 503 与 404 必须分开——前端 status-monitor 把非 2xx 归为 serviceError，
// 显示「服务暂不可用，付款结果不受影响」，既不伪装成功也不谎称订单丢失。

import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
const lookup = vi.fn();

vi.mock("@/lib/auth", () => ({ requireAuth: () => auth() }));
vi.mock("@/lib/orders/service", () => ({
  getOrderByOutTradeNoForUser: (...args: unknown[]) => lookup(...args),
}));

import { GET } from "./route";

const OK_AUTH = { allowed: true, user: { id: "user-1" } };

function get(qs = "?order=SO-1") {
  return GET(new Request(`https://seeo.test/api/payment/creem/status${qs}`));
}

beforeEach(() => {
  auth.mockReset();
  lookup.mockReset();
  auth.mockResolvedValue(OK_AUTH);
});

describe("身份与参数", () => {
  it("会话失效（requireAuth 不放行）→ 401 AUTH_REQUIRED，且不查库", async () => {
    auth.mockResolvedValue({ allowed: false, user: null });
    const res = await get();
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("AUTH_REQUIRED");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("放行但没有 user.id → 同样 401，不能匿名查订单", async () => {
    auth.mockResolvedValue({ allowed: true, user: null });
    expect((await get()).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("缺 order 参数 → 400 MISSING_ORDER，且不查库", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("MISSING_ORDER");
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("订单查询三态 → HTTP 语义", () => {
  it("absent（订单确实不存在）→ 404 ORDER_NOT_FOUND", async () => {
    lookup.mockResolvedValue({ kind: "absent" });
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("ORDER_NOT_FOUND");
  });

  it("foreign（订单属于他人）→ 403，且不回传任何订单内容", async () => {
    lookup.mockResolvedValue({ kind: "foreign" });
    const res = await get();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("ORDER_FORBIDDEN");
    // 403 响应体只有一句「无权查看」：金额/套餐/状态/订阅周期一律不外泄
    expect(Object.keys(body).sort()).toEqual(["code", "error"]);
  });

  it("failure（数据库/依赖故障）→ 503 ORDER_QUERY_FAILED，绝不能塌成 404", async () => {
    lookup.mockResolvedValue({ kind: "failure", reason: "could not connect to host" });
    const res = await get();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("ORDER_QUERY_FAILED");
    expect(body.error).toBe("暂时无法确认订单状态");
  });

  it("found → 200 且只回传订单本身字段", async () => {
    lookup.mockResolvedValue({
      kind: "found",
      order: {
        out_trade_no: "SO-1",
        plan: "pro",
        amount: 99,
        currency: "CNY",
        payment_status: "paid",
        payment_channel: "creem",
        paid_at: "2026-10-17T00:00:00Z",
        period_end: null,
        user_id: "user-1",
        id: "internal-id",
      },
    });
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      outTradeNo: "SO-1",
      plan: "pro",
      amount: 99,
      currency: "CNY",
      paymentStatus: "paid",
      paymentChannel: "creem",
      paidAt: "2026-10-17T00:00:00Z",
      periodEnd: null,
    });
    expect(JSON.stringify(json)).not.toContain("internal-id");
  });

  it("查询始终带当前用户 id（用户隔离未被削弱）", async () => {
    lookup.mockResolvedValue({ kind: "absent" });
    await get("?order=SO-9");
    expect(lookup).toHaveBeenCalledWith("SO-9", "user-1");
  });
});

describe("非 2xx 在前端状态机里的落点", () => {
  it("classifyResponse(503) 归为 serviceError，不是 invalidOrder/authRequired", async () => {
    const { classifyResponse } = await import(
      "../../../../(default)/payment/result/status-monitor"
    );
    expect(classifyResponse(503, { error: "暂时无法确认订单状态", code: "ORDER_QUERY_FAILED" })).toEqual({
      kind: "serviceError",
    });
    expect(classifyResponse(404, { error: "订单不存在", code: "ORDER_NOT_FOUND" })).toEqual({
      kind: "invalidOrder",
    });
  });

  it("403 → forbidden（与「订单不存在」区分），支付结果页据此显示「无权查看」并可重试", async () => {
    const mod = await import("../../../../(default)/payment/result/status-monitor");
    expect(
      mod.classifyResponse(403, { error: "无权查看该订单", code: "ORDER_FORBIDDEN" })
    ).toEqual({ kind: "forbidden" });
    expect(
      mod.deriveResultView({ phase: "idle", outcome: { kind: "forbidden" }, polls: 1, exhausted: false })
    ).toBe("forbidden");
    // 会话仍有效时的 403 值得手动重试（登录态失效的 401 才禁止重试）
    expect(mod.canRetry("forbidden")).toBe(true);
    expect(mod.canRetry("authRequired")).toBe(false);
  });
});
