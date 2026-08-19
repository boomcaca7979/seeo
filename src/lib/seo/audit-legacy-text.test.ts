import { describe, it, expect } from "vitest";
import {
  localizeLegacyDetail,
  localizeLegacySuggestion,
} from "@/lib/seo/audit-legacy-text";
import { perPageChecks, crossPageChecks } from "@/lib/seo/audit-checks";
import type { PageData } from "@/lib/crawl";
import type { AuditIssue } from "@/lib/seo/audit-checks";

/**
 * 历史 Audit 存量双语化测试：
 * 旧版（LText 之前）audit-checks.ts 写入的纯中文 detail / suggestion 模板，
 * 读取时必须能映射为英文；zh locale 原样返回；未知文本兜底原样返回。
 * 英文文案必须与当前 catalog 的 LText.en 一致（不新造自然语言）。
 */

describe("localizeLegacyDetail", () => {
  it("静态中文模板 → 英文 catalog 文案", () => {
    expect(localizeLegacyDetail("页面缺少 <title> 标签", "en")).toBe("Page has no <title> tag");
    expect(localizeLegacyDetail("页面缺少 meta description 标签", "en")).toBe("Page has no meta description tag");
    expect(localizeLegacyDetail("页面缺少 H1 标签", "en")).toBe("Page has no H1 tag");
    expect(localizeLegacyDetail("robots.txt 中未声明 Sitemap", "en")).toBe("robots.txt does not declare a Sitemap");
    expect(localizeLegacyDetail("起始页未能解析，单页检查项未执行，本次审计结果不可用", "en")).toBe(
      "The start page could not be parsed; per-page checks were not executed and this audit is unusable"
    );
  });

  it("动态中文模板 → 英文（保留动态值）", () => {
    expect(localizeLegacyDetail("3/10 张图片缺少 alt 属性", "en")).toBe("3/10 images missing alt attribute");
    expect(localizeLegacyDetail("标题长度 45 字符（建议 30-60）", "en")).toBe("Title length 45 characters (recommended 30-60)");
    expect(localizeLegacyDetail("描述长度 200 字符（建议 120-160）", "en")).toBe("Description length 200 characters (recommended 120-160)");
    expect(localizeLegacyDetail("robots meta 包含阻止指令：noindex, nofollow", "en")).toBe(
      "robots meta contains blocking directives: noindex, nofollow"
    );
    expect(localizeLegacyDetail("响应时间 4.2s（>3s）", "en")).toBe("Response time 4.2s (>3s)");
    expect(localizeLegacyDetail("内联样式 12,345 字符（>5000）", "en")).toBe("Inline styles 12,345 characters (>5000)");
    expect(localizeLegacyDetail('"About Us" 在 3 个页面重复', "en")).toBe('"About Us" duplicated across 3 pages');
    expect(localizeLegacyDetail("抓取超时（10s）", "en")).toBe("Fetch timed out (10s)");
    expect(localizeLegacyDetail("首页抓取超时（重试 12s 仍失败）", "en")).toBe(
      "Homepage fetch timed out (retry at 12s still failed)"
    );
  });

  it("zh locale 原样返回（历史数据本身就是中文）", () => {
    expect(localizeLegacyDetail("页面缺少 <title> 标签", "zh")).toBe("页面缺少 <title> 标签");
    expect(localizeLegacyDetail("标题长度 45 字符（建议 30-60）", "zh")).toBe("标题长度 45 字符（建议 30-60）");
  });

  it("机器值 / 未知文本兜底原样返回（不返回空白）", () => {
    expect(localizeLegacyDetail("HTTP 404 Not Found", "en")).toBe("HTTP 404 Not Found");
    expect(localizeLegacyDetail("HTTP 503 Service Unavailable", "zh")).toBe("HTTP 503 Service Unavailable");
    expect(localizeLegacyDetail("完全未知的文案", "en")).toBe("完全未知的文案");
    expect(localizeLegacyDetail("", "en")).toBe("");
  });
});

describe("localizeLegacySuggestion", () => {
  it("静态中文建议 → 英文 catalog 文案", () => {
    expect(localizeLegacySuggestion("添加 30-60 字符的标题，包含主关键词", "en")).toBe(
      "Add a 30-60 character title containing the primary keyword"
    );
    expect(localizeLegacySuggestion("部署 SSL 证书并强制 HTTPS 重定向", "en")).toBe(
      "Install an SSL certificate and enforce HTTPS redirects"
    );
    expect(localizeLegacySuggestion("检查 URL 是否可访问", "en")).toBe("Check that the URL is reachable");
  });

  it("zh locale 原样返回", () => {
    expect(localizeLegacySuggestion("将内联样式提取到外部 CSS 文件", "zh")).toBe("将内联样式提取到外部 CSS 文件");
  });

  it("未知建议兜底原样返回", () => {
    expect(localizeLegacySuggestion("未知的建议文本", "en")).toBe("未知的建议文本");
  });
});

/**
 * 契约测试：当前 catalog 的所有静态 message zh 文案，必须能被 legacy 映射命中
 * （保证历史存量行 100% 可映射，不出现漏网中文）。
 * 动态模板（含插值）单独覆盖。
 */
describe("legacy catalog 覆盖率（与当前 audit-checks zh 文案对齐）", () => {
  function makeFailingPage(): PageData {
    return {
      url: "http://example.com/",
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
      twitterCard: null,
      favicon: null,
      hasStructuredData: false,
      structuredDataRaw: [],
      inlineStyleLength: 0,
      finalUrl: "http://example.com/",
    };
  }

  it("当前 catalog 全部静态 message/suggestion zh 文案均能映射为英文", () => {
    // 用当前 catalog 生成一批 issue（zh 侧 LText 与历史纯文本一致）
    const issues: AuditIssue[] = [
      ...perPageChecks.flatMap((c) => c.check(makeFailingPage(), "http://example.com/") ?? []),
      // 逐个触发静态 message 的检查（makeFailingPage 触发大多数静态项）
    ];
    // manually include cross-page static messages
    const staticCrossMessages = [
      "robots.txt 中未声明 Sitemap",
      "起始页未能解析，单页检查项未执行，本次审计结果不可用",
    ];
    for (const zh of staticCrossMessages) {
      expect(localizeLegacyDetail(zh, "en")).not.toBe(zh);
    }

    // perPage 检查产生的 message：动态的按模式断言，静态的必须精确映射
    for (const issue of issues) {
      const zh = typeof issue.message === "string" ? issue.message : issue.message.zh;
      const en = localizeLegacyDetail(zh, "en");
      expect(en, `detail 未映射: ${zh}`).not.toBe(zh);
      const enSug = localizeLegacySuggestion(
        typeof issue.suggestion === "string" ? issue.suggestion : issue.suggestion.zh,
        "en"
      );
      expect(enSug, `suggestion 未映射: ${typeof issue.suggestion === "string" ? issue.suggestion : issue.suggestion.zh}`).not.toBe(
        typeof issue.suggestion === "string" ? issue.suggestion : issue.suggestion.zh
      );
    }
  });

  it("当前 catalog 静态 suggestion zh 文案（手动枚举）均能映射为英文", () => {
    const suggestions = [
      "为每个页面编写唯一的 title",
      "为每个页面编写唯一的 meta description",
      "为每个页面编写唯一的 H1",
      "添加 301 重定向到相关页面，或恢复缺失内容",
      "优化服务器响应时间，检查后端服务状态",
      "检查域名解析与服务器可达性",
    ];
    for (const zh of suggestions) {
      expect(localizeLegacySuggestion(zh, "en"), `suggestion 未映射: ${zh}`).not.toBe(zh);
    }
  });

  it("重复类跨页检查的动态 message zh 文案能映射", () => {
    const zh = '"Home" 在 2 个页面重复';
    expect(localizeLegacyDetail(zh, "en")).toBe('"Home" duplicated across 2 pages');
    // crossPageChecks 元数据存在性（防 catalog 漂移）
    expect(crossPageChecks.length).toBeGreaterThanOrEqual(5);
  });
});
