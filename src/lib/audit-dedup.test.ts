// ===== Audit Engine 重定向别名去重测试 =====
// 背景 bug：起始 URL（https://seeo.asia）301 → www.seeo.asia/ 再 302 → /zh，
// 站内链接又把 https://www.seeo.asia/ 与 https://www.seeo.asia/zh 入队。
// 旧逻辑按"入队 URL"判重，同一最终页面被抓 3 次，跨页检查误报
// duplicate-title / duplicate-description / duplicate-h1"3 个页面重复"。
// 修复：以"跟随重定向后的最终 URL"（urlDedupKey）判重，同一最终页面只审计一次。
//
// V2：crawl 层改用 fetchPageWithRedirects（记录重定向链/hop），
// robots/sitemap/llms.txt 各请求一次（全局 fetch stub）；
// 重定向别名页只解析一次 → 不产生 duplicate-* 误报。

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PageData } from "@/lib/crawl";

// ---- mock DB 层：收集写入的 issue，其余 no-op ----
const writtenIssues: Array<Record<string, string | number>> = [];

vi.mock("@/lib/db", () => ({
  updateAuditProgress: vi.fn(async () => undefined),
  finishAudit: vi.fn(async () => undefined),
  addAuditIssue: vi.fn(async (_userId: string, issue: Record<string, string | number>) => {
    writtenIssues.push(issue);
  }),
  getAuditIssues: vi.fn(async () =>
    writtenIssues.map((i) => ({
      type: i.type as string,
      severity: i.severity as string,
      url: i.url as string,
      detail: i.detail as string,
      suggestion: i.suggestion as string,
    }))
  ),
  getPreviousAudit: vi.fn(async () => null),
  createAlert: vi.fn(async () => undefined),
  hasAlertToday: vi.fn(async () => true),
}));

// ---- mock 爬取层：fetchPageWithRedirects 返回重定向链；parsePage 生成 SEO 完备页面 ----
const fetchLog: string[] = [];

vi.mock("@/lib/crawl", () => {
  class CrawlError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    CrawlError,
    normalizeUrl: (d: string) => (/^https?:\/\//.test(d) ? d : `https://${d}`),
    fetchPageWithRedirects: vi.fn(async (url: string) => {
      fetchLog.push(url);
      // 重定向链：seeo.asia/* → www.seeo.asia/ → /zh（2 跳）；www.seeo.asia/ → /zh（1 跳）
      let finalUrl = url;
      let hops = 0;
      let redirectChain: Array<{ url: string; status: number; location: string }> = [];
      if (url.startsWith("https://seeo.asia")) {
        finalUrl = "https://www.seeo.asia/zh";
        hops = 2;
        redirectChain = [
          { url: "https://seeo.asia/", status: 301, location: "https://www.seeo.asia/" },
          { url: "https://www.seeo.asia/", status: 302, location: "https://www.seeo.asia/zh" },
        ];
      } else if (url === "https://www.seeo.asia/" || url === "https://www.seeo.asia") {
        finalUrl = "https://www.seeo.asia/zh";
        hops = 1;
        redirectChain = [{ url: "https://www.seeo.asia/", status: 302, location: "https://www.seeo.asia/zh" }];
      }
      return {
        requestedUrl: url,
        finalUrl,
        status: 200,
        html: "<html><body>ok</body></html>",
        responseTimeMs: 50,
        redirectChain,
        hops,
        isLoop: false,
      };
    }),
    parsePage: vi.fn((_html: string, finalUrl: string) => makePageData(finalUrl)),
  };
});

import { runAudit } from "@/lib/audit";

const COMPLETE_WEBSITE_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Example",
  url: "https://www.seeo.asia/zh",
});

function makePageData(finalUrl: string): PageData {
  return {
    url: finalUrl,
    finalUrl,
    title: "Example - Technical SEO Audit Platform Demo",
    metaDescription:
      "Example 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心功能，每日自动刷新排名数据并生成可视化审计报告与健康评分，帮助你基于真实数据做出搜索优化决策，持续提升自然搜索流量与转化。",
    canonical: finalUrl,
    robotsMeta: "index, follow",
    h1: ["看清搜索流量的走向"],
    h2: ["核心功能"],
    h3: ["关键词研究"],
    images: [{ src: "a.png", alt: "示例图" }],
    links: [
      // 站内链接：裸根路径 + /zh 直达，均为起始页的重定向别名
      { href: "https://www.seeo.asia/", isExternal: false, text: "home" },
      { href: "https://www.seeo.asia/zh", isExternal: false, text: "zh" },
    ],
    bodyText: "内容 ".repeat(200),
    wordCount: 400,
    htmlLang: "zh",
    viewport: "width=device-width, initial-scale=1",
    ogTitle: "Example",
    ogDescription: "Example platform",
    ogImage: null,
    twitterCard: "summary",
    favicon: "/favicon.ico",
    hasStructuredData: true,
    structuredDataRaw: [COMPLETE_WEBSITE_JSON_LD],
    inlineStyleLength: 0,
    htmlSize: 20000,
    cssSize: 100,
    scriptSize: 50,
    visibleTextSize: 4000,
    semantic: { main: true, nav: true, article: true, header: true, footer: true, section: true },
    semanticMainCount: 3,
    headings: [{ level: 1, text: "看清搜索流量的走向" }, { level: 2, text: "核心功能" }],
  };
}

/** 全局 fetch stub：robots 声明 sitemap；llms.txt 有效；sitemap 含根路径与 /zh */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/robots.txt")) {
        return new Response(
          "User-agent: *\nDisallow:\nSitemap: https://www.seeo.asia/sitemap.xml",
          { status: 200, headers: { "content-type": "text/plain" } }
        );
      }
      if (url.includes("/llms.txt")) {
        return new Response("# SeeO\n\n- [Home](https://www.seeo.asia/)", { status: 200 });
      }
      if (url.includes("sitemap.xml")) {
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.seeo.asia/</loc></url><url><loc>https://www.seeo.asia/zh</loc></url></urlset>',
          { status: 200, headers: { "content-type": "application/xml" } }
        );
      }
      return new Response("<html><body>ok</body></html>", { status: 200 });
    })
  );
}

beforeEach(() => {
  writtenIssues.length = 0;
  fetchLog.length = 0;
  stubFetch();
});

describe("runAudit 重定向别名去重（full 深度）", () => {
  it("起始页与其重定向别名解析到同一最终 URL 时，不产生 duplicate-* 误报", { timeout: 20_000 }, async () => {
    const result = await runAudit("user-1", 1, "seeo.asia", { depth: "full" });

    // 起始页与裸根别名都被抓取（/zh 直达别名被 visited 提前拦截）
    expect(fetchLog).toContain("https://seeo.asia/");
    expect(fetchLog).toContain("https://www.seeo.asia/");

    // 跨页检查不得出现重复类误报（旧 bug：同一页面 ×3 → 三项 duplicate 全部触发）
    const types = writtenIssues.map((i) => i.type);
    expect(types).not.toContain("duplicate-title");
    expect(types).not.toContain("duplicate-description");
    expect(types).not.toContain("duplicate-h1");

    // 审计正常完成；重定向/重定向链/sitemap 重定向为预期行为（非误报）
    expect(result.status).toBe("completed");
    expect(result.homepageParsed).toBe(true);
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.healthScore).toBeLessThanOrEqual(100);
  });

  it("quick 深度只爬 1 页，不执行站点级检查（无 duplicate-* issue）", { timeout: 20_000 }, async () => {
    const result = await runAudit("user-1", 2, "seeo.asia", { depth: "quick" });
    const types = writtenIssues.map((i) => i.type);
    expect(types).not.toContain("duplicate-title");
    expect(types).not.toContain("duplicate-description");
    expect(types).not.toContain("duplicate-h1");
    expect(result.status).toBe("completed");
    // quick：页面完备 → 无任何页面级 issue
    expect(writtenIssues.length).toBe(0);
    expect(result.healthScore).toBe(100);
  });
});
