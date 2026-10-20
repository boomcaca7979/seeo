// ===== 阶段 19 遗留 A：登录后回跳白名单 =====
// 旧实现三处各写一份 `redirect.startsWith("/app")`，把支付结果页
// `/payment/result?order=…` 当成不安全地址丢回 /app。
// 现在只放开这一条站内路径，其余绕过手法（绝对 URL、协议相对、反斜杠、编码绕过、
// 控制字符、/app 的同名前缀目录如 /application）必须仍然拒绝。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUTH_FALLBACK_TARGET,
  SAFE_REDIRECT_PREFIXES,
  isSafeRedirectTarget,
  safeRedirectTarget,
} from "./auth-redirect";

const AUTH_FORM_SRC = readFileSync(
  fileURLToPath(new URL("../components/auth/AuthForm.tsx", import.meta.url)),
  "utf-8"
);
const MW_SRC = readFileSync(
  fileURLToPath(new URL("../lib/supabase/middleware.ts", import.meta.url)),
  "utf-8"
);

describe("白名单放行范围", () => {
  it("工作台路径照常放行（含深链与 query）", () => {
    for (const t of [
      "/app",
      "/app/audit",
      "/app/reports/audit?domain=acme-example.com",
      "/app/settings?tab=billing",
    ]) {
      expect(isSafeRedirectTarget(t), t).toBe(true);
      expect(safeRedirectTarget(t), t).toBe(t);
    }
  });

  it("支付结果页（带订单号）是本次新增的唯一放行项", () => {
    const target = "/payment/result?order=SO202610170001";
    expect(isSafeRedirectTarget(target)).toBe(true);
    expect(safeRedirectTarget(target)).toBe(target);
    expect(SAFE_REDIRECT_PREFIXES).toEqual(["/app", "/payment/result"]);
  });

  it("支付结果页之外的 /payment 路径不放开（收银台等仍回落）", () => {
    for (const t of ["/payment", "/payment/checkout", "/payment/success"]) {
      expect(isSafeRedirectTarget(t), t).toBe(false);
      expect(safeRedirectTarget(t), t).toBe(AUTH_FALLBACK_TARGET);
    }
  });
});

describe("恶意与非站内地址一律拒绝", () => {
  const REJECTED = [
    null,
    undefined,
    "",
    "app",
    "/application", // 同名前缀，不是 /app 的子路径
    "/app-evil",
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "/app/../../evil",
    "https://evil.com/app",
    "http://evil.com",
    "javascript:alert(1)",
    "data:text/html;base64,PHN2Zz4=",
    "/app%09evil",
    "/app\n/x",
    "/login",
    "/signup",
    "/zh/app",
  ];

  it.each(REJECTED.map((t) => [String(t), t] as const))("%s → 回落到 %s", (label, target) => {
    expect(isSafeRedirectTarget(target), label).toBe(false);
    expect(safeRedirectTarget(target), label).toBe(AUTH_FALLBACK_TARGET);
  });

  it("已解码的编码绕过（%2f%2fevil.com → //evil.com）依然拒绝", () => {
    // searchParams.get() 交出来的就是解码后的值，这里按同一契约测试
    const decoded = decodeURIComponent("%2f%2fevil.com");
    expect(decoded).toBe("//evil.com");
    expect(isSafeRedirectTarget(decoded)).toBe(false);
    const traversal = decodeURIComponent("/app/%2e%2e/evil.com");
    expect(traversal).toBe("/app/../evil.com");
    expect(isSafeRedirectTarget(traversal)).toBe(false);
    const decodedApp = decodeURIComponent("%2fapp%2fsettings");
    expect(isSafeRedirectTarget(decodedApp), decodedApp).toBe(true);
  });

  it("反斜杠被浏览器视作 /，因此含反斜杠的目标整体拒绝", () => {
    expect(isSafeRedirectTarget("/app\\..\\..\\evil.com")).toBe(false);
  });
});

describe("消费点接线：白名单只有这一份实现", () => {
  it("AuthForm 与 middleware 都改用 safeRedirectTarget", () => {
    expect(AUTH_FORM_SRC).toContain("safeRedirectTarget(redirectTarget)");
    expect(MW_SRC).toContain("safeRedirectTarget(request.nextUrl.searchParams.get(\"redirect\"))");
    expect(AUTH_FORM_SRC).not.toContain('redirectTarget.startsWith("/app")');
    expect(MW_SRC).not.toContain('searchParams.get("redirect")?.startsWith');
  });

  it("登录/注册成功仍统一跳转白名单结果（未变的行为锚点）", () => {
    expect(AUTH_FORM_SRC).toContain("const safeRedirect = safeRedirectTarget(redirectTarget);");
    expect(AUTH_FORM_SRC.match(/router\.push\(safeRedirect\)/g)?.length).toBe(2);
  });

  it("middleware 回跳时保留查询参数（支付结果页靠 order 定位订单）", () => {
    expect(MW_SRC).toContain('safeRedirect.split("?")[0]');
    expect(MW_SRC).toContain('safeRedirect.includes("?")');
  });

  it("未登录访问受保护页时，redirect 参数仍写完整原路径 + query", () => {
    expect(MW_SRC).toContain("const redirectTarget = pathname + request.nextUrl.search");
    expect(MW_SRC).toContain('url.searchParams.set("redirect", redirectTarget)');
  });
});
