// ===== 注册 loading 修复：针对性测试 =====
// 覆盖目标：
//   1. claim 不再阻塞注册（后台触发，同步返回）
//   2. 导航不依赖 claim 完成
//   3. claim 成功时请求仍然发出且参数正确（归属规则未变）
//   4. claim 失败时注册流程不受影响（静默）
//   5. 无 guest audit（无 domain）时等价于全量认领
//   6. 成功路径的 loading 在导航之前结束
//
// 数据完整性（24h 窗口 / domain 过滤 / 跨用户隔离 / 激活只记一次）由既有测试覆盖：
//   - src/lib/db/audits-claim.test.ts   → claimGuestAudits 的归属规则
//   - src/lib/analytics/server.test.ts  → trackActivationIfFirst 只成功一次
// 本文件不重复它们，只验证「阻塞被移除且不引入回归」。

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { domainFromRedirect, startGuestAuditClaim } from "./claim-guest-audits";

const AUTH_FORM = path.join(process.cwd(), "src/components/auth/AuthForm.tsx");

function readAuthForm(): string {
  return fs.readFileSync(AUTH_FORM, "utf-8");
}

// ---------------- 行为测试：后台触发 ----------------

describe("startGuestAuditClaim：后台触发，不阻塞调用方", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
  });

  it("同步返回：请求已发出，但不等待它完成", () => {
    let resolved = false;
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fakeFetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Promise((res) => {
        setTimeout(() => {
          resolved = true;
          res(new Response("{}"));
        }, 50);
      });
    }) as unknown as typeof fetch;

    startGuestAuditClaim({ fetchImpl: fakeFetch });

    // 调用方没有被阻塞
    expect(resolved).toBe(false);
    // 但请求确实已经发出
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/audit/claim");
  });

  it("使用 keepalive：导航后浏览器仍会完成该请求", () => {
    const calls: RequestInit[] = [];
    const fakeFetch = ((_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;

    startGuestAuditClaim({ fetchImpl: fakeFetch });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].keepalive).toBe(true);
    expect((calls[0].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("无 domain 时全量认领（body 为空对象）", () => {
    const bodies: string[] = [];
    const fakeFetch = ((_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;

    startGuestAuditClaim({ redirectTarget: null, fetchImpl: fakeFetch });
    startGuestAuditClaim({ redirectTarget: "/app/audit", fetchImpl: fakeFetch });

    expect(bodies).toEqual(["{}", "{}"]);
  });

  it("redirect 带 domain 时按域名精确认领", () => {
    const bodies: string[] = [];
    const fakeFetch = ((_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;

    startGuestAuditClaim({ redirectTarget: "/app/audit?domain=example.com", fetchImpl: fakeFetch });

    expect(JSON.parse(bodies[0])).toEqual({ domain: "example.com" });
  });

  it("claim 失败（网络错误）不抛出、不产生未处理拒绝", async () => {
    process.on("unhandledRejection", onUnhandled);
    const fakeFetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    expect(() => startGuestAuditClaim({ fetchImpl: fakeFetch })).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]);
  });

  it("claim 失败（HTTP 500）同样静默", async () => {
    process.on("unhandledRejection", onUnhandled);
    const fakeFetch = (() => Promise.resolve(new Response("boom", { status: 500 }))) as unknown as typeof fetch;

    expect(() => startGuestAuditClaim({ fetchImpl: fakeFetch })).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]);
  });

  it("fetch 同步抛错也不影响调用方", () => {
    const fakeFetch = (() => {
      throw new Error("sync boom");
    }) as unknown as typeof fetch;

    expect(() => startGuestAuditClaim({ fetchImpl: fakeFetch })).not.toThrow();
  });

  it("domainFromRedirect 解析规则", () => {
    expect(domainFromRedirect("/app/audit?domain=example.com")).toBe("example.com");
    expect(domainFromRedirect("/app/audit?redirect=%2Fapp&domain=a.com")).toBe("a.com");
    expect(domainFromRedirect("/app/audit")).toBeUndefined();
    expect(domainFromRedirect(null)).toBeUndefined();
    expect(domainFromRedirect("")).toBeUndefined();
    expect(domainFromRedirect("/app/audit?domain=%20%20")).toBeUndefined();
  });
});

// ---------------- 源码契约：AuthForm 的 loading 边界与调用方式 ----------------

describe("AuthForm：成功路径不再被 claim 阻塞", () => {
  const src = readAuthForm();

  it("不再存在可 await 的本地 claimGuestAudits 函数", () => {
    expect(src).not.toMatch(/const claimGuestAudits\s*=/);
    expect(src).not.toMatch(/await\s+claimGuestAudits/);
  });

  it("没有任何地方 await 认领（认领只能后台触发）", () => {
    expect(src).not.toMatch(/await\s+startGuestAuditClaim/);
  });

  it("注册成功路径：先 setLoading(false)，再 router.push", () => {
    const start = src.indexOf('track("signup_completed")');
    const end = src.indexOf("router.push(safeRedirect)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const successBlock = src.slice(start, end);
    expect(successBlock).toContain("startGuestAuditClaim({ redirectTarget })");
    expect(successBlock).toContain("setLoading(false)");
  });

  it("登录成功路径同样是「先结束 loading，再导航」", () => {
    const start = src.indexOf('track("login_completed")');
    const end = src.indexOf("router.push(safeRedirect)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const loginBlock = src.slice(start, end);
    expect(loginBlock).toContain("startGuestAuditClaim({ redirectTarget })");
    expect(loginBlock).toContain("setLoading(false)");
  });

  it("认领在导航之前就已触发（不依赖导航后再补）", () => {
    const claimAt = src.indexOf("startGuestAuditClaim({ redirectTarget })");
    const pushAt = src.indexOf("router.push(safeRedirect)");
    expect(claimAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(pushAt);
  });

  it("失败路径保持原样：报错并结束 loading", () => {
    const signupErrorBlock = src.slice(
      src.indexOf("if (signUpError)"),
      src.indexOf("注册成功后直接跳转")
    );
    expect(signupErrorBlock).toContain("setError(");
    expect(signupErrorBlock).toContain("setLoading(false)");

    const signinErrorBlock = src.slice(src.indexOf("if (signInError)"), src.indexOf("track(\"login_completed\")"));
    expect(signinErrorBlock).toContain("setError(");
    expect(signinErrorBlock).toContain("setLoading(false)");
  });

  it("Analytics 事件定义未被改动（signup_started / signup_completed / login_completed 仍在）", () => {
    for (const e of ['track("signup_started")', 'track("signup_completed")', 'track("login_completed")']) {
      expect(src).toContain(e);
    }
  });

  it("Welcome 邮件触发未在本轮被触碰（仍只由 analytics ingest 侧发起）", () => {
    expect(src).not.toContain("sendWelcomeEmail");
    expect(src).not.toContain("/api/email/");
  });
});
