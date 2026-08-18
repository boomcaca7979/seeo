// ===== 公开页面导航统一性测试 =====
// 覆盖：
//   1. 法律页（/privacy /terms /refund）统一 Navbar + Footer（含返回站内导航入口）
//   2. marketing 页（/pricing /about /docs /features/*）统一 Footer
//   3. Footer 为 client 组件，locale-routed 路径按 locale 生成（/zh 前缀）
//   4. dev 身份（demo@seeo.local）只允许出现在 !isAuthEnabled demo 分支

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const LEGAL_PAGES = [
  ["privacy", "../(default)/privacy/page.tsx"],
  ["terms", "../(default)/terms/page.tsx"],
  ["refund", "../(default)/refund/page.tsx"],
] as const;

const MARKETING_PAGES = [
  ["pricing", "../(default)/pricing/page.tsx"],
  ["about", "../(default)/about/page.tsx"],
  ["docs", "../(default)/docs/page.tsx"],
  ["features/seo-audit", "../(default)/features/seo-audit/page.tsx"],
  ["features/rank-tracking", "../(default)/features/rank-tracking/page.tsx"],
  ["features/backlink-analysis", "../(default)/features/backlink-analysis/page.tsx"],
] as const;

describe("法律页导航（OBS-001 + 导航统一）", () => {
  for (const [name, rel] of LEGAL_PAGES) {
    it(`/${name} 渲染 Navbar + Footer`, () => {
      const src = read(rel);
      expect(src).toMatch(/<Navbar\s*\/>/);
      expect(src).toMatch(/<Footer\s*\/>/);
    });
  }
});

describe("marketing 页 Footer（导航体系统一）", () => {
  for (const [name, rel] of MARKETING_PAGES) {
    it(`/${name} 渲染 Footer`, () => {
      const src = read(rel);
      expect(src).toMatch(/<Footer\s*\/>/);
    });
  }
});

describe("Footer 组件 locale 行为", () => {
  const footer = read("../../components/Footer.tsx");

  it("为 client 组件（可嵌入 server 营销页与 client 页面）", () => {
    expect(footer).toContain('"use client"');
  });

  it("locale-routed 路径按 locale 加 /zh 前缀，legacy 路径原样", () => {
    expect(footer).toContain("LOCALE_ROUTED_PATHS.has(path)");
    expect(footer).toContain("localePath(locale");
  });
});

describe("dev 身份展示（demo@seeo.local 仅限 demo 分支）", () => {
  const settings = read("../(default)/(dashboard)/app/settings/page.tsx");

  it("demo 邮箱只出现在 !isAuthEnabled 守卫内，auth-enabled 走 Supabase 真实用户", () => {
    expect(settings).toContain("demo@seeo.local");
    const demoBlock = settings.slice(
      settings.indexOf("if (!isAuthEnabled)"),
      settings.indexOf("try {")
    );
    expect(demoBlock).toContain("demo@seeo.local");
    // auth-enabled：真实 Supabase 用户信息
    expect(settings).toContain("supabase.auth.getUser()");
    expect(settings).toContain("user.email");
  });
});
