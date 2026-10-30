// ===== 多方向扩词单元测试（纯函数口径：模板≠搜索数据、≤4 查询、不支持市场明确禁用）=====

import { describe, expect, it } from "vitest";
import {
  EXPAND_DIRECTIONS,
  MAX_QUERIES_PER_DIRECTION,
  composeDirectionQueries,
  directionLanguageForMarket,
  type DirectionId,
} from "./expand-directions";

const ALL_IDS: DirectionId[] = [
  "free_price",
  "best_alternatives",
  "tutorial_questions",
  "usecases_audience",
  "compare_choose",
];

describe("directionLanguageForMarket", () => {
  it("中文市场（中国/香港/台湾）→ zh 模板", () => {
    expect(directionLanguageForMarket("中国")).toBe("zh");
    expect(directionLanguageForMarket("香港")).toBe("zh");
    expect(directionLanguageForMarket("台湾")).toBe("zh");
  });

  it("英文市场（美国/英国）→ en 模板", () => {
    expect(directionLanguageForMarket("美国")).toBe("en");
    expect(directionLanguageForMarket("英国")).toBe("en");
  });

  it("暂无已验证模板的市场返回 null（明确禁用，不输出错误翻译词）", () => {
    expect(directionLanguageForMarket("日本")).toBeNull();
    expect(directionLanguageForMarket("德国")).toBeNull();
    expect(directionLanguageForMarket("")).toBeNull();
    expect(directionLanguageForMarket("Unknown Market")).toBeNull();
  });

  it("首尾空格不改变判定（与页面 trim 后传参同一口径）", () => {
    expect(directionLanguageForMarket(" 中国 ")).toBe("zh");
  });
});

describe("composeDirectionQueries", () => {
  it("五个方向 id 齐全且互不重复", () => {
    expect(EXPAND_DIRECTIONS.map((d) => d.id)).toEqual(ALL_IDS);
  });

  it("每个方向 zh/en 模板都存在且不超过上限", () => {
    for (const d of EXPAND_DIRECTIONS) {
      expect(d.zh.length).toBeGreaterThan(0);
      expect(d.zh.length).toBeLessThanOrEqual(MAX_QUERIES_PER_DIRECTION);
      expect(d.en.length).toBeLessThanOrEqual(MAX_QUERIES_PER_DIRECTION);
    }
  });

  it("组合查询包含种子词；前缀/后缀位置与模板一致", () => {
    expect(composeDirectionQueries("seo tools", "best_alternatives", "en")).toEqual([
      "best seo tools",
      "top seo tools",
      "seo tools alternative",
      "seo tools alternatives",
    ]);
    expect(composeDirectionQueries("关键词工具", "free_price", "zh")).toEqual([
      "关键词工具 免费",
      "关键词工具 价格",
      "关键词工具 多少钱",
      "关键词工具 收费",
    ]);
  });

  it("组合数量 ≤ 4（成本上限）", () => {
    for (const d of EXPAND_DIRECTIONS) {
      for (const lang of ["zh", "en"] as const) {
        expect(composeDirectionQueries("seed", d.id, lang).length).toBeLessThanOrEqual(4);
      }
    }
  });

  it("空种子词或未知方向返回 []", () => {
    expect(composeDirectionQueries("", "free_price", "zh")).toEqual([]);
    expect(composeDirectionQueries("  ", "free_price", "en")).toEqual([]);
    expect(composeDirectionQueries("x", "not_a_direction" as DirectionId, "zh")).toEqual([]);
  });

  it("组合结果全部包含种子词（模板只是修饰，绝不替换种子词）", () => {
    for (const d of EXPAND_DIRECTIONS) {
      for (const q of composeDirectionQueries("seo", d.id, "en")) {
        expect(q).toContain("seo");
      }
    }
  });
});
