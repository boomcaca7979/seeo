// ===== 认证/身份请求的有界等待、故障归类与留痕 =====
// 生产事故形状：认证上游半开连接时，`supabase.auth.getUser()` 既不返回也不报错，
// 整条请求挂到运行时默认超时，浏览器侧表现为「点了登录长时间没反应」。
// 本文件锁四件事：到点必 abort；外部取消优先且不被覆盖；整趟 deadline；
// 故障归类与「上游不可用」判据；日志字段只含安全信息。
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyAuthFailure,
  createBoundedFetch,
  isAuthUnavailable,
  logAuthUpstreamFailure,
  withRequestDeadline,
} from "./bounded-fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 永不自行 settle 的 fetch：只在 signal abort 时按 signal.reason 拒绝（真实网络挂起的形状）。
 *  已处于 aborted 状态的 signal 必须立刻拒绝 —— 这正是真实 fetch 的行为。 */
function stubHangingFetch() {
  return vi.fn(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(signal.reason ?? new DOMException("aborted", "AbortError"));
        });
      }),
  );
}

describe("createBoundedFetch", () => {
  it("上游按时返回 → 原样透传，并把 AbortSignal 交给底层 fetch", async () => {
    const seen: Array<RequestInit | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        seen.push(init);
        return new Response("ok");
      }),
    );

    const res = await createBoundedFetch(1000)("https://x/auth/v1/user", { method: "GET" });

    expect(await res.text()).toBe("ok");
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.method).toBe("GET");
  });

  it("超过上限 → 主动 abort 并拒绝为 TimeoutError（auth-js 会把它归入可重试错误）", async () => {
    vi.useFakeTimers();
    const hanging = stubHangingFetch();
    vi.stubGlobal("fetch", hanging);

    const pending = createBoundedFetch(500)("https://x/auth/v1/user");
    // 断言必须先挂上处理器，再推进计时器：否则拒绝发生在两个 await 之间，
    // Node 会记一次「未处理拒绝」（测试本身仍会过，但门禁会被污染）。
    const assertion = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(501);

    await assertion;
  });

  it("请求提前结束 → 计时器被清理，不留下挂着的定时器", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );

    await createBoundedFetch(5000)("https://x/auth/v1/user");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("调用方取消优先：外部 signal abort → 立刻按原因拒绝，无需等上限", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", stubHangingFetch());

    const pending = createBoundedFetch(60_000)("https://x/auth/v1/user", { signal: ctrl.signal });
    ctrl.abort();

    await expect(pending).rejects.toBeInstanceOf(Error);
  });

  it("外部 signal 已处于 aborted 状态 → 不发出等待中的请求结果", async () => {
    const ctrl = new AbortController();
    ctrl.abort(new DOMException("已取消", "AbortError"));
    vi.stubGlobal("fetch", stubHangingFetch());

    await expect(
      createBoundedFetch(60_000)("https://x/auth/v1/user", { signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

// 响应头到达即解除 abort，因此「慢 body」仍可能长时间挂着；身份读取用整趟
// deadline 补这一段。这里锁：到期即判失败、绝不伪造值、原始 Promise 稍后拒绝
// 不会变成未处理拒绝（那正是生产日志里的第二条 Unhandled Rejection）。
describe("withRequestDeadline：整趟硬上限", () => {
  it("原始 Promise 先完成 → 原样透传结果，计时器清理干净", async () => {
    vi.useFakeTimers();
    const r = await withRequestDeadline(Promise.resolve("session"), 1000);
    expect(r).toEqual({ ok: true, value: "session" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("整趟到期 → 判失败（timeout），不返回任何身份值", async () => {
    vi.useFakeTimers();
    let rejectLate: (e: unknown) => void = () => {};
    const hanging = new Promise<string>((_resolve, reject) => {
      rejectLate = reject;
    });

    const watcher = withRequestDeadline(hanging, 100);
    await vi.advanceTimersByTimeAsync(101);

    const r = await watcher;
    expect(r.ok).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    // 到期之后上游才失败：不得冒出来污染结果，也不得留下未处理拒绝
    rejectLate(new TypeError("fetch failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(await watcher).toBe(r);
  });

  it("原始 Promise 先失败 → 带上真实 error，交由调用方归类", async () => {
    const failing = Promise.reject(new DOMException("上游认证请求超时", "TimeoutError"));
    const r = await withRequestDeadline(failing, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(classifyAuthFailure(r.error)).toMatchObject({ category: "timeout" });
    }
  });
});

describe("classifyAuthFailure 故障归类", () => {
  const cases: Array<[string, unknown, string, number | null]> = [
    ["TimeoutError", { name: "TimeoutError" }, "timeout", null],
    ["AbortError", { name: "AbortError" }, "aborted", null],
    ["429", { name: "AuthApiError", status: 429 }, "rate_limited", 429],
    ["502", { name: "AuthApiError", status: 502 }, "upstream_5xx", 502],
    [
      "AuthRetryableFetchError status 0",
      { name: "AuthRetryableFetchError", status: 0 },
      "network_error",
      0,
    ],
    [
      "裸 TypeError",
      new TypeError("fetch failed"),
      "network_error",
      null,
    ],
    ["401", { name: "AuthApiError", status: 401 }, "unknown", 401],
    ["400 无会话", { name: "AuthSessionMissingError", status: 400 }, "unknown", 400],
    ["无 status 的字符串", "boom", "unknown", null],
    ["越界 status 不外泄", { name: "X", status: 99999 }, "unknown", null],
  ];

  it.each(cases)("%s → %s", (_label, error, category, status) => {
    expect(classifyAuthFailure(error)).toEqual({ category, status });
  });
});

describe("isAuthUnavailable 判据（未登录 ≠ 上游不可用）", () => {
  const cases: Array<[string, unknown, boolean]> = [
    ["null", null, false],
    ["字符串", "fetch failed", false],
    ["AuthRetryableFetchError", { name: "AuthRetryableFetchError", status: 0 }, true],
    ["AuthUnknownError", { name: "AuthUnknownError" }, true],
    ["TimeoutError", { name: "TimeoutError" }, true],
    ["AbortError", { name: "AbortError" }, true],
    ["status 0", { name: "X", status: 0 }, true],
    ["429", { name: "AuthApiError", status: 429 }, true],
    ["502", { name: "AuthApiError", status: 502 }, true],
    ["401", { name: "AuthApiError", status: 401 }, false],
    ["403", { name: "AuthApiError", status: 403 }, false],
    ["AuthSessionMissingError", { name: "AuthSessionMissingError", status: 400 }, false],
  ];
  it.each(cases)("%s → %s", (_label, error, expected) => {
    expect(isAuthUnavailable(error)).toBe(expected);
  });
});

describe("logAuthUpstreamFailure 只输出安全字段", () => {
  afterEach(() => vi.restoreAllMocks());

  it("一条 warning：阶段 / 路径类别 / 故障类别 / 状态码", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logAuthUpstreamFailure({
      stage: "dashboard_session",
      pathCategory: "dashboard_render",
      error: { name: "AuthApiError", status: 503 },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("[AuthUpstream]");
    expect(spy.mock.calls[0][1]).toEqual({
      stage: "dashboard_session",
      path: "dashboard_render",
      category: "upstream_5xx",
      status: 503,
    });
  });

  it("绝不回显 message：里面可能塞着 JWT / 邮箱 / Cookie", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logAuthUpstreamFailure({
      stage: "proxy_auth",
      pathCategory: "login",
      error: {
        name: "AuthRetryableFetchError",
        status: 0,
        message:
          "Authorization: Bearer eyJhbGciOiJIU251r5e nba@example.com sb-refresh-token Cookie",
      },
    });
    const out = JSON.stringify(spy.mock.calls);
    for (const forbidden of ["eyJhbGci", "Bearer", "nba@", "Cookie", "refresh", "Authorization"]) {
      expect(out, forbidden).not.toContain(forbidden);
    }
  });

  it("异常形状（字符串 / null / undefined）也不崩", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const error of ["boom", null, undefined, 42]) {
      expect(() =>
        logAuthUpstreamFailure({ stage: "proxy_auth", pathCategory: "other", error })
      ).not.toThrow();
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });
});
