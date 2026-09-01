// ===== Audit Engine V2 健康分单元测试 =====
// 覆盖：
// - 0 findings → 100
// - 少量 notice → 极低扣分
// - 大量 warnings / 1 个 error / 多个 error 的相对扣分
// - 1 页受影响 vs 多数页受影响的差异化扣分（affectedPageRatio）
// - severity × scoreWeight × ratio 的组合
// - 分级区间：Excellent / Good / Needs Attention / Critical

import { describe, it, expect } from "vitest";
import {
  calculateHealthScoreV2,
  ruleImpact,
  scoreGrade,
  SEVERITY_IMPACT,
  ENGINE_VERSION,
  RULE_SET_VERSION,
  type ScoreRuleInput,
} from "@/lib/seo/audit-score";

function pageRule(partial: Partial<ScoreRuleInput>): ScoreRuleInput {
  return {
    ruleId: "test-rule",
    severity: "warning",
    scoreWeight: 1,
    pageLevel: "page",
    affectedPages: 1,
    ...partial,
  };
}

describe("calculateHealthScoreV2：基础", () => {
  it("0 findings → 100 分", () => {
    expect(calculateHealthScoreV2([], 50)).toBe(100);
  });

  it("分数永不越界（0-100）", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      pageRule({ ruleId: `r${i}`, severity: "error", scoreWeight: 2, affectedPages: 100 })
    );
    const score = calculateHealthScoreV2(many, 100);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("calculateHealthScoreV2：severity 影响", () => {
  it("同一规则全量影响：error 扣分 > warning 扣分 > notice 扣分", () => {
    const base = { affectedPages: 100 } as const;
    const withError = calculateHealthScoreV2([pageRule({ severity: "error", ...base })], 100);
    const withWarning = calculateHealthScoreV2([pageRule({ severity: "warning", ...base })], 100);
    const withNotice = calculateHealthScoreV2([pageRule({ severity: "notice", ...base })], 100);
    expect(withError).toBeLessThan(withWarning);
    expect(withWarning).toBeLessThan(withNotice);
  });

  it("1 个 error 扣分低于 多个 error 扣分（累积）", () => {
    const one = calculateHealthScoreV2(
      [pageRule({ ruleId: "a", severity: "error", affectedPages: 100 })],
      100
    );
    const three = calculateHealthScoreV2(
      [
        pageRule({ ruleId: "a", severity: "error", affectedPages: 100 }),
        pageRule({ ruleId: "b", severity: "error", affectedPages: 100 }),
        pageRule({ ruleId: "c", severity: "error", affectedPages: 100 }),
      ],
      100
    );
    expect(three).toBeLessThan(one);
  });

  it("大量 warnings 的累积扣分超过单个 warning（按 severity 权重，非线性每 finding -1）", () => {
    const oneWarning = calculateHealthScoreV2(
      [pageRule({ severity: "warning", affectedPages: 100 })],
      100
    );
    const manyWarnings = calculateHealthScoreV2(
      Array.from({ length: 8 }, (_, i) =>
        pageRule({ ruleId: `w${i}`, severity: "warning", affectedPages: 100 })
      ),
      100
    );
    expect(manyWarnings).toBeLessThan(oneWarning);
    // 8 个满影响 warning 各按 SEVERITY_IMPACT.warning 扣分（不是每个 finding 固定扣 1 分）
    expect(manyWarnings).toBe(100 - 8 * SEVERITY_IMPACT.warning);
  });
});

describe("calculateHealthScoreV2：affectedPageRatio", () => {
  it("同一 error：80/100 页影响扣分显著高于 1/100 页", () => {
    const one = calculateHealthScoreV2(
      [pageRule({ severity: "error", affectedPages: 1 })],
      100
    );
    const many = calculateHealthScoreV2(
      [pageRule({ severity: "error", affectedPages: 80 })],
      100
    );
    expect(many).toBeLessThan(one);
  });

  it("affectedPages 超过 indexablePages 时按 100% 计算（不超扣）", () => {
    const impact = ruleImpact(
      pageRule({ severity: "error", affectedPages: 500 }),
      100
    );
    expect(impact.ratio).toBe(1);
  });

  it("site 级规则按全量影响计算（与页面数无关）", () => {
    const pageImpact = ruleImpact(pageRule({ severity: "warning", affectedPages: 1 }), 100);
    const siteImpact = ruleImpact(
      pageRule({ severity: "warning", pageLevel: "site", affectedPages: 1 }),
      100
    );
    // page 级 1/100 只有小比例；site 级恒为全量
    expect(siteImpact.impact).toBeGreaterThan(pageImpact.impact);
    expect(siteImpact.ratio).toBe(1);
  });

  it("error/warning 保留 30% 地板：1 页受影响也扣分（存在即扣分）", () => {
    const errorOne = ruleImpact(pageRule({ severity: "error", affectedPages: 1 }), 100);
    // 地板 = 0.3 + 0.7 * (1/100) = 0.307
    expect(errorOne.impact).toBeCloseTo(1 * SEVERITY_IMPACT.error * 0.307, 3);
  });

  it("notice 纯按比例：1/100 页几乎不扣分（无地板）", () => {
    const noticeOne = ruleImpact(pageRule({ severity: "notice", affectedPages: 1 }), 100);
    expect(noticeOne.impact).toBeCloseTo(SEVERITY_IMPACT.notice * 0.01, 5);
  });

  it("scoreWeight 放大扣分", () => {
    const w1 = ruleImpact(pageRule({ severity: "error", scoreWeight: 1, affectedPages: 100 }), 100);
    const w2 = ruleImpact(pageRule({ severity: "error", scoreWeight: 2, affectedPages: 100 }), 100);
    expect(w2.impact).toBeCloseTo(w1.impact * 2, 5);
  });
});

describe("scoreGrade 分级", () => {
  it("90-100 Excellent / 80-89 Good / 60-79 Needs Attention / 0-59 Critical", () => {
    expect(scoreGrade(100)).toBe("excellent");
    expect(scoreGrade(90)).toBe("excellent");
    expect(scoreGrade(89)).toBe("good");
    expect(scoreGrade(80)).toBe("good");
    expect(scoreGrade(79)).toBe("needs-attention");
    expect(scoreGrade(60)).toBe("needs-attention");
    expect(scoreGrade(59)).toBe("critical");
    expect(scoreGrade(0)).toBe("critical");
  });
});

describe("版本常量", () => {
  it("engineVersion / ruleSetVersion 存在（用于历史可解释性）", () => {
    expect(ENGINE_VERSION).toBe("v2");
    expect(RULE_SET_VERSION).toBe("2.0");
  });
});
