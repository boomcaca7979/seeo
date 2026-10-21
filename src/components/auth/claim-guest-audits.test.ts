// ===== 注册 loading 修复：针对性测试 =====
// 覆盖目标：
//   1. claim 不再阻塞注册（后台触发，同步返回）
//   2. 导航不依赖 claim 完成
//   3. claim 成功时请求仍然发出且参数正确（归属规则未变）
//   4. claim 失败时注册流程不受影响（静默）
//   5. 无 guest audit（无 domain）时等价于全量认领
//   6. 成功路径在导航前不会被本地 loading 状态「提前结束」（2026-10-21 变更，见下）
//
// ⚠️ 契约变更记录（2026-10-21 登录转场修复）：
//   本文件过去断言「先 setLoading(false)，再 router.push」。那条契约本身就是 bug 来源
//   ——认证返回即把按钮恢复成可点击，而后台首屏还在加载（用户实测：2 秒后可点、
//   10 秒后才进后台）。现在成功路径必须保持 loading 直到登录页卸载，因此断言改为
//   「enterOpening() 在 router.push 之前、且成功块内不出现任何 loading 复位」。
//   本文件的核心目的（claim 绝不进入等待链）不变。
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

  it("注册成功路径：认领先触发、进入 opening 后再导航（不在导航前结束 loading）", () => {
    const start = src.indexOf('track("signup_completed")');
    const end = src.indexOf("router.push(safeRedirect)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const successBlock = src.slice(start, end);
    expect(successBlock).toContain("startGuestAuditClaim({ redirectTarget })");
    // 2026-10-21：成功路径不得在导航前把状态退回 idle / 复位 loading
    expect(successBlock).toContain("enterOpening();");
    expect(successBlock).not.toContain("setLoading");
    expect(successBlock).not.toContain('setPhase("idle")');
  });

  it("登录成功路径同样是「先进入 opening，再导航」", () => {
    const start = src.indexOf('track("login_completed")');
    const end = src.indexOf("router.push(safeRedirect)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const loginBlock = src.slice(start, end);
    expect(loginBlock).toContain("startGuestAuditClaim({ redirectTarget })");
    expect(loginBlock).toContain("enterOpening();");
    expect(loginBlock).not.toContain("setLoading");
    expect(loginBlock).not.toContain('setPhase("idle")');
  });

  it("认领在导航之前就已触发（不依赖导航后再补）", () => {
    const claimAt = src.indexOf("startGuestAuditClaim({ redirectTarget })");
    const pushAt = src.indexOf("router.push(safeRedirect)");
    expect(claimAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(pushAt);
  });

  it("失败路径保持原样：报错并回到可重试状态（由 finally 统一收尾，不再就地复位）", () => {
    const signupErrorBlock = src.slice(
      src.indexOf("if (signUpError)"),
      src.indexOf("注册成功后直接跳转")
    );
    expect(signupErrorBlock).toContain("setError(");
    // 2026-10-21：复位收敛到 handleSubmit 的 finally（if (!navigating) 分支），
    // 错误块本身只负责报错并 return，避免「报错后仍停在 opening」的双重收尾。
    expect(signupErrorBlock).not.toContain("setLoading");
    expect(signupErrorBlock).toContain("return;");

    const signinErrorBlock = src.slice(src.indexOf("if (signInError)"), src.indexOf("track(\"login_completed\")"));
    expect(signinErrorBlock).toContain("setError(");
    expect(signinErrorBlock).not.toContain("setLoading");
    expect(signinErrorBlock).toContain("return;");
    // 收尾逻辑本身存在且可恢复（失败后能再次提交）
    expect(src).toContain("if (!navigating) {");
    expect(src).toContain('setPhase("idle")');
    expect(src).toContain("inFlight.current = false;");
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
