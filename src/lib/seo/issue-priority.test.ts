// ===== 「先做这一件事」选题逻辑测试（纯函数，无 DB/网络）=====
// 验证：只用本次真实检测结果 + 既有优先级规则；确定性并列裁决；
// 无失败规则 → null；并列时如实返回 tieCount（UI 据此说明依据不足）。

import { describe, it, expect } from "vitest";
import { selectTopIssue, explainTechnicalPriority } from "./issue-priority";
import { explainTechnicalPriority as fromWorkQueue } from "./work-queue";
import type { RuleSnapshot } from "./audit-dashboard";

function rule(overrides: Partial<RuleSnapshot> & { ruleId: string }): RuleSnapshot {
  return {
    name: { en: overrides.ruleId, zh: overrides.ruleId },
    description: { en: "test", zh: "测试" },
    recommendation: { en: "fix", zh: "修复" },
    category: "onpage",
    severity: "warning",
    pageLevel: "page",
    scoreWeight: 1,
    status: "fail",
    findings: 1,
    affectedPages: 1,
    affectedRatio: 0.1,
    scoreImpact: 1,
    sampleUrl: `https://x.test/${overrides.ruleId}`,
    sampleMessage: { en: `finding for ${overrides.ruleId}`, zh: `发现 ${overrides.ruleId}` },
    sampleMetrics: null,
    pattern: null,
    ...overrides,
  } as RuleSnapshot;
}

describe("selectTopIssue：审计结果页「先做这一件事」", () => {
  it("无失败规则 → null（不伪造判断）", () => {
    expect(selectTopIssue([rule({ ruleId: "a", status: "pass" })])).toBeNull();
    expect(selectTopIssue([])).toBeNull();
  });

  it("error + site-wide 优先于 warning 分散问题（severity/范围/杠杆真实计分）", () => {
    const top = selectTopIssue([
      rule({ ruleId: "warn-scattered", severity: "warning", affectedRatio: 0.1, scoreImpact: 1 }),
      rule({ ruleId: "err-sitewide", severity: "error", affectedRatio: 0.6, scoreImpact: 6, pattern: "site-wide", pageLevel: "site" }),
    ]);
    expect(top!.rule.ruleId).toBe("err-sitewide");
    expect(top!.priority.level).toBe("P0");
    expect(top!.totalFailing).toBe(2);
  });

  it("同分时确定性裁决：affectedRatio ↓ → findings ↓ → ruleId 字典序（可复现）", () => {
    const a = rule({ ruleId: "b-rule", affectedRatio: 0.2, findings: 3, scoreImpact: 2 });
    const b = rule({ ruleId: "a-rule", affectedRatio: 0.2, findings: 3, scoreImpact: 2 });
    const s1 = selectTopIssue([a, b]);
    const s2 = selectTopIssue([b, a]);
    expect(s1!.rule.ruleId).toBe("a-rule");
    expect(s2!.rule.ruleId).toBe("a-rule"); // 输入顺序不影响结果
    expect(s1!.tieCount).toBe(2); // 同分 → 如实报告并列
  });

  it("唯一最高分 → tieCount=1（不谎报并列）", () => {
    const top = selectTopIssue([
      rule({ ruleId: "strong", severity: "error", affectedRatio: 0.6, scoreImpact: 6, pattern: "site-wide" }),
      rule({ ruleId: "weak", severity: "notice", affectedRatio: 0.05, scoreImpact: 0 }),
    ]);
    expect(top!.tieCount).toBe(1);
    expect(top!.totalFailing).toBe(2);
  });

  it("与 work-queue 的优先级算法同源：同一输入产出同一分数（唯一来源纪律）", () => {
    const input = {
      severity: "warning" as const,
      affectedRatio: 0.6,
      scoreImpact: 6,
      pattern: "site-wide" as const,
      pageLevel: "site" as const,
    };
    const fromIssuePriority = explainTechnicalPriority(input).priority;
    // work-queue re-export 同一实现（不存在第二套评分）
    expect(fromWorkQueue(input).priority).toEqual(fromIssuePriority);
  });
});
