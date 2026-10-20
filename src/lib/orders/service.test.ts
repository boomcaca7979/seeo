// ===== Orders completeOrder 幂等回归测试 =====
// 覆盖：pending→paid 开通、重复调用幂等、refunded 不重复开通、
//       金额不匹配拒绝、并发条件 UPDATE 语义、
//       查询故障与「订单不存在」的分离（code + retryable，供 webhook 决定是否让渠道重投）
//
// 全部使用内存 mock admin client，不触碰真实 Supabase / 不产生真实费用

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mock admin client ----

interface AdminState {
  /** getOrderByOutTradeNo 每次 select().single() 依次返回的订单（跨 admin 实例共享计数） */
  orderQueryResults: Array<Record<string, unknown> | null>;
  /** 下一次订单查询的索引（getAdminClient 每次调用新建实例，索引必须放 state） */
  orderQueryIndex: number;
  /** 注入「查不了」故障：非 null 时命中的订单查询返回该 PostgREST 错误（data 仍为 null） */
  orderQueryFault: { code?: string; message: string } | null;
  /** 故障作用于哪几次订单查询（0 基索引）；空集 = 所有查询都故障 */
  faultQueryIndexes: Set<number>;
  /** SUPABASE_SERVICE_ROLE_KEY 缺失等：getAdminClient() 返回 null */
  adminAvailable: boolean;
  /** 条件 UPDATE（.update().eq().eq().select().single()）返回的数据；null = 未命中 */
  conditionalUpdateData: Record<string, unknown> | null;
  /** 无返回行的普通 UPDATE（.update().eq().eq()）注入的故障 */
  plainUpdateFault: { code?: string; message: string } | null;
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
    const index = state.orderQueryIndex;
    const row =
      index < state.orderQueryResults.length
        ? state.orderQueryResults[index]
        : (state.orderQueryResults[state.orderQueryResults.length - 1] ?? null);
    state.orderQueryIndex += 1;
    if (
      state.orderQueryFault &&
      (state.faultQueryIndexes.size === 0 || state.faultQueryIndexes.has(index))
    ) {
      return {
        data: null,
        error: { code: state.orderQueryFault.code ?? "XX000", message: state.orderQueryFault.message },
      };
    }
    return {
      data: row,
      // 真实 PostgREST：.single() 命中 0 行不是「普通错误 + data null」，而是固定 code PGRST116。
      // 服务层只把这个 code 当作「订单不存在」，其它 error 一律视为故障（必须可重投）。
      error: row ? null : { code: "PGRST116", message: "0 rows returned by .single()" },
    };
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
        update: () => {
          // 「无返回行」的 UPDATE 路径：await .update().eq(...)（或 .eq().eq()）本身
          // 即 PostgREST 的 thenable builder —— 故障必须在这里可见，不能被静默吞成成功
          const awaitedResult = {
            then: (
              resolve: (v: { data: null; error: { code?: string; message: string } | null }) => void,
              reject: (e: unknown) => void
            ) => {
              Promise.resolve({
                data: null,
                error: state.plainUpdateFault
                  ? {
                      code: state.plainUpdateFault.code ?? "XX000",
                      message: state.plainUpdateFault.message,
                    }
                  : null,
              }).then(resolve, reject);
            },
          };
          return {
            eq: () => ({
              ...awaitedResult,
              // 条件更新链：.update().eq(out_trade_no).eq(payment_status).select().single()
              eq: () => ({
                ...awaitedResult,
                select: () => ({ single: conditionalSingle }),
              }),
            }),
          };
        },
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
  getAdminClient: () => (state.adminAvailable ? makeAdmin(state) : null),
}));

import {
  completeOrder,
  handleRefundSuccess,
  markOrderFailed,
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
    orderQueryFault: null,
    faultQueryIndexes: new Set<number>(),
    adminAvailable: true,
    conditionalUpdateData: null,
    plainUpdateFault: null,
    postCheckStatus: null,
    extendResult: null,
    recomputeResult: null,
    rpcCalls: [],
    conditionalUpdateCalls: 0,
  };
});

describe("completeOrder", () => {
  it("订单不存在（PGRST116）→ ok=false、code=ORDER_NOT_FOUND、不可重试", async () => {
    state.orderQueryResults = [null];
    const r = await completeOrder({
      outTradeNo: "S_NOT_EXIST",
      paidAmount: 9.9,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("订单不存在");
    expect(r.code).toBe("ORDER_NOT_FOUND");
    // 永久性：重投也不会出现订单（本地订单先于渠道调用写入）
    expect(r.retryable).toBe(false);
  });

  it("查不了 ≠ 查不到：连接故障 → code=ORDER_QUERY_FAILED 且 retryable=true", async () => {
    state.orderQueryFault = { code: "XX000", message: "could not connect to host" };
    const r = await completeOrder({ outTradeNo: "S20260815000001TEST01", paidAmount: 9.9 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ORDER_QUERY_FAILED");
    expect(r.retryable).toBe(true);
    expect(r.error).toContain("could not connect to host");
    // 故障时绝不能触碰开通：条件 UPDATE 与 RPC 都不该发生
    expect(state.conditionalUpdateCalls).toBe(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("SUPABASE_SERVICE_ROLE_KEY 缺失（admin client 为 null）→ 可重试故障，不是「订单不存在」", async () => {
    state.adminAvailable = false;
    const r = await completeOrder({ outTradeNo: "S20260815000001TEST01", paidAmount: 9.9 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ADMIN_CLIENT_UNAVAILABLE");
    expect(r.retryable).toBe(true);
  });

  it("条件 UPDATE 未命中 + 重查也故障 → ORDER_UPDATE_FAILED、retryable=true（不能谎报幂等）", async () => {
    state.orderQueryResults = [pendingOrder()];
    state.conditionalUpdateData = null; // 未命中（并发或报错）
    state.faultQueryIndexes = new Set([1]); // 只有重查故障
    state.orderQueryFault = { message: "primary database is starting up" };

    const r = await completeOrder({ outTradeNo: "S20260815000001TEST01", paidAmount: 9.9 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ORDER_UPDATE_FAILED");
    expect(r.retryable).toBe(true);
    expect(r.error).toContain("无法确认");
    expect(state.rpcCalls.find((c) => c.fn === "extend_membership")).toBeUndefined();
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

  it("金额不匹配 → 拒绝（永久，code=AMOUNT_MISMATCH），不执行任何更新", async () => {
    const order = pendingOrder(); // amount=9.9
    state.orderQueryResults = [order];

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 0.01, // 攻击者只付 1 分
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("订单金额不匹配");
    expect(r.code).toBe("AMOUNT_MISMATCH");
    expect(r.retryable).toBe(false);
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

  it("竞态降级保护：RPC 拒绝 PLAN_DOWNGRADE_NOT_ALLOWED → 订单保留 paid 且 period_end 被设置（阻断无限重试）", async () => {
    // 场景：用户下单 Lite 后、支付完成前已升级 Pro；
    // completeOrder 调用 extend_membership(lite) 被 0010 RPC 拒绝
    const order = pendingOrder();
    state.orderQueryResults = [order];
    state.conditionalUpdateData = { ...order, payment_status: "paid" };
    state.extendResult = {
      data: null,
      error: {
        message:
          "PLAN_DOWNGRADE_NOT_ALLOWED: current effective plan pro, target plan lite",
      },
    };

    const r = await completeOrder({
      outTradeNo: order.out_trade_no,
      paidAmount: 9.9,
    });

    // 订单已收款，保持 ok=true / opened=true，但不抛异常
    expect(r.ok).toBe(true);
    expect(r.opened).toBe(true);
    // period_end 被写入（非 null），query 轮询不会无限重试 retryMembershipActivation
    expect(r.order?.period_end).not.toBeNull();
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

  it("pending（未支付）订单 → 拒绝退款，但可重试（退款事件可能先于完成处理落库）", async () => {
    const order = pendingOrder();
    state.orderQueryResults = [order];

    const r = await handleRefundSuccess({
      outTradeNo: order.out_trade_no,
      refundAmount: 9.9,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("订单未支付，不可退款");
    expect(r.code).toBe("ORDER_NOT_PAYABLE");
    expect(r.retryable).toBe(true);
  });

  it("订单不存在 → ORDER_NOT_FOUND（永久）；查库故障 → ORDER_QUERY_FAILED（可重试）", async () => {
    state.orderQueryResults = [null];
    const absent = await handleRefundSuccess({
      outTradeNo: "S_NOT_EXIST",
      refundAmount: 9.9,
    });
    expect(absent.code).toBe("ORDER_NOT_FOUND");
    expect(absent.retryable).toBe(false);

    state.orderQueryIndex = 0;
    state.orderQueryFault = { message: "could not connect to host" };
    const faulted = await handleRefundSuccess({
      outTradeNo: "S20260815000001TEST01",
      refundAmount: 9.9,
    });
    expect(faulted.code).toBe("ORDER_QUERY_FAILED");
    expect(faulted.retryable).toBe(true);
    expect(state.conditionalUpdateCalls).toBe(0);
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
    expect(r.code).toBe("REFUND_AMOUNT_EXCEEDS");
    expect(r.retryable).toBe(false);
  });
});

describe("markOrderFailed（渠道明确报告支付失败）", () => {
  it("更新成功 → ok=true", async () => {
    const r = await markOrderFailed("S20260815000001TEST01");
    expect(r.ok).toBe(true);
  });

  it("未落库（连接故障）→ ok=false、retryable=true，webhook 必须据此换 500 让渠道重投", async () => {
    state.plainUpdateFault = { message: "could not connect to host" };
    const r = await markOrderFailed("S20260815000001TEST01");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ORDER_UPDATE_FAILED");
    expect(r.retryable).toBe(true);
    expect(r.error).toContain("could not connect to host");
  });

  it("admin client 不可用 → 同样是可重试故障", async () => {
    state.adminAvailable = false;
    const r = await markOrderFailed("S20260815000001TEST01");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ADMIN_CLIENT_UNAVAILABLE");
    expect(r.retryable).toBe(true);
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
