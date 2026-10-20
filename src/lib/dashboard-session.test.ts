// ===== 生产 2026-10-20 登录延迟：一次工作台加载只取一次身份，且有硬上限 =====
// 修前：app/layout.tsx 与 app/page.tsx 各自 `auth.getUser()` + 查 `profiles`，
// 加上 proxy 一共 3 次 /auth/v1/user、2 次 profiles，全部串行且**没有时间上限** ——
// 上游一慢就是「点了登录之后长时间没反应」的等待本身。
// 现在两条渲染共用同一个 cache() helper，并且：
//   1. helper 自身每次调用只打 1 次 getUser + 1 次 profiles（无冗余往返）；
//   2. 那次调用走有界 transport，整趟另有 deadline（不再无限等待）；
//   3. 「上游没答案」与「确实没登录」分开：前者 authUnavailable=true，绝不产出
//      虚假 profile，调用方必须跳登录（故障即登出），绝不放行；
//   4. layout 与 page 都改走 helper 且都带可重试标记（= 请求级去重的结构保证）。
// 说明：vitest 跑在非 react-server 解析条件下，React 的 cache() 是直通实现，
// 所以「同一次请求内两次调用只命中一次」由接线断言锁死，而不是假装能复现
// Server Component 的缓存调度器。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Mode = "signed-in" | "signed-out" | "upstream-error" | "throws" | "hanging";

const calls = {
  getUser: 0,
  profiles: 0,
  transports: [] as unknown[],
  eq: [] as Array<[string, unknown]>,
};
let mode: Mode = "signed-in";
let profileDisplayName: string | null = "周野";
let userEmail: string | null = "zhou@example.com";
let warnings: Array<Array<unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  createServer: async (fetchArg?: unknown) => {
    calls.transports.push(fetchArg);
    const user =
      mode === "signed-in" ? { id: "u1", email: userEmail } : null;
    return {
      auth: {
        getUser: async () => {
          calls.getUser++;
          if (mode === "throws") throw new TypeError("fetch failed");
          if (mode === "hanging") return await new Promise(() => {});
          if (mode === "upstream-error") {
            return {
              data: { user: null },
              error: {
                name: "AuthRetryableFetchError",
                status: 0,
                message: "Authorization: Bearer eyJsecret zhou@example.com",
              },
            };
          }
          if (mode === "signed-out") {
            return {
              data: { user: null },
              error: { name: "AuthSessionMissingError", status: 400 },
            };
          }
          return { data: { user }, error: null };
        },
      },
      from: (table: string) => {
        if (table !== "profiles") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: (column: string, value: unknown) => {
              calls.eq.push([column, value]);
              return {
                single: async () => {
                  calls.profiles++;
                  return {
                    data: profileDisplayName === null ? null : { display_name: profileDisplayName },
                    error: null,
                  };
                },
              };
            },
          }),
        };
      },
    };
  },
}));

import { getDashboardSession } from "./dashboard-session";

beforeEach(() => {
  calls.getUser = 0;
  calls.profiles = 0;
  calls.transports = [];
  calls.eq = [];
  mode = "signed-in";
  profileDisplayName = "周野";
  userEmail = "zhou@example.com";
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("getDashboardSession：单次调用的查询次数与取值", () => {
  it("已登录：1 次 getUser + 1 次 profiles，返回 id / 显示名 / 邮箱", async () => {
    const s = await getDashboardSession();
    expect(s).toEqual({
      userId: "u1",
      displayName: "周野",
      email: "zhou@example.com",
      authUnavailable: false,
    });
    expect(calls.getUser).toBe(1);
    expect(calls.profiles).toBe(1);
    // profile 查询只按刚校验出来的 user id 收窄：不能是写死的 id，也不能缺过滤
    expect(calls.eq).toEqual([["id", "u1"]]);
  });

  it("身份这条路用的是有界 transport（不是无上限的默认 fetch）", async () => {
    await getDashboardSession();
    expect(typeof calls.transports[0]).toBe("function");
  });

  it("profile 没名字 → 回落邮箱前缀（与修前页面逻辑一致）", async () => {
    profileDisplayName = null;
    expect((await getDashboardSession()).displayName).toBe("zhou");
  });

  it("用户没有邮箱 → 兜底 SeeO，email 为空串", async () => {
    profileDisplayName = "";
    userEmail = null;
    expect(await getDashboardSession()).toMatchObject({ displayName: "SeeO", email: "" });
  });

  it("未登录：不查 profiles、不打错误日志、不带可重试标记", async () => {
    mode = "signed-out";
    expect(await getDashboardSession()).toEqual({
      userId: null,
      displayName: "",
      email: "",
      authUnavailable: false,
    });
    expect(calls.profiles).toBe(0);
    expect(warnings.length).toBe(0);
  });
});

describe("SSR 身份读取：上游不可用不伪装、不放行、不无限等", () => {
  it("auth-js 返回可重试错误 → authUnavailable，且绝不产出虚假 profile", async () => {
    mode = "upstream-error";
    const s = await getDashboardSession();
    expect(s).toEqual({ userId: null, displayName: "", email: "", authUnavailable: true });
    expect(calls.profiles).toBe(0);
  });

  it("getUser 裸抛 → authUnavailable（上游没答案 ≠ 用户没登录）", async () => {
    mode = "throws";
    expect(await getDashboardSession()).toMatchObject({ authUnavailable: true });
  });

  it("身份请求永不返回 → 整趟到期后按上游不可用处理，不挂着", async () => {
    vi.useFakeTimers();
    mode = "hanging";
    const watcher = getDashboardSession();
    await vi.advanceTimersByTimeAsync(11_000);
    const s = await watcher;
    expect(s).toMatchObject({ userId: null, authUnavailable: true });
  });

  it("真故障各留一条结构化 warning，字段只含安全信息", async () => {
    mode = "upstream-error";
    await getDashboardSession();
    expect(warnings.length).toBe(1);
    expect(warnings[0][0]).toContain("[AuthUpstream]");
    expect(warnings[0][1]).toMatchObject({
      stage: "dashboard_session",
      path: "dashboard_render",
      category: "network_error",
    });
    const out = JSON.stringify(warnings);
    for (const forbidden of ["eyJsecret", "Bearer", "zhou@", "Authorization", "example.com"]) {
      expect(out, forbidden).not.toContain(forbidden);
    }
  });
});

describe("dashboard layout / page 已改走同一条身份读取", () => {
  const layout = readFileSync(
    fileURLToPath(new URL("../app/(default)/(dashboard)/app/layout.tsx", import.meta.url)),
    "utf-8"
  );
  const page = readFileSync(
    fileURLToPath(new URL("../app/(default)/(dashboard)/app/page.tsx", import.meta.url)),
    "utf-8"
  );

  it("helper 用 React cache() 包装（请求级，不跨请求）", () => {
    const src = readFileSync(fileURLToPath(new URL("./dashboard-session.ts", import.meta.url)), "utf-8");
    expect(src).toContain('import { cache } from "react";');
    expect(src).toContain("export const getDashboardSession = cache(");
    expect(src).not.toContain("unstable_cache");
    // 客户端必须在被缓存的函数内部创建：提到模块作用域就会跨用户串号
    expect(src).toContain("const supabase = await createServer(createBoundedFetch());");
  });

  it("layout 与 page 都读 helper，且都不再自己校验身份或查 profiles", () => {
    for (const [name, src] of [["layout", layout], ["page", page]] as const) {
      expect(src, name).toContain('import { getDashboardSession } from "@/lib/dashboard-session";');
      expect(src, name).toContain("await getDashboardSession()");
      expect(src, name).not.toContain("auth.getUser()");
      expect(src, name).not.toContain('from("profiles")');
    }
  });

  it("受保护判定仍保留：拿不到 userId 就跳登录；上游不可用时额外带可重试标记", () => {
    expect(layout).toMatch(/if \(!session\.userId\)/);
    expect(layout).toMatch(/session\.authUnavailable \? "&auth=unavailable" : ""/);
    expect(page).toMatch(/if \(!session\.userId\) \{/);
    expect(page).toMatch(/session\.authUnavailable \? "&auth=unavailable" : ""/);
  });

  it("访客审计入口不因上游故障被赶走（未登录照常以访客身份渲染）", () => {
    const guard = layout.slice(
      layout.indexOf("if (!session.userId)"),
      layout.indexOf("redirect(", layout.indexOf("if (!session.userId)"))
    );
    expect(guard).toContain('pathname === "/app/audit"');
    expect(guard).toContain("isGuest");
  });
});
