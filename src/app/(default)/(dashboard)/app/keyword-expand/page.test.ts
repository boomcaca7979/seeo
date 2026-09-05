// ===== keyword-expand 意图估算测试 =====
// 修复 P1-2：相关关键词表格 intent 原为 `i % 3` 位置循环硬编码假数据，
// 现改用 detectIntent()（基于关键词文本的规则估算，与同页 ExpandTag 标签一致），
// 表头标注「意图（估算）」。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectIntent } from "./page";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("detectIntent（关键词 → 意图分类）", () => {
  it("疑问词 → 信息型", () => {
    expect(detectIntent("seo是什么")).toBe("信息型");
    expect(detectIntent("网站建设怎么做")).toBe("信息型");
    expect(detectIntent("为什么网站不收录")).toBe("信息型");
    expect(detectIntent("如何提升排名")).toBe("信息型");
    expect(detectIntent("seo工具有哪些")).toBe("信息型");
  });

  it("商业词 → 商业型", () => {
    expect(detectIntent("seo工具推荐")).toBe("商业型");
    expect(detectIntent("最好的建站公司")).toBe("商业型");
    expect(detectIntent("semrush ahrefs 对比")).toBe("商业型");
    expect(detectIntent("seo服务价格")).toBe("商业型");
    expect(detectIntent("建站多少钱")).toBe("商业型");
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

  it("英文品牌词 → 导航型", () => {
    expect(detectIntent("seeo")).toBe("导航型");
    expect(detectIntent("seeo login")).toBe("导航型");
  });

  it("其他（品牌/导航/无特征词）→ 导航型", () => {
    expect(detectIntent("semrush 官网")).toBe("导航型");
    expect(detectIntent("toolstep")).toBe("导航型");
  });

  it("空串与边界输入不抛错", () => {
    expect(detectIntent("")).toBe("导航型");
    expect(() => detectIntent("===***###")).not.toThrow();
  });

  it("同一关键词每次分类一致（确定性，与行位置无关）", () => {
    // 修复前：同一关键词在不同行位置会得到不同 intent（i % 3）
    for (let i = 0; i < 9; i++) {
      expect(detectIntent("seo是什么")).toBe("信息型");
    }
  });
});

describe("相关关键词表格 intent 来源（防回归）", () => {
  it("intent 使用 detectIntent(关键词)，不再使用 i % 3 位置硬编码", () => {
    expect(SOURCE).toContain("intent: detectIntent(r.query)");
    expect(SOURCE).not.toContain("i % 3");
    expect(SOURCE).not.toContain("商业调查型"); // 旧假数据特有的类别名
    expect(SOURCE).not.toContain("交易型");
  });

  it("表头标注「意图（估算）」，不伪装成真实分析结果（i18n 后文案位于 zh message catalog）", () => {
    expect(SOURCE).toContain('t("colIntent")');
    const zh = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/zh.json", import.meta.url)), "utf-8"));
    expect(zh.dashboard.keywords.expand.colIntent).toContain("意图（估算）");
  });
});
