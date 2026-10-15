// ===== 审计问题优先级（纯函数，无服务端依赖）=====
//
// 从 work-queue.ts 抽出：审计结果页（client component）需要复用同一套
// 「可解释优先级」来呈现「先做这一件事」，而 work-queue 依赖服务端 DB 模块，
// 不能被 client 导入。本模块只依赖类型与纯计算，client/server 两侧共享。
//
// 唯一来源纪律：优先级算法仍然只有这一份；work-queue 只是 re-export，
// 不存在第二套评分。

import type { RuleSnapshot } from "./audit-dashboard";

export type PriorityLevel = "P0" | "P1" | "P2";
export type EffortLevel = "low" | "medium" | "high";

/** 优先级理由：结构化码 + 数值，由 UI 按 locale 渲染（服务端不写死语言） */
export interface PriorityReason {
  code: string;
  value?: number;
}

export interface TaskPriority {
  level: PriorityLevel;
  score: number;
  reasons: PriorityReason[];
}

export interface TechnicalPriorityInput {
  severity: RuleSnapshot["severity"];
  affectedRatio: number;
  scoreImpact: number;
  pattern: RuleSnapshot["pattern"];
  pageLevel: "page" | "site";
}

const SEVERITY_BASE: Record<RuleSnapshot["severity"], number> = { error: 3, warning: 2, notice: 1 };

/**
 * 技术问题优先级：严重度 + 受影响范围 + 分数影响 + 问题模式 + 修复成本。
 * 输出 reasons 数组，UI 必须展示理由（不允许只给一个标签）。
 */
export function explainTechnicalPriority(input: TechnicalPriorityInput): {
  priority: TaskPriority;
  effort: EffortLevel;
} {
  const reasons: PriorityReason[] = [];
  let score = SEVERITY_BASE[input.severity];
  reasons.push({ code: `severity_${input.severity}` });

  // 受影响范围：占可索引页面比例
  if (input.affectedRatio >= 0.5) {
    score += 2;
    reasons.push({ code: "reach_high", value: Math.round(input.affectedRatio * 100) });
  } else if (input.affectedRatio >= 0.2) {
    score += 1;
    reasons.push({ code: "reach_medium", value: Math.round(input.affectedRatio * 100) });
  }

  // 分数影响（该规则对健康分的扣分）
  if (input.scoreImpact >= 5) {
    score += 2;
    reasons.push({ code: "impact_high", value: Math.round(input.scoreImpact) });
  } else if (input.scoreImpact >= 2) {
    score += 1;
    reasons.push({ code: "impact_medium", value: Math.round(input.scoreImpact) });
  }

  // 问题模式：站点级问题一次修复覆盖多页（高杠杆），重复模式次之
  if (input.pattern === "site-wide") {
    score += 2;
    reasons.push({ code: "pattern_site_wide" });
  } else if (input.pattern === "repeated") {
    score += 1;
    reasons.push({ code: "pattern_repeated" });
  }

  // 修复成本：站点级规则通常一次改动覆盖全站
  let effort: EffortLevel = "medium";
  if (input.pageLevel === "site" || input.pattern === "site-wide") {
    effort = "low";
    score += 1;
    reasons.push({ code: "effort_low" });
  } else {
    reasons.push({ code: "effort_medium" });
  }

  // 证据可靠性：审计问题为自研爬虫的直接观测证据
  reasons.push({ code: "evidence_direct_crawl" });

  const level: PriorityLevel = score >= 7 ? "P0" : score >= 4 ? "P1" : "P2";
  return { priority: { level, score, reasons }, effort };
}

export interface TopIssueSelection {
  rule: RuleSnapshot;
  priority: TaskPriority;
  effort: EffortLevel;
  /** 与最高分**同分**的失败规则数（≥1）。>1 时 UI 必须如实说明"依据本次数据 N 条并列"，不冒充唯一答案 */
  tieCount: number;
  /** 本次审计的失败规则总数（UI 用于说明判断覆盖范围） */
  totalFailing: number;
}

/**
 * 从本次审计快照中选出「最值得先处理的一件事」。
 * 只使用本次真实检测结果 + 既有优先级规则；确定性并列裁决：
 * score ↓ → affectedRatio ↓ → findings ↓ → ruleId 字典序（稳定可复现）。
 * 没有失败规则 → null（不伪造）。
 */
export function selectTopIssue(rules: RuleSnapshot[]): TopIssueSelection | null {
  const failing = rules.filter((r) => r.status === "fail");
  if (failing.length === 0) return null;

  const scored = failing.map((rule) => {
    const { priority, effort } = explainTechnicalPriority({
      severity: rule.severity,
      affectedRatio: rule.affectedRatio,
      scoreImpact: rule.scoreImpact,
      pattern: rule.pattern,
      pageLevel: rule.pageLevel,
    });
    return { rule, priority, effort };
  });

  scored.sort((a, b) => {
    if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
    if (b.rule.affectedRatio !== a.rule.affectedRatio) return b.rule.affectedRatio - a.rule.affectedRatio;
    if (b.rule.findings !== a.rule.findings) return b.rule.findings - a.rule.findings;
    return a.rule.ruleId.localeCompare(b.rule.ruleId);
  });

  const top = scored[0];
  const tieCount = scored.filter((s) => s.priority.score === top.priority.score).length;
  return { ...top, tieCount, totalFailing: failing.length };
}
