// ===== keyword-cluster 单元测试 =====
// 覆盖：规则型主题分组（df≥2 核心词、拉丁/CJK、唯一主分组、「其他」兜底、
//       空/单词安全输入、确定性）、问题词识别（拉丁 token / 中文子串 / 尾字「吗」）

import { describe, expect, it } from "vitest";
import { CLUSTER_OTHER_ID, clusterKeywords, isQuestionKeyword } from "./keyword-cluster";

describe("clusterKeywords（规则型主题分组）", () => {
  it("df≥2 的核心词成为分组，命中同一核心词的关键词归入同组", () => {
    const clusters = clusterKeywords([
      "seo audit tool",
      "seo audit checklist",
      "seo analyzer",
      "rank tracker",
    ]);
    const seo = clusters.find((c) => c.id === "seo");
    expect(seo).toBeDefined();
    expect(seo!.keywords).toHaveLength(3);
    // 每个关键词只有一个主分组
    const total = clusters.reduce((sum, c) => sum + c.keywords.length, 0);
    expect(total).toBe(4);
  });

  it("中文关键词：CJK 2-gram 命中 df≥2 时成组（如「建站」）", () => {
    const clusters = clusterKeywords([
      "建站工具推荐",
      "免费建站工具",
      "建站教程哪个好",
      "网站收录",
    ]);
    const core = clusters.find((c) => c.id === "建站");
    expect(core).toBeDefined();
    expect(core!.keywords).toHaveLength(3);
  });

  it("无 df≥2 核心词时全部进「其他」（其他组固定 id，排最后）", () => {
    const clusters = clusterKeywords(["alpha beta", "gamma delta", "epsilon zeta"]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe(CLUSTER_OTHER_ID);
    expect(clusters[0].keywords).toHaveLength(3);
  });

  it("单个关键词 / 空列表不抛错", () => {
    expect(clusterKeywords([])).toEqual([]);
    const single = clusterKeywords(["seo audit tool"]);
    expect(single).toHaveLength(1);
    expect(single[0].id).toBe(CLUSTER_OTHER_ID);
  });

  it("组内数量降序输出（确定性，与输入顺序无关）", () => {
    const input = [
      "seo tools", "seo audit", "seo checker", "seo analyzer",
      "rank tracker free", "rank tracker online",
    ];
    const a = clusterKeywords(input);
    const b = clusterKeywords([...input].reverse());
    expect(a.map((c) => [c.id, c.keywords.length])).toEqual(b.map((c) => [c.id, c.keywords.length]));
    expect(a[0].keywords.length).toBeGreaterThanOrEqual(a[a.length - 1].keywords.length);
  });

  it("保留关键词原文（不大小写归一展示文本）", () => {
    const clusters = clusterKeywords(["SEO Tools", "seo tools free", "seo audit"]);
    const seo = clusters.find((c) => c.id === "seo")!;
    expect(seo.keywords).toContain("SEO Tools");
    expect(seo.keywords).toContain("seo tools free");
  });
});

describe("isQuestionKeyword（规则型问题词识别）", () => {
  it("拉丁疑问 token 命中", () => {
    expect(isQuestionKeyword("how to check seo")).toBe(true);
    expect(isQuestionKeyword("what is seo audit")).toBe(true);
    expect(isQuestionKeyword("why is my site slow")).toBe(true);
    expect(isQuestionKeyword("is seo worth it")).toBe(true);
  });

  it("中文疑问子串 / 尾字「吗」命中", () => {
    expect(isQuestionKeyword("seo是什么")).toBe(true);
    expect(isQuestionKeyword("怎么提高网站排名")).toBe(true);
    expect(isQuestionKeyword("seo工具好用吗？")).toBe(true);
  });

  it("普通相关词不误判为问题词", () => {
    expect(isQuestionKeyword("seo audit tool")).toBe(false);
    expect(isQuestionKeyword("best seo tools")).toBe(false);
    expect(isQuestionKeyword("免费seo工具")).toBe(false);
    expect(isQuestionKeyword("")).toBe(false);
  });
});
