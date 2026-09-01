// ===== 页面类型识别与内容阈值（Page Type Awareness）单元测试 =====
// 覆盖：URL 路径 / Schema @type / 标题关键词三种信号、内容量状态（normal/low/very-low）、
// 按页面类型区分阈值（不搞 "<300 词 = 差" 一刀切）。

import { describe, it, expect } from "vitest";
import { detectPageType, contentVolumeStatus, CONTENT_THRESHOLDS } from "@/lib/seo/page-type";
import type { PageData } from "@/lib/crawl";

function page(overrides: Partial<PageData>): PageData {
  return {
    url: overrides.url ?? "https://example.com/",
    finalUrl: overrides.finalUrl ?? overrides.url ?? "https://example.com/",
    title: null,
    metaDescription: null,
    canonical: null,
    robotsMeta: null,
    h1: [],
    h2: [],
    h3: [],
    images: [],
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
    ...overrides,
  };
}

describe("detectPageType：URL 路径信号", () => {
  it("根路径 / 语言前缀 → homepage", () => {
    expect(detectPageType(page({ url: "https://example.com/" }))).toBe("homepage");
    expect(detectPageType(page({ url: "https://example.com/zh" }))).toBe("homepage");
    expect(detectPageType(page({ url: "https://example.com/en-US" }))).toBe("homepage");
  });

  it("路径关键词 → guide / review / tool / category / contact / about", () => {
    expect(detectPageType(page({ url: "https://example.com/docs" }))).toBe("guide");
    expect(detectPageType(page({ url: "https://example.com/reviews" }))).toBe("review");
    expect(detectPageType(page({ url: "https://example.com/tools/calculator" }))).toBe("tool");
    expect(detectPageType(page({ url: "https://example.com/category/tech" }))).toBe("category");
    expect(detectPageType(page({ url: "https://example.com/contact-us" }))).toBe("contact");
    expect(detectPageType(page({ url: "https://example.com/about" }))).toBe("about");
  });

  it("未知路径 → other", () => {
    expect(detectPageType(page({ url: "https://example.com/some-page" }))).toBe("other");
  });
});

describe("detectPageType：Schema @type 信号", () => {
  it("Article / BlogPosting → article；Review → review；SoftwareApplication → tool", () => {
    expect(
      detectPageType(page({ url: "https://example.com/post", structuredDataRaw: [JSON.stringify({ "@type": "BlogPosting" })] }))
    ).toBe("article");
    expect(
      detectPageType(page({ url: "https://example.com/post", structuredDataRaw: [JSON.stringify({ "@type": "Review" })] }))
    ).toBe("review");
    expect(
      detectPageType(page({ url: "https://example.com/post", structuredDataRaw: [JSON.stringify({ "@type": "SoftwareApplication" })] }))
    ).toBe("tool");
  });

  it("@graph 内节点类型也参与识别", () => {
    expect(
      detectPageType(page({ url: "https://example.com/post", structuredDataRaw: [JSON.stringify({ "@graph": [{ "@type": "FAQPage" }] })] }))
    ).toBe("other"); // FAQPage 不在映射表 → 继续其他信号
    expect(
      detectPageType(page({ url: "https://example.com/post", structuredDataRaw: [JSON.stringify({ "@graph": [{ "@type": "Article" }] })] }))
    ).toBe("article");
  });
});

describe("detectPageType：标题/H1 关键词兜底", () => {
  it("标题含 guide/review/tool 关键词 → 对应类型", () => {
    expect(detectPageType(page({ url: "https://example.com/post", title: "The Ultimate Guide to SEO" }))).toBe("guide");
    expect(detectPageType(page({ url: "https://example.com/post", h1: ["iPhone 16 Review"] }))).toBe("review");
    expect(detectPageType(page({ url: "https://example.com/post", title: "Free Online Calculator Tool" }))).toBe("tool");
  });
});

describe("contentVolumeStatus：按页面类型区分阈值", () => {
  it("工具页 120 词正常，文章页 120 词偏低（不搞一刀切）", () => {
    expect(contentVolumeStatus(120, "tool")).toBe("normal");
    expect(contentVolumeStatus(120, "article")).toBe("very-low"); // article veryLow=150
    expect(contentVolumeStatus(200, "article")).toBe("low"); // 200 < 300 且 ≥ 150
    expect(contentVolumeStatus(120, "article")).not.toBe("normal");
  });

  it("阈值表：所有页面类型均有 low/veryLow 且 veryLow < low", () => {
    for (const [type, t] of Object.entries(CONTENT_THRESHOLDS)) {
      expect(t.veryLow).toBeLessThan(t.low);
      expect(t.low).toBeGreaterThan(0);
      expect(["homepage", "guide", "review", "tool", "category", "contact", "about", "article", "other"]).toContain(type);
    }
  });

  it("normal / low / very-low 三态正确", () => {
    expect(contentVolumeStatus(500, "guide")).toBe("normal");
    expect(contentVolumeStatus(200, "guide")).toBe("low");
    expect(contentVolumeStatus(10, "guide")).toBe("very-low");
  });
});
