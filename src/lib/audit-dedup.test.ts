// ===== Audit Engine 重定向别名去重测试 =====
// 背景 bug：起始 URL（https://seeo.asia）301 → www.seeo.asia/ 再 302 → /zh，
// 站内链接又把 https://www.seeo.asia/ 与 https://www.seeo.asia/zh 入队。
// 旧逻辑按"入队 URL"判重，同一最终页面被抓 3 次，跨页检查误报
// duplicate-title / duplicate-description / duplicate-h1"3 个页面重复"。
// 修复：以"跟随重定向后的最终 URL"（urlDedupKey）判重，同一最终页面只审计一次。

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

// ---- mock 爬取层：fetchPage 返回重定向后的最终 URL；parsePage 生成 SEO 完备页面 ----
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
    fetchPage: vi.fn(async (url: string) => {
      fetchLog.push(url);
      // 重定向链：seeo.asia/* → www.seeo.asia/zh；www.seeo.asia/ → /zh
      let finalUrl = url;
      if (url.startsWith("https://seeo.asia")) {
        finalUrl = "https://www.seeo.asia/zh";
      } else if (url === "https://www.seeo.asia/" || url === "https://www.seeo.asia") {
        finalUrl = "https://www.seeo.asia/zh";
      }
      return { url: finalUrl, html: "<html></html>", responseTimeMs: 50, status: 200 };
    }),
    parsePage: vi.fn((_html: string, finalUrl: string) => makePageData(finalUrl)),
  };
});

import { runAudit } from "@/lib/audit";

function makePageData(finalUrl: string): PageData {
  return {
    url: finalUrl,
    title: "Example 技术SEO审计与排名追踪工具平台演示页面标题",
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
    twitterCard: "summary",
    favicon: "/favicon.ico",
    hasStructuredData: true,
    structuredDataRaw: ['{"@context":"https://schema.org","@type":"WebSite"}'],
    inlineStyleLength: 0,
    finalUrl,
  };
}

beforeEach(() => {
  writtenIssues.length = 0;
  fetchLog.length = 0;
  // robots.txt 可用且声明 Sitemap（否则 no-sitemap notice 会扣分）
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () =>
        "User-agent: *\nDisallow:\nSitemap: https://www.seeo.asia/sitemap.xml",
    }))
  );
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

    // 审计正常完成，无任何 issue → 满分
    expect(result.status).toBe("completed");
    expect(result.homepageParsed).toBe(true);
    expect(writtenIssues.length).toBe(0);
    expect(result.healthScore).toBe(100);
  });

  it("quick 深度只爬 1 页，不执行跨页检查（无 duplicate-* issue）", { timeout: 20_000 }, async () => {
    const result = await runAudit("user-1", 2, "seeo.asia", { depth: "quick" });
    const types = writtenIssues.map((i) => i.type);
    expect(types).not.toContain("duplicate-title");
    expect(types).not.toContain("duplicate-description");
    expect(types).not.toContain("duplicate-h1");
    expect(result.status).toBe("completed");
    expect(result.healthScore).toBe(100);
  });
});
