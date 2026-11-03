// ===== SERP Overlap / 页面类型 / 多证据意图 / Content Gap 匹配：纯函数契约 =====

import { describe, expect, it } from "vitest";
import { compareSnapshotPairs, groupByContext, normalizeUrlForOverlap, snapshotUrlSet } from "./serp-overlap";
import { classifySerpPageType } from "./page-type-serp";
import { detectIntentEvidence } from "./intent-evidence";
import { analyzeContentGap, type SitePageRecord } from "./content-gap/matcher";
import type { CompactSerpSnapshot } from "./serp-snapshot";

function snap(keyword: string, urls: string[], market = "美国", device = "PC", language = "en"): CompactSerpSnapshot {
  return {
    keyword,
    market,
    language,
    device,
    fetchedAt: "2026-11-02T00:00:00.000Z",
    fromCache: false,
    totalResults: null,
    adsCount: 0,
    results: urls.map((url, i) => ({
      position: i + 1,
      title: `Result ${i + 1}`,
      url,
      domain: new URL(url).host,
      snippet: "",
    })),
    features: [],
    paa: [],
    related: [],
  };
}

describe("normalizeUrlForOverlap", () => {
  it("去除 tracking 参数 / hash / 尾斜杠，大小写 host 归一", () => {
    expect(normalizeUrlForOverlap("https://Example.com/a/b/?utm_source=x&gclid=1")).toBe("example.com/a/b");
    expect(normalizeUrlForOverlap("https://example.com/a/b#top")).toBe("example.com/a/b");
    expect(normalizeUrlForOverlap("https://example.com/a?z=1&a=2")).toBe("example.com/a?a=2&z=1");
  });
  it("非 http(s) 返回 null", () => {
    expect(normalizeUrlForOverlap("javascript:alert(1)")).toBeNull();
    expect(normalizeUrlForOverlap("not a url")).toBeNull();
  });
});

describe("SERP overlap", () => {
  it("完全相同 SERP：overlap=1，strong-same-page", () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://a.com/${i}`);
    const [r] = compareSnapshotPairs([snap("kw a", urls), snap("kw b", urls)]);
    expect(r?.overlapRatio).toBe(1);
    expect(r?.verdict).toBe("strong-same-page");
  });
  it("完全不同 SERP：overlap=0，separate-pages", () => {
    const a = Array.from({ length: 8 }, (_, i) => `https://a.com/${i}`);
    const b = Array.from({ length: 8 }, (_, i) => `https://b.com/${i}`);
    const [r] = compareSnapshotPairs([snap("kw a", a), snap("kw b", b)]);
    expect(r?.overlapRatio).toBe(0);
    expect(r?.verdict).toBe("separate-pages");
  });
  it("部分重叠：0.3-0.5 之间 → possible", () => {
    const a = Array.from({ length: 10 }, (_, i) => `https://a.com/${i}`);
    const b = ["https://a.com/0", "https://a.com/1", "https://a.com/2", "https://a.com/3", "https://a.com/4", ...Array.from({ length: 5 }, (_, i) => `https://b.com/${i}`)];
    const [r] = compareSnapshotPairs([snap("kw a", a), snap("kw b", b)]);
    expect(r!.overlapRatio!).toBeGreaterThan(0.3);
    expect(r!.overlapRatio!).toBeLessThan(0.5);
    expect(r?.verdict).toBe("possible-same-page");
  });
  it("证据不足（可用 URL < 5）不给强结论", () => {
    const [r] = compareSnapshotPairs([snap("kw a", ["https://a.com/1"]), snap("kw b", ["https://a.com/1"])]);
    expect(r?.verdict).toBe("insufficient-evidence");
  });
  it("tracking 参数不影响重合判定", () => {
    const a = Array.from({ length: 8 }, (_, i) => `https://a.com/${i}`);
    const b = Array.from({ length: 8 }, (_, i) => `https://a.com/${i}?utm_source=news`);
    const [r] = compareSnapshotPairs([snap("kw a", a), snap("kw b", b)]);
    expect(r?.verdict).toBe("strong-same-page");
  });
  it("跨市场分组：不同 market 不可混算", () => {
    const groups = groupByContext([snap("a", ["https://a.com/1"], "美国"), snap("b", ["https://b.com/1"], "日本")]);
    expect(groups.size).toBe(2);
    expect(compareSnapshotPairs([snap("a", ["https://a.com/1"], "美国"), snap("b", ["https://b.com/1"], "日本")])).toEqual([]);
  });
  it("URL 集合 size 一致（snapshotUrlSet）", () => {
    expect(snapshotUrlSet(snap("x", ["https://a.com/1", "https://a.com/1?utm_source=x"])).size).toBe(1);
  });
});

describe("SERP 页面类型识别", () => {
  it("教程/指南（URL 路径，高置信）", () => {
    const r = classifySerpPageType({ title: "Something", url: "https://a.com/guide/bike-repair", snippet: "" });
    expect(r.type).toBe("tutorial-guide");
    expect(r.confidence).toBe("high");
  });
  it("论坛域名 → forum-community（domain 缺省时从 URL 兜底）", () => {
    const r = classifySerpPageType({ title: "What is X?", url: "https://www.reddit.com/r/seo/comments/abc/", snippet: "" });
    expect(r.type).toBe("forum-community");
    expect(r.confidence).toBe("high");
  });
  it("电商域名 → product（domain 缺省时从 URL 兜底）", () => {
    const r = classifySerpPageType({ title: "Bike", url: "https://www.amazon.com/dp/B123", snippet: "" });
    expect(r.type).toBe("product");
  });
  it("标题清单模式 → listicle", () => {
    const r = classifySerpPageType({ title: "Top 10 Best Bike Tools", url: "https://a.com/page", snippet: "" });
    expect(r.type).toBe("listicle");
    expect(r.evidence.some((e) => e.includes("数字清单"))).toBe(true);
  });
  it("无信号 → unknown（不强行分类）", () => {
    const r = classifySerpPageType({ title: "Homepage", url: "https://a.com/", snippet: "" });
    expect(r.type).toBe("unknown");
    expect(r.confidence).toBe("low");
  });
});

describe("多证据搜索意图", () => {
  it("英文文本规则：best → 商业型", () => {
    const r = detectIntentEvidence("best coffee grinder");
    expect(r.primary).toBe("商业型");
    expect(r.source).toBe("text");
  });
  it("中文文本规则：如何 → 信息型", () => {
    const r = detectIntentEvidence("如何磨咖啡豆");
    expect(r.primary).toBe("信息型");
  });
  it("日文/德文规则", () => {
    expect(detectIntentEvidence("コーヒーミル おすすめ").primary).toBe("商业型");
    expect(detectIntentEvidence("beste kaffeemühle").primary).toBe("商业型");
  });
  it("SERP 证据：3+ 教程页 → 信息型（source=serp）", () => {
    const snapshot = snap(
      "kw",
      Array.from({ length: 6 }, (_, i) => `https://a.com/guide/post-${i}`),
    );
    const r = detectIntentEvidence("coffee grinder", snapshot);
    expect(r.primary).toBe("信息型");
    expect(r.source).toBe("serp");
  });
  it("文本 + SERP 一致 → mixed 且 high confidence", () => {
    const snapshot = snap(
      "best coffee grinder",
      Array.from({ length: 6 }, (_, i) => `https://a.com/top-10-grinder-reviews-${i}`),
    );
    const r = detectIntentEvidence("best coffee grinder", snapshot);
    expect(r.primary).toBe("商业型");
    expect(r.source).toBe("mixed");
    expect(r.confidence).toBe("high");
  });
  it("无信号 → 未知（不强行分类）", () => {
    const r = detectIntentEvidence("xyzzy qwerty");
    expect(r.primary).toBe("未知");
    expect(r.source).toBe("none");
  });
});

describe("Content Gap 匹配", () => {
  const doc = {
    topics: [
      { id: "t-1", name: "coffee grinder", keywordIds: ["coffee grinder"], keywordCount: 1, pillarId: null, pages: [], totalVolume: null, avgKd: null, intentMix: [1, 0, 0, 0, 0] as const, intentCounts: { informational: 1, commercial: 0, transactional: 0, navigational: 0, unknown: 0 }, pillarReason: "" },
      { id: "t-2", name: "bike repair", keywordIds: ["bike repair"], keywordCount: 1, pillarId: null, pages: [], totalVolume: null, avgKd: null, intentMix: [1, 0, 0, 0, 0] as const, intentCounts: { informational: 1, commercial: 0, transactional: 0, navigational: 0, unknown: 0 }, pillarReason: "" },
    ],
    keywords: [
      { id: "coffee grinder", keyword: "coffee grinder", seeds: ["coffee grinder"], origins: ["seed" as const], volume: null, kd: null, cpc: null, metricsSource: null, intent: "信息型" as const, intentSource: "estimated" as const, manual: false, topicId: "t-1", role: "unassigned" as const, pageId: null, serpFeatures: null },
      { id: "bike repair", keyword: "bike repair", seeds: ["bike repair"], origins: ["seed" as const], volume: null, kd: null, cpc: null, metricsSource: null, intent: "信息型" as const, intentSource: "estimated" as const, manual: false, topicId: "t-2", role: "unassigned" as const, pageId: null, serpFeatures: null },
    ],
    meta: { market: "美国", device: "PC", fetchedAt: null, sources: [], metrics: { volume: "unavailable", kd: "unavailable", cpc: "unavailable", intent: "estimated" }, warnings: [], perSeed: [], failedSeeds: [], addedSeeds: [], related: [], paa: [], method: { clustering: "", pillar: "" } },
  } as never;

  const pages: SitePageRecord[] = [
    { url: "https://site.com/best-coffee-grinders", title: "Best Coffee Grinders of 2026", h1: "Coffee Grinder Buying Guide", httpStatus: 200, error: null },
    { url: "https://site.com/coffee-grinder-reviews", title: "Coffee Grinder Reviews", h1: "Grinder Reviews", httpStatus: 200, error: null },
    { url: "https://site.com/bike-repair-guide", title: "Bike Repair Guide", h1: "How to repair a bike", httpStatus: 200, error: null },
  ];

  it("标题命中完整关键词的多个页面 → Covered + Cannibalization", () => {
    const r = analyzeContentGap(doc, pages);
    const grinder = r.coverage.find((c) => c.topicId === "t-1");
    expect(grinder?.status).toBe("covered");
    expect(grinder?.matchedPages.length).toBeGreaterThanOrEqual(2);
    expect(r.cannibalization.length).toBe(1);
    expect(r.cannibalization[0].pages.length).toBeGreaterThanOrEqual(2);
    expect(r.cannibalization[0].suggestion).toContain("合并");
  });

  it("抓取失败过多 → Needs Review（不误判缺口）", () => {
    const broken: SitePageRecord[] = pages.map((p) => ({ ...p, httpStatus: 404, error: "HTTP 404" }));
    const r = analyzeContentGap(doc, broken);
    expect(r.coverage.every((c) => c.status === "needs-review")).toBe(true);
  });

  it("抓取完整且无匹配 → Potential Gap", () => {
    const unrelated: SitePageRecord[] = Array.from({ length: 8 }, (_, i) => ({
      url: `https://site.com/unrelated-${i}`,
      title: `Unrelated Topic ${i}`,
      h1: "Something else entirely",
      httpStatus: 200,
      error: null,
    }));
    const r = analyzeContentGap(doc, unrelated);
    const grinder = r.coverage.find((c) => c.topicId === "t-1");
    expect(grinder?.status).toBe("potential-gap");
  });
});
