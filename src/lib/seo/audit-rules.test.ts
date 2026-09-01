import { describe, it, expect } from "vitest";
import { auditRules, pageRuleIds, allCheckMeta, normalizePage } from "@/lib/seo/audit-checks";
import type { AuditContext, FetchRecord } from "@/lib/seo/audit-checks";
import type { PageData } from "@/lib/crawl";

const BASE_URL = "https://example.com";

function makeBasePage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Example Page",
    metaDescription: "This is an example page description for testing purposes.",
    h1: ["Example Heading"],
    h2: ["Sub Heading"],
    h3: [],
    canonical: "https://example.com/",
    robotsMeta: null,
    viewport: "width=device-width, initial-scale=1",
    htmlLang: "en",
    ogTitle: "Example",
    ogDescription: "Example desc",
    ogImage: null,
    twitterCard: "summary",
    favicon: "/favicon.ico",
    links: [],
    images: [],
    hasStructuredData: false,
    structuredDataRaw: [],
    inlineStyleLength: 0,
    responseTimeMs: 500,
    bodyText: "Example page body text for testing content analysis.",
    wordCount: 10,
    ...overrides,
  };
}

/** 构造运行单条页面级规则的最小上下文 */
function makeContext(pages: PageData[]): AuditContext {
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
    baseUrl: `${BASE_URL}/`,
    origin: BASE_URL,
    depth: "quick",
    crawlLimit: 50,
    pages: normalized,
    fetchRecords,
    linkGraph,
    robots: { status: "ok", httpStatus: 200, text: "", universalDisallow: [], disallowAll: false, sitemapUrls: [], aiCrawlers: {} },
    sitemap: null,
    llmsTxt: null,
    indexablePages: normalized.length,
  };
}

/** 运行单条规则的 check，返回 RuleFinding[] */
function runRule(ruleId: string, page: PageData) {
  const rule = auditRules.find((r) => r.id === ruleId)!;
  const ctx = makeContext([page]);
  return rule.check(ctx);
}

function ruleFinding(ruleId: string, page: PageData) {
  const findings = runRule(ruleId, page);
  return findings[0] ?? null;
}

describe("no-robots-meta 检查", () => {
  it("缺失 robots meta 时不报错", () => {
    expect(ruleFinding("no-robots-meta", makeBasePage({ robotsMeta: null }))).toBeNull();
  });

  it("robots meta 为 index,follow 时不报错", () => {
    expect(ruleFinding("no-robots-meta", makeBasePage({ robotsMeta: "index, follow" }))).toBeNull();
  });

  it("robots meta 为 noindex 时生成 warning", () => {
    const f = ruleFinding("no-robots-meta", makeBasePage({ robotsMeta: "noindex" }));
    expect(f).not.toBeNull();
    expect(f!.severity ?? "warning").toBe("warning");
  });

  it("robots meta 为 none 时生成 warning", () => {
    const f = ruleFinding("no-robots-meta", makeBasePage({ robotsMeta: "none" }));
    expect(f).not.toBeNull();
    expect(f!.severity ?? "warning").toBe("warning");
  });
});

describe("结构化数据检查（V2：按状态拆分）", () => {
  it("无 JSON-LD 时 no-structured-data 生成 notice", () => {
    const f = ruleFinding("no-structured-data", makeBasePage({ hasStructuredData: false, structuredDataRaw: [] }));
    expect(f).not.toBeNull();
    expect(f!.severity ?? "notice").toBe("notice");
  });

  it("有效 JSON-LD（含 @context 和 @type）时全部通过", () => {
    const page = makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: "h", datePublished: "2026-01-01", author: { "@type": "Person", name: "A" } })],
    });
    expect(ruleFinding("no-structured-data", page)).toBeNull();
    expect(ruleFinding("invalid-structured-data", page)).toBeNull();
    expect(ruleFinding("incomplete-structured-data", page)).toBeNull();
  });

  it("JSON-LD 缺少 @type 时 invalid-structured-data 生成 error", () => {
    const f = ruleFinding("invalid-structured-data", makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify({ "@context": "https://schema.org", foo: "bar" })],
    }));
    expect(f).not.toBeNull();
    expect(f!.severity ?? "error").toBe("error");
  });

  it("JSON-LD 缺少 @context 时 incomplete-structured-data 生成 warning", () => {
    const f = ruleFinding("incomplete-structured-data", makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify({ "@type": "Article", headline: "h", datePublished: "2026-01-01", author: { "@type": "Person", name: "A" } })],
    }));
    expect(f).not.toBeNull();
    expect(f!.severity ?? "warning").toBe("warning");
  });

  it("JSON-LD 格式错误时 invalid-structured-data 生成 error（malformed）", () => {
    const f = ruleFinding("invalid-structured-data", makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: ["{ invalid json @test }"],
    }));
    expect(f).not.toBeNull();
    expect(f!.severity ?? "error").toBe("error");
  });

  it("JSON-LD 数组中含有效节点时通过", () => {
    const page = makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify([{ "@context": "https://schema.org", "@type": "Article", headline: "h", datePublished: "2026-01-01", author: { "@type": "Person", name: "A" } }])],
    });
    expect(ruleFinding("invalid-structured-data", page)).toBeNull();
    expect(ruleFinding("incomplete-structured-data", page)).toBeNull();
  });
});

describe("已删除的检查项不存在", () => {
  it("external-links-nofollow 不在规则目录", () => {
    expect(pageRuleIds.has("external-links-nofollow")).toBe(false);
  });

  it("js-redirect 不在规则目录", () => {
    expect(pageRuleIds.has("js-redirect")).toBe(false);
  });
});

describe("title-length / description-length 权重", () => {
  it("title-length scoreWeight=0.6（低优先优化项）", () => {
    const rule = auditRules.find((r) => r.id === "title-length")!;
    expect(rule.scoreWeight).toBe(0.6);
    const meta = allCheckMeta.find((m) => m.id === "title-length")!;
    expect(meta.weight).toBe(3);
  });

  it("description-length scoreWeight=0.6", () => {
    const rule = auditRules.find((r) => r.id === "description-length")!;
    expect(rule.scoreWeight).toBe(0.6);
  });
});
