// ===== Creem 快照 ↔ orders 逐单对账（纯函数）=====

import { describe, it, expect } from "vitest";
import { diffOrdersVsCreemTransactions } from "./revenue";
import type { OrderRow } from "./snapshot";

function order(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "o1",
    user_id: "u1",
    out_trade_no: "NO-1",
    plan: "lite",
    amount: 9.99,
    currency: "USD",
    payment_channel: "creem",
    payment_status: "paid",
    paid_at: "2026-10-01T00:00:00Z",
    refund_status: null,
    refund_amount: null,
    refunded_at: null,
    created_at: "2026-10-01T00:00:00Z",
    period_end: null,
    param: null,
    ...overrides,
  };
}

function txn(overrides: Partial<Parameters<typeof diffOrdersVsCreemTransactions>[1][number]>) {
  return {
    creem_transaction_id: "txn-1",
    out_trade_no: "NO-1",
    amount_cents: 999,
    currency: "USD",
    type: "payment",
    status: "paid",
    ...overrides,
  };
}

describe("diffOrdersVsCreemTransactions", () => {
  it("两侧一致 → 三个缺口全空", () => {
    const gap = diffOrdersVsCreemTransactions([order({})], [txn({})]);
    expect(gap.missingSnapshot).toEqual([]);
    expect(gap.orphan).toEqual([]);
    expect(gap.mismatch).toEqual([]);
  });

  it("订单已支付但快照缺失 → missingSnapshot（历史回补依据）", () => {
    const gap = diffOrdersVsCreemTransactions([order({ out_trade_no: "HIST-1" })], []);
    expect(gap.missingSnapshot).toHaveLength(1);
    expect(gap.missingSnapshot[0]).toMatchObject({
      outTradeNo: "HIST-1",
      cents: 999,
      currency: "USD",
    });
  });

  it("快照有但 orders 无此订单号 → orphan", () => {
    const gap = diffOrdersVsCreemTransactions(
      [],
      [txn({ creem_transaction_id: "txn-x", out_trade_no: "GHOST-1" })]
    );
    expect(gap.orphan).toHaveLength(1);
    expect(gap.orphan[0]).toMatchObject({ creemTransactionId: "txn-x", outTradeNo: "GHOST-1" });
  });

  it("同单号金额不一致 → mismatch", () => {
    const gap = diffOrdersVsCreemTransactions(
      [order({ amount: 19.99 })],
      [txn({ amount_cents: 999 })]
    );
    expect(gap.mismatch).toHaveLength(1);
    expect(gap.mismatch[0]).toMatchObject({ orderCents: 1999, snapshotCents: 999 });
  });

  it("只比对 creem 渠道已支付订单；未支付/refund 快照行不参与", () => {
    const gap = diffOrdersVsCreemTransactions(
      [
        order({ payment_status: "pending" }),
        order({ payment_channel: "yaolipay" }),
      ],
      [
        txn({ status: "failed" }),
        txn({ type: "refund", creem_transaction_id: "r1", out_trade_no: "NO-R" }),
      ]
    );
    expect(gap.missingSnapshot).toEqual([]);
    expect(gap.orphan).toEqual([]);
  });

  it("历史 CNY 订单不被当作 USD 快照差异（按币种原样记录，不换算）", () => {
    const gap = diffOrdersVsCreemTransactions(
      [order({ out_trade_no: "CNY-1", currency: "CNY", amount: 99 })],
      []
    );
    expect(gap.missingSnapshot[0]).toMatchObject({ currency: "CNY", cents: 9900 });
  });
});
