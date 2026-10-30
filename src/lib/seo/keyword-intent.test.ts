// ===== 关键词意图规则估算测试（keyword-intent.ts）=====
// 修复记录：旧实现（两页各自的本地副本）在无规则命中时默认返回「导航型」，
// "SEO audit tool" 这类工具需求词被误分类。现契约：
//   无规则命中 → 「未知」；「导航型」只来自真实导航信号（login / 官网 等）。

import { describe, expect, it } from "vitest";
import { detectIntent } from "./keyword-intent";

describe("detectIntent（本轮修复的目标用例）", () => {
  it("SEO audit tool → 未知（规则未命中，不伪称导航型）", () => {
    expect(detectIntent("SEO audit tool")).toBe("未知");
  });

  it("what is SEO audit → 信息型", () => {
    expect(detectIntent("what is SEO audit")).toBe("信息型");
  });

  it("best SEO audit tool → 商业型", () => {
    expect(detectIntent("best SEO audit tool")).toBe("商业型");
  });

  it("login → 导航型（真实导航信号）", () => {
    expect(detectIntent("login")).toBe("导航型");
  });
});

describe("既有规则不回退", () => {
  it("中文疑问词 → 信息型", () => {
    expect(detectIntent("seo是什么")).toBe("信息型");
    expect(detectIntent("网站建设怎么做")).toBe("信息型");
    expect(detectIntent("为什么网站不收录")).toBe("信息型");
    expect(detectIntent("如何提升排名")).toBe("信息型");
    expect(detectIntent("seo工具有哪些")).toBe("信息型");
  });

  it("中文商业词 → 商业型", () => {
    expect(detectIntent("seo工具推荐")).toBe("商业型");
    expect(detectIntent("最好的建站公司")).toBe("商业型");
    expect(detectIntent("semrush ahrefs 对比")).toBe("商业型");
    expect(detectIntent("seo服务价格")).toBe("商业型");
    expect(detectIntent("建站多少钱")).toBe("商业型");
  });

  it("中文导航词 → 导航型", () => {
    expect(detectIntent("semrush 官网")).toBe("导航型");
    expect(detectIntent("后台登录")).toBe("导航型");
  });

  it("英文疑问词 → 信息型", () => {
    expect(detectIntent("how to improve seo")).toBe("信息型");
    expect(detectIntent("what is technical seo")).toBe("信息型");
    expect(detectIntent("why is my ranking dropping")).toBe("信息型");
    expect(detectIntent("seo guide for beginners")).toBe("信息型");
  });

  it("英文商业词 → 商业型", () => {
    expect(detectIntent("best seo tools")).toBe("商业型");
    expect(detectIntent("buy seo software")).toBe("商业型");
    expect(detectIntent("semrush vs ahrefs")).toBe("商业型");
    expect(detectIntent("seo audit pricing")).toBe("商业型");
    expect(detectIntent("cheap keyword research alternative")).toBe("商业型");
  });

  it("英文导航词 → 导航型", () => {
    expect(detectIntent("seeo login")).toBe("导航型");
    expect(detectIntent("sign in")).toBe("导航型");
  });
});

describe("无规则命中 → 未知（不产生伪确定性）", () => {
  it("裸品牌词 / 无特征词 / 空串 / 符号串", () => {
    expect(detectIntent("seeo")).toBe("未知");
    expect(detectIntent("toolstep")).toBe("未知");
    expect(detectIntent("")).toBe("未知");
    expect(() => detectIntent("===***###")).not.toThrow();
    expect(detectIntent("===***###")).toBe("未知");
  });
});

describe("确定性", () => {
  it("同一关键词每次分类一致（与行位置无关）", () => {
    for (let i = 0; i < 9; i++) {
      expect(detectIntent("seo是什么")).toBe("信息型");
      expect(detectIntent("SEO audit tool")).toBe("未知");
    }
  });
});
