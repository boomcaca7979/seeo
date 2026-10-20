// ===== 阶段 19 遗留 B：订单查询必须区分「查不到」与「查不了」 =====
// 根因：getOrderByOutTradeNoForUser 把三种情况压成同一个 null ——
//   admin 客户端不可用、PostgREST 返回 error（含连接/权限故障）、以及真正的 0 行；
// 调用方 /api/payment/creem/status 再把 null 一律回 404「订单不存在」，
// 于是数据库抖动时支付结果页告诉用户「未找到订单，请重新购买」。
// 修复：服务层返回四态信封（found / absent / foreign / failure）；路由把 failure 映射为 503
// （前端 status-monitor 已把非 2xx 归为 serviceError，显示「服务暂不可用」，
// 不会伪装成支付成功或失败），foreign 映射为 403。
// 订单隐私：foreign 分支不回传任何订单内容；absent 与 foreign 都不泄露金额/套餐/状态。

import { describe, it, expect, vi, beforeEach } from "vitest";

type FakeResult = {
  data?: Record<string, unknown> | null;
  error?: { code?: string; message?: string } | null;
  throw?: Error;
};

const adminState: {
  available: boolean;
  /** 每次 .single() 依序消费一个结果（第二次消费即「归属探测」查询） */
  results: FakeResult[];
  queries: Array<Array<[string, unknown]>>;
} = { available: true, results: [], queries: [] };

const client = {
  from() {
    const eqs: Array<[string, unknown]> = [];
    const chain = {
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        return chain;
      },
      async single() {
        adminState.queries.push(eqs);
        const next = adminState.results.shift();
        if (!next) throw new Error("测试桩：查询次数超出预置结果");
        if (next.throw) throw next.throw;
        return { data: next.data ?? null, error: next.error ?? null };
      },
    };
    return { select: () => chain };
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => (adminState.available ? client : null),
}));

import { getOrderByOutTradeNo, getOrderByOutTradeNoForUser } from "./service";

const ORDER_ROW = {
  id: "o-1",
  user_id: "user-1",
  out_trade_no: "SO-1",
  plan: "pro",
  amount: 99,
  currency: "CNY",
  payment_status: "paid",
  paid_at: "2026-10-17T00:00:00Z",
  period_end: null,
};

/** PostgREST 对 .single() 命中 0 行的真实响应形状（不是普通 error 故障） */
const NO_ROWS: FakeResult = {
  data: null,
  error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
};

const CONNECTION_FAULT: FakeResult = {
  data: null,
  error: { code: "XX000", message: "could not connect to host" },
};

beforeEach(() => {
  adminState.available = true;
  adminState.results = [];
  adminState.queries = [];
});

describe("getOrderByOutTradeNoForUser 的四种结果", () => {
  it("命中记录 → found，且查询同时按订单号与 user_id 过滤（用户隔离未被放宽）", async () => {
    adminState.results = [{ data: ORDER_ROW }];
    const res = await getOrderByOutTradeNoForUser("SO-1", "user-1");
    expect(res).toEqual({ kind: "found", order: ORDER_ROW });
    expect(adminState.queries).toEqual([[["out_trade_no", "SO-1"], ["user_id", "user-1"]]]);
  });

  it("本用户 0 行 + 全局也 0 行 → absent（订单真的不存在），只做两次单行查询", async () => {
    adminState.results = [NO_ROWS, NO_ROWS];
    expect(await getOrderByOutTradeNoForUser("SO-1", "user-1")).toEqual({ kind: "absent" });
    expect(adminState.queries).toEqual([
      [["out_trade_no", "SO-1"], ["user_id", "user-1"]],
      [["out_trade_no", "SO-1"]],
    ]);
  });

  it("本用户 0 行但订单存在于他人账号 → foreign，且信封不含他人订单内容", async () => {
    adminState.results = [NO_ROWS, { data: { ...ORDER_ROW, user_id: "victim-9", amount: 999 } }];
    const res = await getOrderByOutTradeNoForUser("SO-1", "other-user");
    expect(res).toEqual({ kind: "foreign" });
    const json = JSON.stringify(res);
    expect(json).not.toContain("victim-9");
    expect(json).not.toContain("999");
    expect(json).not.toContain("paid");
  });

  it("admin 客户端不可用 → failure（旧实现此时返回 null，被当成「订单不存在」）", async () => {
    adminState.available = false;
    const res = await getOrderByOutTradeNoForUser("SO-1", "user-1");
    expect(res.kind).toBe("failure");
    expect((res as { reason: string }).reason).toBe("ADMIN_CLIENT_UNAVAILABLE");
  });

  it("其他 PostgREST error（连接/权限/5xx）→ failure，并带上原因供日志，不做归属探测", async () => {
    adminState.results = [CONNECTION_FAULT];
    const res = await getOrderByOutTradeNoForUser("SO-1", "user-1");
    expect(res).toEqual({ kind: "failure", reason: "could not connect to host" });
    expect(adminState.queries).toHaveLength(1);
  });

  it("请求抛异常 → failure，不再被 catch 吞成 null", async () => {
    adminState.results = [{ throw: new Error("fetch failed") }];
    expect(await getOrderByOutTradeNoForUser("SO-1", "user-1")).toEqual({
      kind: "failure",
      reason: "fetch failed",
    });
  });

  it("归属探测自身故障 → 仍是 absent（第一次查询已确证不是本人订单），不升级成 503，但必须留下日志", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    adminState.results = [NO_ROWS, CONNECTION_FAULT];
    expect(await getOrderByOutTradeNoForUser("SO-1", "user-1")).toEqual({ kind: "absent" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("归属探测失败"),
      "could not connect to host"
    );
    warn.mockRestore();
  });
});

describe("getOrderByOutTradeNo（无用户条件，webhook 用）同样区分查不到 / 查不了", () => {
  it("命中 → found；PGRST116 → absent", async () => {
    adminState.results = [{ data: ORDER_ROW }, NO_ROWS];
    expect(await getOrderByOutTradeNo("SO-1")).toEqual({ kind: "found", order: ORDER_ROW });
    expect(await getOrderByOutTradeNo("SO-1")).toEqual({ kind: "absent" });
  });

  it("连接故障与 admin 不可用都是 failure（webhook 据此抛错换 500 让 Creem 重投）", async () => {
    adminState.results = [CONNECTION_FAULT];
    expect(await getOrderByOutTradeNo("SO-1")).toEqual({
      kind: "failure",
      reason: "could not connect to host",
    });
    adminState.available = false;
    expect(await getOrderByOutTradeNo("SO-1")).toEqual({
      kind: "failure",
      reason: "ADMIN_CLIENT_UNAVAILABLE",
    });
  });
});
