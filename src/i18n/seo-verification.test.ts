// ===== Phase 5：SEO 行为自动化测试 =====
// 覆盖：canonical / hreflang / /en redirect 目标 / locale→lang/og / schema inLanguage /
//       sitemap URL 集合（EN+ZH 成对、无 /en、无私有路径）/ robots / llms.txt

import { describe, it, expect } from "vitest";
import { alternatesFor, localePath, localeUrl, hreflangAlternates, SITE_URL } from "./seo";
import { localeToHreflang, localeToHtmlLang, localeToOgLocale } from "./config";
import { isLocaleRoutedPath, stripLocalePrefix, LOCALE_ROUTED_PATHS } from "./locale-routed-paths";
import {
  organizationSchema,
  websiteSchema,
  softwareApplicationSchema,
  breadcrumbSchema,
  faqPageSchema,
} from "../lib/seo/schema";
import sitemapFn from "../app/sitemap";
import robotsFn from "../app/robots";

const MARKETING_PATHS = [
  "/",
  "/pricing",
  "/docs",
  "/about",
  "/features/seo-audit",
  "/features/rank-tracking",
  "/features/backlink-analysis",
  "/privacy",
  "/terms",
  "/refund",
];

describe("1. canonical（alternatesFor）", () => {
  it("EN canonical = 无前缀自身路径", () => {
    for (const p of MARKETING_PATHS) {
      expect(alternatesFor("en", p).alternates?.canonical).toBe(p);
    }
  });

  it("ZH canonical = /zh 前缀路径", () => {
    for (const p of MARKETING_PATHS) {
      expect(alternatesFor("zh", p).alternates?.canonical).toBe(p === "/" ? "/zh" : `/zh${p}`);
    }
  });

  it("canonical 永不指向 /en/*", () => {
    for (const p of MARKETING_PATHS) {
      for (const loc of ["en", "zh"] as const) {
        expect(String(alternatesFor(loc, p).alternates?.canonical)).not.toContain("/en");
      }
    }
  });
});

describe("2. hreflang（双向互指 + x-default）", () => {
  // 页面 hreflang 由 hreflangAlternates() + <HreflangAlternates /> 渲染，
  // 不再走 metadata alternates.languages（Next 16 会输出 camelCase hrefLang）。
  it("EN/ZH 页面均输出 en + zh-CN + x-default 三条", () => {
    for (const p of MARKETING_PATHS) {
      const langs = hreflangAlternates(p).map((a) => a.hreflang);
      expect(langs).toEqual(["en", "zh-CN", "x-default"]);
    }
  });

  it("en → EN URL、zh-CN → ZH URL、x-default → EN URL", () => {
    for (const p of MARKETING_PATHS) {
      const byLang = Object.fromEntries(hreflangAlternates(p).map((a) => [a.hreflang, a.href]));
      expect(byLang.en).toBe(localeUrl("en", p));
      expect(byLang["zh-CN"]).toBe(localeUrl("zh", p));
      expect(byLang["x-default"]).toBe(localeUrl("en", p));
    }
  });

  it("hreflang URL 不含 /en/*", () => {
    for (const p of MARKETING_PATHS) {
      for (const a of hreflangAlternates(p)) {
        expect(a.href).not.toContain("/en");
      }
    }
  });

  it("hreflang 标识与 localeToHreflang 映射一致", () => {
    const byLang = Object.fromEntries(hreflangAlternates("/").map((a) => [a.hreflang, a.href]));
    expect(byLang[localeToHreflang.en]).toBe(localeUrl("en", "/"));
    expect(byLang[localeToHreflang.zh]).toBe(localeUrl("zh", "/"));
  });
});

describe("3. /en redirect 目标合法性（proxy 白名单）", () => {
  it("每个营销路径的 /en 剥离目标是合法 locale 路由路径", () => {
    for (const p of MARKETING_PATHS) {
      const enPath = p === "/" ? "/en" : `/en${p}`;
      const target = stripLocalePrefix(enPath.replace(/^\/en/, "")) || "/";
      // proxy：/en/<path> → 301 <path>（白名单内才 redirect，否则落空）
      expect(isLocaleRoutedPath(p)).toBe(true);
      expect(target).toBe(p);
      expect(target.startsWith("/en")).toBe(false);
    }
  });

  it("Dashboard/API/payment 不参与 locale 路由（/en/app 等不会被白名单处理）", () => {
    expect(isLocaleRoutedPath("/app")).toBe(false);
    expect(isLocaleRoutedPath("/api")).toBe(false);
    expect(isLocaleRoutedPath("/payment")).toBe(false);
    expect(isLocaleRoutedPath("/zh/app")).toBe(false);
  });

  it("白名单与营销页清单一致", () => {
    for (const p of MARKETING_PATHS) expect(LOCALE_ROUTED_PATHS.has(p)).toBe(true);
  });
});

describe("4. locale → lang / og:locale", () => {
  it("html lang：en → en，zh → zh-CN", () => {
    expect(localeToHtmlLang.en).toBe("en");
    expect(localeToHtmlLang.zh).toBe("zh-CN");
  });

  it("og:locale：en → en_US，zh → zh_CN", () => {
    expect(localeToOgLocale.en).toBe("en_US");
    expect(localeToOgLocale.zh).toBe("zh_CN");
  });

  it("hreflang 标识：en → en，zh → zh-CN", () => {
    expect(localeToHreflang.en).toBe("en");
    expect(localeToHreflang.zh).toBe("zh-CN");
  });
});

describe("5. schema inLanguage 与 URL", () => {
  it("Organization/WebSite inLanguage 随 locale", () => {
    expect(organizationSchema("en").inLanguage).toBe("en");
    expect(organizationSchema("zh").inLanguage).toBe("zh-CN");
    expect(websiteSchema("en").inLanguage).toBe("en");
    expect(websiteSchema("zh").inLanguage).toBe("zh-CN");
  });

  it("SoftwareApplication inLanguage + offers url 随 locale 且无 /en", () => {
    const en = softwareApplicationSchema("en") as { inLanguage: string; offers: Array<{ url: string }> };
    const zh = softwareApplicationSchema("zh") as { inLanguage: string; offers: Array<{ url: string }> };
    expect(en.inLanguage).toBe("en");
    expect(zh.inLanguage).toBe("zh-CN");
    expect(zh.offers[0].url).toBe(`${SITE_URL}/zh/pricing`);
    expect(en.offers[0].url).toBe(`${SITE_URL}/pricing`);
    for (const o of [...en.offers, ...zh.offers]) expect(o.url).not.toContain("/en");
  });

  it("BreadcrumbList inLanguage 随 locale（含 pricing 修复后用法）", () => {
    const zh = breadcrumbSchema([{ name: "首页", url: "/zh" }, { name: "定价", url: "/zh/pricing" }], "zh");
    expect(zh.inLanguage).toBe("zh-CN");
    const en = breadcrumbSchema([{ name: "Home", url: "/" }], "en");
    expect(en.inLanguage).toBe("en");
  });

  it("FAQPage inLanguage 随 locale", () => {
    expect(faqPageSchema("/about", [], "en").inLanguage).toBe("en");
    expect(faqPageSchema("/zh/about", [], "zh").inLanguage).toBe("zh-CN");
  });
});

describe("6. sitemap URL 集合", () => {
  const entries = sitemapFn();
  const urls = entries.map((e) => new URL(e.url).pathname);

  it("收录 EN+ZH 成对 URL + login/signup（共 22 条）", () => {
    expect(entries.length).toBe(22);
    for (const p of MARKETING_PATHS) {
      expect(urls).toContain(p);
      expect(urls).toContain(p === "/" ? "/zh" : `/zh${p}`);
    }
    expect(urls).toContain("/login");
    expect(urls).toContain("/signup");
  });

  it("不收录 /en/*、/app、/payment、/api", () => {
    for (const u of urls) {
      expect(u.startsWith("/en")).toBe(false);
      expect(u.startsWith("/app")).toBe(false);
      expect(u.startsWith("/payment")).toBe(false);
      expect(u.startsWith("/api")).toBe(false);
    }
  });

  it("双语 entry 的 hreflang 期望（hreflangAlternates）互指真实存在 URL", () => {
    // 期望值统一来自 hreflangAlternates()（页面 <link> 的单一契约源），
    // 不再读取 sitemap entry 的 alternates.languages。
    for (const e of entries) {
      const path = new URL(e.url).pathname;
      if (path === "/login" || path === "/signup") continue;
      const enPath = path.startsWith("/zh") ? path.slice(3) || "/" : path;
      for (const a of hreflangAlternates(enPath)) {
        const target = new URL(a.href).pathname;
        expect(target.startsWith("/en")).toBe(false);
        // hreflang 指向的 URL 必须在 sitemap 集合内（真实存在）
        expect(urls, `${path} → ${a.hreflang} ${target}`).toContain(target);
      }
    }
  });
});

describe("7. robots.txt", () => {
  const robots = robotsFn();
  const rules = robots.rules as Array<{ disallow?: string[] }>;

  it("私有路径 disallow：/app /api /payment", () => {
    for (const rule of rules) {
      expect(rule.disallow).toContain("/app");
      expect(rule.disallow).toContain("/api");
      expect(rule.disallow).toContain("/payment");
    }
  });

  it("声明 sitemap 且不扩大 Disallow 到 /zh", () => {
    expect(robots.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    const allDisallows = rules.flatMap((r) => r.disallow ?? []);
    expect(allDisallows.some((d) => d.includes("zh"))).toBe(false);
  });
});

describe("8. llms.txt 基本内容", () => {
  it("不再声称 dashboard 仅中文；无 /en URL", async () => {
    const { GET } = await import("../app/llms.txt/route");
    const res = GET();
    const body = await res.text();
    expect(body).not.toContain("is in Chinese (zh-CN)");
    expect(body).toContain("bilingual");
    expect(body).not.toMatch(/https:\/\/www\.seeo\.asia\/en/);
    // EN/ZH URL 成对声明
    expect(body).toContain(`${SITE_URL}/zh`);
    expect(body).toContain(`${SITE_URL}/zh/pricing`);
  });
});

describe("9. localePath 边界", () => {
  it("根路径与子路径", () => {
    expect(localePath("en", "/")).toBe("/");
    expect(localePath("zh", "/")).toBe("/zh");
    expect(localePath("en", "/pricing")).toBe("/pricing");
    expect(localePath("zh", "/pricing")).toBe("/zh/pricing");
  });
});
