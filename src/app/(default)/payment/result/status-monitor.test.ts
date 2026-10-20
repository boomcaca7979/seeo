// ===== BUG-02 定向测试：支付结果页状态机 =====
// 契约来源（不为了通过测试修改生产规则）：
//   - /api/payment/creem/status：401 AUTH_REQUIRED / 400 MISSING_ORDER /
//     404 ORDER_NOT_FOUND / 200 { data: { paymentStatus: pending|paid|failed|refunded, … } }
//   - 订单状态只由 Creem webhook → completeOrder 写入（src/lib/orders/service.ts）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MAX_POLLS,
  POLL_INTERVAL_MS,
  PaymentStatusMonitor,
  canRetry,
  checkOrderStatus,
  classifyResponse,
  deriveResultView,
  isOrderSnapshot,
  statusUrl,
  type MonitorState,
  type OrderSnapshot,
  type StatusFetch,
  type StatusFetchResponse,
} from "./status-monitor";

interface Reply {
  status: number;
  body?: unknown;
  /** json() 抛错（返回体不是合法 JSON，例如网关 HTML 页） */
  jsonThrows?: boolean;
  /** fetch 本身 reject（网络错误） */
  networkError?: boolean;
}

const ORDER: OrderSnapshot = {
  outTradeNo: "S20261017120000ABCDEF",
  plan: "pro",
  amount: 19,
  currency: "USD",
  paymentStatus: "pending",
  paidAt: null,
  periodEnd: null,
};

function body(status: OrderSnapshot["paymentStatus"], over: Partial<OrderSnapshot> = {}) {
  return { data: { ...ORDER, paymentStatus: status, ...over } };
}

function recorder(replies: Reply[]) {
  const calls: { url: string; init: { cache: "no-store"; signal?: AbortSignal } }[] = [];
  let n = 0;
  const fn: StatusFetch = async (input, init) => {
    calls.push({ url: input, init });
    const spec = replies[Math.min(n, replies.length - 1)];
    n += 1;
    if (spec.networkError) throw new TypeError("Failed to fetch");
    return {
      status: spec.status,
      json: async () => {
        if (spec.jsonThrows) throw new SyntaxError("Unexpected token < in JSON");
        return spec.body;
      },
    };
  };
  return { fn, calls, count: () => calls.length };
}

function makeMonitor(
  rec: ReturnType<typeof recorder>,
  opts: { maxPolls?: number; intervalMs?: number } = {}
) {
  const states: MonitorState[] = [];
  const monitor = new PaymentStatusMonitor("S20261017120000ABCDEF", {
    fetch: rec.fn,
    maxPolls: opts.maxPolls ?? 4,
    intervalMs: opts.intervalMs ?? 1000,
    onChange: (s) => states.push(s),
  });
  return {
    monitor,
    states,
    view: () => deriveResultView(monitor.getState()),
    last: () => states[states.length - 1],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("响应判定：只相信真实支付状态字段", () => {
  it("200 + pending / paid / failed / refunded 原样映射为订单结果", () => {
    for (const status of ["pending", "paid", "failed", "refunded"] as const) {
      const outcome = classifyResponse(200, body(status));
      expect(outcome).toEqual({ kind: "order", order: { ...ORDER, paymentStatus: status } });
    }
  });

  it("200 但缺少/非法 data 字段不得判定为支付成功", () => {
    expect(classifyResponse(200, undefined)).toEqual({ kind: "serviceError" });
    expect(classifyResponse(200, {})).toEqual({ kind: "serviceError" });
    expect(classifyResponse(200, { data: null })).toEqual({ kind: "serviceError" });
    expect(classifyResponse(200, "gateway html")).toEqual({ kind: "serviceError" });
    expect(
      classifyResponse(200, { data: { ...ORDER, paymentStatus: "processing_ok" } })
    ).toEqual({ kind: "serviceError" });
    expect(deriveResultView({ phase: "idle", outcome: classifyResponse(200, {}), polls: 1, exhausted: false })).toBe(
      "serviceError"
    );
  });

  it("isOrderSnapshot 校验字段类型（金额/币种/状态缺一不可）", () => {
    expect(isOrderSnapshot(ORDER)).toBe(true);
    expect(isOrderSnapshot({ ...ORDER, amount: "19" })).toBe(false);
    expect(isOrderSnapshot({ ...ORDER, paymentStatus: null })).toBe(false);
    expect(isOrderSnapshot(null)).toBe(false);
  });

  it("401 / 403 / 400 / 404 各自区分，且不落入「支付失败」", () => {
    expect(classifyResponse(401, { code: "AUTH_REQUIRED" })).toEqual({ kind: "authRequired" });
    expect(classifyResponse(403, { code: "FORBIDDEN" })).toEqual({ kind: "forbidden" });
    expect(classifyResponse(400, { code: "MISSING_ORDER" })).toEqual({ kind: "invalidOrder" });
    expect(classifyResponse(404, { code: "ORDER_NOT_FOUND" })).toEqual({ kind: "invalidOrder" });
    expect(deriveResultView({ phase: "idle", outcome: classifyResponse(401, {}), polls: 1, exhausted: false })).toBe(
      "authRequired"
    );
  });

  it("429 / 5xx / 非 2xx 一律为查询服务失败（不代表支付结果）", () => {
    for (const status of [429, 500, 502, 503, 302]) {
      expect(classifyResponse(status, { error: "boom" })).toEqual({ kind: "serviceError" });
    }
  });
});

describe("单次查询：URL 契约与异常处理", () => {
  it("订单号做 URL 编码并携带 no-store + signal", async () => {
    const rec = recorder([{ status: 200, body: body("paid") }]);
    const controller = new AbortController();
    const outcome = await checkOrderStatus("seeo probe/001", rec.fn, controller.signal);
    expect(statusUrl("seeo probe/001")).toBe("/api/payment/creem/status?order=seeo%20probe%2F001");
    expect(rec.calls[0].url).toBe("/api/payment/creem/status?order=seeo%20probe%2F001");
    expect(rec.calls[0].init.cache).toBe("no-store");
    expect(rec.calls[0].init.signal).toBe(controller.signal);
    expect(outcome).toEqual({ kind: "order", order: { ...ORDER, paymentStatus: "paid" } });
  });

  it("网络错误 → serviceError；已中止 → aborted；非法 JSON → serviceError", async () => {
    const net = recorder([{ status: 0, networkError: true }]);
    expect(await checkOrderStatus("X", net.fn, new AbortController().signal)).toEqual({
      kind: "serviceError",
    });

    const badJson = recorder([{ status: 200, jsonThrows: true }]);
    expect(await checkOrderStatus("X", badJson.fn, new AbortController().signal)).toEqual({
      kind: "serviceError",
    });

    const aborted = recorder([{ status: 200, body: body("paid") }]);
    const controller = new AbortController();
    controller.abort();
    expect(await checkOrderStatus("X", aborted.fn, controller.signal)).toEqual({ kind: "aborted" });
    expect(aborted.count()).toBe(0);
  });
});

describe("轮询生命周期：有上限、终止即停", () => {
  it("pending → 渠道确认后转成功：停止轮询且不再发请求", async () => {
    const rec = recorder([{ status: 200, body: body("pending") }, { status: 200, body: body("paid") }]);
    const { monitor, view, states } = makeMonitor(rec, { maxPolls: 10 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(3000);

    expect(view()).toBe("paid");
    expect(states.some((s) => deriveResultView(s) === "confirming")).toBe(true);
    expect(rec.count()).toBe(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(rec.count()).toBe(2);
    expect(canRetry("paid")).toBe(false);
  });

  it("一直 pending 时到上限即终止为「无法确认」，并保留真实查询次数", async () => {
    const rec = recorder([{ status: 200, body: body("pending") }]);
    const { monitor, view } = makeMonitor(rec, { maxPolls: 5, intervalMs: 1000 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(60000);

    expect(rec.count()).toBe(5);
    expect(monitor.getState().polls).toBe(5);
    expect(monitor.getState().exhausted).toBe(true);
    expect(view()).toBe("timeout");
    expect(canRetry(view())).toBe(true);
  });

  it("生产默认上限是有限值（20 次 × 3s），不是无限轮询", async () => {
    expect(MAX_POLLS).toBe(20);
    expect(POLL_INTERVAL_MS).toBe(3000);
    const rec = recorder([{ status: 200, body: body("pending") }]);
    const monitor = new PaymentStatusMonitor("X", { fetch: rec.fn, onChange: () => {} });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * (MAX_POLLS + 3));
    expect(rec.count()).toBe(MAX_POLLS);
    expect(deriveResultView(monitor.getState())).toBe("timeout");
  });

  it("401 立即停止轮询：不重复请求同一个无效会话", async () => {
    const rec = recorder([{ status: 401, body: { code: "AUTH_REQUIRED" } }]);
    const { monitor, view } = makeMonitor(rec, { maxPolls: 10 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(120000);

    expect(rec.count()).toBe(1);
    expect(view()).toBe("authRequired");
    // 会话失效时不提供重试入口，且重试入口本身也不会再次请求同一个无效会话
    expect(canRetry(view())).toBe(false);
    monitor.checkOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(rec.count()).toBe(1);
  });

  it("403 / 404 各自终止为「无权查看」「未找到订单」", async () => {
    const forbidden = recorder([{ status: 403, body: { code: "FORBIDDEN" } }]);
    const f = makeMonitor(forbidden, { maxPolls: 10 });
    f.monitor.startAuto();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.view()).toBe("forbidden");
    expect(forbidden.count()).toBe(1);

    const notFound = recorder([{ status: 404, body: { code: "ORDER_NOT_FOUND" } }]);
    const n = makeMonitor(notFound, { maxPolls: 10 });
    n.monitor.startAuto();
    await vi.advanceTimersByTimeAsync(60000);
    expect(n.view()).toBe("invalidOrder");
    expect(notFound.count()).toBe(1);
  });

  it("服务端 5xx 视为查询服务抖动：在预算内继续轮询，超预算后停在「服务暂不可用」", async () => {
    const rec = recorder([
      { status: 503, body: { error: "upstream" } },
      { status: 503, body: { error: "upstream" } },
      { status: 200, body: body("paid") },
    ]);
    const { monitor, view } = makeMonitor(rec, { maxPolls: 6, intervalMs: 1000 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(2500);
    expect(view()).toBe("paid");
    expect(rec.count()).toBe(3);

    const alwaysDown = recorder([{ status: 500, body: { error: "boom" } }]);
    const down = makeMonitor(alwaysDown, { maxPolls: 3, intervalMs: 1000 });
    down.monitor.startAuto();
    await vi.advanceTimersByTimeAsync(30000);
    expect(alwaysDown.count()).toBe(3);
    expect(down.view()).toBe("serviceError");
    // 服务失败 ≠ 支付失败
    expect(down.view()).not.toBe("failed");
  });

  it("网络错误同样终止为「服务暂不可用」并可重试", async () => {
    const rec = recorder([{ status: 0, networkError: true }]);
    const { monitor, view } = makeMonitor(rec, { maxPolls: 2, intervalMs: 1000 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(20000);
    expect(rec.count()).toBe(2);
    expect(view()).toBe("serviceError");
    expect(canRetry(view())).toBe(true);
  });
});

describe("手动重试：一次有界检查，不并行、不成环", () => {
  it("到上限后重试只发一次请求；仍 pending → 「仍在处理中」，不是无限循环", async () => {
    const rec = recorder([{ status: 200, body: body("pending") }]);
    const { monitor, view } = makeMonitor(rec, { maxPolls: 3, intervalMs: 1000 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(30000);
    expect(view()).toBe("timeout");
    expect(rec.count()).toBe(3);

    monitor.checkOnce();
    await vi.advanceTimersByTimeAsync(30000);
    expect(rec.count()).toBe(4);
    expect(view()).toBe("processing");
    expect(monitor.getState().polls).toBe(3);

    monitor.checkOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(rec.count()).toBe(5);
  });

  it("重试拿到确认结果 → 成功态", async () => {
    const rec = recorder([{ status: 200, body: body("pending") }, { status: 200, body: body("paid") }]);
    const { monitor, view } = makeMonitor(rec, { maxPolls: 1, intervalMs: 1000 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(10000);
    expect(view()).toBe("timeout");
    monitor.checkOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(view()).toBe("paid");
    expect(rec.count()).toBe(2);
  });

  it("连点重试不会产生并行请求", async () => {
    const deferred: { resolve?: (v: StatusFetchResponse) => void } = {};
    const calls: string[] = [];
    const monitor = new PaymentStatusMonitor("X", {
      fetch: (input) => {
        calls.push(input);
        return new Promise<StatusFetchResponse>((resolve) => {
          deferred.resolve = resolve;
        });
      },
      maxPolls: 5,
      intervalMs: 1000,
      onChange: () => {},
    });
    monitor.checkOnce();
    monitor.checkOnce();
    monitor.checkOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.length).toBe(1);

    deferred.resolve?.({ status: 200, json: async () => body("paid") });
    await vi.advanceTimersByTimeAsync(0);
    expect(deriveResultView(monitor.getState())).toBe("paid");
  });

  it("重复 startAuto 不会叠加定时器（StrictMode 双挂载只保留一条轮询链）", async () => {
    const rec = recorder([{ status: 200, body: body("pending") }]);
    const { monitor } = makeMonitor(rec, { maxPolls: 4, intervalMs: 1000 });
    monitor.startAuto();
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.count()).toBe(4);
  });
});

describe("卸载与陈旧响应", () => {
  it("dispose 清空定时器并中止在途请求，晚到的响应不改变状态", async () => {
    const deferred: { resolve?: (v: StatusFetchResponse) => void } = {};
    const seenSignals: (AbortSignal | undefined)[] = [];
    const monitor = new PaymentStatusMonitor("X", {
      fetch: (_input, init) => {
        seenSignals.push(init.signal);
        return new Promise<StatusFetchResponse>((resolve) => {
          deferred.resolve = resolve;
        });
      },
      maxPolls: 5,
      intervalMs: 1000,
      onChange: () => {},
    });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(0);
    monitor.dispose();
    expect(seenSignals[0]?.aborted).toBe(true);

    const before = monitor.getState();
    deferred.resolve?.({ status: 200, json: async () => body("paid") });
    await vi.advanceTimersByTimeAsync(60000);
    expect(monitor.getState()).toBe(before);
    expect(deriveResultView(monitor.getState())).toBe("checking");

    // dispose 后 startAuto / checkOnce 都不再发起请求
    monitor.startAuto();
    monitor.checkOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(seenSignals.length).toBe(1);
  });

  it("重新 startAuto 会重开一条有界轮询链（计数重置、不叠加旧链）", async () => {
    const rec = recorder([{ status: 200, body: body("pending") }]);
    const { monitor, view } = makeMonitor(rec, { maxPolls: 3, intervalMs: 1000 });
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.getState().polls).toBe(2);
    monitor.startAuto();
    await vi.advanceTimersByTimeAsync(5000);
    expect(monitor.getState().polls).toBe(3);
    expect(view()).toBe("timeout");
  });
});

describe("可见状态与文案键一一对应", () => {
  it("每种状态唯一：正在确认 / 成功 / 仍在处理 / 无法确认 / 登录失效 / 无权查看 / 服务暂不可用 / 无效订单", () => {
    const cases: [MonitorState, string][] = [
      [{ phase: "idle", outcome: null, polls: 0, exhausted: false }, "checking"],
      [{ phase: "polling", outcome: { kind: "order", order: ORDER }, polls: 2, exhausted: false }, "confirming"],
      [
        { phase: "idle", outcome: { kind: "order", order: { ...ORDER, paymentStatus: "paid" } }, polls: 3, exhausted: false },
        "paid",
      ],
      [
        { phase: "idle", outcome: { kind: "order", order: { ...ORDER, paymentStatus: "failed" } }, polls: 3, exhausted: false },
        "failed",
      ],
      [
        { phase: "idle", outcome: { kind: "order", order: { ...ORDER, paymentStatus: "refunded" } }, polls: 3, exhausted: false },
        "refunded",
      ],
      [{ phase: "idle", outcome: { kind: "order", order: ORDER }, polls: 3, exhausted: false }, "processing"],
      [{ phase: "idle", outcome: { kind: "order", order: ORDER }, polls: 20, exhausted: true }, "timeout"],
      [{ phase: "idle", outcome: { kind: "authRequired" }, polls: 1, exhausted: false }, "authRequired"],
      [{ phase: "idle", outcome: { kind: "forbidden" }, polls: 1, exhausted: false }, "forbidden"],
      [{ phase: "idle", outcome: { kind: "serviceError" }, polls: 1, exhausted: false }, "serviceError"],
      [{ phase: "idle", outcome: { kind: "invalidOrder" }, polls: 1, exhausted: false }, "invalidOrder"],
    ];
    for (const [state, expected] of cases) {
      expect(deriveResultView(state)).toBe(expected);
    }
    const views = cases.map(([, v]) => v);
    expect(new Set(views).size).toBe(views.length);
  });

  it("只有未确认/服务类状态提供重试入口；401 与订单终态不提供", () => {
    expect(["timeout", "processing", "serviceError", "forbidden"].every((v) => canRetry(v as never))).toBe(true);
    for (const v of ["paid", "failed", "refunded", "authRequired", "checking", "confirming", "invalidOrder"] as const) {
      expect(canRetry(v)).toBe(false);
    }
  });
});
