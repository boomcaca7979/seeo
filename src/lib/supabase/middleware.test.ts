// ===== proxy 层的资源型 404 路由 =====
// /app/projects/<无效 id> 的文档请求必须在「首个服务器响应」就进 404 路由：
// 页面里的 notFound() 在动态渲染下只能得到 Next 的 __next_error__ 错误壳
// （<html> 无 lang、body 空、robots 两份）。这里锁死改写边界：
//   1. 只有文档 GET + 数据源确认缺失 → rewrite 到 /_not-found（并转发 x-seeo-pathname，
//      404 的界面语言解析要看原始路径）；
//   2. 读取故障绝不改写（否则 DB 挂了会把真实项目说成不存在）；
//   3. RSC（站内点击）不改写，交回页面的 notFound() 命中 dashboard 的 not-found 边界；
//   4. 未登录仍先跳 /login（原有保护顺序不变）；
//   5. 改写响应要带上本次刷新的会话 cookie（rewrite 返回的是新响应对象）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const cfg = { isAuthEnabled: false };
vi.mock("@/lib/auth-config", () => ({
  get isAuthEnabled() {
    return cfg.isAuthEnabled;
  },
}));

// demo 分支的项目读取走 @/lib/db；测试进程不碰任何真实库
vi.mock("@/lib/db", () => ({ getProjectById: vi.fn() }));

const auth = {
  user: null as { id: string } | null,
  row: null as Record<string, unknown> | null,
  error: null as { code?: string; message?: string } | null,
  filters: [] as Array<[string, unknown]>,
  refresh: false,
  /** getUser 返回的 error 字段（auth-js 把网络级失败归入 AuthRetryableFetchError） */
  userError: null as { name?: string; status?: number } | null,
  /** getUser 直接抛出（裸 TypeError: fetch failed 的形状） */
  userThrows: null as Error | null,
};

/** 捕获传给 createServerClient 的 options，用于断言超时 fetch 已接线 */
const clientOptions: Array<{ global?: { fetch?: unknown } }> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (
      _url: string,
      _key: string,
      options: {
        cookies: { setAll: (c: unknown[]) => void };
        global?: { fetch?: unknown };
      },
    ) => {
      clientOptions.push(options);
      // 模拟 Supabase 在 getUser 过程中刷新 token：中间件必须把这些 cookie 带到响应上
      if (auth.refresh) {
        options.cookies.setAll([
          { name: "sb-access-token", value: "fresh", options: { Path: "/" } },
        ]);
      }
      return {
        auth: {
          getUser: async () => {
            if (auth.userThrows) throw auth.userThrows;
            return { data: { user: auth.user }, error: auth.userError };
          },
        },
        from: () => ({
          select: () => ({
            eq: (column: string, value: unknown) => ({
              eq: (column2: string, value2: unknown) => {
                auth.filters.push([column, value], [column2, value2]);
                return {
                  maybeSingle: async () => ({ data: auth.row, error: auth.error }),
                };
              },
            }),
          }),
        }),
      };
    }
  ),
}));

import { getProjectById } from "@/lib/db";
import { updateSession } from "./middleware";

const getProjectByIdMock = vi.mocked(getProjectById);

type ReqInit = {
  /** document = 浏览器取 HTML；flight = 站内 router.push 的 RSC 请求；缺省 = 不带 Sec-Fetch-* */
  mode?: "document" | "flight";
  method?: string;
  rscHeader?: boolean;
  rscQuery?: boolean;
};

function request(pathname: string, init: ReqInit = {}) {
  const url = new URL(pathname, "http://localhost:3300");
  if (init.rscQuery) url.searchParams.set("_rsc", "abc123");
  const headers = new Headers({ host: "localhost:3300" });
  if (init.mode === "document") {
    headers.set("sec-fetch-dest", "document");
    headers.set("sec-fetch-mode", "navigate");
    headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  }
  if (init.mode === "flight") {
    headers.set("sec-fetch-dest", "empty");
    headers.set("sec-fetch-mode", "cors");
    headers.set("accept", "*/*");
  }
  if (init.rscHeader) headers.set("rsc", "1");
  return new NextRequest(url, { method: init.method ?? "GET", headers });
}

function rewriteTarget(response: Response) {
  return response.headers.get("x-middleware-rewrite");
}

beforeEach(() => {
  vi.clearAllMocks();
  cfg.isAuthEnabled = false;
  auth.user = { id: "user-1" };
  auth.row = null;
  auth.error = null;
  auth.filters = [];
  auth.refresh = false;
  auth.userError = null;
  auth.userThrows = null;
  clientOptions.length = 0;
});

describe("演示模式：/app/projects/<id> 文档请求", () => {
  it("demo 库确认没有这条项目 → 首屏就改写进 404 路由，并转发原始路径", async () => {
    getProjectByIdMock.mockResolvedValue(null);
    const res = await updateSession(request("/app/projects/999"));
    expect(rewriteTarget(res)).toBe("http://localhost:3300/_not-found");
    // global-not-found 按 x-seeo-pathname 解析界面语言（/app 属 UI locale 空间）
    expect(res.headers.get("x-middleware-request-x-seeo-pathname")).toBe("/app/projects/999");
    expect(res.headers.get("x-middleware-override-headers")).toContain("x-seeo-pathname");
  });

  it("项目存在 → 原样放行，不碰 404", async () => {
    getProjectByIdMock.mockResolvedValue({
      id: 17,
      name: "toolstep",
      domain: "toolstep.xyz",
      created_at: "2026-08-10 01:02:03",
    });
    const res = await updateSession(request("/app/projects/17"));
    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("本地库读取抛错 → 放行给页面按「数据不可用」呈现，不改写成 404", async () => {
    getProjectByIdMock.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));
    const res = await updateSession(request("/app/projects/17"));
    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("形状不对的 id（非正整数）→ 改写进 404，且不查库", async () => {
    const res = await updateSession(request("/app/projects/not-a-project"));
    expect(rewriteTarget(res)).toBe("http://localhost:3300/_not-found");
    expect(getProjectByIdMock).not.toHaveBeenCalled();
  });

  it("站内点击（RSC 请求）不改写：由页面 notFound() 命中 dashboard 的 not-found 边界", async () => {
    getProjectByIdMock.mockResolvedValue(null);
    // 站内 router.push 的 flight 请求：Sec-Fetch-Dest: empty
    const flight = await updateSession(request("/app/projects/999", { mode: "flight" }));
    expect(rewriteTarget(flight)).toBeNull();
    expect(getProjectByIdMock).not.toHaveBeenCalled();

    // Next 会在进 proxy 前删掉 rsc header、归一化掉 ?_rsc=，两者都不构成放行理由：
    // 不带 Sec-Fetch-Dest 的请求（curl、爬虫）必须按文档处理，否则首屏仍是错误壳。
    const rscHeaderOnly = new NextRequest("http://localhost:3300/app/projects/999", {
      headers: new Headers({ host: "localhost:3300", rsc: "1" }),
    });
    expect(rewriteTarget(await updateSession(rscHeaderOnly))).toBe(
      "http://localhost:3300/_not-found"
    );
    const rscQueryOnly = await updateSession(
      request("/app/projects/999", { rscQuery: true })
    );
    expect(rewriteTarget(rscQueryOnly)).toBe("http://localhost:3300/_not-found");
  });

  it("非项目详情的 /app 路径不触发归属查询（含公开审计入口）", async () => {
    getProjectByIdMock.mockResolvedValue(null);
    for (const path of ["/app", "/app/audit", "/app/projects", "/app/projects/17/edit"]) {
      const res = await updateSession(request(path));
      expect(rewriteTarget(res)).toBeNull();
    }
    expect(getProjectByIdMock).not.toHaveBeenCalled();
  });

  it("POST 不改写（本判据只针对取文档的 GET）", async () => {
    getProjectByIdMock.mockResolvedValue(null);
    const res = await updateSession(request("/app/projects/999", { method: "POST" }));
    expect(rewriteTarget(res)).toBeNull();
  });
});

describe("启用鉴权：/app/projects/<id> 文档请求", () => {
  beforeEach(() => {
    cfg.isAuthEnabled = true;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("当前用户名下确实没有 → 改写进 404，查询带 user_id（越权与不存在同答案）", async () => {
    const res = await updateSession(request("/app/projects/" + "0".repeat(32)));
    expect(rewriteTarget(res)).toBe("http://localhost:3300/_not-found");
    expect(res.headers.get("x-middleware-request-x-seeo-pathname")).toBe(
      "/app/projects/" + "0".repeat(32)
    );
    expect(auth.filters).toEqual([
      ["id", "0".repeat(32)],
      ["user_id", "user-1"],
    ]);
  });

  it("项目属于当前用户 → 放行", async () => {
    auth.row = { id: "0".repeat(32), user_id: "user-1", domain: "toolstep.xyz" };
    const res = await updateSession(request("/app/projects/" + "0".repeat(32)));
    expect(rewriteTarget(res)).toBeNull();
  });

  it("Supabase 报错 → 放行，不降级成 404", async () => {
    auth.error = { code: "PGRST000", message: "Failed to fetch" };
    const res = await updateSession(request("/app/projects/" + "0".repeat(32)));
    expect(rewriteTarget(res)).toBeNull();
  });

  it("404 改写仍要带上本次刷新的会话 cookie（否则用户会被莫名其妙登出）", async () => {
    auth.refresh = true;
    const res = await updateSession(request("/app/projects/" + "0".repeat(32)));
    expect(rewriteTarget(res)).toBe("http://localhost:3300/_not-found");
    expect(res.headers.get("set-cookie")).toContain("sb-access-token=fresh");
  });

  it("未登录访问受保护的项目页 → 仍先跳登录（原有保护顺序不被 404 逻辑抢走）", async () => {
    auth.user = null;
    const res = await updateSession(request("/app/projects/" + "0".repeat(32)));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?redirect=");
    expect(rewriteTarget(res)).toBeNull();
    expect(auth.filters).toEqual([]);
  });
});

// ===== 上游认证故障：绝不 500、绝不无限等待、绝不伪装成「你没登录」 =====
// 生产 2026-10-20T10:09:29Z 的形状是 proxy 里 `TypeError: fetch failed`
// （SocketError: other side closed）打穿 updateSession → 500 + Unhandled Rejection，
// 站内 router.push 的 flight 请求因此静默失败，用户看到「点了登录约 30 秒没反应」。
describe("认证上游不可用：降级而不是挂住 / 500", () => {
  beforeEach(() => {
    cfg.isAuthEnabled = true;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("getUser 抛裸 TypeError（fetch failed）→ 受保护页跳登录并带可重试标记", async () => {
    auth.user = null;
    auth.userThrows = new TypeError("fetch failed");
    const res = await updateSession(request("/app"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    expect(location).toContain("redirect=%2Fapp");
    expect(location).toContain("auth=unavailable");
  });

  it("getUser 返回 AuthRetryableFetchError(status 0) → 同样带标记", async () => {
    auth.user = null;
    auth.userError = { name: "AuthRetryableFetchError", status: 0 };
    const res = await updateSession(request("/app/audit-report/abc"));
    const location = res.headers.get("location")!;
    expect(res.status).toBe(307);
    expect(location).toContain("auth=unavailable");
  });

  it("限流 429 → 带标记：瞬时故障不能让用户以为是自己的凭据问题", async () => {
    auth.user = null;
    auth.userError = { name: "AuthApiError", status: 429 };
    const location = (await updateSession(request("/app"))).headers.get("location")!;
    expect(location).toContain("auth=unavailable");
  });

  it("真·无效会话（401）→ 正常跳登录，不带可重试标记", async () => {
    auth.user = null;
    auth.userError = { name: "AuthApiError", status: 401 };
    const location = (await updateSession(request("/app"))).headers.get("location")!;
    expect(location).toContain("redirect=%2Fapp");
    expect(location).not.toContain("auth=unavailable");
  });

  it("确实没登录（无会话 → AuthSessionMissingError）→ 不带标记", async () => {
    auth.user = null;
    auth.userError = { name: "AuthSessionMissingError" };
    const location = (await updateSession(request("/app"))).headers.get("location")!;
    expect(location).not.toContain("auth=unavailable");
  });

  it("公开页 /login 遇上游抛错 → 原样放行渲染，不重定向、不 500", async () => {
    auth.user = null;
    auth.userThrows = new TypeError("fetch failed");
    const res = await updateSession(request("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
  });

  it("受保护页仍严格执行「故障即登出」：抛错时绝不放行", async () => {
    auth.user = null;
    auth.userThrows = new Error("socket hang up");
    const res = await updateSession(request("/app/projects"));
    expect(res.status).toBe(307);
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("会话校验这条路接了带硬超时的 fetch", async () => {
    cfg.isAuthEnabled = true;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    await updateSession(request("/login"));
    expect(typeof clientOptions[0]?.global?.fetch).toBe("function");
  });
});

// ===== 上游故障必须留痕（但正常未登录与凭据错误绝不能留痕）=====
// catch 之后静默 = 「问题被藏起来」：部署后无法判断上游是否仍在抖。
// 这里同时锁死日志字段：只有阶段 / 路径类别 / 故障类别 / 安全状态码。
describe("proxy 上游故障的可观测性", () => {
  let warnings: Array<Array<unknown>>;

  beforeEach(() => {
    cfg.isAuthEnabled = true;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    warnings = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 日志那一趟的全部文本内容（用于「绝不含敏感串」断言） */
  const line = () => JSON.stringify(warnings);

  it("裸抛 TypeError（生产 fetch failed 形状）→ 一条 warning，类别 network_error", async () => {
    auth.user = null;
    auth.userThrows = new TypeError("fetch failed");
    await updateSession(request("/app"));
    expect(warnings.length).toBe(1);
    expect(warnings[0][0]).toContain("[AuthUpstream]");
    expect(warnings[0][1]).toMatchObject({
      stage: "proxy_auth",
      path: "dashboard",
      category: "network_error",
    });
  });

  it("AuthRetryableFetchError(status 0) → network_error；502 → upstream_5xx；429 → rate_limited", async () => {
    const cases: Array<[Record<string, unknown>, string, number | null]> = [
      [{ name: "AuthRetryableFetchError", status: 0 }, "network_error", 0],
      [{ name: "AuthApiError", status: 502 }, "upstream_5xx", 502],
      [{ name: "AuthApiError", status: 429 }, "rate_limited", 429],
      [{ name: "TimeoutError" }, "timeout", null],
    ];
    for (const [error, category, status] of cases) {
      warnings = [];
      auth.user = null;
      auth.userError = error;
      await updateSession(request("/app"));
      expect(warnings.length, JSON.stringify(error)).toBe(1);
      expect(warnings[0][1]).toMatchObject({ category, status, path: "dashboard" });
    }
  });

  it("正常未登录（AuthSessionMissingError）与无效凭据（401）→ 不打错误日志", async () => {
    for (const error of [
      { name: "AuthSessionMissingError", status: 400 },
      { name: "AuthApiError", status: 401 },
      { name: "AuthApiError", status: 403 },
    ]) {
      warnings = [];
      auth.user = null;
      auth.userError = error;
      await updateSession(request("/app"));
      expect(warnings.length, JSON.stringify(error)).toBe(0);
    }
    // 验证成功也不留痕
    warnings = [];
    auth.user = { id: "user-1" };
    auth.userError = null;
    await updateSession(request("/app"));
    expect(warnings.length).toBe(0);
  });

  it("日志不含 message 原文、token、Cookie、邮箱或 query string", async () => {
    auth.user = null;
    auth.userError = {
      name: "AuthRetryableFetchError",
      status: 0,
      message:
        "Bearer sekret-jwt.eyJhbGciOi JWT access_token=refresh_token_value zhou@example.com sb-access-token",
    } as Record<string, unknown>;
    const req = new NextRequest(
      "http://localhost:3300/app/projects?redirect=%2Fapp%3Ftoken%3Dabc&email=zhou@example.com",
      { headers: new Headers({ host: "localhost:3300" }) }
    );
    await updateSession(req);
    expect(warnings.length).toBe(1);
    for (const forbidden of [
      "sekret",
      "eyJhbGci",
      "Bearer",
      "access_token",
      "refresh_token",
      "zhou@",
      "example.com",
      "sb-access-token",
      "redirect",
      "token=abc",
      "/app/projects?",
    ]) {
      expect(line(), forbidden).not.toContain(forbidden);
    }
  });

  it("路径类别只到类别为止：/app/audit 记 public_audit，/login 记 login", async () => {
    for (const [path, category] of [
      ["/app/audit/abc", "public_audit"],
      ["/login", "login"],
      ["/signup", "signup"],
    ] as const) {
      warnings = [];
      auth.user = null;
      auth.userThrows = new TypeError("fetch failed");
      await updateSession(request(path));
      expect(warnings.length, path).toBe(1);
      expect(warnings[0][1]).toMatchObject({ path: category });
    }
  });
});

// ===== 正常会话的基本走向：新加的超时与留痕都不该插手 =====
// 最容易误伤的正是这两条平常路（未登录打开登录页、已登录进工作台 / 回跳）。
// 三条都必须照旧放行/跳转，且 0 条错误日志。
describe("正常会话的基本走向（本轮机制不得改变）", () => {
  let warnings: Array<Array<unknown>> = [];

  beforeEach(() => {
    cfg.isAuthEnabled = true;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    warnings = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("未登录访问 /login → 原样放行渲染：不重定向、不带标记、不打错误日志", async () => {
    auth.user = null;
    auth.userError = { name: "AuthSessionMissingError", status: 400 };
    const res = await updateSession(request("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
    expect(warnings.length).toBe(0);
  });

  it("会话有效访问 /app → 照常放行，不带任何标记", async () => {
    auth.user = { id: "user-1" };
    const res = await updateSession(request("/app"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
    expect(warnings.length).toBe(0);
  });

  it("会话有效访问 /login → 跳回工作台（登录成功后的那一跳不变）", async () => {
    auth.user = { id: "user-1" };
    const res = await updateSession(request("/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/app");
    expect(res.headers.get("location")).not.toContain("auth=");
    expect(warnings.length).toBe(0);
  });
});
