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

import { describe, it, expect, vi, beforeEach } from "vitest";
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
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (_url: string, _key: string, options: { cookies: { setAll: (c: unknown[]) => void } }) => {
      // 模拟 Supabase 在 getUser 过程中刷新 token：中间件必须把这些 cookie 带到响应上
      if (auth.refresh) {
        options.cookies.setAll([
          { name: "sb-access-token", value: "fresh", options: { Path: "/" } },
        ]);
      }
      return {
        auth: { getUser: async () => ({ data: { user: auth.user } }) },
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
