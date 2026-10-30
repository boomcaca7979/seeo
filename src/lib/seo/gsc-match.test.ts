// ===== GSC 查询词交叉匹配（纯模块）测试 =====
// 覆盖：归一化规则 / 仅精确匹配（无模糊） / 多落地页关系保留 / 聚合口径 /
//       空数据与缺失字段 / 未匹配。

import { describe, expect, it } from "vitest";
import {
  buildGscQueryIndex,
  matchKeywordsToGsc,
  normalizeQueryForMatch,
  type GscMatchInputRow,
} from "./gsc-match";

function row(query: string, page: string | null, clicks: number, impressions: number, ctr: number, position: number): GscMatchInputRow {
  return {
    keys: page === null ? [query] : [query, page],
    clicks,
    impressions,
    ctr,
    position,
  };
}

describe("normalizeQueryForMatch（显式归一化规则）", () => {
  it("大小写不敏感、去首尾空白", () => {
    expect(normalizeQueryForMatch("  SEO Tools  ")).toBe("seo tools");
  });

  it("连续空白（含全角空格）折叠为单个空格", () => {
    expect(normalizeQueryForMatch("seo\u3000\u3000  tools")).toBe("seo tools");
  });

  it("去除引号类字符", () => {
    expect(normalizeQueryForMatch('"best seo"')).toBe("best seo");
    expect(normalizeQueryForMatch("what’s seo")).toBe("whats seo");
  });

  it("剥离首尾标点（中英文）", () => {
    expect(normalizeQueryForMatch("what is seo?")).toBe("what is seo");
    expect(normalizeQueryForMatch("seo 工具，")).toBe("seo 工具");
    expect(normalizeQueryForMatch("…keyword research…")).toBe("keyword research");
  });

  it("保留内部标点（连字符/点号可能是有意义的）", () => {
    expect(normalizeQueryForMatch("e-mail marketing")).toBe("e-mail marketing");
    expect(normalizeQueryForMatch("node.js")).toBe("node.js");
  });

  it("纯标点/空串归一化为空（不可匹配）", () => {
    expect(normalizeQueryForMatch("")).toBe("");
    expect(normalizeQueryForMatch("?!")).toBe("");
  });
});

describe("buildGscQueryIndex（聚合与页面关系）", () => {
  it("同查询词多个落地页全部保留，不选代表页", () => {
    const index = buildGscQueryIndex([
      row("seo tools", "/a", 10, 100, 0.1, 5),
      row("seo tools", "/b", 4, 50, 0.08, 12),
    ]);
    const match = index.get("seo tools");
    expect(match).toBeDefined();
    expect(match!.pages).toHaveLength(2);
    expect(match!.pages.map((p) => p.page)).toEqual(["/a", "/b"]);
    expect(match!.clicks).toBe(14);
    expect(match!.impressions).toBe(150);
  });

  it("CTR = Σclicks/Σimpressions；位置为曝光加权（与 gsc-service 同口径）", () => {
    const index = buildGscQueryIndex([
      row("kw", "/a", 10, 100, 0.1, 4),
      row("kw", "/b", 2, 100, 0.02, 10),
    ]);
    const match = index.get("kw")!;
    expect(match.ctr).toBeCloseTo(12 / 200, 10);
    expect(match.position).toBeCloseTo((4 * 100 + 10 * 100) / 200, 10);
  });

  it("零曝光行不参与位置加权；整体无曝光时 ctr/position 为 null（不冒充 0）", () => {
    const index = buildGscQueryIndex([
      row("kw", "/a", 0, 0, 0, 0),
      row("kw", "/b", 0, 0, 0, 0),
    ]);
    const match = index.get("kw")!;
    expect(match.ctr).toBeNull();
    expect(match.position).toBeNull();
    expect(match.clicks).toBe(0);
    expect(match.impressions).toBe(0);
  });

  it("无页面维度行（keys 单元素）page 为 null，也计入聚合", () => {
    const index = buildGscQueryIndex([row("kw only", null, 3, 30, 0.1, 7)]);
    const match = index.get("kw only")!;
    expect(match.pages).toEqual([{ page: null, clicks: 3, impressions: 30, ctr: 0.1, position: 7 }]);
    expect(match.ctr).toBeCloseTo(0.1, 10);
  });

  it("keys 缺失或 query 为空白的行被跳过", () => {
    const index = buildGscQueryIndex([
      { keys: [], clicks: 1, impressions: 1, ctr: 1, position: 1 },
      row("  ", "/x", 1, 1, 1, 1),
    ]);
    expect(index.size).toBe(0);
  });

  it("空输入返回空索引", () => {
    expect(buildGscQueryIndex([]).size).toBe(0);
  });

  it("形态不同但归一化等价的查询词合并到同一索引键（保留首个原文）", () => {
    const index = buildGscQueryIndex([
      row("SEO Tools", "/a", 1, 10, 0.1, 3),
      row("seo  tools?", "/b", 1, 10, 0.1, 4),
    ]);
    expect(index.size).toBe(1);
    expect(index.get("seo tools")!.query).toBe("SEO Tools");
    expect(index.get("seo tools")!.pages).toHaveLength(2);
  });
});

describe("matchKeywordsToGsc（仅精确匹配，无模糊）", () => {
  const index = buildGscQueryIndex([row("seo tools", "/a", 5, 50, 0.1, 6)]);

  it("归一化等价即命中", () => {
    const matches = matchKeywordsToGsc(["SEO Tools!"], index);
    expect(matches.has("SEO Tools!")).toBe(true);
  });

  it("单复数/词形差异不命中（禁止模糊匹配）", () => {
    expect(matchKeywordsToGsc(["seo tool"], index).size).toBe(0);
    expect(matchKeywordsToGsc(["seo tools review"], index).size).toBe(0);
    expect(matchKeywordsToGsc(["best seo tools"], index).size).toBe(0);
  });

  it("未命中关键词不出现在结果中", () => {
    const matches = matchKeywordsToGsc(["unrelated query", "seo tools"], index);
    expect([...matches.keys()]).toEqual(["seo tools"]);
  });

  it("空关键词列表/空索引返回空匹配", () => {
    expect(matchKeywordsToGsc([], index).size).toBe(0);
    expect(matchKeywordsToGsc(["seo tools"], new Map()).size).toBe(0);
  });
});
