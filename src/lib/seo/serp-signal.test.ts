// ===== SeeO SERP Competition Signal 单元测试（P4 公式 + P7 titleMatch 扩展） =====
// 确定性纯函数：score = 100 × (0.30×域名集中度 + 0.30×feature 挤压度 + 0.20×自然结果稀疏度 + 0.20×标题关键词匹配度)
// 硬约束：绝不使用搜索量/外链/权威度输入；无自然结果返回 null（不编造分数）；
//         这是 SeeO 自有相对参考分，绝不是 Google KD（UI 层负责命名与口径说明）。

import { describe, expect, it } from "vitest";
import { computeSerpCompetitionSignal } from "./serp-signal";

function organicOf(domains: string[]) {
  return domains.map((domain, i) => ({ domain, link: `https://${domain}/${i}` }));
}

function organicWithTitles(rows: { domain: string; title: string }[]) {
  return rows.map((row, i) => ({ domain: row.domain, title: row.title, link: `https://${row.domain}/${i}` }));
}

describe("computeSerpCompetitionSignal 公式", () => {
  it("头部同域名 + 双重阻塞 feature → 高分（各项同向）", () => {
    // 10 条结果全部同一域名：集中度 = 1 − 1/10 = 0.9；ai_overview(3) + featured_snippet(3) → 挤压度 = 1；
    // 10 条 → 稀疏度 = 0；无 title 证据 → 标题匹配 = 0。score = 100 × (0.27 + 0.30 + 0 + 0) = 57
    const signal = computeSerpCompetitionSignal(
      {
        organic: organicOf(Array.from({ length: 10 }, () => "example.com")),
        features: [{ featureType: "ai_overview" }, { featureType: "featured_snippet" }],
      },
      "seo audit"
    );
    expect(signal).toEqual({
      score: 57,
      inputs: {
        organicCount: 10,
        distinctDomains: 1,
        featureCount: 2,
        blockingFeatures: ["ai_overview", "featured_snippet"],
        titleMatchCount: 0,
      },
      sampleSize: 10,
    });
  });

  it("域名完全分散 + 无 feature + 结果满页 → 低分", () => {
    // 集中度 = 0；featurePressure = 0；稀疏度 = 0；标题匹配 = 0 → score = 0
    const signal = computeSerpCompetitionSignal(
      {
        organic: organicOf(["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com", "h.com", "i.com", "j.com"]),
        features: null,
      },
      "seo audit"
    );
    expect(signal).not.toBeNull();
    expect(signal!.score).toBe(0);
    expect(signal!.inputs.distinctDomains).toBe(10);
    expect(signal!.inputs.blockingFeatures).toEqual([]);
    expect(signal!.inputs.titleMatchCount).toBe(0);
  });

  it("无阻塞 feature 时其余 feature 每个权重 1（普通块挤压度低）", () => {
    // 10 条全同域名（集中度 0.9）+ 2 个普通 feature（挤压度 = 2/6）→ 100 × (0.27 + 0.30×(1/3)) = 37
    const signal = computeSerpCompetitionSignal(
      {
        organic: organicOf(Array.from({ length: 10 }, () => "example.com")),
        features: [{ featureType: "video_results" }, { featureType: "knowledge_graph" }],
      },
      "seo audit"
    );
    expect(signal!.score).toBe(37);
    expect(signal!.inputs.blockingFeatures).toEqual([]);
  });

  it("feature 权重封顶：再多阻塞块挤压度也不超过 1", () => {
    // 6 条全不同域名：集中度 0；feature 总权重 3+3+2+2+1+1+1 > 6 → 挤压度 = 1；
    // 稀疏度 = 0.4。score = 100 × (0 + 0.30 + 0.08) = 38
    const signal = computeSerpCompetitionSignal(
      {
        organic: organicOf(["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"]),
        features: [
          { featureType: "ai_overview" },
          { featureType: "featured_snippet" },
          { featureType: "local_pack" },
          { featureType: "shopping_results" },
          { featureType: "video_results" },
          { featureType: "top_stories" },
          { featureType: "knowledge_graph" },
        ],
      },
      "seo audit"
    );
    expect(signal!.score).toBe(38);
  });

  it("结果稀疏：5 条同域名结果 → 集中度 0.8、稀疏度 0.5 参与计分", () => {
    // score = 100 × (0.30×0.8 + 0 + 0.20×0.5) = 34
    const signal = computeSerpCompetitionSignal(
      {
        organic: organicOf(["example.com", "example.com", "example.com", "example.com", "example.com"]),
        features: [],
      },
      "seo audit"
    );
    expect(signal!.score).toBe(34);
    expect(signal!.inputs.organicCount).toBe(5);
  });

  it("标题关键词匹配（P7）：4/10 标题包含种子词 → titleMatch 参与计分", () => {
    // 集中度 0（全不同域名）、无 feature、满页稀疏度 0；4/10 标题命中 →
    // score = 100 × (0 + 0 + 0 + 0.20×0.4) = 8
    const signal = computeSerpCompetitionSignal(
      {
        organic: organicWithTitles([
          { domain: "a.com", title: "Best SEO Audit Tool 2026" },
          { domain: "b.com", title: "How to run an seo audit" },
          { domain: "c.com", title: "SEO AUDIT checklist" },
          { domain: "d.com", title: "seo audit pricing compared" },
          { domain: "e.com", title: "Website health check guide" },
          { domain: "f.com", title: "Technical crawl basics" },
          { domain: "g.com", title: "Content strategy tips" },
          { domain: "h.com", title: "Link building primer" },
          { domain: "i.com", title: "Analytics dashboards" },
          { domain: "j.com", title: "Core Web Vitals explained" },
        ]),
        features: null,
      },
      "SEO Audit"
    );
    expect(signal!.score).toBe(8);
    expect(signal!.inputs.titleMatchCount).toBe(4);
  });

  it("种子词为空白时标题匹配不参与计分（不用空串把每一行都算命中）", () => {
    const signal = computeSerpCompetitionSignal(
      {
        organic: organicWithTitles([
          { domain: "a.com", title: "anything" },
          { domain: "b.com", title: "anything else" },
        ]),
        features: null,
      },
      "   "
    );
    expect(signal!.inputs.titleMatchCount).toBe(0);
  });

  it("无自然结果 → null（诚实缺数据，不用 0 冒充）", () => {
    expect(computeSerpCompetitionSignal({ organic: [], features: null }, "kw")).toBeNull();
    expect(computeSerpCompetitionSignal({ organic: [] }, "kw")).toBeNull();
  });

  it("features 缺省（undefined）等价于无 feature 块", () => {
    const without = computeSerpCompetitionSignal({ organic: organicOf(["a.com", "b.com"]) }, "kw");
    const withEmpty = computeSerpCompetitionSignal({ organic: organicOf(["a.com", "b.com"]), features: [] }, "kw");
    expect(without).toEqual(withEmpty);
  });

  it("同输入每次结果一致（确定性，页面重渲染不跳动）", () => {
    const input = {
      organic: organicOf(["example.com", "example.com", "other.org"]),
      features: [{ featureType: "ai_overview" }],
    };
    const first = computeSerpCompetitionSignal(input, "seo audit");
    for (let i = 0; i < 5; i++) {
      expect(computeSerpCompetitionSignal(input, "seo audit")).toEqual(first);
    }
  });
});
