// ===== Owner Console：Customers 数据层测试（纯函数部分）=====
// 覆盖三件容易出错、且直接影响"老板 10 秒判断"的事：
//   1. 客户经营状态分类（Trial / Paying / Canceled / Inactive / Free）互斥且顺序确定；
//   2. 搜索 / 筛选 / 排序是**服务端纯函数**，行为必须可预测（含"从未活跃 ≠ 流失"）；
//   3. 订单金额聚合按币种分组、退款扣减、不跨币种换算。

import { describe, it, expect } from "vitest";
import {
  CUSTOMER_STATUS_FILTERS,
  CUSTOMER_STATUS_LABELS,
  INACTIVE_AFTER_DAYS,
  aggregateOrderRevenue,
  classifyCustomer,
  filterCustomers,
  type CustomerRow,
} from "./customers";
import type { OrderRow } from "./snapshot";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function classify(overrides: Partial<Parameters<typeof classifyCustomer>[0]> = {}) {
  return classifyCustomer({
    plan: "free",
    subscriptionStatus: "inactive",
    currentPeriodEnd: null,
    lastActiveAt: null,
    now: NOW,
    ...overrides,
  });
}

describe("CUSTOMER_STATUS_FILTERS / LABELS", () => {
  it("筛选器枚举与文案一一对应（UI chips 直接按其渲染）", () => {
    for (const key of CUSTOMER_STATUS_FILTERS) {
      expect(CUSTOMER_STATUS_LABELS[key], `缺少文案：${key}`).toBeTruthy();
    }
    expect(CUSTOMER_STATUS_FILTERS).toEqual([
      "all",
      "free",
      "trial",
      "paying",
      "canceled",
      "inactive",
    ]);
  });
});

describe("classifyCustomer：状态分类", () => {
  it("试用中 → trial（优先于 paying）", () => {
    expect(
      classify({
        plan: "pro",
        subscriptionStatus: "trialing",
        currentPeriodEnd: daysAgo(-10),
      })
    ).toBe("trial");
  });

  it("有效订阅 + 付费档 → paying", () => {
    expect(
      classify({ plan: "lite", subscriptionStatus: "active", currentPeriodEnd: daysAgo(-10) })
    ).toBe("paying");
    expect(
      classify({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: daysAgo(-10) })
    ).toBe("paying");
  });

  it("免费档即使 status=active 也不算 paying", () => {
    expect(
      classify({ plan: "free", subscriptionStatus: "active", currentPeriodEnd: daysAgo(-10) })
    ).toBe("free");
  });

  it("订阅已过期（period_end 在过去）→ 不算 paying，回落 free", () => {
    expect(
      classify({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: daysAgo(3) })
    ).toBe("free");
  });

  it("无 period_end 视为有效（兼容老数据）", () => {
    expect(classify({ plan: "lite", subscriptionStatus: "active", currentPeriodEnd: null })).toBe(
      "paying"
    );
  });

  it("canceled / expired → canceled（即使 plan 是付费档）", () => {
    expect(classify({ plan: "pro", subscriptionStatus: "canceled" })).toBe("canceled");
    expect(classify({ plan: "pro", subscriptionStatus: "expired" })).toBe("canceled");
  });

  it(`超过 ${INACTIVE_AFTER_DAYS} 天无活动 → inactive`, () => {
    expect(classify({ lastActiveAt: daysAgo(31) })).toBe("inactive");
    expect(classify({ lastActiveAt: daysAgo(INACTIVE_AFTER_DAYS + 1) })).toBe("inactive");
  });

  it("边界：刚好 30 天算活跃；刚注册（从未活跃）不算流失", () => {
    expect(classify({ lastActiveAt: daysAgo(INACTIVE_AFTER_DAYS - 1) })).toBe("free");
    expect(classify({ lastActiveAt: null })).toBe("free");
  });

  it("无法解析的 lastActiveAt 不当成流失", () => {
    expect(classify({ lastActiveAt: "not-a-date" })).toBe("free");
  });

  it("canceled 优先于 inactive（终态不该被活动时间改写）", () => {
    expect(classify({ subscriptionStatus: "canceled", lastActiveAt: daysAgo(90) })).toBe("canceled");
  });
});

// ---------- filterCustomers ----------

function row(over: Partial<CustomerRow> & { userId: string }): CustomerRow {
  return {
    email: `${over.userId}@example.com`,
    displayName: null,
    signupAt: daysAgo(10),
    status: "free",
    plan: "free",
    effectivePlan: "free",
    subscriptionStatus: "inactive",
    currentPeriodEnd: null,
    source: null,
    medium: null,
    campaign: null,
    landingPage: null,
    lastActiveAt: null,
    lastSeenAt: null,
    projects: 0,
    audits: 0,
    featureUses: 0,
    features: [],
    revenue: [],
    paidOrders: 0,
    lastPaidAt: null,
    ...over,
  };
}

describe("filterCustomers：筛选 / 搜索 / 排序", () => {
  const rows: CustomerRow[] = [
    row({
      userId: "u1",
      email: "alice@acme.com",
      displayName: "Alice",
      status: "paying",
      signupAt: daysAgo(1),
      lastActiveAt: daysAgo(1),
      revenue: [{ currency: "USD", cents: 9900 }],
    }),
    row({
      userId: "u2",
      email: "bob@beta.io",
      status: "free",
      signupAt: daysAgo(5),
      lastActiveAt: daysAgo(2),
      revenue: [],
    }),
    row({
      userId: "u3",
      email: "carol@gamma.dev",
      status: "canceled",
      signupAt: daysAgo(9),
      lastActiveAt: daysAgo(8),
      revenue: [{ currency: "USD", cents: 14900 }],
    }),
  ];

  it("默认：全部 + 按注册时间倒序（最新在前）", () => {
    expect(filterCustomers(rows, {}).map((r) => r.userId)).toEqual(["u1", "u2", "u3"]);
  });

  it("状态筛选互斥", () => {
    expect(filterCustomers(rows, { status: "paying" }).map((r) => r.userId)).toEqual(["u1"]);
    expect(filterCustomers(rows, { status: "canceled" }).map((r) => r.userId)).toEqual(["u3"]);
    expect(filterCustomers(rows, { status: "free" }).map((r) => r.userId)).toEqual(["u2"]);
    expect(filterCustomers(rows, { status: "all" })).toHaveLength(3);
  });

  it("搜索命中 email / 显示名 / userId，大小写不敏感", () => {
    expect(filterCustomers(rows, { search: "ACME" }).map((r) => r.userId)).toEqual(["u1"]);
    expect(filterCustomers(rows, { search: "alice" }).map((r) => r.userId)).toEqual(["u1"]);
    expect(filterCustomers(rows, { search: "u3" }).map((r) => r.userId)).toEqual(["u3"]);
    expect(filterCustomers(rows, { search: "  " })).toHaveLength(3);
    expect(filterCustomers(rows, { search: "zzz" })).toHaveLength(0);
  });

  it("搜索与状态筛选叠加", () => {
    expect(filterCustomers(rows, { status: "free", search: "beta" }).map((r) => r.userId)).toEqual([
      "u2",
    ]);
    expect(filterCustomers(rows, { status: "paying", search: "beta" })).toHaveLength(0);
  });

  it("按最近活跃倒序（无活跃记录排最后）", () => {
    const withNull = [...rows, row({ userId: "u4", status: "free", lastActiveAt: null })];
    expect(filterCustomers(withNull, { sort: "lastActive" }).map((r) => r.userId)).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
    ]);
  });

  it("按收入倒序（同收入回落到注册时间）", () => {
    expect(filterCustomers(rows, { sort: "revenue" }).map((r) => r.userId)).toEqual([
      "u3",
      "u1",
      "u2",
    ]);
  });

  it("不修改入参数组（服务端渲染下同一快照可能被多处复用）", () => {
    const input = [...rows];
    filterCustomers(input, { sort: "revenue" });
    expect(input.map((r) => r.userId)).toEqual(["u1", "u2", "u3"]);
  });
});

// ---------- aggregateOrderRevenue ----------

function order(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o1",
    user_id: "u1",
    out_trade_no: "S1",
    plan: "lite",
    amount: 9.9,
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
    ...over,
  };
}

describe("aggregateOrderRevenue：订单金额聚合", () => {
  it("只统计 paid / refunded 订单，金额转分", () => {
    const r = aggregateOrderRevenue([
      order({ id: "o1", amount: 9.9 }),
      order({ id: "o2", payment_status: "pending", amount: 100 }),
      order({ id: "o3", payment_status: "failed", amount: 100 }),
    ]);
    expect(r.byCurrency.get("USD")).toBe(990);
    expect(r.paidOrders).toBe(1);
  });

  it("退款从同币种收入中扣减（不跨币种换算）", () => {
    const r = aggregateOrderRevenue([
      order({ id: "o1", amount: 9.9 }),
      order({
        id: "o2",
        amount: 9.9,
        payment_status: "refunded",
        refund_status: "success",
        refund_amount: 4.9,
      }),
    ]);
    // 两笔 paid（含 refunded 订单本身）+ 扣掉 4.9 退款
    expect(r.byCurrency.get("USD")).toBe(990 + 990 - 490);
    expect(r.paidOrders).toBe(2);
  });

  it("多币种分列，不做汇率换算", () => {
    const r = aggregateOrderRevenue([
      order({ id: "o1", amount: 9.9, currency: "USD" }),
      order({ id: "o2", amount: 68, currency: "CNY" }),
      order({ id: "o3", amount: 9.9, currency: "usd" }), // 大小写
    ]);
    expect(r.byCurrency.get("USD")).toBe(1980);
    expect(r.byCurrency.get("CNY")).toBe(6800);
  });

  it("lastPaidAt 取最晚一次付费时间；无付费为 null", () => {
    const r = aggregateOrderRevenue([
      order({ id: "o1", paid_at: "2026-09-01T00:00:00Z" }),
      order({ id: "o2", paid_at: "2026-10-05T00:00:00Z" }),
    ]);
    expect(r.lastPaidAt).toBe("2026-10-05T00:00:00Z");
    expect(aggregateOrderRevenue([]).lastPaidAt).toBeNull();
    expect(aggregateOrderRevenue([]).paidOrders).toBe(0);
  });

  it("无订单 → 空映射（UI 显示 0，而不是 unavailable）", () => {
    expect(aggregateOrderRevenue([]).byCurrency.size).toBe(0);
  });
});

// ===== 订单去重（防分页重叠把同一订单读两遍）=====
describe("dedupeOrdersById", () => {
  const base = {
    id: "ord-1",
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
  };

  it("同一订单 id 出现两次 → 只保留一次（收入不翻倍）", async () => {
    const { dedupeOrdersById, aggregateOrderRevenue } = await import("./customers");
    const dup = [
      { ...base },
      { ...base },
      { ...base, id: "ord-2", amount: 5 },
    ];
    const deduped = dedupeOrdersById(dup as never[]);
    expect(deduped).toHaveLength(2);
    const agg = aggregateOrderRevenue(deduped);
    expect(agg.paidOrders).toBe(2);
    expect(agg.byCurrency.get("USD")).toBe(999 + 500);
  });

  it("无 id 的行原样保留（不因缺 id 丢数据）", async () => {
    const { dedupeOrdersById } = await import("./customers");
    const rows = [{ ...base, id: null }, { ...base, id: null }];
    expect(dedupeOrdersById(rows as never[])).toHaveLength(2);
  });
});
