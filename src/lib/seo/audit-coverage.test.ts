// ===== Audit Coverage 统计链路测试 =====
// 背景 bug：审计报告"检查项覆盖（0/0 通过）"。
// 根因：快照只存 {healthScore, issues} 丢弃 coverage；历史预览回退空数组；
// 且 /api/audit/latest 旧版把未执行的检查项也计为"通过"，与 runAudit 健康分口径不一致。
// 修复：getExecutedCheckIds(depth) + buildCoverageFromIssues()，
// score 与 coverage 共用"该 depth 实际执行的检查项"口径。

import { describe, it, expect } from "vitest";
import {
  allCheckMeta,
  perPageChecks,
  crossPageChecks,
  getExecutedCheckIds,
  crossPageCheckIds,
  buildCoverageFromIssues,
  calculateHealthScore,
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

describe("getExecutedCheckIds：审计深度与实际执行的检查项", () => {
  it("quick 只执行单页检查（不含跨页）", () => {
    const quick = getExecutedCheckIds("quick");
    expect(quick.size).toBe(perPageChecks.length);
    for (const id of crossPageCheckIds) {
      expect(quick.has(id)).toBe(false);
    }
  });

  it("full 执行单页 + 跨页全部检查（与 allCheckMeta 一致）", () => {
    const full = getExecutedCheckIds("full");
    expect(full.size).toBe(allCheckMeta.length);
    expect(full.size).toBe(perPageChecks.length + crossPageChecks.length);
  });

  it("与 runAudit 健康分的 executedCheckIds 口径一致", () => {
    // runAudit：quick = perPageChecks；full = perPage + crossPage
    const quickRunAudit = new Set(perPageChecks.map((c) => c.id));
    const fullRunAudit = new Set([
      ...perPageChecks.map((c) => c.id),
      ...crossPageChecks.map((c) => c.id),
    ]);
    expect([...getExecutedCheckIds("quick")].sort()).toEqual([...quickRunAudit].sort());
    expect([...getExecutedCheckIds("full")].sort()).toEqual([...fullRunAudit].sort());
  });
});

describe("buildCoverageFromIssues：从 issues 重建检查项覆盖", () => {
  it("无 issue 时全部通过，总数 > 0（不再 0/0）", () => {
    for (const locale of ["en", "zh"] as const) {
      const coverage = buildCoverageFromIssues([], locale, "full");
      expect(coverage.length).toBe(allCheckMeta.length);
      expect(coverage.length).toBeGreaterThan(0);
      expect(coverage.every((c) => c.passed)).toBe(true);
    }
  });

  it("命中的检查项 passed=false，未命中 passed=true", () => {
    const coverage = buildCoverageFromIssues(
      ["missing-title", "duplicate-h1"],
      "zh",
      "full"
    );
    const missing = coverage.find((c) => c.id === "missing-title");
    const dup = coverage.find((c) => c.id === "duplicate-h1");
    const ok = coverage.find((c) => c.id === "missing-description");
    expect(missing?.passed).toBe(false);
    expect(dup?.passed).toBe(false);
    expect(ok?.passed).toBe(true);
  });

  it("quick depth 时跨页检查不进入覆盖（未执行不得计为通过）", () => {
    const coverage = buildCoverageFromIssues([], "zh", "quick");
    expect(coverage.length).toBe(perPageChecks.length);
    for (const c of coverage) {
      expect(crossPageCheckIds.has(c.id)).toBe(false);
    }
  });

  it("depth 未知（历史快照）时按全部检查项处理", () => {
    const coverage = buildCoverageFromIssues(["missing-title"], "en");
    expect(coverage.length).toBe(allCheckMeta.length);
    expect(coverage.find((c) => c.id === "missing-title")?.passed).toBe(false);
  });

  it("name 按 locale 输出", () => {
    const zh = buildCoverageFromIssues([], "zh", "full");
    const en = buildCoverageFromIssues([], "en", "full");
    const zhTitle = zh.find((c) => c.id === "missing-title")!.name;
    const enTitle = en.find((c) => c.id === "missing-title")!.name;
    expect(zhTitle).toBe("缺失标题");
    expect(enTitle).toBe("Missing title");
  });

  it("coverage 通过数与 failed 检查项互补：passed + failed = total", () => {
    const issueIds = ["missing-title", "duplicate-h1", "no-h2-h3"];
    const coverage = buildCoverageFromIssues(issueIds, "zh", "full");
    const passed = coverage.filter((c) => c.passed).length;
    const failed = coverage.filter((c) => !c.passed).length;
    expect(passed + failed).toBe(allCheckMeta.length);
    expect(failed).toBe(3);
  });
});

describe("coverage 与健康分口径一致性", () => {
  it("同一组 issues 下：coverage.failed = 健康分扣分的检查项集合", () => {
    const issueIds = ["missing-title", "duplicate-title", "duplicate-h1"];
    const issues = issueIds.map(makeIssue);
    const executed = getExecutedCheckIds("full");

    // 健康分：只统计 executed 内命中的权重
    const hitInExecuted = issues.filter((i) => executed.has(i.checkId));
    const hitIds = new Set(hitInExecuted.map((i) => i.checkId));

    const coverage = buildCoverageFromIssues(issueIds, "zh", "full");
    const failedIds = new Set(coverage.filter((c) => !c.passed).map((c) => c.id));

    expect([...hitIds].sort()).toEqual([...failedIds].sort());

    // 分数计算不因 coverage 重建而改变
    const score = calculateHealthScore(issues, executed);
    const totalWeight = allCheckMeta
      .filter((m) => executed.has(m.id))
      .reduce((s, m) => s + m.weight, 0);
    const hitWeight = allCheckMeta
      .filter((m) => failedIds.has(m.id))
      .reduce((s, m) => s + m.weight, 0);
    expect(score).toBe(Math.round(100 - (hitWeight / totalWeight) * 100));
  });

  it("quick 模式：跨页 issue 不影响健康分与 coverage（未执行）", () => {
    const issues = [makeIssue("duplicate-title")];
    const executed = getExecutedCheckIds("quick");
    const score = calculateHealthScore(issues, executed);
    // duplicate-title 不在 quick 执行范围 → 不扣分
    expect(score).toBe(100);

    const coverage = buildCoverageFromIssues(["duplicate-title"], "zh", "quick");
    expect(coverage.every((c) => c.passed)).toBe(true);
  });
});
