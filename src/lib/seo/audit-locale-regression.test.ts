// ===== Audit 全链路深层国际化回归测试（语言污染扫描） =====
//
// 覆盖：
// 1. 标准 checks 双语完整性：所有 check 的 name/description 及触发的
//    message/suggestion 必须同时具备非空 en/zh
// 2. 语言污染扫描：ZH 文本不得出现标准英文系统文案；EN 文本不得出现标准中文系统文案
//    （URL / domain / HTTP 状态 / 技术术语 / 用户原始内容不在扫描范围）
// 3. 统一读取层 resolver 双向映射：LText JSON / 中文纯文本 / 英文纯文本 / 未知原文
// 4. 报告标题读取层双语化
// 5. catalog 外 checkId（startpage-unparsed）展示名映射
// 6. 快照字段结构契约
//
// V2：全部规则（页面级 + 站点级）经统一 runAuditRules 执行，
// trigger cases 构造对应 AuditContext，逐项触发每一条规则。

import { describe, it, expect } from "vitest";
import {
  allCheckMeta,
  nonCatalogCheckNames,
  runAuditRules,
  executionToIssues,
  normalizePage,
  pickText,
  type AuditContext,
  type AuditIssue,
  type FetchRecord,
  type LocalizedText,
} from "@/lib/seo/audit-checks";
import type { RobotsReport, SitemapReport, LlmsTxtReport } from "@/lib/seo/site-reports";
import {
  resolveAuditDetail,
  resolveAuditSuggestion,
  localizeReportTitle,
} from "@/lib/seo/audit-legacy-text";
import type { PageData } from "@/lib/crawl";

// ---------- 标准系统文案黑名单（语言污染扫描用） ----------

const EN_SYSTEM_TEXTS = [
  "Missing title",
  "Missing description",
  "Missing H1",
  "Images missing alt",
  "Missing canonical",
  "Not HTTPS",
  "Excessive inline CSS",
];

const ZH_SYSTEM_TEXTS = [
  "缺失标题",
  "缺失描述",
  "缺失 H1",
  "图片无 alt",
  "缺失 canonical",
  "非 HTTPS",
  "内联样式过多",
  "缺少标题",
  "缺少描述",
  "缺少 H1",
  "图片缺少 alt",
  "缺少 canonical",
];

// ---------- PageData 构造 ----------

const COMPLETE_WEBSITE_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Example",
  url: "https://example.com/",
});

function basePage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Example Domain — A sufficiently long title for tests",
    metaDescription:
      "A meta description that is long enough to stay within the recommended 120-160 character range for this test fixture.",
    canonical: "https://example.com/",
    robotsMeta: null,
    h1: ["Example Domain"],
    h2: ["Section"],
    h3: ["Sub"],
    images: [{ src: "a.png", alt: "decorative image" }],
    links: [{ href: "https://example.com/about", isExternal: false, text: "about" }],
    bodyText: "example body text",
    wordCount: 150,
    responseTimeMs: 800,
    status: 200,
    htmlLang: "en",
    viewport: "width=device-width, initial-scale=1",
    ogTitle: "Example",
    ogDescription: "Example description",
    ogImage: null,
    twitterCard: "summary_large_image",
    favicon: "/favicon.ico",
    hasStructuredData: true,
    structuredDataRaw: [COMPLETE_WEBSITE_JSON_LD],
    inlineStyleLength: 100,
    htmlSize: 10000,
    cssSize: 500,
    scriptSize: 200,
    visibleTextSize: 2000,
    semantic: { main: true, nav: true, article: true, header: true, footer: true, section: true },
    semanticMainCount: 3,
    headings: [{ level: 1, text: "Example Domain" }, { level: 2, text: "Section" }],
    ...overrides,
  };
}

function okRec(url: string, source: FetchRecord["source"], depth: number, hops = 0): FetchRecord {
  return {
    url,
    finalUrl: url,
    status: 200,
    responseTimeMs: 100,
    hops,
    redirectChain: [],
    isLoop: false,
    ok: true,
    source,
    depth,
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

/** 构造 AuditContext（默认 full 深度；robots 默认无 sitemap 声明） */
function makeCtx(opts: {
  pages: PageData[];
  fetchRecords?: FetchRecord[];
  robots?: RobotsReport;
  sitemap?: SitemapReport | null;
  llmsTxt?: LlmsTxtReport | null;
  linkGraph?: Map<string, Set<string>>;
}): AuditContext {
  const fetchRecords =
    opts.fetchRecords ??
    opts.pages.map((p, i) => okRec(p.finalUrl ?? p.url, i === 0 ? "start" : "link", i));
  const linkGraph = opts.linkGraph ?? new Map<string, Set<string>>();
  const pages = opts.pages.map((p, i) => normalizePage(p, fetchRecords[i], linkGraph));
  return {
    baseUrl: "https://example.com/",
    origin: "https://example.com",
    depth: "full",
    crawlLimit: 50,
    pages,
    fetchRecords,
    linkGraph,
    robots: opts.robots ?? DEFAULT_ROBOTS,
    sitemap: opts.sitemap ?? null,
    llmsTxt: opts.llmsTxt ?? null,
    indexablePages: pages.length,
  };
}

/** sitemap 报告最小构造 */
function smReport(overrides: Partial<SitemapReport>): SitemapReport {
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

// ---------- 逐项触发所有规则（V2） ----------

const triggerCases: Array<{ label: string; build: () => AuditContext }> = [
  // 页面级：元数据
  { label: "missing-title", build: () => makeCtx({ pages: [basePage({ title: "" })] }) },
  { label: "missing-description", build: () => makeCtx({ pages: [basePage({ metaDescription: null })] }) },
  { label: "missing-h1", build: () => makeCtx({ pages: [basePage({ h1: [] })] }) },
  {
    label: "missing-alt",
    build: () => makeCtx({ pages: [basePage({ images: [{ src: "a.png", alt: null }, { src: "b.png", alt: "ok" }] })] }),
  },
  { label: "missing-canonical", build: () => makeCtx({ pages: [basePage({ canonical: null })] }) },
  {
    label: "no-ssl",
    build: () => makeCtx({ pages: [basePage({ url: "http://example.com/", finalUrl: "http://example.com/" })] }),
  },
  { label: "title-length", build: () => makeCtx({ pages: [basePage({ title: "short" })] }) },
  { label: "description-length", build: () => makeCtx({ pages: [basePage({ metaDescription: "too short" })] }) },
  { label: "missing-lang", build: () => makeCtx({ pages: [basePage({ htmlLang: null })] }) },
  { label: "missing-viewport", build: () => makeCtx({ pages: [basePage({ viewport: null })] }) },
  { label: "no-robots-meta", build: () => makeCtx({ pages: [basePage({ robotsMeta: "noindex, nofollow" })] }) },
  { label: "slow-page", build: () => makeCtx({ pages: [basePage({ responseTimeMs: 4500 })] }) },
  // 页面级：结构化数据
  { label: "no-structured-data", build: () => makeCtx({ pages: [basePage({ hasStructuredData: false, structuredDataRaw: [] })] }) },
  {
    label: "invalid-structured-data/malformed",
    build: () => makeCtx({ pages: [basePage({ structuredDataRaw: ["{ not valid json }"] })] }),
  },
  {
    label: "invalid-structured-data/missing-type",
    build: () => makeCtx({ pages: [basePage({ structuredDataRaw: [JSON.stringify({ "@context": "https://schema.org", foo: "bar" })] })] }),
  },
  {
    label: "incomplete-structured-data/missing-context",
    build: () => makeCtx({ pages: [basePage({ structuredDataRaw: [JSON.stringify({ "@type": "WebSite", name: "Example", url: "https://example.com/" })] })] }),
  },
  {
    label: "duplicate-structured-data",
    build: () => makeCtx({ pages: [basePage({ structuredDataRaw: [COMPLETE_WEBSITE_JSON_LD, COMPLETE_WEBSITE_JSON_LD] })] }),
  },
  // 页面级：社交 / favicon / 样式
  { label: "missing-og-tags", build: () => makeCtx({ pages: [basePage({ ogTitle: null, ogDescription: null })] }) },
  { label: "missing-og-title-only", build: () => makeCtx({ pages: [basePage({ ogTitle: null })] }) },
  { label: "missing-twitter-card", build: () => makeCtx({ pages: [basePage({ twitterCard: null })] }) },
  { label: "no-favicon", build: () => makeCtx({ pages: [basePage({ favicon: null })] }) },
  { label: "inline-css", build: () => makeCtx({ pages: [basePage({ inlineStyleLength: 8000 })] }) },
  { label: "no-h2-h3", build: () => makeCtx({ pages: [basePage({ h2: [], h3: [] })] }) },
  // 页面级：内容
  { label: "low-content", build: () => makeCtx({ pages: [basePage({ wordCount: 5 })] }) },
  {
    label: "low-text-html-ratio",
    build: () => makeCtx({ pages: [basePage({ htmlSize: 50000, visibleTextSize: 100 })] }),
  },
  {
    label: "semantic-html/no-main",
    build: () => makeCtx({
      pages: [basePage({ semantic: { main: false, nav: true, article: false, header: true, footer: true, section: false }, semanticMainCount: 0 })],
    }),
  },
  {
    label: "semantic-html/heading-skip",
    build: () => makeCtx({
      pages: [basePage({ headings: [{ level: 1, text: "H1" }, { level: 3, text: "H3" }] })],
    }),
  },
  {
    label: "semantic-html/multi-h1",
    build: () => makeCtx({ pages: [basePage({ h1: ["A", "B"] })] }),
  },
  {
    label: "zero-internal-links",
    build: () => makeCtx({ pages: [basePage({ links: [] })] }),
  },
  // 站点级：重复内容
  { label: "duplicate-title", build: () => makeCtx({ pages: [basePage(), basePage({ url: "https://example.com/about", finalUrl: "https://example.com/about" })] }) },
  { label: "duplicate-description", build: () => makeCtx({ pages: [basePage(), basePage({ url: "https://example.com/about", finalUrl: "https://example.com/about" })] }) },
  { label: "duplicate-h1", build: () => makeCtx({ pages: [basePage(), basePage({ url: "https://example.com/about", finalUrl: "https://example.com/about" })] }) },
  // 站点级：失效页面 / 死链
  {
    label: "broken-crawled-pages",
    build: () => makeCtx({
      pages: [],
      fetchRecords: [
        { ...okRec("https://example.com/", "start", 0), status: 404, ok: false },
        { ...okRec("https://example.com/gone", "sitemap", 1), status: 410, ok: false },
      ],
    }),
  },
  {
    label: "broken-links",
    build: () => makeCtx({
      pages: [basePage()],
      fetchRecords: [
        okRec("https://example.com/", "start", 0),
        { ...okRec("https://example.com/missing", "link", 1), status: 404, ok: false },
        { ...okRec("https://example.com/error", "link", 1), status: 500, ok: false },
        { ...okRec("https://example.com/net", "link", 1), status: 0, ok: false, errorCode: "NETWORK" },
      ],
    }),
  },
  // 站点级：重定向
  {
    label: "redirect-loop",
    build: () => makeCtx({
      pages: [],
      fetchRecords: [{ ...okRec("https://example.com/a", "start", 0), finalUrl: "https://example.com/a", status: 302, ok: false, isLoop: true, hops: 3 }],
    }),
  },
  {
    label: "redirect-chain",
    build: () => makeCtx({
      pages: [],
      fetchRecords: [{ ...okRec("https://example.com/a", "start", 0), finalUrl: "https://example.com/final", hops: 3 }],
    }),
  },
  {
    label: "redirected-urls",
    build: () => makeCtx({
      pages: [],
      fetchRecords: [{ ...okRec("https://example.com/a", "start", 0), finalUrl: "https://example.com/b", status: 301, hops: 1, redirectChain: [{ url: "https://example.com/a", status: 301, location: "https://example.com/b" }] }],
    }),
  },
  {
    label: "links-to-redirects",
    build: () => makeCtx({
      pages: [basePage()],
      fetchRecords: [
        okRec("https://example.com/", "start", 0),
        {
          ...okRec("https://example.com/old", "link", 1),
          finalUrl: "https://example.com/new",
          status: 301,
          hops: 1,
          redirectChain: [{ url: "https://example.com/old", status: 301, location: "https://example.com/new" }],
        },
      ],
    }),
  },
  // 站点级：内链拓扑
  {
    label: "orphan-pages",
    build: () => makeCtx({
      pages: [basePage({ url: "https://example.com/deep", finalUrl: "https://example.com/deep" })],
      fetchRecords: [okRec("https://example.com/deep", "link", 1)],
      linkGraph: new Map([["https://example.com/", new Set(["https://example.com/other"])]]),
    }),
  },
  {
    label: "deep-pages",
    build: () => makeCtx({
      pages: [basePage()],
      fetchRecords: [okRec("https://example.com/", "start", 5)],
    }),
  },
  // 站点级：sitemap
  {
    label: "no-sitemap",
    build: () => makeCtx({ pages: [basePage()], sitemap: { found: false, sitemapUrls: ["https://example.com/sitemap.xml"], httpStatus: null, xmlValid: false, isIndex: false, childSitemaps: [], urls: [], urlStatuses: [] } }),
  },
  {
    label: "sitemap-invalid",
    build: () => makeCtx({
      pages: [basePage()],
      robots: { ...DEFAULT_ROBOTS, sitemapUrls: ["https://example.com/sitemap.xml"] },
      sitemap: { found: false, sitemapUrls: ["https://example.com/sitemap.xml"], httpStatus: 500, xmlValid: false, isIndex: false, childSitemaps: [], urls: [], urlStatuses: [] },
    }),
  },
  {
    label: "sitemap-bad-urls",
    build: () => makeCtx({
      pages: [basePage()],
      sitemap: smReport({ urls: ["https://example.com/missing"], urlStatuses: [{ url: "https://example.com/missing", status: 404, redirect: false, location: null }] }),
    }),
  },
  {
    label: "sitemap-redirects",
    build: () => makeCtx({
      pages: [basePage()],
      sitemap: smReport({ urls: ["https://example.com/old"], urlStatuses: [{ url: "https://example.com/old", status: 301, redirect: true, location: "https://example.com/new" }] }),
    }),
  },
  {
    label: "sitemap-coverage",
    build: () => makeCtx({
      pages: [basePage()],
      sitemap: smReport({ urls: ["https://example.com/not-crawled"], urlStatuses: [] }),
    }),
  },
  // 站点级：robots / AI 爬虫 / llms.txt
  {
    label: "robots-unreachable",
    build: () => makeCtx({ pages: [basePage()], robots: { ...DEFAULT_ROBOTS, status: "unreachable", httpStatus: 500 } }),
  },
  {
    label: "robots-blocks-important",
    build: () => makeCtx({ pages: [basePage()], robots: { ...DEFAULT_ROBOTS, disallowAll: true, universalDisallow: ["/"] } }),
  },
  {
    label: "ai-crawler-access",
    build: () => makeCtx({ pages: [basePage()], robots: { ...DEFAULT_ROBOTS, aiCrawlers: { "OAI-SearchBot": "disallowed" } } }),
  },
  {
    label: "llms-txt/missing",
    build: () => makeCtx({ pages: [basePage()], llmsTxt: { status: "missing", httpStatus: 404, size: 0 } }),
  },
  {
    label: "llms-txt/invalid",
    build: () => makeCtx({ pages: [basePage()], llmsTxt: { status: "invalid", httpStatus: 200, size: 5 } }),
  },
];

/** 触发全部检查并收集 issue（每条 issue 的 message/suggestion 应为 LText） */
function collectAllIssues(): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const c of triggerCases) {
    const execIssues = runAuditRules(c.build()).flatMap((ex) => executionToIssues(ex));
    expect(execIssues.length, `触发用例未产生 issue：${c.label}`).toBeGreaterThan(0);
    issues.push(...execIssues);
  }
  return issues;
}

// ---------- 1. 标准 checks 双语完整性 ----------

describe("标准 Audit checks 双语完整性", () => {
  it("所有检查项 name/description 的 en/zh 均为非空字符串", () => {
    for (const meta of allCheckMeta) {
      expect(pickText(meta.name, "en"), `${meta.id}.name.en`).toBeTruthy();
      expect(pickText(meta.name, "zh"), `${meta.id}.name.zh`).toBeTruthy();
      expect(pickText(meta.description, "en"), `${meta.id}.description.en`).toBeTruthy();
      expect(pickText(meta.description, "zh"), `${meta.id}.description.zh`).toBeTruthy();
    }
  });

  it("所有触发 issue 的 message/suggestion：LText 值 en/zh 均非空；机器值纯字符串原样通过", () => {
    const issues = collectAllIssues();
    expect(issues.length).toBeGreaterThanOrEqual(20);
    for (const issue of issues) {
      // 机器值 message（如 HTTP 状态文本）按规范不翻译，存取均原样
      if (typeof issue.message === "string") {
        expect(issue.message.length, `${issue.checkId} machine message`).toBeGreaterThan(0);
        expect(resolveAuditDetail(issue.message, "zh")).toBe(issue.message);
        expect(resolveAuditDetail(issue.message, "en")).toBe(issue.message);
      } else {
        const msg = issue.message as { en: string; zh: string };
        expect(msg.en, `${issue.checkId} message.en`).toBeTruthy();
        expect(msg.zh, `${issue.checkId} message.zh`).toBeTruthy();
      }
      const sug = issue.suggestion as { en: string; zh: string };
      expect(sug.en, `${issue.checkId} suggestion.en`).toBeTruthy();
      expect(sug.zh, `${issue.checkId} suggestion.zh`).toBeTruthy();
    }
  });

  it("检查项总数 ≥ 20（页面级 + 站点级合计）", () => {
    expect(allCheckMeta.length).toBeGreaterThanOrEqual(20);
    expect(allCheckMeta.filter((m) => m.category === "critical").length).toBeGreaterThan(0);
  });
});

// ---------- 2. 语言污染扫描 ----------

describe("语言污染扫描（ZH 结果无英文系统文案 / EN 结果无中文系统文案）", () => {
  const issues = collectAllIssues();

  it("ZH 输出不得包含标准英文系统文案", () => {
    const zhTexts = [
      ...allCheckMeta.flatMap((m) => [pickText(m.name, "zh"), pickText(m.description, "zh")]),
      ...issues.flatMap((i) => [
        pickText(i.message, "zh"),
        pickText(i.suggestion, "zh"),
        pickText(i.checkName, "zh"),
      ]),
    ];
    for (const text of zhTexts) {
      for (const en of EN_SYSTEM_TEXTS) {
        expect(text, `ZH 文案包含英文系统文案 "${en}"：${text}`).not.toContain(en);
      }
    }
  });

  it("EN 输出不得包含标准中文系统文案", () => {
    const enTexts = [
      ...allCheckMeta.flatMap((m) => [pickText(m.name, "en"), pickText(m.description, "en")]),
      ...issues.flatMap((i) => [
        pickText(i.message, "en"),
        pickText(i.suggestion, "en"),
        pickText(i.checkName, "en"),
      ]),
    ];
    for (const text of enTexts) {
      for (const zh of ZH_SYSTEM_TEXTS) {
        expect(text, `EN 文案包含中文系统文案 "${zh}"：${text}`).not.toContain(zh);
      }
    }
  });

  it("机器值 / 技术术语允许原样出现（不误伤）", () => {
    expect(pickText(issues.find((i) => i.checkId === "missing-canonical")!.message, "en")).toContain("canonical");
    expect(resolveAuditDetail("HTTP 404 Not Found", "zh")).toBe("HTTP 404 Not Found");
    expect(resolveAuditDetail("HTTP 404 Not Found", "en")).toBe("HTTP 404 Not Found");
  });
});

// ---------- 3. 统一读取层 resolver（双向） ----------

describe("resolveAuditDetail / resolveAuditSuggestion（统一读取层）", () => {
  it("LText JSON → 按 locale 选取", () => {
    const ltext = JSON.stringify({ en: "Page has no H1 tag", zh: "页面缺少 H1 标签" });
    expect(resolveAuditDetail(ltext, "en")).toBe("Page has no H1 tag");
    expect(resolveAuditDetail(ltext, "zh")).toBe("页面缺少 H1 标签");
    const sug = JSON.stringify({ en: "Write a unique H1", zh: "编写唯一的 H1" });
    expect(resolveAuditSuggestion(sug, "en")).toBe("Write a unique H1");
    expect(resolveAuditSuggestion(sug, "zh")).toBe("编写唯一的 H1");
  });

  it("中文纯文本（历史 DB / ZH 保存快照）→ 双向输出", () => {
    expect(resolveAuditDetail("页面缺少 H1 标签", "zh")).toBe("页面缺少 H1 标签");
    expect(resolveAuditDetail("页面缺少 H1 标签", "en")).toBe("Page has no H1 tag");
    expect(resolveAuditDetail("标题长度 45 字符（建议 30-60）", "en")).toBe(
      "Title length 45 characters (recommended 30-60)"
    );
    expect(resolveAuditSuggestion("部署 SSL 证书并强制 HTTPS 重定向", "en")).toBe(
      "Install an SSL certificate and enforce HTTPS redirects"
    );
    // 旧版（v1.0）no-robots-meta / js-redirect 历史行（本地 DB 实际存在）
    expect(resolveAuditDetail("页面缺少 robots meta 标签", "en")).toBe("Page has no robots meta tag");
    expect(resolveAuditDetail("页面缺少 robots meta 标签", "zh")).toBe("页面缺少 robots meta 标签");
    expect(resolveAuditSuggestion('添加 <meta name="robots" content="index, follow">（非强制）', "en")).toBe(
      'Add <meta name="robots" content="index, follow"> (optional)'
    );
    expect(resolveAuditDetail("页面检测到 JS 重定向（window.location）", "en")).toBe(
      "JS redirect detected on the page (window.location)"
    );
    expect(resolveAuditSuggestion("改用服务端 301/302 重定向", "en")).toBe(
      "Use server-side 301/302 redirects instead"
    );
  });

  it("英文纯文本（EN 保存快照）→ 双向输出（反向映射）", () => {
    expect(resolveAuditDetail("Page has no H1 tag", "en")).toBe("Page has no H1 tag");
    expect(resolveAuditDetail("Page has no H1 tag", "zh")).toBe("页面缺少 H1 标签");
    expect(resolveAuditDetail("Title length 45 characters (recommended 30-60)", "zh")).toBe(
      "标题长度 45 字符（建议 30-60）"
    );
    expect(resolveAuditDetail('"About Us" duplicated across 3 pages', "zh")).toBe(
      '"About Us" 在 3 个页面重复'
    );
    expect(resolveAuditDetail("3/10 images missing alt attribute", "zh")).toBe(
      "3/10 张图片缺少 alt 属性"
    );
    expect(resolveAuditSuggestion("Install an SSL certificate and enforce HTTPS redirects", "zh")).toBe(
      "部署 SSL 证书并强制 HTTPS 重定向"
    );
  });

  it("未知 / 机器值 / 用户原始内容 → 原样保留（绝不返回空白）", () => {
    expect(resolveAuditDetail("HTTP 404", "en")).toBe("HTTP 404");
    expect(resolveAuditDetail("HTTP 404", "zh")).toBe("HTTP 404");
    expect(resolveAuditDetail("完全未知的自定义文案", "en")).toBe("完全未知的自定义文案");
    expect(resolveAuditDetail("Totally unknown custom text", "zh")).toBe("Totally unknown custom text");
    expect(resolveAuditDetail(null, "zh")).toBeNull();
    expect(resolveAuditDetail(undefined, "en")).toBeNull();
    expect(resolveAuditSuggestion("未知的建议文本", "en")).toBe("未知的建议文本");
    expect(resolveAuditSuggestion("Unknown suggestion text", "zh")).toBe("Unknown suggestion text");
  });

  it("当前 catalog 全部 message/suggestion 的 zh 与 en 纯文本均可双向解析（快照场景闭环）", () => {
    const issues = collectAllIssues();
    for (const issue of issues) {
      // 机器值 message（如 HTTP 状态文本）不参与语言映射
      if (typeof issue.message === "string") continue;
      const msg = issue.message as { en: string; zh: string };
      // EN 保存的快照在 ZH 下回读 → 中文
      expect(resolveAuditDetail(msg.en, "zh"), `${issue.checkId} en→zh`).toBe(msg.zh);
      // ZH 保存的快照在 EN 下回读 → 英文
      expect(resolveAuditDetail(msg.zh, "en"), `${issue.checkId} zh→en`).toBe(msg.en);
      const sug = issue.suggestion as { en: string; zh: string };
      expect(resolveAuditSuggestion(sug.en, "zh"), `${issue.checkId} sug en→zh`).toBe(sug.zh);
      expect(resolveAuditSuggestion(sug.zh, "en"), `${issue.checkId} sug zh→en`).toBe(sug.en);
    }
  });
});

// ---------- 4. 报告标题读取层双语化 ----------

describe("localizeReportTitle（报告列表标题）", () => {
  it("英文保存标题 → ZH 显示中文；中文保存标题 → EN 显示英文", () => {
    expect(localizeReportTitle("Audit Report · example.com", "zh")).toBe("审计报告 · example.com");
    expect(localizeReportTitle("审计报告 · example.com", "en")).toBe("Audit Report · example.com");
    expect(localizeReportTitle("Ranking Report · example.com", "zh")).toBe("排名报告 · example.com");
    expect(localizeReportTitle("排名报告 · example.com", "en")).toBe("Ranking Report · example.com");
    expect(localizeReportTitle("Content Report · https://example.com/a", "zh")).toBe(
      "内容报告 · https://example.com/a"
    );
    expect(localizeReportTitle("Weekly Report · 2026.08.10 - 2026.08.17", "zh")).toBe(
      "周报 · 2026.08.10 - 2026.08.17"
    );
  });

  it("同语言 / 未知标题原样返回", () => {
    expect(localizeReportTitle("Audit Report · example.com", "en")).toBe("Audit Report · example.com");
    expect(localizeReportTitle("审计报告 · example.com", "zh")).toBe("审计报告 · example.com");
    expect(localizeReportTitle("自定义标题 example", "zh")).toBe("自定义标题 example");
    expect(localizeReportTitle("Custom title", "en")).toBe("Custom title");
  });
});

// ---------- 5. catalog 外 checkId 展示名 ----------

describe("catalog 外 checkId（如 startpage-unparsed）展示名映射", () => {
  it("startpage-unparsed 具备 en/zh 双语展示名", () => {
    const name = nonCatalogCheckNames["startpage-unparsed"];
    expect(name).toBeTruthy();
    expect(pickText(name, "en")).toBeTruthy();
    expect(pickText(name, "zh")).toBe("起始页未能解析");
  });

  it("js-redirect（旧版检查项）具备 en/zh 双语展示名", () => {
    const name = nonCatalogCheckNames["js-redirect"];
    expect(name).toBeTruthy();
    expect(pickText(name, "en")).toBe("JS redirect");
    expect(pickText(name, "zh")).toBe("JS 重定向");
  });

  it("补充映射不得混入评分 catalog（MAX_SCORE 不受影响）", () => {
    expect(allCheckMeta.some((m) => m.id === "startpage-unparsed")).toBe(false);
  });
});

// ---------- 6. 快照字段结构契约 ----------

describe("快照字段结构契约（AuditReport / reports 页消费）", () => {
  it("message/suggestion 序列化后仍可被 resolver 还原（模拟 DB / 快照 JSON 往返）", () => {
    const issues = collectAllIssues();
    for (const issue of issues) {
      // 与生产写入一致（audit.ts serializeLocalized）：LText → JSON 字符串；纯字符串机器值原样
      const serialize = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
      const stored = JSON.stringify({
        checkId: issue.checkId,
        detail: serialize(issue.message),
        suggestion: serialize(issue.suggestion),
      });
      const parsed = JSON.parse(stored) as { checkId: string; detail: string; suggestion: string };
      expect(resolveAuditDetail(parsed.detail, "zh")).toBe(pickText(issue.message, "zh"));
      expect(resolveAuditDetail(parsed.detail, "en")).toBe(pickText(issue.message, "en"));
      expect(resolveAuditSuggestion(parsed.suggestion, "zh")).toBe(pickText(issue.suggestion, "zh"));
      expect(resolveAuditSuggestion(parsed.suggestion, "en")).toBe(pickText(issue.suggestion, "en"));
    }
  });

  it("checkName 兼容 string 历史值与 LText 新值（pickText）", () => {
    const legacy: LocalizedText = "历史纯文本";
    expect(pickText(legacy, "zh")).toBe("历史纯文本");
    expect(pickText(legacy, "en")).toBe("历史纯文本");
    const ltext: LocalizedText = { en: "New", zh: "新值" };
    expect(pickText(ltext, "zh")).toBe("新值");
    expect(pickText(ltext, "en")).toBe("New");
    expect(pickText(null, "zh")).toBe("");
  });
});
