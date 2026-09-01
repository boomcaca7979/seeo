// ===== Audit Engine V2 健康分计算 =====
// 核心变化（相对 V1 的"命中检查项即按权重扣分"）：
// 1. 扣分同时考虑 severity（error/warning/notice）与规则权重 scoreWeight
// 2. 引入 affectedPageRatio：同一问题影响 1/100 页与 80/100 页的扣分不同
// 3. notice 极低扣分（不设下限地板），error/warning 保留 30% 地板（存在即扣分）
//
// 分级：90-100 Excellent / 80-89 Good / 60-79 Needs Attention / 0-59 Critical

export type ScoreSeverity = "error" | "warning" | "notice";

/** severity → 满覆盖时的单位扣分（再乘 scoreWeight 与比例因子） */
export const SEVERITY_IMPACT: Record<ScoreSeverity, number> = {
  error: 8,
  warning: 4,
  notice: 0.8,
};

export type ScoreGrade = "excellent" | "good" | "needs-attention" | "critical";

export function scoreGrade(score: number): ScoreGrade {
  if (score >= 90) return "excellent";
  if (score >= 80) return "good";
  if (score >= 60) return "needs-attention";
  return "critical";
}

export interface ScoreRuleInput {
  ruleId: string;
  severity: ScoreSeverity;
  /** 规则权重（默认 1；更高 = 更重要） */
  scoreWeight: number;
  /** site 级规则（sitemap/robots/llms 等与页面比例无关）按全量影响计算 */
  pageLevel: "page" | "site";
  /** 至少存在一个 finding 的页面数（site 级规则传 1 即可，不影响计算） */
  affectedPages: number;
}

export interface ScoreRuleImpact extends ScoreRuleInput {
  impact: number;
  ratio: number;
}

/** 单规则扣分 */
export function ruleImpact(rule: ScoreRuleInput, indexablePages: number): ScoreRuleImpact {
  const ratio =
    rule.pageLevel === "site"
      ? 1
      : Math.min(1, rule.affectedPages / Math.max(1, indexablePages));
  // error/warning：保留 30% 地板（问题存在即扣分）+ 70% 按影响面比例
  // notice：纯按比例（1 页受影响几乎不扣分，符合"notice 极低扣分"）
  const ratioFactor = rule.severity === "notice" ? ratio : 0.3 + 0.7 * ratio;
  const impact = rule.scoreWeight * SEVERITY_IMPACT[rule.severity] * ratioFactor;
  return { ...rule, impact, ratio };
}

/**
 * V2 健康分：100 - Σ(每条失败规则的 impact)，下限 0。
 * 未失败规则不产生任何扣分；0 findings = 100 分。
 */
export function calculateHealthScoreV2(
  failedRules: ScoreRuleInput[],
  indexablePages: number
): number {
  const deduction = failedRules.reduce(
    (sum, r) => sum + ruleImpact(r, indexablePages).impact,
    0
  );
  return Math.max(0, Math.min(100, Math.round(100 - deduction)));
}

export const ENGINE_VERSION = "v2";
export const RULE_SET_VERSION = "2.0";
