// ===== Audit 全链路深层国际化回归测试（语言污染扫描）=====
//
// 覆盖：
// 1. 标准 checks 双语完整性：所有 check 的 name/description 及触发的
//    message/suggestion 必须同时具备非空 en/zh
// 2. 语言污染扫描：ZH 文本不得出现标准英文系统文案；EN 文本不得出现标准中文系统文案
//    （URL / domain / HTTP 状态 / 技术术语 / 用户原始内容不在扫描范围）
// 3. 统一读取层 resolver 双向映射：LText JSON / 中文纯文本 / 英文纯文本 / 未知原文
// 4. 报告标题读取层双语化
// 5. catalog 外 checkId（startpage-unparsed）展示名映射

import { describe, it, expect } from "vitest";
import {
  perPageChecks,
  crossPageChecks,
  allCheckMeta,
  nonCatalogCheckNames,
  runPerPageChecks,
  runCrossPageChecks,
  pickText,
  type AuditIssue,
  type LocalizedText,
} from "@/lib/seo/audit-checks";
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

function basePage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: "https://example.com/",
    title: "Example Domain — A sufficiently long title for tests",
    metaDescription:
      "A meta description that is long enough to stay within the recommended 120-160 character range for this test fixture.",
    canonical: "https://example.com/",
    robotsMeta: null,
    h1: ["Example Domain"],
    h2: ["Section"],
    h3: ["Sub"],
    images: [{ src: "a.png", alt: "decorative image" }],
    links: [],
    bodyText: "example body text",
    wordCount: 100,
    responseTimeMs: 800,
    status: 200,
    finalUrl: "https://example.com/",
    htmlLang: "en",
    viewport: "width=device-width, initial-scale=1",
    ogTitle: "Example",
    ogDescription: "Example description",
    twitterCard: "summary_large_image",
    favicon: "/favicon.ico",
    hasStructuredData: true,
    structuredDataRaw: [
      JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite" }),
    ],
    inlineStyleLength: 100,
    ...overrides,
  };
}

interface TriggerCase {
  label: string;
  pages: PageData[];
  extra?: { robotsText: string | null; brokenLinks: Array<{ url: string; statusCode: number }> };
}

/** 逐项触发所有检查（覆盖 no-structured-data 的全部分支） */
const triggerCases: TriggerCase[] = [
  { label: "missing-title", pages: [basePage({ title: "" })] },
  { label: "missing-description", pages: [basePage({ metaDescription: null })] },
  { label: "missing-h1", pages: [basePage({ h1: [] })] },
  {
    label: "missing-alt",
    pages: [basePage({ images: [{ src: "a.png", alt: null }, { src: "b.png", alt: "ok" }] })],
  },
  { label: "missing-canonical", pages: [basePage({ canonical: null })] },
  { label: "no-ssl", pages: [basePage({ url: "http://example.com/", finalUrl: "http://example.com/" })] },
  { label: "title-length", pages: [basePage({ title: "short" })] },
  { label: "description-length", pages: [basePage({ metaDescription: "too short" })] },
  { label: "missing-lang", pages: [basePage({ htmlLang: null })] },
  { label: "missing-viewport", pages: [basePage({ viewport: null })] },
  { label: "no-robots-meta", pages: [basePage({ robotsMeta: "noindex, nofollow" })] },
  { label: "slow-page", pages: [basePage({ responseTimeMs: 4500 })] },
  { label: "no-structured-data/absent", pages: [basePage({ hasStructuredData: false, structuredDataRaw: [] })] },
  {
    label: "no-structured-data/malformed",
    pages: [basePage({ structuredDataRaw: ["{ not valid json }"] })],
  },
  {
    label: "no-structured-data/graph-incomplete",
    pages: [
      basePage({
        structuredDataRaw: [
          JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }] }),
        ],
      }),
    ],
  },
  {
    label: "no-structured-data/incomplete",
    pages: [basePage({ structuredDataRaw: [JSON.stringify({ "@type": "WebPage" })] })],
  },
  { label: "missing-og-tags", pages: [basePage({ ogTitle: null, ogDescription: null })] },
  { label: "missing-twitter-card", pages: [basePage({ twitterCard: null })] },
  { label: "no-favicon", pages: [basePage({ favicon: null })] },
  { label: "inline-css", pages: [basePage({ inlineStyleLength: 8000 })] },
  { label: "no-h2-h3", pages: [basePage({ h2: [], h3: [] })] },
  {
    label: "duplicate-title",
    pages: [basePage(), basePage({ url: "https://example.com/about" })],
  },
  {
    label: "duplicate-description",
    pages: [basePage(), basePage({ url: "https://example.com/about" })],
  },
  {
    label: "duplicate-h1",
    pages: [basePage(), basePage({ url: "https://example.com/about" })],
  },
  {
    label: "no-sitemap",
    pages: [basePage()],
    extra: { robotsText: "User-agent: *\nDisallow: /private\n", brokenLinks: [] },
  },
  {
    label: "broken-links",
    pages: [basePage()],
    extra: {
      robotsText: null,
      brokenLinks: [
        { url: "https://example.com/missing", statusCode: 404 },
        { url: "https://example.com/error", statusCode: 500 },
      ],
    },
  },
];

/** 触发全部检查并收集 issue（每条 issue 的 message/suggestion 应为 LText） */
function collectAllIssues(): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const c of triggerCases) {
    const perPage = c.pages.flatMap((p) => runPerPageChecks(p, "https://example.com/"));
    const cross = runCrossPageChecks(c.pages, "https://example.com/", {
      robotsText: c.extra?.robotsText ?? "Sitemap: https://example.com/sitemap.xml",
      brokenLinks: c.extra?.brokenLinks ?? [],
    });
    expect(
      [...perPage, ...cross].length,
      `触发用例未产生 issue：${c.label}`
    ).toBeGreaterThan(0);
    issues.push(...perPage, ...cross);
  }
  return issues;
}

// ---------- 1. 标准 checks 双语完整性 ----------

describe("标准 Audit checks 双语完整性", () => {
  it("所有检查项 name/description 的 en/zh 均为非空字符串", () => {
    for (const meta of allCheckMeta) {
      expect(meta.name.en, `${meta.id}.name.en`).toBeTruthy();
      expect(meta.name.zh, `${meta.id}.name.zh`).toBeTruthy();
      expect(meta.description.en, `${meta.id}.description.en`).toBeTruthy();
      expect(meta.description.zh, `${meta.id}.description.zh`).toBeTruthy();
    }
  });

  it("所有触发 issue 的 message/suggestion：LText 值 en/zh 均非空；机器值纯字符串原样通过", () => {
    const issues = collectAllIssues();
    expect(issues.length).toBeGreaterThanOrEqual(20);
    for (const issue of issues) {
      // 机器值 message（如 broken-links 的 "HTTP 404"）按规范不翻译，存取均原样
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

  it("检查项总数 ≥ 20（单页 + 跨页合计）", () => {
    expect(perPageChecks.length + crossPageChecks.length).toBeGreaterThanOrEqual(20);
    expect(crossPageChecks.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------- 2. 语言污染扫描 ----------

describe("语言污染扫描（ZH 结果无英文系统文案 / EN 结果无中文系统文案）", () => {
  const issues = collectAllIssues();

  it("ZH 输出不得包含标准英文系统文案", () => {
    const zhTexts = [
      ...allCheckMeta.flatMap((m) => [m.name.zh, m.description.zh]),
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
      ...allCheckMeta.flatMap((m) => [m.name.en, m.description.en]),
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
    // HTTP 状态、canonical 等技术术语不应被误判为污染
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
      // 机器值 message（如 broken-links "HTTP 404"）不参与语言映射
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
    expect(name!.en).toBeTruthy();
    expect(name!.zh).toBe("起始页未能解析");
  });

  it("js-redirect（旧版检查项）具备 en/zh 双语展示名", () => {
    const name = nonCatalogCheckNames["js-redirect"];
    expect(name).toBeTruthy();
    expect(name!.en).toBe("JS redirect");
    expect(name!.zh).toBe("JS 重定向");
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
