import { describe, it, expect } from "vitest";
import { perPageChecks } from "@/lib/seo/audit-checks";
import type { PageData } from "@/lib/crawl";

const BASE_URL = "https://example.com";

function makeBasePage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: "https://example.com/",
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

describe("no-robots-meta 检查", () => {
  const check = perPageChecks.find((c) => c.id === "no-robots-meta")!;

  it("缺失 robots meta 时不报错", () => {
    const page = makeBasePage({ robotsMeta: null });
    const result = check.check(page, BASE_URL);
    expect(result).toBeNull();
  });

  it("robots meta 为 index,follow 时不报错", () => {
    const page = makeBasePage({ robotsMeta: "index, follow" });
    const result = check.check(page, BASE_URL);
    expect(result).toBeNull();
  });

  it("robots meta 为 noindex 时生成 warning", () => {
    const page = makeBasePage({ robotsMeta: "noindex" });
    const result = check.check(page, BASE_URL);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  it("robots meta 为 none 时生成 warning", () => {
    const page = makeBasePage({ robotsMeta: "none" });
    const result = check.check(page, BASE_URL);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });
});

describe("no-structured-data 检查", () => {
  const check = perPageChecks.find((c) => c.id === "no-structured-data")!;

  it("无 JSON-LD 时生成 notice", () => {
    const page = makeBasePage({ hasStructuredData: false, structuredDataRaw: [] });
    const result = check.check(page, BASE_URL);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("notice");
  });

  it("有效 JSON-LD（含 @context 和 @type）时通过", () => {
    const page = makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify({ "@context": "https://schema.org", "@type": "Article" })],
    });
    const result = check.check(page, BASE_URL);
    expect(result).toBeNull();
  });

  it("JSON-LD 缺少 @type 时生成 warning", () => {
    const page = makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify({ "@context": "https://schema.org", foo: "bar" })],
    });
    const result = check.check(page, BASE_URL);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  it("JSON-LD 缺少 @context 时生成 warning", () => {
    const page = makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify({ "@type": "Article" })],
    });
    const result = check.check(page, BASE_URL);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  it("JSON-LD 格式错误时生成 warning", () => {
    const page = makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: ["{ invalid json @test }"],
    });
    const result = check.check(page, BASE_URL);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  it("JSON-LD 数组中含有效节点时通过", () => {
    const page = makeBasePage({
      hasStructuredData: true,
      structuredDataRaw: [JSON.stringify([{ "@context": "https://schema.org", "@type": "Article" }])],
    });
    const result = check.check(page, BASE_URL);
    expect(result).toBeNull();
  });
});

describe("已删除的检查项不存在", () => {
  it("external-links-nofollow 不在 perPageChecks", () => {
    const ids = perPageChecks.map((c) => c.id);
    expect(ids).not.toContain("external-links-nofollow");
  });

  it("js-redirect 不在 perPageChecks", () => {
    const ids = perPageChecks.map((c) => c.id);
    expect(ids).not.toContain("js-redirect");
  });
});

describe("title-length / description-length 权重", () => {
  it("title-length weight=1", () => {
    const check = perPageChecks.find((c) => c.id === "title-length")!;
    expect(check.weight).toBe(1);
  });

  it("description-length weight=1", () => {
    const check = perPageChecks.find((c) => c.id === "description-length")!;
    expect(check.weight).toBe(1);
  });
});
