// ===== Orders completeOrder 幂等回归测试 =====
// 覆盖：pending→paid 开通、重复调用幂等、refunded 不重复开通、
//       金额不匹配拒绝、并发条件 UPDATE 语义
//
// 全部使用内存 mock admin client，不触碰真实 Supabase / 不产生真实费用

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mock admin client ----

interface AdminState {
  /** getOrderByOutTradeNo 每次 select().single() 依次返回的订单（跨 admin 实例共享计数） */
  orderQueryResults: Array<Record<string, unknown> | null>;
  /** 下一次订单查询的索引（getAdminClient 每次调用新建实例，索引必须放 state） */
  orderQueryIndex: number;
  /** 条件 UPDATE（.update().eq().eq().select().single()）返回的数据；null = 未命中 */
  conditionalUpdateData: Record<string, unknown> | null;
  /** post-check（select("payment_status")）返回的状态 */
  postCheckStatus: string | null;
  /** rpc 返回 */
  extendResult: { data: unknown; error: unknown } | null;
  recomputeResult: { data: unknown; error: unknown } | null;
  /** 调用记录 */
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  conditionalUpdateCalls: number;
}

function makeAdmin(state: AdminState) {
  const singleOrder = async () => {
    const row =
      state.orderQueryIndex < state.orderQueryResults.length
        ? state.orderQueryResults[state.orderQueryIndex]
        : (state.orderQueryResults[state.orderQueryResults.length - 1] ?? null);
    state.orderQueryIndex += 1;
    return { data: row, error: row ? null : { message: "not found" } };
  };

  const conditionalSingle = async () => {
    state.conditionalUpdateCalls += 1;
    return {
      data: state.conditionalUpdateData,
      error: state.conditionalUpdateData ? null : { message: "concurrent update missed" },
    };
  };

  return {
    from(table: string) {
      if (table !== "orders") throw new Error(`unexpected table: ${table}`);
      return {
        select: (cols?: string) => ({
          eq: () => ({
            single:
              cols === "payment_status"
                ? async () => ({
                    data: state.postCheckStatus
                      ? { payment_status: state.postCheckStatus }
                      : null,
                    error: null,
                  })
                : singleOrder,
          }),
        }),
        update: () => ({
          eq: () => ({
            // 条件更新路径：.update().eq(out_trade_no).eq(payment_status).select().single()
            eq: () => ({
              select: () => ({ single: conditionalSingle }),
            }),
            // period_end 更新路径：.update().eq(out_trade_no) 直接 await（thenable）
            then: (
              resolve: (v: { data: null; error: null }) => void,
              reject: (e: unknown) => void
            ) => {
              Promise.resolve({ data: null, error: null }).then(resolve, reject);
            },
          }),
        }),
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      if (fn === "extend_membership") {
        return state.extendResult ?? { data: null, error: null };
      }
      if (fn === "recompute_membership_after_refund") {
        return state.recomputeResult ?? { data: null, error: null };
      }
      return { data: null, error: null };
    },
  };
}

let state: AdminState;

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => makeAdmin(state),
}));

import {
  completeOrder,
  handleRefundSuccess,
  amountsMatch,
} from "@/lib/orders/service";

function pendingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    user_id: "u1",
    out_trade_no: "S20260815000001TEST01",
    trade_no: null,
    api_trade_no: null,
    plan: "lite",
    amount: 9.9,
    currency: "CNY",
    payment_channel: "alipay",
    payment_status: "pending",
    paid_at: null,
    refund_status: null,
    refund_amount: null,
    refunded_at: null,
    period_type: "30d",
    period_end: null,
    clientip: "127.0.0.1",
    param: null,
    created_at: "2026-08-15T00:00:00Z",
    updated_at: "2026-08-15T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    orderQueryResults: [],
    orderQueryIndex: 0,
    conditionalUpdateData: null,
    postCheckStatus: null,
    extendResult: null,
    recomputeResult: null,
    rpcCalls: [],
    conditionalUpdateCalls: 0,
  };
});

describe("completeOrder", () => {
  it("订单不存在 → ok=false", async () => {
    state.orderQueryResults = [null];
    const r = await completeOrder({
      outTradeNo: "S_NOT_EXIST",
      paidAmount: 9.9,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("订单不存在");
  });

  it("pending + 金额匹配 → paid 并开通会员（opened=true）", async () => {
    const order = pendingOrder();
    state.orderQueryResults = [order];
    state.conditionalUpdateData = { ...order, payment_status: "paid" };
    state.extendResult = { data: "2026-09-14T00:00:00Z", error: null };

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 9.9,
      tradeNo: "T123",
    });

    expect(r.ok).toBe(true);
    expect(r.opened).toBe(true);
    // 条件 UPDATE 已执行（WHERE payment_status='pending'）
    expect(state.conditionalUpdateCalls).toBe(1);
    // extend_membership 以订单的 plan + periodDays 调用
    const extend = state.rpcCalls.find((c) => c.fn === "extend_membership");
    expect(extend).toBeDefined();
    expect(extend?.args).toEqual({
      p_user_id: "u1",
      p_plan: "lite",
      p_period_days: 30,
    });
  });

  it("已 paid 的订单重复调用 → 幂等返回，不再开通（opened=false）", async () => {
    const order = pendingOrder({ payment_status: "paid" });
    state.orderQueryResults = [order];

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 9.9,
    });

    expect(r.ok).toBe(true);
    expect(r.opened).toBe(false);
    // 未执行条件 UPDATE、未调用任何 RPC
    expect(state.conditionalUpdateCalls).toBe(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("已 refunded 的订单 → 幂等返回，不重复开通（opened=false）", async () => {
    const order = pendingOrder({ payment_status: "refunded" });
    state.orderQueryResults = [order];

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 9.9,
    });

    expect(r.ok).toBe(true);
    expect(r.opened).toBe(false);
    expect(state.conditionalUpdateCalls).toBe(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("金额不匹配 → 拒绝，不执行任何更新", async () => {
    const order = pendingOrder(); // amount=9.9
    state.orderQueryResults = [order];

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 0.01, // 攻击者只付 1 分
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("订单金额不匹配");
    expect(state.conditionalUpdateCalls).toBe(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("并发竞争：条件 UPDATE 未命中 + 订单已被并发置为 paid → 幂等（opened=false，不开通）", async () => {
    const order = pendingOrder();
    // 第一次查询：pending；条件 UPDATE 未命中后 reload：paid
    state.orderQueryResults = [order, { ...order, payment_status: "paid" }];
    // 条件 UPDATE 返回 null（WHERE payment_status='pending' 未命中，另一请求已处理）
    state.conditionalUpdateData = null;

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 9.9,
    });

    expect(r.ok).toBe(true);
    expect(r.opened).toBe(false);
    // 关键：不再调用 extend_membership（否则会重复加 30 天）
    expect(state.rpcCalls.find((c) => c.fn === "extend_membership")).toBeUndefined();
  });

  it("开通期间被退款（post-check refunded）→ 调用 recompute_membership_after_refund 修正", async () => {
    const order = pendingOrder();
    state.orderQueryResults = [order];
    state.conditionalUpdateData = { ...order, payment_status: "paid" };
    state.extendResult = { data: "2026-09-14T00:00:00Z", error: null };
    // post-check 发现订单已被退款
    state.postCheckStatus = "refunded";

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 9.9,
    });

    expect(r.ok).toBe(true);
    expect(r.opened).toBe(true);
    const recompute = state.rpcCalls.find(
      (c) => c.fn === "recompute_membership_after_refund"
    );
    expect(recompute).toBeDefined();
    expect(recompute?.args).toEqual({ p_user_id: "u1" });
  });
});

describe("handleRefundSuccess", () => {
  it("已 refunded 的订单重复退款 → 幂等 ok=true，不再处理", async () => {
    const order = pendingOrder({
      payment_status: "refunded",
      refund_status: "succeeded",
    });
    state.orderQueryResults = [order];

    const r = await handleRefundSuccess({
      outTradeNo: order.out_trade_no,
      refundAmount: 9.9,
    });

    expect(r.ok).toBe(true);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("pending（未支付）订单 → 拒绝退款", async () => {
    const order = pendingOrder();
    state.orderQueryResults = [order];

    const r = await handleRefundSuccess({
      outTradeNo: order.out_trade_no,
      refundAmount: 9.9,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("订单未支付，不可退款");
  });

  it("退款金额超过订单金额 → 拒绝", async () => {
    const order = pendingOrder({ payment_status: "paid" });
    state.orderQueryResults = [order];

    const r = await handleRefundSuccess({
      outTradeNo: order.out_trade_no,
      refundAmount: 99.9, // 超过 9.9
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("退款金额超过订单金额");
  });
});

describe("amountsMatch 整数分比较（浮点安全）", () => {
  it("相同金额（含浮点表示）→ 匹配", () => {
    expect(amountsMatch(9.9, 9.9)).toBe(true);
    expect(amountsMatch(0.01, 0.01)).toBe(true);
    expect(amountsMatch(29.9, 29.9)).toBe(true);
  });

  it("不同金额 → 不匹配", () => {
    expect(amountsMatch(9.9, 9.91)).toBe(false);
    expect(amountsMatch(9.9, 0.01)).toBe(false);
    expect(amountsMatch(29.9, 9.9)).toBe(false);
  });

  it("浮点精度边界：9.9*100 与 990 比较 → 匹配", () => {
    // 9.9 * 100 = 990.0000000000001，必须经 Math.round 归一
    expect(amountsMatch(9.9, 990 / 100)).toBe(true);
  });
});
