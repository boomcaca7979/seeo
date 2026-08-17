// ===== Phase 3：Dashboard UI 双语化测试 =====
// 覆盖：message catalog 加载/键位对齐、Dashboard locale 解析优先级、
// PLAN_LABELS EN/ZH、delete-guard 回归、日期/数字 locale 格式化、
// Dashboard 不进入 /zh/app（proxy 白名单）、login redirect 保持原路径、Auth UI locale。

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../messages/zh.json", import.meta.url)), "utf-8"));
const MW = readFileSync(fileURLToPath(new URL("../lib/supabase/middleware.ts", import.meta.url)), "utf-8");
const AUTH_FORM_SRC = readFileSync(
  fileURLToPath(new URL("../components/auth/AuthForm.tsx", import.meta.url)),
  "utf-8"
);

// ---------- 1. locale message loading ----------
describe("1. locale message loading（en/zh catalog 完整性）", () => {
  it("en/zh 均可加载，dashboard 命名空间存在", () => {
    expect(EN.dashboard).toBeTruthy();
    expect(ZH.dashboard).toBeTruthy();
  });

  it("dashboard 全部子命名空间键位 en/zh 完全一致（无缺失/无 __tbd 占位）", () => {
    const flat = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? flat(v, p + k + ".") : [p + k]
      );
    const fe = flat(EN.dashboard).sort();
    const fz = flat(ZH.dashboard).sort();
    expect(fe).toEqual(fz);
    expect(JSON.stringify(fe)).not.toContain("__tbd");
  });

  it("核心 Dashboard 模块文案齐备（sidebar/topbar/common/authForm/projectList/8 大功能页/pdf）", () => {
    for (const ns of [
      "sidebar", "topbar", "common", "authForm", "projectList", "notFound", "rankCheck",
      "audit", "positionTracking", "keywords", "competitors", "backlinks", "content",
      "reportsPage", "settings", "pdf", "shared", "printAudit", "upgrade",
    ]) {
      expect(EN.dashboard[ns], `en.dashboard.${ns}`).toBeTruthy();
      expect(ZH.dashboard[ns], `zh.dashboard.${ns}`).toBeTruthy();
    }
  });
});

// ---------- 2. Dashboard locale fallback ----------
const stores = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
  headerStore: { get: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: async () => stores.cookieStore,
  headers: async () => stores.headerStore,
}));

// next-intl/server 的 ESM navigation 链在 vitest node 环境解析 "next/navigation" 失败；
// request.ts 仅用 getRequestConfig（本测试不触达），stub 掉以隔离
vi.mock("next-intl/server", () => ({
  getRequestConfig: vi.fn(async () => ({ locale: "en", messages: {} })),
}));

// proxy.ts → @/i18n/routing → next-intl/navigation 同理；proxy 测试只依赖
// isLocaleRoutedPath（真实模块）+ updateSession（doMock），routing 传入被 mock 的 intlMiddleware
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["en", "zh"], defaultLocale: "en", localePrefix: "as-needed" },
}));

describe("2. Dashboard locale fallback（cookie → Accept-Language → en）", () => {
  it("NEXT_LOCALE=zh → zh；=en → en", async () => {
    const { resolveUiLocale } = await import("./request");
    stores.cookieStore.get.mockReturnValue({ value: "zh" });
    stores.headerStore.get.mockReturnValue("en-US,en;q=0.9");
    expect(await resolveUiLocale()).toBe("zh");
    stores.cookieStore.get.mockReturnValue({ value: "en" });
    expect(await resolveUiLocale()).toBe("en");
  });

  it("无 cookie + Accept-Language 含 zh → zh（zh-CN / zh-TW / zh / 混合均命中）", async () => {
    const { resolveUiLocale } = await import("./request");
    stores.cookieStore.get.mockReturnValue(undefined);
    for (const al of ["zh-CN,zh;q=0.9", "zh-TW,zh;q=0.8", "zh", "en-US,zh;q=0.7"]) {
      stores.headerStore.get.mockReturnValue(al);
      expect(await resolveUiLocale(), `Accept-Language: ${al}`).toBe("zh");
    }
  });

  it("无 cookie + 非 zh Accept-Language → 默认 en", async () => {
    const { resolveUiLocale } = await import("./request");
    stores.cookieStore.get.mockReturnValue(undefined);
    stores.headerStore.get.mockReturnValue("ja-JP,ja;q=0.9,en;q=0.8");
    expect(await resolveUiLocale()).toBe("en");
    stores.headerStore.get.mockReturnValue(null);
    expect(await resolveUiLocale()).toBe("en");
  });

  it("非法 cookie 值 → 忽略，走 Accept-Language/默认", async () => {
    const { resolveUiLocale } = await import("./request");
    stores.cookieStore.get.mockReturnValue({ value: "fr" });
    stores.headerStore.get.mockReturnValue("en-US");
    expect(await resolveUiLocale()).toBe("en");
  });
});

// ---------- 3. PLAN_LABELS EN/ZH ----------
describe("3. PLAN_LABELS EN/ZH 统一（只翻译显示名，不硬编码额度）", () => {
  it("EN：Free / Lite / Pro；ZH：免费版 / Lite 版 / 专业版", async () => {
    const { PLAN_LABELS, planLabel } = await import("@/lib/plan-labels");
    expect(PLAN_LABELS.en).toEqual({ free: "Free", lite: "Lite", pro: "Pro" });
    expect(PLAN_LABELS.zh).toEqual({ free: "免费版", lite: "Lite 版", pro: "专业版" });
    expect(planLabel("pro", "en")).toBe("Pro");
    expect(planLabel("pro", "zh")).toBe("专业版");
    expect(planLabel("lite", "en")).toBe("Lite");
    expect(planLabel("free", "zh")).toBe("免费版");
  });

  it("显示名不含额度/价格数字（真实额度来自 billing 单一数据源）", async () => {
    const { PLAN_LABELS } = await import("@/lib/plan-labels");
    for (const labels of [PLAN_LABELS.en, PLAN_LABELS.zh]) {
      for (const label of Object.values(labels)) {
        expect(label).not.toMatch(/\d/);
      }
    }
  });

  it("未知 plan key 原样回退（不抛错）", async () => {
    const { planLabel } = await import("@/lib/plan-labels");
    expect(planLabel("enterprise", "en")).toBe("enterprise");
  });
});

// ---------- 4. ProjectList delete guard 回归 ----------
describe("4. delete-guard 回归（www.toolstep.top 不进入错误删除路径）", () => {
  it("www.toolstep.top 的合法 UUID target 允许删除；number/篡改 id 一律拒绝", async () => {
    const { canSubmitDelete } = await import("@/lib/delete-guard");
    const UUID_A = "0db5a114-adf0-4f24-917a-275ed19b6397"; // www.toolstep.top
    expect(canSubmitDelete({ id: UUID_A, domain: "www.toolstep.top" })).toBe(true);
    expect(canSubmitDelete({ id: Number(UUID_A), domain: "www.toolstep.top" })).toBe(false);
    expect(canSubmitDelete({ id: 0, domain: "www.toolstep.top" })).toBe(false);
    expect(canSubmitDelete({ id: `${UUID_A}&other=1`, domain: "x.com" })).toBe(false);
    expect(canSubmitDelete(null)).toBe(false);
  });
});

// ---------- 5. 日期/数字 locale 格式化 ----------
describe("5. 日期/数字 locale 格式化（en-US / zh-CN）", () => {
  it("formatDate：en → August 17, 2026；zh → 2026年8月17日", async () => {
    const { formatDate } = await import("@/lib/ui-locale");
    const d = new Date("2026-08-17T00:00:00Z");
    expect(formatDate(d, "en")).toMatch(/August 17, 2026/);
    expect(formatDate(d, "zh")).toMatch(/2026年8月17日/);
  });

  it("formatNumber：千分位分隔（en-US 与 zh-CN 均为 1,234,567）", async () => {
    const { formatNumber } = await import("@/lib/ui-locale");
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234567, "zh")).toBe("1,234,567");
  });

  it("intlLocale：zh → zh-CN，en → en-US", async () => {
    const { intlLocale } = await import("@/lib/ui-locale");
    expect(intlLocale("zh")).toBe("zh-CN");
    expect(intlLocale("en")).toBe("en-US");
  });

  it("formatRelativeTime：走 message 回调（分钟/小时/天），>30 天回退日期", async () => {
    const { formatRelativeTime } = await import("@/lib/relative-time");
    const now = Date.now();
    const iso = (offsetMin: number) => new Date(now - offsetMin * 60000).toISOString();
    const t = (key: string, v?: { n: number }) => (v ? `${key}:${v.n}` : key);
    expect(formatRelativeTime(iso(0), "en", t)).toBe("justNow");
    expect(formatRelativeTime(iso(5), "en", t)).toBe("minutesAgo:5");
    expect(formatRelativeTime(iso(120), "en", t)).toBe("hoursAgo:2");
    expect(formatRelativeTime(iso(48 * 60), "en", t)).toBe("daysAgo:2");
    // >30 天：回退为本地化日期（含年份数字）
    expect(formatRelativeTime(iso(60 * 24 * 60), "en", t)).toMatch(/202\d/);
  });
});

// ---------- 6. Dashboard 不进入 /zh/app ----------
describe("6. Dashboard 不进入 /zh/app（locale 路由白名单）", () => {
  it("isLocaleRoutedPath：/app 与 /zh/app 均不做 locale 路由", async () => {
    const { isLocaleRoutedPath } = await import("./locale-routed-paths");
    expect(isLocaleRoutedPath("/app")).toBe(false);
    expect(isLocaleRoutedPath("/zh/app")).toBe(false);
    expect(isLocaleRoutedPath("/en/app")).toBe(false);
    expect(isLocaleRoutedPath("/app/audit")).toBe(false);
    expect(isLocaleRoutedPath("/zh/app/projects")).toBe(false);
    // 对照组：营销页仍走 locale 路由
    expect(isLocaleRoutedPath("/")).toBe(true);
    expect(isLocaleRoutedPath("/pricing")).toBe(true);
    expect(isLocaleRoutedPath("/zh/pricing")).toBe(true);
  });

  it("proxy：/app 与 /zh/app 均交给 updateSession（Supabase 链路），不经 intlMiddleware", async () => {
    const marker = { type: "update-session-marker" } as unknown as Response;
    const intlSpy = vi.fn();
    vi.doMock("next-intl/middleware", () => ({ default: () => intlSpy }));
    vi.doMock("@/lib/supabase/middleware", () => ({ updateSession: async () => marker }));
    const { proxy } = await import("../proxy");
    const { NextRequest } = await import("next/server");
    for (const p of ["/app", "/app/audit", "/zh/app", "/zh/app/projects"]) {
      const req = new NextRequest(new URL(`http://localhost${p}`));
      const res = await proxy(req);
      expect(res).toBe(marker);
      expect(intlSpy).not.toHaveBeenCalled();
    }
    vi.doUnmock("next-intl/middleware");
    vi.doUnmock("@/lib/supabase/middleware");
  });
});

// ---------- 7. login redirect 保持原路径 ----------
describe("7. login redirect 保持原路径（safeRedirect 只放行 /app 前缀）", () => {
  it("middleware：未登录访问 /app → /login?redirect=<原路径+query>（深链保留）", () => {
    expect(MW).toContain('url.searchParams.set("redirect", redirectTarget)');
    expect(MW).toContain("pathname + request.nextUrl.search");
    expect(MW).toContain('url.pathname = "/login"');
  });

  it("middleware + AuthForm：redirect 参数必须以 /app 开头才放行（防 open redirect）", () => {
    const guard = 'startsWith("/app")';
    expect(MW).toContain(guard);
    expect(AUTH_FORM_SRC).toContain(guard);
  });

  it("AuthForm：登录/注册成功统一 router.push(safeRedirect)", () => {
    expect(AUTH_FORM_SRC).toContain("router.push(safeRedirect)");
  });
});

// ---------- 8. Auth UI locale ----------
describe("8. Auth UI locale（AuthForm 双语键位）", () => {
  it("AuthForm 使用 dashboard.authForm message catalog（非硬编码双语）", () => {
    expect(AUTH_FORM_SRC).toContain('useTranslations("dashboard.authForm")');
  });

  it("en/zh 核心键位齐备且语义正确", () => {
    const keys = [
      "loginTitle", "signupTitle", "loginSubtitle", "signupSubtitle",
      "email", "password", "loginBtn", "signupBtn",
      "errInvalidCredentials", "errPasswordShort",
      "hasAccount", "noAccount", "loginLink", "signupLink",
    ];
    for (const k of keys) {
      expect(EN.dashboard.authForm[k], `en.${k}`).toBeTruthy();
      expect(ZH.dashboard.authForm[k], `zh.${k}`).toBeTruthy();
    }
    expect(EN.dashboard.authForm.loginTitle).toBe("Welcome back");
    expect(ZH.dashboard.authForm.loginTitle).toBe("欢迎回来");
    expect(EN.dashboard.authForm.loginBtn).toBe("Log in");
    expect(ZH.dashboard.authForm.loginBtn).toBe("登录");
    expect(EN.dashboard.authForm.password).toBe("Password");
    expect(ZH.dashboard.authForm.password).toBe("密码");
  });
});
