// ===== 关键词合并/去重单元测试 =====
// 覆盖：Trends 新来源（trends_queries / trends_topics）并入统一发现模型、
//       跨来源去重合并 origins、limit 截断、空串过滤。

import { describe, expect, it } from "vitest";
import {
  dedupeKeywordList,
  mergeKeywordCandidates,
  normalizeKeywordForDedup,
} from "./keyword-merge";

describe("mergeKeywordCandidates 基础合并", () => {
  it("seed 置首，related / paa 依序合并，跨来源去重并合并 origins", () => {
    const rows = mergeKeywordCandidates(
      "seo audit tool",
      ["seo audit checklist", "seo audit tool"],
      ["what is seo audit", "seo audit checklist"],
      10
    );
    expect(rows).toEqual([
      { keyword: "seo audit tool", origin: "seed", origins: ["seed", "related"] },
      { keyword: "seo audit checklist", origin: "related", origins: ["related", "paa"] },
      { keyword: "what is seo audit", origin: "paa", origins: ["paa"] },
    ]);
  });

  it("trim + 小写归一去重（保留首次出现的原文）", () => {
    const rows = mergeKeywordCandidates("SEO Audit Tool", ["  seo audit tool  "], [], 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].keyword).toBe("SEO Audit Tool");
    expect(normalizeKeywordForDedup("  SEO Audit Tool ")).toBe("seo audit tool");
  });

  it("limit 截断（不含被截断后重复命中的词）", () => {
    const rows = mergeKeywordCandidates("a", ["b", "c"], [], 2);
    expect(rows.map((row) => row.keyword)).toEqual(["a", "b"]);
  });

  it("空串被过滤，不占 limit 名额", () => {
    const rows = mergeKeywordCandidates("a", ["", "   "], ["b"], 10);
    expect(rows.map((row) => row.keyword)).toEqual(["a", "b"]);
  });
});

describe("P4：Trends 来源并入统一发现模型", () => {
  it("trends_queries / trends_topics 是合法 KeywordOrigin（类型层面）", () => {
    const rows = mergeKeywordCandidates("seed", [], [], 10, [
      { origin: "trends_queries", keywords: ["free seo audit", "seo audit free"] },
      { origin: "trends_topics", keywords: ["search engine optimization"] },
    ]);
    expect(rows.map((row) => row.origin)).toEqual(["seed", "trends_queries", "trends_queries", "trends_topics"]);
    expect(rows[1].origins).toEqual(["trends_queries"]);
  });

  it("Trends 查询与既有来源重复时只保留一条并把 trends_queries 合并进 origins", () => {
    const rows = mergeKeywordCandidates("seo audit", ["seo audit free"], [], 10, [
      { origin: "trends_queries", keywords: ["SEO Audit Free"] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].keyword).toBe("seo audit free");
    expect(rows[1].origins).toEqual(["related", "trends_queries"]);
  });

  it("extraSources 中 origin 不允许 seed/related/paa（类型约束）", () => {
    // 类型层面：{ origin: "seed" } 等在 TS 下无法编译（Exclude 约束）；此处确认合法来源路径可用
    const rows = mergeKeywordCandidates("s", [], [], 10, [
      { origin: "autocomplete", keywords: ["ac kw"] },
      { origin: "trends_queries", keywords: ["tq kw"] },
      { origin: "serp_content", keywords: ["sc kw"] },
    ]);
    expect(rows.map((row) => row.origin)).toEqual(["seed", "autocomplete", "trends_queries", "serp_content"]);
  });
});

describe("dedupeKeywordList", () => {
  it("同一套归一口径（trim + 小写）去重，保留首现原文", () => {
    expect(dedupeKeywordList(["A b", "  a b ", "c", ""])).toEqual(["A b", "c"]);
  });
});

describe("P6：真实 SerpApi 响应 fixture（2026-10-29 实录，非编造数据）", () => {
  // fixture 来自两次经批准的真实请求：google_autocomplete + google_trends RELATED_QUERIES，
  // 种子词 "SEO audit tool"、市场美国/英文。字段结构为 SerpApi 真实返回（value 为字符串等）。
  const REAL_AUTOCOMPLETE = [
    "seo audit tool free", "seo audit tool free online", "seo audit tools list",
    "seo audit tools are dash and dash", "seo audit tools are class 12", "seo audit tool online",
    "seo audit tools examples", "seo audit tool for agencies", "seo audit tool.github",
    "seo audit tools name", "seo audit tool ai", "seo audit tool google",
    "seo audit tools available on net", "seo audit toolkit", "seo audit tool claude",
  ];
  const REAL_TRENDS_TOP = [
    "free seo audit tool", "best seo audit tool", "seo website audit tool", "seo site audit tool",
    "seo technical audit tool", "seo audit report tool", "best free seo audit tool",
    "white label seo audit tool", "free white label seo audit tool",
  ];
  const REAL_TRENDS_RISING = ["best free seo audit tool"];

  it("15 条真实建议词全部保留：无真实词被过滤/丢失（trim+小写后 15 个独立词形）", () => {
    const rows = mergeKeywordCandidates("SEO audit tool", [], [], 100, [
      { origin: "autocomplete", keywords: REAL_AUTOCOMPLETE },
    ]);
    // 1 seed + 15 suggestions（"seo audit tool" 本身不在 suggestions 里，无需剔除）
    expect(rows).toHaveLength(16);
    expect(rows.filter((r) => r.origins.includes("autocomplete"))).toHaveLength(15);
    for (const s of REAL_AUTOCOMPLETE) {
      expect(rows.some((r) => r.keyword.toLowerCase() === s)).toBe(true);
    }
  });

  it("真实 top/rising 跨列表重复（best free seo audit tool）只占一行，且保留 trends 来源", () => {
    const rows = mergeKeywordCandidates("SEO audit tool", [], [], 100, [
      { origin: "trends_queries", keywords: [...REAL_TRENDS_TOP, ...REAL_TRENDS_RISING] },
    ]);
    const hits = rows.filter((r) => r.keyword === "best free seo audit tool");
    expect(hits).toHaveLength(1);
    expect(hits[0].origins).toEqual(["trends_queries"]);
  });

  it("跨来源真实重复词形（autocomplete 'seo audit tool free' vs trends 'free seo audit tool'）按表面词形各占一行，不冒认同词", () => {
    const rows = mergeKeywordCandidates("SEO audit tool", [], [], 100, [
      { origin: "autocomplete", keywords: REAL_AUTOCOMPLETE },
      { origin: "trends_queries", keywords: REAL_TRENDS_TOP },
    ]);
    const ac = rows.find((r) => r.keyword === "seo audit tool free");
    const tr = rows.find((r) => r.keyword === "free seo audit tool");
    expect(ac?.origins).toEqual(["autocomplete"]);
    expect(tr?.origins).toEqual(["trends_queries"]);
  });
});
