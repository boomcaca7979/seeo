import { describe, it, expect } from "vitest";
import {
  auditRules,
  pageRuleIds,
  siteRuleIds,
  allCheckMeta,
  runAuditRules,
  executionToIssues,
  normalizePage,
  pickText,
  type AuditContext,
  type AuditIssue,
  type FetchRecord,
} from "@/lib/seo/audit-checks";
import { calculateHealthScoreV2 } from "@/lib/seo/audit-score";
import type { PageData } from "@/lib/crawl";

/** 构造「各项基本失败」的最小 PageData（触发尽可能多的检查项） */
function makeFailingPage(): PageData {
  return {
    url: "http://example.com/",
    finalUrl: "http://example.com/",
    title: "",
    metaDescription: null,
    canonical: null,
    robotsMeta: null,
    h1: [],
    h2: [],
    h3: [],
    images: [{ src: "a.png", alt: null }],
    links: [],
    bodyText: "",
    wordCount: 0,
    htmlLang: null,
    viewport: null,
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

/** PageData[] → 最小可用的 AuditContext（页面级规则用） */
function makeQuickContext(pages: PageData[]): AuditContext {
  const fetchRecords: FetchRecord[] = pages.map((p, i) => ({
    url: p.url,
    finalUrl: p.finalUrl ?? p.url,
    status: 200,
    responseTimeMs: p.responseTimeMs ?? 100,
    hops: 0,
    redirectChain: [],
    isLoop: false,
    ok: true,
    source: i === 0 ? "start" : "link",
    depth: i,
  }));
  const linkGraph = new Map<string, Set<string>>();
  const normalized = pages.map((p, i) => normalizePage(p, fetchRecords[i], linkGraph));
  return {
    baseUrl: "http://example.com/",
    origin: "http://example.com",
    depth: "quick",
    crawlLimit: 50,
    pages: normalized,
    fetchRecords,
    linkGraph,
    robots: {
      status: "ok",
      httpStatus: 200,
      text: "",
      universalDisallow: [],
      disallowAll: false,
      sitemapUrls: [],
      aiCrawlers: {},
    },
    sitemap: null,
    llmsTxt: null,
    indexablePages: normalized.length,
  };
}

/** 运行页面级规则并收集全部 issue */
function runPageRules(pages: PageData[]): AuditIssue[] {
  const ctx = makeQuickContext(pages);
  return runAuditRules(ctx).flatMap((ex) => executionToIssues(ex));
}

describe("统一规则目录结构", () => {
  it("每条规则包含 id/category/severity/pageLevel/scoreWeight/name/description/recommendation", () => {
    expect(auditRules.length).toBeGreaterThanOrEqual(20);
    for (const rule of auditRules) {
      expect(rule.id).toMatch(/^[a-z0-9-]+$/);
      expect(["crawlability", "indexability", "onpage", "content", "links", "structured-data", "performance", "sitemap", "ai-search"]).toContain(rule.category);
      expect(["error", "warning", "notice"]).toContain(rule.severity);
      expect(["page", "site"]).toContain(rule.pageLevel);
      expect(rule.scoreWeight).toBeGreaterThan(0);
      expect(pickText(rule.name, "en").length).toBeGreaterThan(0);
      expect(pickText(rule.name, "zh").length).toBeGreaterThan(0);
      expect(pickText(rule.description, "en").length).toBeGreaterThan(0);
      expect(pickText(rule.description, "zh").length).toBeGreaterThan(0);
      expect(pickText(rule.recommendation, "en").length).toBeGreaterThan(0);
      expect(pickText(rule.recommendation, "zh").length).toBeGreaterThan(0);
      expect(typeof rule.check).toBe("function");
    }
  });

  it("规则 id 全局唯一；page/site 集合无交集且并集为全量", () => {
    const ids = auditRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of pageRuleIds) {
      expect(siteRuleIds.has(id)).toBe(false);
    }
    expect(pageRuleIds.size + siteRuleIds.size).toBe(auditRules.length);
  });

  it("V1 23 项能力全部保留（规则 id 覆盖）", () => {
    const ids = new Set(auditRules.map((r) => r.id));
    for (const id of [
      "missing-title", "missing-description", "missing-h1", "missing-alt",
      "missing-canonical", "no-ssl", "title-length", "description-length",
      "missing-lang", "missing-viewport", "no-robots-meta", "slow-page",
      "no-structured-data", "missing-og-tags", "missing-twitter-card",
      "no-favicon", "inline-css", "no-h2-h3", "duplicate-title",
      "duplicate-description", "duplicate-h1", "no-sitemap", "broken-links",
    ]) {
      expect(ids.has(id), `规则缺失: ${id}`).toBe(true);
    }
  });
});

describe("runAuditRules：统一执行结构", () => {
  it("返回 status/pass-fail/findings/affectedPages 结构，affectedPages 为 distinct URL", () => {
    const ctx = makeQuickContext([makeFailingPage(), makeFailingPage()]);
    const executions = runAuditRules(ctx);
    const failed = executions.filter((e) => e.status === "fail");
    // 两个相同失败页面：affectedPages 去重后仍为 1（不把 2 个 finding 当 2 页）
    for (const ex of failed) {
      expect(ex.findings.length).toBeGreaterThan(0);
      expect(ex.affectedPages).toBe(1);
    }
  });

  it("severity 由规则定义，不由前端推断", () => {
    const ctx = makeQuickContext([makeFailingPage()]);
    const byId = new Map(runAuditRules(ctx).map((e) => [e.rule.id, e]));
    expect(byId.get("missing-title")!.severity).toBe("error");
    expect(byId.get("missing-canonical")!.severity).toBe("warning");
    expect(byId.get("missing-lang")!.severity).toBe("notice");
  });
});

describe("计算健康分（V2 引擎）", () => {
  it("无 issue 时返回 100", () => {
    expect(calculateHealthScoreV2([], 50)).toBe(100);
  });

  it("同一 error 影响 1/100 页与 80/100 页扣分不同（影响面参与计算）", () => {
    const one = calculateHealthScoreV2([{ ruleId: "r", severity: "error", scoreWeight: 1, pageLevel: "page", affectedPages: 1 }], 100);
    const many = calculateHealthScoreV2([{ ruleId: "r", severity: "error", scoreWeight: 1, pageLevel: "page", affectedPages: 80 }], 100);
    expect(many).toBeLessThan(one);
  });

  it("notice 极低扣分：1/100 页几乎不影响分数", () => {
    const score = calculateHealthScoreV2([{ ruleId: "r", severity: "notice", scoreWeight: 1, pageLevel: "page", affectedPages: 1 }], 100);
    expect(score).toBeGreaterThanOrEqual(99);
  });
});

describe("本地化：pickText", () => {
  it("LText 按 locale 选取 en / zh", () => {
    const t = { en: "Missing title", zh: "缺失标题" };
    expect(pickText(t, "en")).toBe("Missing title");
    expect(pickText(t, "zh")).toBe("缺失标题");
  });

  it("历史存量 string 直接返回（不区分 locale）", () => {
    expect(pickText("旧数据中文文案", "en")).toBe("旧数据中文文案");
    expect(pickText("legacy text", "zh")).toBe("legacy text");
  });

  it("null / undefined 返回空串", () => {
    expect(pickText(null, "en")).toBe("");
    expect(pickText(undefined, "zh")).toBe("");
  });
});

describe("本地化：检查项元数据双语齐备", () => {
  const HAS_CHINESE = (s: string) => /[\u4e00-\u9fff]/.test(s);

  it("所有检查项 name/description 的 en 为非空英文、zh 为非空中文", () => {
    expect(allCheckMeta.length).toBeGreaterThanOrEqual(20);
    for (const meta of allCheckMeta) {
      expect(pickText(meta.name, "en").length).toBeGreaterThan(0);
      expect(pickText(meta.name, "zh").length).toBeGreaterThan(0);
      expect(HAS_CHINESE(pickText(meta.name, "en"))).toBe(false);
      expect(HAS_CHINESE(pickText(meta.name, "zh"))).toBe(true);
      expect(pickText(meta.description, "en").length).toBeGreaterThan(0);
      expect(pickText(meta.description, "zh").length).toBeGreaterThan(0);
      expect(HAS_CHINESE(pickText(meta.description, "en"))).toBe(false);
    }
  });

  it("机器协议值不变：id/category/weight 为稳定英文枚举", () => {
    for (const meta of allCheckMeta) {
      expect(meta.id).toMatch(/^[a-z0-9-]+$/);
      expect(["critical", "warning", "info"]).toContain(meta.category);
      expect(meta.weight).toBeGreaterThan(0);
    }
  });
});

describe("本地化：检查结果输出（EN 英文 / ZH 中文）", () => {
  const issues = runPageRules([makeFailingPage()]);
  const HAS_CHINESE = (s: string) => /[\u4e00-\u9fff]/.test(s);

  it("EN locale 输出英文文案（无中文残留）", () => {
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(typeof issue.checkName).toBe("object");
      expect(HAS_CHINESE(pickText(issue.checkName, "en"))).toBe(false);
      expect(HAS_CHINESE(pickText(issue.message, "en"))).toBe(false);
      expect(HAS_CHINESE(pickText(issue.suggestion, "en"))).toBe(false);
    }
  });

  it("ZH locale 输出中文文案", () => {
    for (const issue of issues) {
      expect(HAS_CHINESE(pickText(issue.checkName, "zh"))).toBe(true);
      expect(HAS_CHINESE(pickText(issue.message, "zh"))).toBe(true);
      expect(HAS_CHINESE(pickText(issue.suggestion, "zh"))).toBe(true);
    }
  });

  it("结果结构不变：checkId/severity/url 为机器值", () => {
    for (const issue of issues) {
      expect(issue.checkId).toMatch(/^[a-z0-9-]+$/);
      expect(["error", "warning", "notice"]).toContain(issue.severity);
      expect(issue.url).toBe("http://example.com/");
    }
    const ids = new Set(issues.map((i) => i.checkId));
    expect(ids.has("missing-title")).toBe(true);
    expect(ids.has("missing-h1")).toBe(true);
    expect(ids.has("no-ssl")).toBe(true);
  });
});
