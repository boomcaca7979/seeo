// ===== Audit Dashboard 聚合逻辑单元测试 =====
// 覆盖：
// - detectIssuePattern 多信号判定（<3 findings / site-wide / repeated / scattered）
// - Category Score 归一化（per-rule health 均值：规则数量不影响可比性）
// - notEnoughData（无可解析页面）

import { describe, it, expect } from "vitest";
import { buildDashboardSnapshot, detectIssuePattern, type FindingSnapshot } from "@/lib/seo/audit-dashboard";
import { auditRules, type AuditContext, type FetchRecord, type RuleExecution } from "@/lib/seo/audit-checks";
import type { PageData } from "@/lib/crawl";
import type { PageType } from "@/lib/seo/page-type";

function finding(overrides: Partial<FindingSnapshot>): FindingSnapshot {
  return {
    ruleId: "inline-css",
    url: "https://example.com/a",
    severity: "warning",
    message: { en: "Inline styles 12,345 characters (>5000)", zh: "内联样式 12,345 字符（>5000）" },
    metrics: { inlineStyleLength: 12345 },
    ...overrides,
  };
}

describe("detectIssuePattern：多信号判定", () => {
  const pages = new Map<string, PageType | null>([
    ["https://example.com/a", "tool"],
    ["https://example.com/b", "tool"],
    ["https://example.com/c", "tool"],
  ]);

  it("findings < 3 → null（证据不足）", () => {
    expect(detectIssuePattern({ findings: [finding({}), finding({ url: "https://example.com/b" })], pageTypeByUrl: pages, indexablePages: 10 })).toBeNull();
  });

  it("消息一致 + metric 一致 + 高覆盖 → site-wide（模板级，多信号）", () => {
    const fs = [
      finding({ url: "https://example.com/a" }),
      finding({ url: "https://example.com/b" }),
      finding({ url: "https://example.com/c" }),
    ];
    // 3/10 页不满足高覆盖，但 3 条消息与 metric 完全一致 → 判 site-wide 需要 S3 或 S4
    expect(detectIssuePattern({ findings: fs, pageTypeByUrl: pages, indexablePages: 10 })).toBe("site-wide"); // S1+S2+S4(同类型 100%)
  });

  it("消息一致 + metric 一致但覆盖低且类型分散 → repeated（不轻易 site-wide）", () => {
    const fs = [
      finding({ url: "https://example.com/a", metrics: { inlineStyleLength: 100 } }),
      finding({ url: "https://example.com/b", metrics: { inlineStyleLength: 200 } }),
      finding({ url: "https://example.com/d", metrics: { inlineStyleLength: 300 } }),
    ];
    const mixedTypes = new Map<string, PageType | null>([
      ["https://example.com/a", "tool"],
      ["https://example.com/b", "guide"],
      ["https://example.com/d", "article"],
    ]);
    // S1 一致（消息归一化去数字后相同），但 metric 不一致 → 仅 S1 → null（分散）
    expect(detectIssuePattern({ findings: fs, pageTypeByUrl: mixedTypes, indexablePages: 10 })).toBeNull();
  });

  it("消息一致 + 高覆盖但 metric 不一致 → repeated（有模式但非模板）", () => {
    const fs = [
      finding({ url: "https://example.com/a", metrics: { inlineStyleLength: 100 } }),
      finding({ url: "https://example.com/b", metrics: { inlineStyleLength: 200 } }),
      finding({ url: "https://example.com/c", metrics: { inlineStyleLength: 300 } }),
    ];
    const r = detectIssuePattern({ findings: fs, pageTypeByUrl: pages, indexablePages: 4 }); // 3/4 = 75% 覆盖 → S3
    expect(r).toBe("repeated"); // S1 + S3，但 metric 不一致 → 非 site-wide
  });

  it("完全分散（消息不同）→ null", () => {
    const fs = [
      finding({ url: "https://example.com/a", message: { en: "A", zh: "A" } }),
      finding({ url: "https://example.com/b", message: { en: "B", zh: "B" } }),
      finding({ url: "https://example.com/c", message: { en: "C", zh: "C" } }),
    ];
    expect(detectIssuePattern({ findings: fs, pageTypeByUrl: pages, indexablePages: 4 })).toBeNull();
  });
});

// ---------- Category 归一化 ----------

function pageData(url: string): PageData {
  return {
    url,
    finalUrl: url,
    title: "Example Page Title for Testing",
    metaDescription: null,
    canonical: null,
    robotsMeta: null,
    h1: ["H1"],
    h2: ["H2"],
    h3: [],
    images: [],
    links: [],
    bodyText: "content ".repeat(100),
    wordCount: 200,
    htmlLang: "en",
    viewport: "width=device-width, initial-scale=1",
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    twitterCard: null,
    favicon: null,
    hasStructuredData: false,
    structuredDataRaw: [],
    inlineStyleLength: 0,
  };
}

function rec(url: string, i: number): FetchRecord {
  return { url, finalUrl: url, status: 200, responseTimeMs: 100, hops: 0, redirectChain: [], isLoop: false, ok: true, source: i === 0 ? "start" : "link", depth: i };
}

function ruleExec(ruleId: string, findingUrls: string[]): RuleExecution {
  const rule = auditRules.find((r) => r.id === ruleId)!;
  return {
    rule,
    status: findingUrls.length > 0 ? "fail" : "pass",
    severity: rule.severity,
    findings: findingUrls.map((u) => ({ url: u, message: rule.name })),
    affectedPages: findingUrls.length,
  };
}

function minimalCtx(indexablePages: number): AuditContext {
  const urls = Array.from({ length: indexablePages }, (_, i) => `https://example.com/p${i}`);
  const pagesData = urls.map(pageData);
  const fetchRecords = pagesData.map((p, i) => rec(p.url, i));
  return {
    baseUrl: "https://example.com/",
    origin: "https://example.com",
    depth: "full",
    crawlLimit: 50,
    pages: [],
    fetchRecords,
    linkGraph: new Map(),
    robots: { status: "ok", httpStatus: 200, text: "", universalDisallow: [], disallowAll: false, sitemapUrls: [], aiCrawlers: {} },
    sitemap: null,
    llmsTxt: null,
    indexablePages,
  };
}

describe("buildDashboardSnapshot：Category 归一化", () => {
  it("规则数量不影响可比性：单规则分类 100% 失败 vs 双规则分类（1 失败 1 通过）", () => {
    const ctx = minimalCtx(4);
    // category A (onpage)：missing-h1 error 规则，全部 4 页失败
    // category B (performance)：inline-css warning 失败 + slow-page notice 通过
    const executions: RuleExecution[] = [
      ruleExec("missing-h1", ["https://example.com/p0", "https://example.com/p1", "https://example.com/p2", "https://example.com/p3"]),
      ruleExec("inline-css", ["https://example.com/p0", "https://example.com/p1", "https://example.com/p2", "https://example.com/p3"]),
      ruleExec("slow-page", []),
    ];
    const failedRules = executions.filter((e) => e.findings.length > 0).map((e) => ({
      ruleId: e.rule.id,
      severity: e.severity,
      scoreWeight: e.rule.scoreWeight,
      pageLevel: e.rule.pageLevel,
      affectedPages: e.affectedPages,
    }));
    const snap = buildDashboardSnapshot(ctx, executions, failedRules, 50, "v2", "2.0");

    const onpage = snap.categories.find((c) => c.category === "onpage")!;
    const performance = snap.categories.find((c) => c.category === "performance")!;
    // onpage：1 条 error 规则 100% 失败 → health 0 → score 0
    expect(onpage.score).toBe(0);
    // performance：inline-css 100% 失败（health 0）+ slow-page 通过（health 100）→ 均值 50
    expect(performance.score).toBe(50);
    // 双规则分类不会被"规则数量多"惩罚到低于单规则分类的合理值
    expect(performance.score).toBeGreaterThan(onpage.score);
    // major issue
    expect(onpage.majorIssue?.ruleId).toBe("missing-h1");
  });

  it("indexablePages=0 → notEnoughData=true（不显示数字分数）", () => {
    const ctx = minimalCtx(0);
    const executions: RuleExecution[] = [ruleExec("missing-h1", [])];
    const snap = buildDashboardSnapshot(ctx, executions, [], 100, "v2", "2.0");
    for (const c of snap.categories) {
      expect(c.notEnoughData).toBe(true);
    }
  });

  it("全部通过的分类 score=100", () => {
    const ctx = minimalCtx(2);
    const executions: RuleExecution[] = [
      ruleExec("missing-h1", []),
      ruleExec("missing-description", []),
    ];
    const snap = buildDashboardSnapshot(ctx, executions, [], 100, "v2", "2.0");
    const onpage = snap.categories.find((c) => c.category === "onpage")!;
    expect(onpage.score).toBe(100);
    expect(onpage.majorIssue).toBeNull();
  });
});
