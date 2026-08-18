// ===== 404 页本地化 + title 回归测试 =====
// 覆盖：
//   1. /zh/未知路径 → 中文 404（notFoundPage zh 文案 + [locale]/[...rest] catch-all）
//   2. 根未知路径 → 英文 404（global-not-found 自包含）
//   3. 404 title 不继承站点默认 title（EN/ZH 各自明确 404 title）
//   4. 404 canonical 不指向真实营销页 + noindex + 不进 sitemap
// BUG-004 防回归：requestLocale 无效时不解析 cookies（见 src/i18n/request.test.ts）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../messages/zh.json", import.meta.url)), "utf-8"));
const LOCALE_NOT_FOUND_SRC = readFileSync(fileURLToPath(new URL("./not-found.tsx", import.meta.url)), "utf-8");
const CATCH_ALL_SRC = readFileSync(fileURLToPath(new URL("./[...rest]/page.tsx", import.meta.url)), "utf-8");
const GLOBAL_NOT_FOUND_SRC = readFileSync(fileURLToPath(new URL("../global-not-found.tsx", import.meta.url)), "utf-8");
const SITEMAP_SRC = readFileSync(fileURLToPath(new URL("../sitemap.ts", import.meta.url)), "utf-8");

const ZH_HAS_CHINESE = (s: string) => /[\u4e00-\u9fff]/.test(s);

describe("404：messages 双语齐备", () => {
  it("en.notFoundPage 输出英文 title/heading/back", () => {
    const p = EN.notFoundPage;
    expect(p.title).toBe("Page Not Found | SeeO");
    expect(p.heading).toBe("Page not found");
    expect(p.back).toBe("Back to Home");
    for (const key of ["title", "heading", "desc", "back"] as const) {
      expect(ZH_HAS_CHINESE(p[key])).toBe(false);
    }
  });

  it("zh.notFoundPage 输出中文 title/heading/back", () => {
    const p = ZH.notFoundPage;
    expect(p.title).toBe("页面不存在 | SeeO");
    expect(p.heading).toBe("页面不存在");
    expect(p.back).toBe("返回首页");
    for (const key of ["title", "heading", "desc", "back"] as const) {
      expect(ZH_HAS_CHINESE(p[key])).toBe(true);
    }
  });

  it("404 title 不继承站点默认 title", () => {
    const defaultTitle = JSON.stringify(EN.metadata?.title ?? "");
    expect(JSON.stringify(EN.notFoundPage.title)).not.toBe(defaultTitle);
    expect(JSON.stringify(ZH.notFoundPage.title)).not.toBe(JSON.stringify(ZH.metadata?.title ?? ""));
  });
});

describe("404：[locale] 渲染树（/zh/未知路径 → 中文 404）", () => {
  it("[...rest] catch-all 进入 [locale] 树后立即 notFound()", () => {
    expect(CATCH_ALL_SRC).toContain("notFound()");
    expect(CATCH_ALL_SRC).not.toContain("redirect(");
  });

  it("not-found.tsx 使用 notFoundPage 翻译（title/heading/desc/back）", () => {
    for (const key of ["title", "heading", "desc", "back"]) {
      expect(LOCALE_NOT_FOUND_SRC).toContain(`t("${key}")`);
    }
  });

  it("not-found.tsx：React hoist noindex + 不输出 canonical（不指向真实营销页）", () => {
    // generateMetadata 在 not-found 边界不可用（隔离上下文，BUG-004 同类 500），
    // title / robots 由组件内 hoist 渲染；canonical 从不输出。
    expect(LOCALE_NOT_FOUND_SRC).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(LOCALE_NOT_FOUND_SRC).not.toContain("canonical");
  });

  it("not-found.tsx：客户端同步 html lang（错误壳 hydration 不修补 html 属性）", () => {
    expect(LOCALE_NOT_FOUND_SRC).toContain("<HtmlLang locale={locale} />");
  });

  it("返回首页链接按 locale 生成（/zh → /zh）", () => {
    expect(LOCALE_NOT_FOUND_SRC).toContain("localePath(locale, \"/\")");
  });
});

describe("404：全局壳（根未知路径 → 英文 404）", () => {
  it("自带明确英文 404 title，不依赖站点默认 title", () => {
    expect(GLOBAL_NOT_FOUND_SRC).toContain("<title>Page Not Found | SeeO</title>");
  });

  it("自包含（html lang=en + noindex），不依赖 layout/全局 CSS", () => {
    expect(GLOBAL_NOT_FOUND_SRC).toContain('<html lang="en">');
    expect(GLOBAL_NOT_FOUND_SRC).toContain('name="robots" content="noindex, nofollow"');
    expect(GLOBAL_NOT_FOUND_SRC).toContain("Back to Home");
  });
});

describe("404：不进入 sitemap", () => {
  it("sitemap 不包含 404 / catch-all 条目", () => {
    expect(SITEMAP_SRC).not.toMatch(/not-found|\[\.\.\.rest\]/);
  });
});
