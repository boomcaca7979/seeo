// ===== Audit Engine 站点级规则 + 内容规则单元测试 =====
// 覆盖：重定向（1 跳 / 多跳 / 环）、失效页面（404/410/500/网络错误）、
// 内链拓扑（孤儿 / 深层页）、sitemap（无引用 / 无效 / 坏 URL / 重定向 / 覆盖）、
// robots（不可达 / 整站阻断）、AI 爬虫访问、llms.txt、内容量阈值、text-html 比例、
// 语义化 HTML。

import { describe, it, expect } from "vitest";
import {
  auditRules,
  runAuditRules,
  normalizePage,
  pickText,
  type AuditContext,
  type FetchRecord,
  type RuleFinding,
} from "@/lib/seo/audit-checks";
import type { RobotsReport, SitemapReport, LlmsTxtReport } from "@/lib/seo/site-reports";
import type { PageData } from "@/lib/crawl";

// ---------- 构造 ----------

function basePage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Example - A Sufficiently Long Page Title",
    metaDescription: "A meta description long enough to stay within the recommended 120-160 character range for this test.",
    canonical: "https://example.com/",
    robotsMeta: null,
    h1: ["Example"],
    h2: ["Section"],
    h3: [],
    images: [{ src: "a.png", alt: "ok" }],
    links: [{ href: "https://example.com/about", isExternal: false, text: "about" }],
    bodyText: "content ".repeat(200),
    wordCount: 400,
    htmlLang: "en",
    viewport: "width=device-width, initial-scale=1",
    ogTitle: "Example",
    ogDescription: "Example desc",
    ogImage: null,
    twitterCard: "summary",
    favicon: "/favicon.ico",
    hasStructuredData: true,
    structuredDataRaw: [JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: "Example", url: "https://example.com/" })],
    inlineStyleLength: 0,
    htmlSize: 20000,
    cssSize: 100,
    scriptSize: 50,
    visibleTextSize: 4000,
    semantic: { main: true, nav: true, article: true, header: true, footer: true, section: true },
    semanticMainCount: 3,
    headings: [{ level: 1, text: "Example" }, { level: 2, text: "Section" }],
    ...overrides,
  };
}

function rec(overrides: Partial<FetchRecord> = {}): FetchRecord {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    responseTimeMs: 100,
    hops: 0,
    redirectChain: [],
    isLoop: false,
    ok: true,
    source: "start",
    depth: 0,
    ...overrides,
  };
}

const DEFAULT_ROBOTS: RobotsReport = {
  status: "ok",
  httpStatus: 200,
  text: "User-agent: *\nDisallow:",
  universalDisallow: [],
  disallowAll: false,
  sitemapUrls: [],
  aiCrawlers: {},
};

function ctx(opts: {
  pages?: PageData[];
  fetchRecords?: FetchRecord[];
  robots?: RobotsReport;
  sitemap?: SitemapReport | null;
  llmsTxt?: LlmsTxtReport | null;
  linkGraph?: Map<string, Set<string>>;
}): AuditContext {
  const pages = opts.pages ?? [];
  const fetchRecords = opts.fetchRecords ?? pages.map((p, i) => rec({ url: p.url, finalUrl: p.finalUrl, depth: i, source: i === 0 ? "start" : "link" }));
  const linkGraph = opts.linkGraph ?? new Map<string, Set<string>>();
  const normalized = pages.map((p, i) => normalizePage(p, fetchRecords[i], linkGraph));
  return {
    baseUrl: "https://example.com/",
    origin: "https://example.com",
    depth: "full",
    crawlLimit: 50,
    pages: normalized,
    fetchRecords,
    linkGraph,
    robots: opts.robots ?? DEFAULT_ROBOTS,
    sitemap: opts.sitemap ?? null,
    llmsTxt: opts.llmsTxt ?? null,
    indexablePages: normalized.length,
  };
}

function run(ruleId: string, c: AuditContext): RuleFinding[] {
  const rule = auditRules.find((r) => r.id === ruleId)!;
  return rule.check(c);
}

function smReport(overrides: Partial<SitemapReport> = {}): SitemapReport {
  return {
    found: true,
    sitemapUrls: ["https://example.com/sitemap.xml"],
    httpStatus: 200,
    xmlValid: true,
    isIndex: false,
    childSitemaps: [],
    urls: [],
    urlStatuses: [],
    ...overrides,
  };
}

// ---------- 重定向 ----------

describe("重定向规则", () => {
  it("1 跳 → redirected-urls（notice）；2+ 跳 → redirect-chain（warning/高影响）", () => {
    const oneHop = run("redirected-urls", ctx({
      fetchRecords: [rec({ url: "https://example.com/old", finalUrl: "https://example.com/new", hops: 1, redirectChain: [{ url: "https://example.com/old", status: 301, location: "https://example.com/new" }] })],
    }));
    expect(oneHop.length).toBe(1);

    const chain = run("redirect-chain", ctx({
      fetchRecords: [rec({ url: "https://example.com/old", finalUrl: "https://example.com/new", hops: 3 })],
    }));
    expect(chain.length).toBe(1);
    expect(pickText(chain[0].message, "zh")).toContain("影响较大");
  });

  it("重定向环 → redirect-loop（error）", () => {
    const loop = run("redirect-loop", ctx({
      fetchRecords: [rec({ url: "https://example.com/a", finalUrl: "https://example.com/a", isLoop: true, hops: 2, ok: false })],
    }));
    expect(loop.length).toBe(1);
    expect(loop[0].severity ?? "error").toBe("error");
  });

  it("内链指向重定向 → links-to-redirects（notice）", () => {
    const links = run("links-to-redirects", ctx({
      fetchRecords: [
        rec(),
        rec({ url: "https://example.com/old", finalUrl: "https://example.com/new", hops: 1, source: "link" }),
      ],
    }));
    expect(links.length).toBe(1);
  });
});

// ---------- 失效页面 / 死链 ----------

describe("失效页面与死链规则", () => {
  it("起始页 404/410 → broken-crawled-pages error；5xx → warning", () => {
    const findings = run("broken-crawled-pages", ctx({
      fetchRecords: [
        rec({ url: "https://example.com/", status: 404, ok: false }),
        rec({ url: "https://example.com/gone", status: 410, ok: false, source: "sitemap" }),
        rec({ url: "https://example.com/err", status: 500, ok: false, source: "start" }),
      ],
    }));
    const errors = findings.filter((f) => (f.severity ?? "error") === "error");
    const warnings = findings.filter((f) => (f.severity ?? "error") === "warning");
    expect(errors.length).toBe(2); // 404 + 410
    expect(warnings.length).toBe(1); // 500
  });

  it("站内链接 404/500 → broken-links（5xx 为 warning）", () => {
    const findings = run("broken-links", ctx({
      fetchRecords: [
        rec(),
        rec({ url: "https://example.com/missing", status: 404, ok: false, source: "link" }),
        rec({ url: "https://example.com/err", status: 500, ok: false, source: "link" }),
      ],
    }));
    expect(findings.length).toBe(2);
    expect(findings.find((f) => f.url.endsWith("404") || f.url.includes("missing"))?.severity ?? "error").toBe("error");
    expect(findings.find((f) => f.url.includes("err"))?.severity ?? "error").toBe("warning");
  });

  it("网络错误视为 broken（error）", () => {
    const findings = run("broken-crawled-pages", ctx({
      fetchRecords: [rec({ url: "https://example.com/net", status: 0, ok: false, errorCode: "NETWORK", source: "start" })],
    }));
    expect(findings.length).toBe(1);
    expect(pickText(findings[0].message, "en")).toContain("failed to connect");
  });

  it("重定向不当成 broken（hops>0 的 301 不触发）", () => {
    const findings = run("broken-links", ctx({
      fetchRecords: [
        rec(),
        rec({ url: "https://example.com/old", status: 301, ok: false, source: "link", hops: 1, finalUrl: "https://example.com/new" }),
      ],
    }));
    expect(findings.length).toBe(0);
  });
});

// ---------- 内链拓扑 ----------

describe("内链拓扑规则", () => {
  it("无入链且非起始页 → orphan-pages（notice，非 error）", () => {
    const findings = run("orphan-pages", ctx({
      pages: [basePage({ url: "https://example.com/deep", finalUrl: "https://example.com/deep" })],
      fetchRecords: [rec({ url: "https://example.com/deep", finalUrl: "https://example.com/deep", depth: 1, source: "link" })],
    }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "notice").toBe("notice");
  });

  it("起始页（depth 0）不判为孤儿；有入链的页面不判为孤儿", () => {
    const lg = new Map<string, Set<string>>([["https://example.com/deep", new Set(["https://example.com/"])]]);
    const findings = run("orphan-pages", ctx({
      pages: [basePage(), basePage({ url: "https://example.com/deep", finalUrl: "https://example.com/deep" })],
      fetchRecords: [
        rec({ url: "https://example.com/", depth: 0 }),
        rec({ url: "https://example.com/deep", finalUrl: "https://example.com/deep", depth: 1, source: "link" }),
      ],
      linkGraph: lg,
    }));
    expect(findings.length).toBe(0);
  });

  it("超过 4 层 → deep-pages（notice）", () => {
    const findings = run("deep-pages", ctx({
      pages: [basePage()],
      fetchRecords: [rec({ depth: 5 })],
    }));
    expect(findings.length).toBe(1);
    expect(findings[0].metrics?.depth).toBe(5);
  });
});

// ---------- sitemap ----------

describe("sitemap 规则", () => {
  it("robots 未声明且无可访问 sitemap → no-sitemap（notice）", () => {
    const findings = run("no-sitemap", ctx({ sitemap: { found: false, sitemapUrls: [], httpStatus: null, xmlValid: false, isIndex: false, childSitemaps: [], urls: [], urlStatuses: [] } }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "notice").toBe("notice");
  });

  it("sitemap 无效/不可达 → sitemap-invalid（warning）", () => {
    const findings = run("sitemap-invalid", ctx({
      robots: { ...DEFAULT_ROBOTS, sitemapUrls: ["https://example.com/sitemap.xml"] },
      sitemap: { found: false, sitemapUrls: ["https://example.com/sitemap.xml"], httpStatus: 500, xmlValid: false, isIndex: false, childSitemaps: [], urls: [], urlStatuses: [] },
    }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "warning").toBe("warning");
  });

  it("sitemap 含 4xx URL → sitemap-bad-urls（warning）", () => {
    const findings = run("sitemap-bad-urls", ctx({
      sitemap: smReport({ urls: ["https://example.com/missing"], urlStatuses: [{ url: "https://example.com/missing", status: 404, redirect: false, location: null }] }),
    }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "warning").toBe("warning");
  });

  it("sitemap 含重定向 URL → sitemap-redirects（notice）", () => {
    const findings = run("sitemap-redirects", ctx({
      sitemap: smReport({ urls: ["https://example.com/old"], urlStatuses: [{ url: "https://example.com/old", status: 301, redirect: true, location: "https://example.com/new" }] }),
    }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "notice").toBe("notice");
  });

  it("已抓取页面未列入 sitemap → sitemap-coverage（notice，非 sitemap 错误）", () => {
    const findings = run("sitemap-coverage", ctx({
      pages: [basePage()],
      sitemap: smReport({ urls: ["https://example.com/not-crawled"], urlStatuses: [] }),
    }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "notice").toBe("notice");
  });

  it("sitemap 覆盖全部已抓取页面时不报（crawler 未抓到不代表 sitemap 错误）", () => {
    const findings = run("sitemap-coverage", ctx({
      pages: [basePage()],
      sitemap: smReport({ urls: ["https://example.com/"], urlStatuses: [] }),
    }));
    expect(findings.length).toBe(0);
  });
});

// ---------- robots / AI 爬虫 / llms.txt ----------

describe("robots / AI 爬虫 / llms.txt 规则", () => {
  it("robots.txt 不可达 → robots-unreachable（warning）", () => {
    const findings = run("robots-unreachable", ctx({ robots: { ...DEFAULT_ROBOTS, status: "unreachable", httpStatus: 500 } }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "warning").toBe("warning");
  });

  it("Disallow: / → robots-blocks-important（error）", () => {
    const findings = run("robots-blocks-important", ctx({ robots: { ...DEFAULT_ROBOTS, disallowAll: true, universalDisallow: ["/"] } }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "error").toBe("error");
  });

  it("AI 爬虫被 Disallow → ai-crawler-access（notice，非传统 SEO Error）", () => {
    const findings = run("ai-crawler-access", ctx({ robots: { ...DEFAULT_ROBOTS, aiCrawlers: { GPTBot: "disallowed" } } }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "notice").toBe("notice");
    expect(findings[0].metrics?.GPTBot).toBe("disallowed");
  });

  it("AI 爬虫全部允许时不报", () => {
    const findings = run("ai-crawler-access", ctx({ robots: { ...DEFAULT_ROBOTS, aiCrawlers: { GPTBot: "allowed", ClaudeBot: "not-specified" } } }));
    expect(findings.length).toBe(0);
  });

  it("llms.txt 缺失 → llms-txt（notice/机会，非 error）", () => {
    const findings = run("llms-txt", ctx({ llmsTxt: { status: "missing", httpStatus: 404, size: 0 } }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "notice").toBe("notice");
  });

  it("llms.txt 无效 → llms-txt notice；存在且有效不报", () => {
    const invalid = run("llms-txt", ctx({ llmsTxt: { status: "invalid", httpStatus: 200, size: 5 } }));
    expect(invalid.length).toBe(1);
    const found = run("llms-txt", ctx({ llmsTxt: { status: "found", httpStatus: 200, size: 100 } }));
    expect(found.length).toBe(0);
  });
});

// ---------- 内容 / text-html / 语义化 ----------

describe("内容与语义规则", () => {
  it("低内容按页面类型区分：工具页 120 词 normal，指南页 200 词 low", () => {
    const tool = run("low-content", ctx({ pages: [basePage({ url: "https://example.com/tools/x", finalUrl: "https://example.com/tools/x", wordCount: 120 })] }));
    expect(tool.length).toBe(0);

    const guide = run("low-content", ctx({ pages: [basePage({ url: "https://example.com/guide/x", finalUrl: "https://example.com/guide/x", wordCount: 200 })] }));
    expect(guide.length).toBe(1);
    expect(guide[0].metrics?.contentType).toBe("guide");
    expect(guide[0].metrics?.status).toBe("low");
  });

  it("内容极低 → warning；一般偏低 → notice", () => {
    const veryLow = run("low-content", ctx({ pages: [basePage({ wordCount: 10 })] }));
    expect(veryLow[0].severity ?? "warning").toBe("warning");
    const low = run("low-content", ctx({ pages: [basePage({ wordCount: 100 })] })); // homepage low=150
    expect(low[0].severity ?? "notice").toBe("notice");
  });

  it("text-html 比例过低 → notice（<10%）；极低 → warning（<5%）", () => {
    const low = run("low-text-html-ratio", ctx({ pages: [basePage({ htmlSize: 20000, visibleTextSize: 1500 })] })); // 7.5%
    expect(low.length).toBe(1);
    expect(low[0].severity ?? "notice").toBe("notice");
    const veryLow = run("low-text-html-ratio", ctx({ pages: [basePage({ htmlSize: 20000, visibleTextSize: 800 })] })); // 4%
    expect(veryLow[0].severity ?? "warning").toBe("warning");
  });

  it("text-html 比例正常不报", () => {
    const ok = run("low-text-html-ratio", ctx({ pages: [basePage({ htmlSize: 20000, visibleTextSize: 4000 })] })); // 20%
    expect(ok.length).toBe(0);
  });

  it("语义化 HTML：主内容无语义标签 → notice（不直接判 error）", () => {
    const findings = run("semantic-html", ctx({
      pages: [basePage({ semantic: { main: false, nav: true, article: false, header: true, footer: true, section: false }, semanticMainCount: 0 })],
    }));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity ?? "notice").toBe("notice");
  });

  it("标题层级跳跃 → semantic-html notice", () => {
    const findings = run("semantic-html", ctx({
      pages: [basePage({ headings: [{ level: 1, text: "H1" }, { level: 3, text: "H3" }] })],
    }));
    expect(findings.some((f) => pickText(f.message, "en").includes("skips"))).toBe(true);
  });

  it("无内链 → zero-internal-links（notice）", () => {
    const findings = run("zero-internal-links", ctx({ pages: [basePage({ links: [] })] }));
    expect(findings.length).toBe(1);
    expect(findings[0].severity ?? "notice").toBe("notice");
  });
});

// ---------- 规则执行完整性 ----------

describe("runAuditRules 站点级联动", () => {
  it("quick 深度跳过站点级规则（depth 口径）", () => {
    const c = ctx({
      pages: [basePage({ title: "" })],
      fetchRecords: [
        rec(),
        rec({ url: "https://example.com/old", finalUrl: "https://example.com/new", hops: 2, source: "link" }),
      ],
    });
    c.depth = "quick";
    const execs = runAuditRules(c);
    const siteRules = execs.filter((e) => e.rule.pageLevel === "site");
    expect(siteRules.every((e) => e.findings.length === 0)).toBe(true);
    // 页面级规则照常执行（失败页面触发 missing-title 等）
    expect(execs.some((e) => e.rule.pageLevel === "page" && e.findings.length > 0)).toBe(true);
  });
});
