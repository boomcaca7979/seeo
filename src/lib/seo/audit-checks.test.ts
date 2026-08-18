import { describe, it, expect } from "vitest";
import {
  calculateHealthScore,
  perPageChecks,
  crossPageChecks,
  allCheckMeta,
  runPerPageChecks,
  pickText,
  type AuditIssue,
} from "@/lib/seo/audit-checks";
import type { PageData } from "@/lib/crawl";

/** 构造「各项基本失败」的最小 PageData（触发尽可能多的检查项） */
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

function makeIssue(checkId: string): AuditIssue {
  return {
    checkId,
    checkName: "test",
    message: "test",
    url: "https://example.com/",
    severity: "warning",
    suggestion: "test",
  };
}

describe("calculateHealthScore", () => {
  it("无 issue 时返回 100", () => {
    const score = calculateHealthScore([], new Set(perPageChecks.map((c) => c.id)));
    expect(score).toBe(100);
  });

  it("quick 模式只按 perPageChecks 权重计算", () => {
    // 触发一个 missing-title（weight=5）
    const issues: AuditIssue[] = [makeIssue("missing-title")];
    const executed = new Set(perPageChecks.map((c) => c.id));
    const perPageWeight = perPageChecks.reduce((s, c) => s + c.weight, 0);
    const expected = Math.round(100 - (5 / perPageWeight) * 100);
    const score = calculateHealthScore(issues, executed);
    expect(score).toBe(expected);
  });

  it("full 模式按 perPage + crossPage 权重计算", () => {
    const issues: AuditIssue[] = [makeIssue("duplicate-title")];
    const executed = new Set([
      ...perPageChecks.map((c) => c.id),
      ...crossPageChecks.map((c) => c.id),
    ]);
    const totalWeight = perPageChecks.reduce((s, c) => s + c.weight, 0) +
      crossPageChecks.reduce((s, c) => s + c.weight, 0);
    const dupWeight = crossPageChecks.find((c) => c.id === "duplicate-title")!.weight;
    const expected = Math.round(100 - (dupWeight / totalWeight) * 100);
    const score = calculateHealthScore(issues, executed);
    expect(score).toBe(expected);
  });

  it("quick 模式与 full 模式权重不同导致分数不同", () => {
    const issues: AuditIssue[] = [makeIssue("missing-title")];
    const quickScore = calculateHealthScore(
      issues,
      new Set(perPageChecks.map((c) => c.id))
    );
    const fullScore = calculateHealthScore(
      issues,
      new Set([
        ...perPageChecks.map((c) => c.id),
        ...crossPageChecks.map((c) => c.id),
      ])
    );
    // full 模式分母更大，扣分比例更小，分数更高
    expect(fullScore).toBeGreaterThan(quickScore);
  });

  it("未传 executedCheckIds 时使用全量权重（向后兼容）", () => {
    const issues: AuditIssue[] = [makeIssue("missing-title")];
    const score = calculateHealthScore(issues);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
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
      expect(meta.name.en.length).toBeGreaterThan(0);
      expect(meta.name.zh.length).toBeGreaterThan(0);
      expect(HAS_CHINESE(meta.name.en)).toBe(false);
      expect(HAS_CHINESE(meta.name.zh)).toBe(true);
      expect(meta.description.en.length).toBeGreaterThan(0);
      expect(meta.description.zh.length).toBeGreaterThan(0);
      expect(HAS_CHINESE(meta.description.en)).toBe(false);
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
  const issues = runPerPageChecks(makeFailingPage(), "http://example.com/");
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

  it("severity 由 category 映射：critical→error / warning→warning / info→notice", () => {
    const byId = new Map(issues.map((i) => [i.checkId, i]));
    expect(byId.get("missing-title")!.severity).toBe("error");
    expect(byId.get("missing-canonical")!.severity).toBe("warning");
    expect(byId.get("missing-lang")!.severity).toBe("notice");
  });
});
