// ===== POST /api/payment/creem/webhook 测试 =====
// 覆盖：
//   - 正确签名 → 200 且 completeOrder 被调用
//   - 错误签名 / 缺少签名 → 400 且不触发任何订单操作
//   - 重放 / 重复投递（含 paid 订单重复 webhook）→ 路由正确委托，幂等由订单层保证
//   - 金额不匹配 / 币种不匹配 → 不开通
//   - 找不到订单 → 200 且不处理（不可重试的永久情况）
//   - payment failure（order.status=failed）→ markOrderFailed
//   - Lite / Pro 订阅：periodEndIso 透传 Creem 订阅周期
//   - Custom：不传订阅周期（不产生会员周期）
//   - subscription.paid 续费 → syncSubscriptionPeriod
//   - refund.created → handleRefundSuccess
//   - 非 Creem 渠道订单（历史 Yaolipay）→ 拒绝处理
//
// 签名使用真实 HMAC-SHA256 计算验证（与生产同算法）

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const h = vi.hoisted(() => {
  // 可注入的订单数据库（out_trade_no → order）
  const orderDb = new Map<string, Record<string, unknown>>();
  return {
    orderDb,
    completeOrderMock: vi.fn(
      async (): Promise<{ ok: boolean; order: unknown; opened: boolean }> => ({
        ok: true,
        order: null,
        opened: true,
      })
    ),
    markOrderFailedMock: vi.fn(async () => {}),
    syncSubscriptionPeriodMock: vi.fn(async () => true),
    handleRefundSuccessMock: vi.fn(async () => ({ ok: true })),
    recordPaymentCompletedMock: vi.fn(async () => {}),
    // ---- Owner Console：analytics 事件 ----
    recordCheckoutCompletedMock: vi.fn(async () => {}),
    recordSubscriptionActiveMock: vi.fn(async () => {}),
    recordSubscriptionCanceledMock: vi.fn(async () => {}),
    // ---- Owner Console：Creem 本地经营快照 ----
    // 默认 "claimed"：保持既有「重复投递仍各自处理」的测试语义不变
    claimWebhookEventMock: vi.fn(
      async (): Promise<"claimed" | "duplicate" | "retry"> => "claimed"
    ),
    finishWebhookEventMock: vi.fn(async () => {}),
    upsertCreemCustomerMock: vi.fn(async () => {}),
    upsertCreemSubscriptionMock: vi.fn(
      async (): Promise<{
        created: boolean;
        previousStatus: string | null;
        statusChanged: boolean;
      }> => ({ created: true, previousStatus: null, statusChanged: true })
    ),
    recordCreemPaymentMock: vi.fn(async () => {}),
    recordCreemRefundMock: vi.fn(async () => {}),
  };
});

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

vi.mock("@/lib/orders/service", () => ({
  completeOrder: h.completeOrderMock,
  markOrderFailed: h.markOrderFailedMock,
  syncSubscriptionPeriod: h.syncSubscriptionPeriodMock,
  handleRefundSuccess: h.handleRefundSuccessMock,
  amountsMatch: (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100),
  getOrderByOutTradeNo: vi.fn(async (no: string) => h.orderDb.get(no) ?? null),
  getOrderByOutTradeNoForUser: vi.fn(async () => null),
  findOrderByCreemSubscriptionId: vi.fn(async (subId: string) => {
    for (const o of h.orderDb.values()) {
      if (o.api_trade_no === subId) return o;
    }
    return null;
  }),
  findOrderByCreemOrderId: vi.fn(async (ordId: string) => {
    for (const o of h.orderDb.values()) {
      if (o.trade_no === ordId) return o;
    }
    return null;
  }),
  listUserOrders: vi.fn(async () => []),
  parseOrderParam: vi.fn(() => ({})),
}));

vi.mock("@/lib/analytics/server", () => ({
  recordPaymentCompleted: h.recordPaymentCompletedMock,
  recordCheckoutCompleted: h.recordCheckoutCompletedMock,
  recordSubscriptionActive: h.recordSubscriptionActiveMock,
  recordSubscriptionCanceled: h.recordSubscriptionCanceledMock,
}));

const { orderDb } = h;

const SECRET = "whsec_test_secret";

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-uuid-1",
    user_id: "user-1",
    out_trade_no: "S20260831120000ABCDEF",
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
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    ...overrides,
  };
}

import { POST } from "./route";
import {
  completeOrder,
  markOrderFailed,
  syncSubscriptionPeriod,
  handleRefundSuccess,
} from "@/lib/orders/service";

const mockComplete = vi.mocked(completeOrder);
const mockMarkFailed = vi.mocked(markOrderFailed);
const mockSync = vi.mocked(syncSubscriptionPeriod);
const mockRefund = vi.mocked(handleRefundSuccess);

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function makeWebhookRequest(event: unknown, signature?: string | null): Request {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {};
  if (signature !== null) {
    headers["creem-signature"] = signature ?? sign(body);
  }
  return new Request("https://www.seeo.asia/api/payment/creem/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function checkoutCompletedEvent(overrides: {
  outTradeNo?: string;
  amount?: number;
  currency?: string;
  orderStatus?: string;
  subscription?: Record<string, unknown> | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return {
    id: "evt_test_001",
    eventType: "checkout.completed",
    created_at: 1756646400,
    object: {
      id: "ch_test_123",
      request_id: overrides.requestId ?? null,
      status: "finalized",
      order: {
        id: "ord_test_456",
        amount: overrides.amount ?? 149,
        currency: overrides.currency ?? "usd",
        status: overrides.orderStatus ?? "paid",
      },
      product: { id: "prod_1lm34wwaIsim962h2ibpmx", billing_type: "recurring" },
      customer: { id: "cus_test_789", email: "u@example.com" },
      subscription: overrides.subscription,
      metadata: overrides.metadata,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  orderDb.clear();
  orderDb.set("S20260831120000ABCDEF", baseOrder());
});

describe("POST /api/payment/creem/webhook 签名验证", () => {
  it("正确签名 → 200 且 completeOrder 被调用", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
          subscription: { id: "sub_test_1", current_period_end_date: "2026-09-30T00:00:00Z" },
        })
      )
    );
    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("错误签名 → 400 且不触发任何订单操作", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({ metadata: { out_trade_no: "S20260831120000ABCDEF" } }),
        "deadbeef"
      )
    );
    expect(res.status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("缺少签名头 → 400", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({ metadata: { out_trade_no: "S20260831120000ABCDEF" } }),
        null
      )
    );
    expect(res.status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("篡改 body（签名后修改内容）→ 400", async () => {
    const event = checkoutCompletedEvent({
      metadata: { out_trade_no: "S20260831120000ABCDEF" },
    });
    const body = JSON.stringify(event);
    const sig = sign(body);
    // 篡改后的 body（金额被改动）配旧签名
    const tampered = JSON.stringify({
      ...event,
      object: { ...event.object, order: { ...event.object.order, amount: 1 } },
    });
    const res = await POST(
      new Request("https://www.seeo.asia/api/payment/creem/webhook", {
        method: "POST",
        headers: { "creem-signature": sig },
        body: tampered,
      })
    );
    expect(res.status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("checkout.completed 处理", () => {
  it("Lite 订阅：periodEndIso 透传 Creem 订阅周期", async () => {
    const periodEnd = "2026-09-30T12:00:00Z";
    await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
          subscription: { id: "sub_test_1", current_period_end_date: periodEnd },
        })
      )
    );
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        outTradeNo: "S20260831120000ABCDEF",
        paidAmount: 1.49,
        periodEndIso: periodEnd,
        tradeNo: "ord_test_456",
        apiTradeNo: "sub_test_1",
      })
    );
  });

  it("Pro 订阅：同样以 Creem 周期开通", async () => {
    orderDb.set("S20260831120000PRO", baseOrder({ plan: "pro", amount: 4.49 }));
    const periodEnd = "2026-09-30T12:00:00Z";
    await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          amount: 449,
          metadata: { out_trade_no: "S20260831120000PRO" },
          subscription: { id: "sub_pro_1", current_period_end_date: periodEnd },
        })
      )
    );
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ outTradeNo: "S20260831120000PRO", paidAmount: 4.49, periodEndIso: periodEnd })
    );
  });

  it("Custom one-time：不传订阅周期（不产生会员周期）", async () => {
    orderDb.set("S20260831120000CST", baseOrder({ plan: "custom", amount: 89.99 }));
    // 即使渠道误带 subscription 字段，custom 也必须忽略
    await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          amount: 8999,
          metadata: { out_trade_no: "S20260831120000CST" },
          subscription: { id: "sub_should_ignore", current_period_end_date: "2026-09-30T00:00:00Z" },
        })
      )
    );
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        outTradeNo: "S20260831120000CST",
        paidAmount: 89.99,
        periodEndIso: undefined,
        apiTradeNo: "ord_test_456",
      })
    );
  });

  it("金额不匹配 → 不开通", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          amount: 999, // $9.99 != $1.49
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
        })
      )
    );
    expect(res.status).toBe(200);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("币种不匹配 → 不开通", async () => {
    await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          currency: "eur",
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
        })
      )
    );
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("找不到订单 → 200 且不处理（永久失败不重试）", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({ metadata: { out_trade_no: "S_NOT_EXIST" } })
      )
    );
    expect(res.status).toBe(200);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("payment failure（order.status=failed）→ markOrderFailed，不开通", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          orderStatus: "failed",
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
        })
      )
    );
    expect(res.status).toBe(200);
    expect(mockMarkFailed).toHaveBeenCalledWith("S20260831120000ABCDEF");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("非 Creem 渠道订单（历史 Yaolipay alipay 渠道）→ 拒绝处理", async () => {
    orderDb.set("S20260801120000OLD", baseOrder({ payment_channel: "alipay", amount: 9.9, currency: "CNY" }));
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          amount: 990,
          currency: "cny",
          metadata: { out_trade_no: "S20260801120000OLD" },
        })
      )
    );
    expect(res.status).toBe(200);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("metadata 缺失时回退 request_id 匹配订单", async () => {
    await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          requestId: "S20260831120000ABCDEF",
          metadata: null,
        })
      )
    );
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ outTradeNo: "S20260831120000ABCDEF" })
    );
  });
});

describe("幂等 / 重放", () => {
  it("同一事件重复投递两次 → 两次均 200，均委托 completeOrder（幂等由订单层条件 UPDATE 保证）", async () => {
    const event = checkoutCompletedEvent({
      metadata: { out_trade_no: "S20260831120000ABCDEF" },
      subscription: { id: "sub_test_1", current_period_end_date: "2026-09-30T00:00:00Z" },
    });
    const first = await POST(makeWebhookRequest(event));
    const second = await POST(makeWebhookRequest(event));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it("paid 订单重复 webhook：completeOrder 返回 opened=false 时路由仍 200", async () => {
    mockComplete.mockResolvedValueOnce({
      ok: true,
      order: baseOrder({ payment_status: "paid" }) as unknown as import("@/lib/orders/service").OrderRecord,
      opened: true,
    });
    mockComplete.mockResolvedValueOnce({
      ok: true,
      order: baseOrder({ payment_status: "paid" }) as unknown as import("@/lib/orders/service").OrderRecord,
      opened: false,
    });
    const event = checkoutCompletedEvent({
      metadata: { out_trade_no: "S20260831120000ABCDEF" },
    });
    await POST(makeWebhookRequest(event));
    const res = await POST(makeWebhookRequest(event));
    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });
});

describe("analytics payment_completed（B9）", () => {
  it("真实开通（opened=true）→ 记录 payment_completed（含 user_id / 订单号 / plan）", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
        })
      )
    );
    expect(res.status).toBe(200);
    expect(h.recordPaymentCompletedMock).toHaveBeenCalledTimes(1);
    expect(h.recordPaymentCompletedMock).toHaveBeenCalledWith({
      userId: "user-1",
      outTradeNo: "S20260831120000ABCDEF",
      plan: "lite",
    });
  });

  it("支付失败（order.status=failed）→ 不产生 payment_completed", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          orderStatus: "failed",
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
        })
      )
    );
    expect(res.status).toBe(200);
    expect(h.recordPaymentCompletedMock).not.toHaveBeenCalled();
  });

  it("重复投递（第二次 opened=false）→ 不重复记录 payment_completed", async () => {
    mockComplete.mockResolvedValueOnce({
      ok: true,
      order: baseOrder({ payment_status: "paid" }) as unknown as import("@/lib/orders/service").OrderRecord,
      opened: true,
    });
    mockComplete.mockResolvedValueOnce({
      ok: true,
      order: baseOrder({ payment_status: "paid" }) as unknown as import("@/lib/orders/service").OrderRecord,
      opened: false,
    });
    const event = checkoutCompletedEvent({
      metadata: { out_trade_no: "S20260831120000ABCDEF" },
    });
    await POST(makeWebhookRequest(event));
    await POST(makeWebhookRequest(event));
    expect(h.recordPaymentCompletedMock).toHaveBeenCalledTimes(1);
  });
});

describe("subscription.* 事件", () => {
  it("subscription.paid 续费 → syncSubscriptionPeriod 以 Creem 周期同步", async () => {
    orderDb.set(
      "S20260831120000ABCDEF",
      baseOrder({ payment_status: "paid", api_trade_no: "sub_test_1" })
    );
    const res = await POST(
      makeWebhookRequest({
        id: "evt_sub_001",
        eventType: "subscription.paid",
        created_at: 1756646400,
        object: {
          id: "sub_test_1",
          status: "paid",
          current_period_end_date: "2026-10-30T00:00:00Z",
          last_transaction_id: "txn_001",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        plan: "lite",
        periodEndIso: "2026-10-30T00:00:00Z",
        outTradeNo: "S20260831120000ABCDEF",
      })
    );
  });

  it("subscription.active：订单未支付时跳过（等待 checkout.completed 先处理）", async () => {
    const res = await POST(
      makeWebhookRequest({
        id: "evt_sub_002",
        eventType: "subscription.active",
        created_at: 1756646400,
        object: {
          id: "sub_test_1",
          status: "active",
          current_period_end_date: "2026-10-30T00:00:00Z",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("subscription.canceled：仅记录，不动会员", async () => {
    const res = await POST(
      makeWebhookRequest({
        id: "evt_sub_003",
        eventType: "subscription.canceled",
        created_at: 1756646400,
        object: { id: "sub_test_1", status: "canceled" },
      })
    );
    expect(res.status).toBe(200);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("refund.created", () => {
  it("按 Creem order id 匹配订单并处理退款", async () => {
    orderDb.set(
      "S20260831120000ABCDEF",
      baseOrder({ payment_status: "paid", trade_no: "ord_test_456" })
    );
    const res = await POST(
      makeWebhookRequest({
        id: "evt_refund_001",
        eventType: "refund.created",
        created_at: 1756646400,
        object: {
          id: "ref_test_001",
          status: "succeeded",
          refund_amount: 149,
          refund_currency: "usd",
          order_id: "ord_test_456",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(mockRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        outTradeNo: "S20260831120000ABCDEF",
        refundAmount: 1.49,
      })
    );
  });

  it("未匹配到订单 → 200 且不处理", async () => {
    const res = await POST(
      makeWebhookRequest({
        id: "evt_refund_002",
        eventType: "refund.created",
        created_at: 1756646400,
        object: {
          id: "ref_test_002",
          refund_amount: 149,
          order_id: "ord_not_exist",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(mockRefund).not.toHaveBeenCalled();
  });
});

// ===== Owner Console：事件账本 + 本地经营快照 =====
// 两条硬约束：
//   1. 账本/快照**不可用**时不得阻塞权益（否则已付费用户拿不到服务）；
//   2. 账本**命中重复**时必须短路（否则重复计收入、重复抬高漏斗）。
describe("Owner Console 快照与事件账本", () => {
  it("checkout.completed → 写入 Creem 客户/订阅/收款快照（金额用最小货币单位）", async () => {
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({
          metadata: { out_trade_no: "S20260831120000ABCDEF" },
          subscription: {
            id: "sub_test_1",
            status: "active",
            current_period_end_date: "2026-09-30T00:00:00Z",
          },
        })
      )
    );
    expect(res.status).toBe(200);
    expect(h.upsertCreemCustomerMock).toHaveBeenCalledTimes(1);
    expect(h.upsertCreemSubscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_test_1", plan: "lite" })
    );
    expect(h.recordCreemPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "ord_test_456",
        amountCents: 149,
        outTradeNo: "S20260831120000ABCDEF",
        plan: "lite",
      })
    );
    // 新订阅（created=true）→ 记一次 subscription_active，避免续费重复抬高漏斗
    expect(h.recordSubscriptionActiveMock).toHaveBeenCalledTimes(1);
    // 账本写 processed（detail 省略）
    expect(h.finishWebhookEventMock.mock.calls.map((c) => c.slice(0, 2))).toContainEqual([
      "evt_test_001",
      "processed",
    ]);
  });

  it("续费（subscription.paid 状态未变）→ 不重复发射 subscription_active", async () => {
    orderDb.set(
      "S20260831120000ABCDEF",
      baseOrder({ payment_status: "paid", api_trade_no: "sub_test_1" })
    );
    h.upsertCreemSubscriptionMock.mockResolvedValueOnce({
      created: false,
      previousStatus: "active",
      statusChanged: false,
    });
    const res = await POST(
      makeWebhookRequest({
        id: "evt_sub_renew",
        eventType: "subscription.paid",
        created_at: 1756646400,
        object: {
          id: "sub_test_1",
          status: "paid",
          current_period_end_date: "2026-10-30T00:00:00Z",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(h.recordSubscriptionActiveMock).not.toHaveBeenCalled();
    expect(mockSync).toHaveBeenCalledTimes(1); // 周期仍然照常同步
  });

  it("状态迁移到 canceled → 发射 subscription_canceled（且不动会员周期）", async () => {
    // 必须能匹配到本地订单，否则 handleSubscriptionSync 会在快照之前就返回
    orderDb.set(
      "S20260831120000ABCDEF",
      baseOrder({ payment_status: "paid", api_trade_no: "sub_test_1" })
    );
    h.upsertCreemSubscriptionMock.mockResolvedValueOnce({
      created: false,
      previousStatus: "active",
      statusChanged: true,
    });
    const res = await POST(
      makeWebhookRequest({
        id: "evt_sub_cancel",
        eventType: "subscription.canceled",
        created_at: 1756646400,
        object: { id: "sub_test_1", status: "canceled" },
      })
    );
    expect(res.status).toBe(200);
    expect(h.recordSubscriptionCanceledMock).toHaveBeenCalledTimes(1);
    expect(h.recordSubscriptionActiveMock).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("事件账本命中 duplicate → 直接 200 短路，不触碰订单", async () => {
    h.claimWebhookEventMock.mockResolvedValueOnce("duplicate");
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({ metadata: { out_trade_no: "S20260831120000ABCDEF" } })
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.duplicate).toBe(true);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(h.recordCreemPaymentMock).not.toHaveBeenCalled();
  });

  it("事件账本不可用（claim 抛错）→ 降级处理，权益照常开通", async () => {
    h.claimWebhookEventMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({ metadata: { out_trade_no: "S20260831120000ABCDEF" } })
      )
    );
    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(h.recordCreemPaymentMock).toHaveBeenCalledTimes(1);
  });

  it("事件账本写入失败（finish 抛错）→ 仍 200，不触发无效重投", async () => {
    h.finishWebhookEventMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(
      makeWebhookRequest(
        checkoutCompletedEvent({ metadata: { out_trade_no: "S20260831120000ABCDEF" } })
      )
    );
    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("快照写入失败（upsertCreemSubscription 抛错）→ 不阻塞订阅周期同步", async () => {
    orderDb.set(
      "S20260831120000ABCDEF",
      baseOrder({ payment_status: "paid", api_trade_no: "sub_test_1" })
    );
    h.upsertCreemSubscriptionMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(
      makeWebhookRequest({
        id: "evt_sub_snapfail",
        eventType: "subscription.paid",
        created_at: 1756646400,
        object: {
          id: "sub_test_1",
          status: "paid",
          current_period_end_date: "2026-10-30T00:00:00Z",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledTimes(1);
    // 读不到上一状态 → 宁可不记，也不重复抬高漏斗
    expect(h.recordSubscriptionActiveMock).not.toHaveBeenCalled();
  });

  it("未处理事件类型 → 账本记 ignored（可观测，不当作失败）", async () => {
    const res = await POST(
      makeWebhookRequest({
        id: "evt_unknown_1",
        eventType: "product.created",
        created_at: 1756646400,
        object: { id: "prod_1" },
      })
    );
    expect(res.status).toBe(200);
    expect(h.finishWebhookEventMock).toHaveBeenCalledWith(
      "evt_unknown_1",
      "ignored",
      "unhandled: product.created"
    );
  });
});
