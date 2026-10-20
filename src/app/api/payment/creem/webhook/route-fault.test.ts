// ===== Creem webhook 故障注入：查询故障绝不能被「确认收货」 =====
// 根因：src/lib/orders/service.ts 的订单查询把 PostgREST 错误、请求异常、
// SUPABASE_SERVICE_ROLE_KEY 缺失一律吞成 null；webhook 路由再把 null 读成
// 「订单不存在」→ 返回 200。Creem 收到 200 即认为投递成功、停止重投，
// 于是数据库抖动期间到达的支付成功事件会让已付款用户永久拿不到会员权益。
//
// 本文件只 mock **外部依赖边界**（Supabase admin 客户端 / 快照账本 / analytics / 邮件），
// 订单服务与 webhook 路由都跑真实实现，断言三件事：
//   1. HTTP 状态（500 = 可重试，200 = 已安全处理或永久无法处理）；
//   2. 错误语义（故障 ≠ 不存在）；
//   3. 重试契约（故障恢复后重投能真实开通，且不重复开通 / 不重复通知）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

type FaultMode = "none" | "error" | "throw";
/** 读路径多一种故障：admin 客户端根本不可创建（缺 SUPABASE_SERVICE_ROLE_KEY） */
type ReadFaultMode = FaultMode | "noClient";

const h = vi.hoisted(() => {
  const store: {
    orders: Map<string, Record<string, unknown>>;
    readFault: ReadFaultMode;
    faultReadIndexes: Set<number>;
    readCount: number;
    writeFault: FaultMode;
    writes: number;
    rpcCalls: string[];
  } = {
    orders: new Map(),
    readFault: "none",
    faultReadIndexes: new Set(),
    readCount: 0,
    writeFault: "none",
    writes: 0,
    rpcCalls: [],
  };
  return {
    store,
    claimWebhookEventMock: vi.fn(
      async (): Promise<"claimed" | "duplicate" | "retry"> => "claimed"
    ),
    finishWebhookEventMock: vi.fn(async () => {}),
    upsertCreemCustomerMock: vi.fn(async () => {}),
    upsertCreemSubscriptionMock: vi.fn(
      async (): Promise<{ created: boolean; previousStatus: string | null; statusChanged: boolean }> => ({
        created: true,
        previousStatus: null,
        statusChanged: true,
      })
    ),
    recordCreemPaymentMock: vi.fn(async () => {}),
    recordCreemRefundMock: vi.fn(async () => {}),
    recordCheckoutCompletedMock: vi.fn(async () => {}),
    recordPaymentCompletedMock: vi.fn(async () => {}),
    recordSubscriptionActiveMock: vi.fn(async () => {}),
    recordSubscriptionCanceledMock: vi.fn(async () => {}),
    queuePaymentNotificationMock: vi.fn(async (): Promise<number | null> => 7),
    deliverPaymentNotificationMock: vi.fn(async () => ({ status: "sent" as const })),
    getAccountEmailMock: vi.fn(async (): Promise<string | null> => null),
  };
});

const store = h.store;

// ---- PostgREST 真实语义：.single() 命中 0 行固定报 PGRST116 ----
const PGRST116 = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
};
const CONNECTION_ERROR = {
  code: "XX000",
  message: "could not connect to host: primary database unavailable",
};

/** 读故障注入：命中则按模式返回错误或抛异常 */
function readOutcome(): { blocked: true; res: unknown } | { blocked: false } {
  store.readCount += 1;
  const active =
    store.readFault !== "none" || store.faultReadIndexes.has(store.readCount - 1);
  if (!active) return { blocked: false };
  if (store.readFault === "throw") throw new Error("fetch failed: connection reset");
  return { blocked: true, res: { data: null, error: CONNECTION_ERROR } };
}

function writeOutcome(patch: Record<string, unknown>, filters: Array<[string, unknown]>) {
  store.writes += 1;
  if (store.writeFault === "throw") throw new Error("fetch failed: write connection reset");
  if (store.writeFault === "error") return { data: null, error: CONNECTION_ERROR };
  const matched = [...store.orders.values()].filter((row) =>
    filters.every(([col, val]) => row[col] === val)
  );
  if (matched.length === 0) return { data: null, error: PGRST116 };
  for (const row of matched) Object.assign(row, patch);
  return { data: matched[0], error: null };
}

function makeAdminClient() {
  return {
    from(table: string) {
      if (table !== "orders") {
        // 本测试只允许触碰 orders；其他表（profiles 等）由被调用方自行兜底
        throw new Error(`unexpected table in fault-injection test: ${table}`);
      }
      return {
        select(columns?: string) {
          const filters: Array<[string, unknown]> = [];
          const matched = () =>
            [...store.orders.values()].filter((row) =>
              filters.every(([col, val]) => row[col] === val)
            );
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            order() {
              return api;
            },
            async single() {
              const fault = readOutcome();
              if (fault.blocked) return fault.res;
              const rows = matched();
              if (rows.length !== 1) return { data: null, error: PGRST116 };
              // post-check 只投影 payment_status
              if (columns === "payment_status") {
                return { data: { payment_status: rows[0].payment_status }, error: null };
              }
              return { data: rows[0], error: null };
            },
            async limit(count: number) {
              const fault = readOutcome();
              if (fault.blocked) return fault.res;
              return { data: matched().slice(0, count), error: null };
            },
          };
          return api;
        },
        update(patch: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            select() {
              return {
                single: async () => writeOutcome(patch, filters),
              };
            },
            // 直接 await 的更新（period_end 等）
            then(
              resolve: (v: unknown) => void,
              reject: (e: unknown) => void
            ) {
              void Promise.resolve(writeOutcome(patch, filters)).then(resolve, reject);
            },
          };
          return api;
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      store.rpcCalls.push(fn);
      if (store.readFault !== "none" || store.writeFault !== "none") {
        if (store.readFault === "throw" || store.writeFault === "throw") {
          throw new Error("fetch failed: rpc unreachable");
        }
        return { data: null, error: CONNECTION_ERROR };
      }
      const periodEnd = (args.p_period_end as string) ?? "2026-10-30T00:00:00Z";
      // 真实 PostgREST 把 timestamptz 序列化为带偏移的形式，服务层再归一化为 ISO
      if (fn === "set_membership_period")
        return { data: periodEnd.replace(/Z$/, "+00:00"), error: null };
      if (fn === "extend_membership") return { data: "2026-10-15T00:00:00Z", error: null };
      return { data: null, error: null };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => (store.readFault === "noClient" ? null : makeAdminClient()),
}));

vi.mock("@/lib/creem/config", () => ({
  getCreemWebhookSecret: vi.fn(() => "whsec_test_secret"),
}));

vi.mock("@/lib/creem/snapshot", () => ({
  claimWebhookEvent: h.claimWebhookEventMock,
  finishWebhookEvent: h.finishWebhookEventMock,
  upsertCreemCustomer: h.upsertCreemCustomerMock,
  upsertCreemSubscription: h.upsertCreemSubscriptionMock,
  recordCreemPayment: h.recordCreemPaymentMock,
  recordCreemRefund: h.recordCreemRefundMock,
}));

vi.mock("@/lib/analytics/server", () => ({
  recordPaymentCompleted: h.recordPaymentCompletedMock,
  recordCheckoutCompleted: h.recordCheckoutCompletedMock,
  recordSubscriptionActive: h.recordSubscriptionActiveMock,
  recordSubscriptionCanceled: h.recordSubscriptionCanceledMock,
}));

// 只 stub 通知的存储/发信侧，保留 shouldNotifyRenewal 的真实判定逻辑
vi.mock("@/lib/payments/notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/notify")>();
  return {
    ...actual,
    queuePaymentNotification: h.queuePaymentNotificationMock,
    deliverPaymentNotification: h.deliverPaymentNotificationMock,
    getAccountEmail: h.getAccountEmailMock,
  };
});

const SECRET = "whsec_test_secret";
const OUT_TRADE_NO = "S20261017120000FAULT1";

function baseOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "order-uuid-1",
    user_id: "user-1",
    out_trade_no: OUT_TRADE_NO,
    trade_no: null,
    api_trade_no: null,
    plan: "lite",
    amount: 1.49,
    currency: "USD",
    payment_channel: "creem",
    payment_status: "pending",
    paid_at: null,
    refund_status: null,
    refund_amount: null,
    refunded_at: null,
    period_type: "30d",
    period_end: null,
    clientip: null,
    param: null,
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
    ...overrides,
  };
}

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function post(event: unknown, signature?: string | null): Promise<Response> {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {};
  if (signature !== null) headers["creem-signature"] = signature ?? sign(body);
  return POST(
    new Request("https://www.seeo.asia/api/payment/creem/webhook", {
      method: "POST",
      headers,
      body,
    })
  );
}

function checkoutCompleted(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_fault_001",
    eventType: "checkout.completed",
    created_at: 1760659200,
    object: {
      id: "ch_fault_1",
      request_id: null,
      status: "finalized",
      order: { id: "ord_fault_1", amount: 149, currency: "usd", status: "paid" },
      product: { id: "prod_1", billing_type: "recurring" },
      customer: { id: "cus_1", email: "buyer@example.com" },
      subscription: { id: "sub_fault_1", current_period_end_date: "2026-11-16T00:00:00Z" },
      metadata: { out_trade_no: OUT_TRADE_NO },
      ...overrides,
    },
  };
}

import { POST } from "./route";

function resetStore() {
  store.orders.clear();
  store.orders.set(OUT_TRADE_NO, baseOrder());
  store.readFault = "none";
  store.writeFault = "none";
  store.faultReadIndexes.clear();
  store.readCount = 0;
  store.writes = 0;
  store.rpcCalls = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  // 逐次 mockResolvedValueOnce 不会随 clearAllMocks 出队，显式复位基准实现
  h.claimWebhookEventMock.mockImplementation(async () => "claimed");
  h.queuePaymentNotificationMock.mockImplementation(async () => 7);
  resetStore();
});

describe("checkout.completed：健康路径真实开通", () => {
  it("无故障 → 200、订单转 paid、period_end 落库、通知入队一次", async () => {
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    const order = store.orders.get(OUT_TRADE_NO)!;
    expect(order.payment_status).toBe("paid");
    expect(order.period_end).toBe("2026-11-16T00:00:00.000Z");
    expect(store.rpcCalls).toContain("set_membership_period");
    expect(h.queuePaymentNotificationMock).toHaveBeenCalledTimes(1);
    expect(h.deliverPaymentNotificationMock).toHaveBeenCalledTimes(1);
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith("evt_fault_001", "processed", null);
  });
});

describe("checkout.completed：读故障必须让 Creem 重投", () => {
  it("PostgREST 连接故障 → 500（旧实现吞成 null→「订单不存在」→200 确认收货）", async () => {
    store.readFault = "error";
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("processing error");
    // 故障时不能发生任何权益写入，也不能确认收货
    expect(store.writes).toBe(0);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("pending");
    expect(h.queuePaymentNotificationMock).not.toHaveBeenCalled();
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_fault_001",
      "failed",
      expect.stringContaining("查询失败")
    );
  });

  it("admin 客户端不可用（SUPABASE_SERVICE_ROLE_KEY 缺失）→ 500，不是「订单不存在」", async () => {
    store.readFault = "noClient";
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(500);
    expect(store.writes).toBe(0);
  });

  it("请求直接抛异常 → 500（异常不得被 catch 成空结果）", async () => {
    store.readFault = "throw";
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(500);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("pending");
  });

  it("订单确实不存在（PGRST116）→ 200 且账本记 ignored，不做无效重投", async () => {
    store.orders.clear();
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_fault_001",
      "ignored",
      expect.stringContaining(OUT_TRADE_NO)
    );
    expect(store.writes).toBe(0);
  });

  it("金额不匹配（真实读到的订单）→ 200 ignored，不开通（永久性，不重投）", async () => {
    const res = await post(
      checkoutCompleted({ order: { id: "ord_fault_1", amount: 999, currency: "usd", status: "paid" } })
    );
    expect(res.status).toBe(200);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("pending");
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_fault_001",
      "ignored",
      expect.stringContaining("金额")
    );
  });
});

describe("故障恢复后的重投契约", () => {
  it("第 1 次故障 → 500；Creem 重投（账本 retry）→ 200 且真实开通，只开通一次", async () => {
    store.readFault = "error";
    const first = await post(checkoutCompleted());
    expect(first.status).toBe(500);

    resetStore();
    h.claimWebhookEventMock.mockResolvedValueOnce("retry");
    const second = await post(checkoutCompleted());
    expect(second.status).toBe(200);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("paid");
    expect(h.queuePaymentNotificationMock).toHaveBeenCalledTimes(1);

    // 第三次：账本判定 duplicate → 短路，不再开通、不再通知
    h.claimWebhookEventMock.mockResolvedValueOnce("duplicate");
    const third = await post(checkoutCompleted());
    expect(third.status).toBe(200);
    const body = (await third.json()) as Record<string, unknown>;
    expect(body.duplicate).toBe(true);
    expect(h.queuePaymentNotificationMock).toHaveBeenCalledTimes(1);
    expect(store.orders.get(OUT_TRADE_NO)!.period_end).toBe("2026-11-16T00:00:00.000Z");
  });

  it("账本命中 duplicate → 直接 200，绝不触碰订单读写", async () => {
    h.claimWebhookEventMock.mockResolvedValueOnce("duplicate");
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    expect(store.readCount).toBe(0);
    expect(store.writes).toBe(0);
  });

  it("已 paid 订单再收到同一事件（账本可用但重复投递）→ 200 且不重复延长周期", async () => {
    store.orders.set(OUT_TRADE_NO, baseOrder({ payment_status: "paid", period_end: "2026-11-16T00:00:00Z" }));
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    expect(store.rpcCalls).not.toContain("set_membership_period");
    expect(store.orders.get(OUT_TRADE_NO)!.period_end).toBe("2026-11-16T00:00:00Z");
    expect(h.queuePaymentNotificationMock).not.toHaveBeenCalled();
  });

  it("条件 UPDATE 失败且重查也失败 → 500（不能把「不知道」说成幂等成功）", async () => {
    // 读序：①路由定位订单 ②completeOrder 查订单 均正常；③更新失败后的重查注入故障
    store.writeFault = "error";
    store.faultReadIndexes.add(3);
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(500);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("pending");
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_fault_001",
      "failed",
      expect.stringContaining("状态更新失败")
    );
    expect(h.queuePaymentNotificationMock).not.toHaveBeenCalled();
  });
});

describe("subscription.* 与 refund.created 的故障语义", () => {
  const paidOrder = () =>
    baseOrder({ payment_status: "paid", api_trade_no: "sub_fault_1", trade_no: "ord_fault_1", period_end: "2026-10-17T00:00:00Z" });

  it("订阅续费事件的订单查询故障 → 500 让 Creem 重投", async () => {
    store.readFault = "error";
    const res = await post({
      id: "evt_sub_fault",
      eventType: "subscription.paid",
      created_at: 1760659200,
      object: {
        id: "sub_fault_1",
        status: "paid",
        current_period_end_date: "2026-11-30T00:00:00Z",
        last_transaction_id: "txn_new",
        metadata: { out_trade_no: OUT_TRADE_NO },
      },
    });
    expect(res.status).toBe(500);
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_sub_fault",
      "failed",
      expect.any(String)
    );
  });

  it("订阅续费健康路径 → 200 且周期推进；订单未匹配 → 200 ignored", async () => {
    store.orders.set(OUT_TRADE_NO, paidOrder());
    const res = await post({
      id: "evt_sub_ok",
      eventType: "subscription.paid",
      created_at: 1760659200,
      object: {
        id: "sub_fault_1",
        status: "paid",
        current_period_end_date: "2026-11-30T00:00:00Z",
        last_transaction_id: "txn_new",
        metadata: { out_trade_no: OUT_TRADE_NO },
      },
    });
    expect(res.status).toBe(200);
    expect(store.orders.get(OUT_TRADE_NO)!.period_end).toBe("2026-11-30T00:00:00Z");

    store.orders.clear();
    const missing = await post({
      id: "evt_sub_missing",
      eventType: "subscription.paid",
      created_at: 1760659200,
      object: {
        id: "sub_none",
        status: "paid",
        current_period_end_date: "2026-11-30T00:00:00Z",
        metadata: { out_trade_no: "S_NOT_EXIST" },
      },
    });
    expect(missing.status).toBe(200);
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_sub_missing",
      "ignored",
      expect.stringContaining("sub_none")
    );
  });

  it("退款事件的订单查询故障 → 500", async () => {
    store.readFault = "error";
    const res = await post({
      id: "evt_refund_fault",
      eventType: "refund.created",
      created_at: 1760659200,
      object: {
        id: "ref_1",
        status: "succeeded",
        refund_amount: 149,
        refund_currency: "usd",
        order_id: "ord_fault_1",
        metadata: { out_trade_no: OUT_TRADE_NO },
      },
    });
    expect(res.status).toBe(500);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("pending");
  });

  it("退款健康路径 → 200、订单转 refunded；订单不存在 → 200 ignored", async () => {
    store.orders.set(OUT_TRADE_NO, paidOrder());
    const res = await post({
      id: "evt_refund_ok",
      eventType: "refund.created",
      created_at: 1760659200,
      object: {
        id: "ref_2",
        status: "succeeded",
        refund_amount: 149,
        refund_currency: "usd",
        order_id: "ord_fault_1",
        metadata: { out_trade_no: OUT_TRADE_NO },
      },
    });
    expect(res.status).toBe(200);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("refunded");
    expect(store.rpcCalls).toContain("recompute_membership_after_refund");

    store.orders.clear();
    const missing = await post({
      id: "evt_refund_missing",
      eventType: "refund.created",
      created_at: 1760659200,
      object: {
        id: "ref_3",
        refund_amount: 149,
        order_id: "ord_none",
        metadata: { out_trade_no: "S_NOT_EXIST" },
      },
    });
    expect(missing.status).toBe(200);
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_refund_missing",
      "ignored",
      expect.stringContaining("ref_3")
    );
  });

  it("支付失败事件落库故障 → 500（不能把 pending 留在「确认中」却被确认收货）", async () => {
    store.writeFault = "error";
    const res = await post(
      checkoutCompleted({
        order: { id: "ord_fault_1", amount: 149, currency: "usd", status: "failed" },
      })
    );
    expect(res.status).toBe(500);
    expect(store.orders.get(OUT_TRADE_NO)!.payment_status).toBe("pending");
  });
});
