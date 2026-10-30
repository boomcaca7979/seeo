// ===== extractSerpContentKeywords 单元测试 =====
// 口径：只从传入的真实标题/摘要文本提取；重复出现（加权≥2）或含种子词才保留；
// 纯数字/URL/种子词本身/纯停用词被丢弃；归一去重与 keyword-merge 同一套 trim+小写。

import { describe, expect, it } from "vitest";
import { extractSerpContentKeywords } from "./serp-keywords";

const r = (title: string, snippet: string) => ({ title, snippet });

describe("extractSerpContentKeywords", () => {
  it("空输入或空种子词返回空数组", () => {
    expect(extractSerpContentKeywords([], "seo tools")).toEqual([]);
    expect(extractSerpContentKeywords([r("Best SEO Tools", "Free SEO tools review")], "")).toEqual([]);
    expect(extractSerpContentKeywords([r("", "")], "seo tools")).toEqual([]);
  });

  it("标题段权重 2 单次即达标：跨结果重复出现的短语被保留", () => {
    const rows = [
      r("Best SEO Tools - Free & Paid Compared", "We reviewed 20 options."),
      r("10 Best SEO Tools Compared | Free vs Paid", "Pricing, features and more."),
    ];
    const result = extractSerpContentKeywords(rows, "seo");
    expect(result).toContain("Best SEO Tools");
    // "10 Best SEO Tools Compared" 仅标题出现 1 次（权重 2）也保留，且含种子词
    expect(result).toContain("10 Best SEO Tools Compared");
  });

  it("仅摘要出现 1 次且不含种子词的短语被丢弃（权重 1 不达标）", () => {
    const rows = [r("", "Some unique phrase about gardening. Nothing else relevant.")];
    const result = extractSerpContentKeywords(rows, "seo");
    expect(result).toEqual([]);
  });

  it("标题出现 1 次即保留（权重 2），即使不含种子词且无重复", () => {
    const rows = [r("Some Unique Phrase About Gardening", "")];
    expect(extractSerpContentKeywords(rows, "seo")).toContain("Some Unique Phrase About Gardening");
  });

  it("包含种子词的短语出现 1 次也保留（种子词变体）", () => {
    const rows = [r("SEO Audit Tool Review", "A detailed walkthrough of one product.")];
    const result = extractSerpContentKeywords(rows, "seo audit");
    expect(result).toContain("SEO Audit Tool Review");
  });

  it("种子词本身不返回，但包含种子词的变体返回", () => {
    expect(extractSerpContentKeywords([r("seo tools", "seo tools")], "seo tools")).toEqual([]);
    const result = extractSerpContentKeywords([r("seo tools", "seo tools compared here")], "seo tools");
    expect(result).toContain("seo tools compared here");
  });

  it("纯数字、URL、纯停用词片段被过滤", () => {
    const rows = [
      r("2026 - https://example.com - How to Choose SEO Tools", "12,345 users visited. The of and to."),
    ];
    const result = extractSerpContentKeywords(rows, "seo");
    expect(result).not.toContain("2026");
    expect(result).not.toContain("https://example.com");
    // 拉丁文候选必须含至少一个非停用词实词
    expect(result).not.toContain("How to");
    expect(result).toContain("How to Choose SEO Tools");
  });

  it("CJK 候选：2-14 字保留，跨结果重复达标", () => {
    const rows = [
      r("关键词研究工具推荐：10 款对比", "这款关键词研究工具支持批量查询。"),
      r("免费关键词研究工具", "适合新手使用。"),
    ];
    const result = extractSerpContentKeywords(rows, "关键词研究");
    expect(result).toContain("关键词研究工具推荐");
    expect(result).toContain("免费关键词研究工具");
  });

  it("CJK 超长候选（>14 字）被丢弃", () => {
    const rows = [
      r("这是一个特别特别长的中文短语远远超过了十四个字的限制需要被过滤掉才对啊", "重复出现一次。"),
      r("这是一个特别特别长的中文短语远远超过了十四个字的限制需要被过滤掉才对啊", "再次重复出现。"),
    ];
    const result = extractSerpContentKeywords(rows, "关键词");
    expect(result).toEqual([]);
  });

  it("同一短语去重：归一后只保留首现原文（大小写/首尾空格差异）", () => {
    const rows = [
      r("Free SEO Tools Compared", "first appearance."),
      r("free seo tools compared | second title", "again."),
      r("FREE SEO TOOLS COMPARED", "third."),
    ];
    const result = extractSerpContentKeywords(rows, "seo");
    const matches = result.filter((k) => k.toLowerCase() === "free seo tools compared");
    expect(matches).toEqual(["Free SEO Tools Compared"]);
  });

  it("limit 截断返回数量，按首现顺序", () => {
    const rows = [
      r("Alpha SEO Widget", "x."),
      r("Beta SEO Widget", "y."),
      r("Gamma SEO Widget", "z."),
      r("Delta SEO Widget", "w."),
    ];
    const result = extractSerpContentKeywords(rows, "seo", 2);
    expect(result).toEqual(["Alpha SEO Widget", "Beta SEO Widget"]);
  });

  it("snippet 命中权重 1：同短语需出现 2 次（摘要或标题+摘要）才保留", () => {
    const rows = [r("", "Competitor Analysis Guide mentioned once")];
    expect(extractSerpContentKeywords(rows, "seo")).toEqual([]);
    const twice = [
      r("", "Here is our Competitor Analysis Guide. It is free"),
      r("", "Here is our Competitor Analysis Guide. Updated weekly"),
    ];
    expect(extractSerpContentKeywords(twice, "seo")).toContain("Here is our Competitor Analysis Guide");
  });
});
