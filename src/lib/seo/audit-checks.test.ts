import { describe, it, expect } from "vitest";
import {
  calculateHealthScore,
  perPageChecks,
  crossPageChecks,
  type AuditIssue,
} from "@/lib/seo/audit-checks";

function makeIssue(checkId: string): AuditIssue {
  return {
    checkId,
    checkName: "test",
    message: "test",
    url: "https://example.com/",
    severity: "warning",
    suggestion: "test",
  };
}

describe("calculateHealthScore", () => {
  it("无 issue 时返回 100", () => {
    const score = calculateHealthScore([], new Set(perPageChecks.map((c) => c.id)));
    expect(score).toBe(100);
  });

  it("quick 模式只按 perPageChecks 权重计算", () => {
    // 触发一个 missing-title（weight=5）
    const issues: AuditIssue[] = [makeIssue("missing-title")];
    const executed = new Set(perPageChecks.map((c) => c.id));
    const perPageWeight = perPageChecks.reduce((s, c) => s + c.weight, 0);
    const expected = Math.round(100 - (5 / perPageWeight) * 100);
    const score = calculateHealthScore(issues, executed);
    expect(score).toBe(expected);
  });

  it("full 模式按 perPage + crossPage 权重计算", () => {
    const issues: AuditIssue[] = [makeIssue("duplicate-title")];
    const executed = new Set([
      ...perPageChecks.map((c) => c.id),
      ...crossPageChecks.map((c) => c.id),
    ]);
    const totalWeight = perPageChecks.reduce((s, c) => s + c.weight, 0) +
      crossPageChecks.reduce((s, c) => s + c.weight, 0);
    const dupWeight = crossPageChecks.find((c) => c.id === "duplicate-title")!.weight;
    const expected = Math.round(100 - (dupWeight / totalWeight) * 100);
    const score = calculateHealthScore(issues, executed);
    expect(score).toBe(expected);
  });

  it("quick 模式与 full 模式权重不同导致分数不同", () => {
    const issues: AuditIssue[] = [makeIssue("missing-title")];
    const quickScore = calculateHealthScore(
      issues,
      new Set(perPageChecks.map((c) => c.id))
    );
    const fullScore = calculateHealthScore(
      issues,
      new Set([
        ...perPageChecks.map((c) => c.id),
        ...crossPageChecks.map((c) => c.id),
      ])
    );
    // full 模式分母更大，扣分比例更小，分数更高
    expect(fullScore).toBeGreaterThan(quickScore);
  });

  it("未传 executedCheckIds 时使用全量权重（向后兼容）", () => {
    const issues: AuditIssue[] = [makeIssue("missing-title")];
    const score = calculateHealthScore(issues);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
