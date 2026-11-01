// ===== 关键词显示格式化契约（keyword-display.ts）=====
// 只锁「显示」：中文内部空格去掉、中英之间留一个空格、大小写与词序不动。
// 任何一条改动都会直接影响魔法工具左栏/表格的中文可读性，故逐条钉住。

import { describe, expect, it } from "vitest";
import { formatKeywordDisplay, keywordDisplayDiffers } from "./keyword-display";

describe("中文关键词显示格式化", () => {
  it("汉字之间的空格被移除（本轮用户点名的三例）", () => {
    expect(formatKeywordDisplay("Ai agent 有 哪些")).toBe("Ai agent 有哪些");
    expect(formatKeywordDisplay("Ai agent 怎麼 用")).toBe("Ai agent 怎麼用");
    expect(formatKeywordDisplay("SEO 是 什么 职位")).toBe("SEO 是什么职位");
  });

  it("中英之间保留一个空格（不粘连）", () => {
    expect(formatKeywordDisplay("SEO 优化")).toBe("SEO 优化");
    expect(formatKeywordDisplay("Google SEO 优化")).toBe("Google SEO 优化");
    expect(formatKeywordDisplay("AI SEO 工具")).toBe("AI SEO 工具");
    expect(formatKeywordDisplay("2026 年 SEO 趋势")).toBe("2026 年 SEO 趋势");
  });

  it("英文单词之间的空格保留", () => {
    expect(formatKeywordDisplay("SEO audit tool")).toBe("SEO audit tool");
  });

  it("连续多个空格合并为一个", () => {
    expect(formatKeywordDisplay("SEO   工具    推荐")).toBe("SEO 工具推荐");
    expect(formatKeywordDisplay("AI\u00A0\u00A0agent  工具")).toBe("AI agent 工具");
    expect(formatKeywordDisplay("SEO\u3000优化")).toBe("SEO 优化");
  });

  it("中文标点两侧不留空格", () => {
    expect(formatKeywordDisplay("SEO ， 工具")).toBe("SEO，工具");
    expect(formatKeywordDisplay("工具 。 推荐")).toBe("工具。推荐");
    expect(formatKeywordDisplay("（ SEO 工具 ）")).toBe("（SEO 工具）");
    expect(formatKeywordDisplay("“ SEO 优化 ”")).toBe("“SEO 优化”");
  });

  it("大小写、词序、词量一个字节都不改", () => {
    const cases = ["Ai agent 有 哪些", "SEO 工具", "seo TOOL audit", "Seo 站 长 工具"];
    for (const c of cases) {
      const out = formatKeywordDisplay(c);
      // 去掉空白后必须与原文逐字符相同：只动了空格，没动任何字符（含大小写）
      expect(out.replace(/\s/g, "")).toBe(c.replace(/\s/g, ""));
      expect(out.length).toBeLessThanOrEqual(c.length);
    }
    expect(formatKeywordDisplay("SEO 工具")).not.toBe("seo 工具");
  });

  it("首尾空白被裁掉", () => {
    expect(formatKeywordDisplay("  SEO 工具  ")).toBe("SEO 工具");
  });

  it("幂等：重复格式化不再变化", () => {
    const once = formatKeywordDisplay("Ai agent 有 哪些");
    expect(formatKeywordDisplay(once)).toBe(once);
  });

  it("不吞有语义的空格：韩文分词、英文冠词、连字符短语", () => {
    expect(formatKeywordDisplay("검색 엔진 최적화")).toBe("검색 엔진 최적화");
    expect(formatKeywordDisplay("what is seo")).toBe("what is seo");
    expect(formatKeywordDisplay("seo - tools")).toBe("seo - tools");
  });

  it("空串与纯空白返回空串", () => {
    expect(formatKeywordDisplay("")).toBe("");
    expect(formatKeywordDisplay("   ")).toBe("");
    expect(formatKeywordDisplay("\u3000")).toBe("");
  });

  it("纯英文/纯中文原样返回", () => {
    expect(formatKeywordDisplay("seo")).toBe("seo");
    expect(formatKeywordDisplay("人工智能代理")).toBe("人工智能代理");
    expect(formatKeywordDisplay("搜索引擎排名优化服务")).toBe("搜索引擎排名优化服务");
  });

  it("keywordDisplayDiffers 只在显示文本变化时为真", () => {
    expect(keywordDisplayDiffers("Ai agent 有 哪些")).toBe(true);
    expect(keywordDisplayDiffers("人工智能代理")).toBe(false);
    expect(keywordDisplayDiffers("SEO 优化")).toBe(false);
  });
});
