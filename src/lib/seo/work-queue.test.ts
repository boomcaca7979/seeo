// ===== Action Center 核心逻辑测试（纯函数，无 DB / 无网络）=====
// 覆盖产品承诺中最关键的三点：
//   1. 优先级必须**可解释**（给出理由列表，不是只给一个标签）
//   2. 标记完成 ≠ 已验证解决（只有再审计证据能判定 pass；未执行该规则必须 inconclusive）
//   3. 机会状态 → 统一状态词表的投影不能把"未验证"误判为"已验证"

import { describe, it, expect } from "vitest";
import {
  explainTechnicalPriority,
  evaluateRuleVerification,
  projectOpportunityStatus,
  projectOpportunityPriority,
  parseVerifyDetail,
} from "./work-queue";

describe("优先级可解释（severity + 影响范围 + 分数影响 + 问题模式 + 修复成本 + 证据）", () => {
  it("错误级 + 覆盖面≥50% + 高分数影响 + 模板级 → P0，并给出全部理由码", () => {
    const { priority, effort } = explainTechnicalPriority({
      severity: "error",
      affectedRatio: 0.8,
      scoreImpact: 10,
      pattern: "site-wide",
      pageLevel: "site",
    });
    expect(priority.level).toBe("P0");
    const codes = priority.reasons.map((r) => r.code);
    expect(codes).toContain("severity_error");
    expect(codes).toContain("reach_high");
    expect(codes).toContain("impact_high");
    expect(codes).toContain("pattern_site_wide");
    expect(codes).toContain("effort_low");
    // 证据可靠性必须显式声明（自研爬虫直接观测）
    expect(codes).toContain("evidence_direct_crawl");
    // 理由必须带数值，UI 才能渲染 "影响 80% 的可索引页面"
    expect(priority.reasons.find((r) => r.code === "reach_high")?.value).toBe(80);
    expect(effort).toBe("low");
  });

  it("提示级 + 无覆盖面 + 无分数影响 + 分散 → P2，修复成本中等", () => {
    const { priority, effort } = explainTechnicalPriority({
      severity: "notice",
      affectedRatio: 0,
      scoreImpact: 0,
      pattern: null,
      pageLevel: "page",
    });
    expect(priority.level).toBe("P2");
    expect(effort).toBe("medium");
    const codes = priority.reasons.map((r) => r.code);
    expect(codes).toContain("severity_notice");
    expect(codes).toContain("effort_medium");
    expect(codes).not.toContain("reach_high");
  });

  it("同级内单调：高覆盖面得分必须高于低覆盖面", () => {
    const high = explainTechnicalPriority({
      severity: "warning",
      affectedRatio: 0.9,
      scoreImpact: 6,
      pattern: "repeated",
      pageLevel: "page",
    });
    const low = explainTechnicalPriority({
      severity: "warning",
      affectedRatio: 0.05,
      scoreImpact: 0,
      pattern: null,
      pageLevel: "page",
    });
    expect(high.priority.score).toBeGreaterThan(low.priority.score);
  });

  it("每个等级都必须至少给出 2 条理由（禁止只给标签）", () => {
    for (const severity of ["error", "warning", "notice"] as const) {
      const { priority } = explainTechnicalPriority({
        severity,
        affectedRatio: 0.1,
        scoreImpact: 1,
        pattern: null,
        pageLevel: "page",
      });
      expect(priority.reasons.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("校验判定：只有再审计证据能判定「已验证解决」", () => {
  it("最新审计仍 fail → 判定 fail 并给出检出数字（保持 fixed_claimed）", () => {
    const r = evaluateRuleVerification({ currentStatus: "fail", findings: 3, affectedPages: 2, auditId: 12 });
    expect(r.status).toBe("fail");
    expect(r.findings).toBe(3);
    expect(r.affectedPages).toBe(2);
  });

  it("最新审计已 pass → 判定 pass（可推进 verified_resolved）", () => {
    const r = evaluateRuleVerification({ currentStatus: "pass", findings: 0, affectedPages: 0, auditId: 12 });
    expect(r.status).toBe("pass");
  });

  it("最新审计未执行该规则（null）→ inconclusive，绝不当成已解决", () => {
    const r = evaluateRuleVerification({ currentStatus: null, findings: 0, affectedPages: 0, auditId: 12 });
    expect(r.status).toBe("inconclusive");
    expect(r.status).not.toBe("pass");
  });
});

describe("机会状态 → 统一状态词表投影", () => {
  const passChecks = JSON.stringify([{ check: "rank", status: "pass", checkedAt: "2026-10-14T00:00:00Z" }]);
  const pendingChecks = JSON.stringify([{ check: "gsc", status: "pending", checkedAt: null }]);

  it("new → open；approved/in_progress → in_progress", () => {
    expect(projectOpportunityStatus("new", null)).toBe("open");
    expect(projectOpportunityStatus("approved", null)).toBe("in_progress");
    expect(projectOpportunityStatus("in_progress", null)).toBe("in_progress");
  });

  it("completed 且校验 pass → verified_resolved", () => {
    expect(projectOpportunityStatus("completed", passChecks)).toBe("verified_resolved");
  });

  it("completed 但校验未通过/未校验 → fixed_claimed（不得冒充已验证）", () => {
    expect(projectOpportunityStatus("completed", pendingChecks)).toBe("fixed_claimed");
    expect(projectOpportunityStatus("completed", null)).toBe("fixed_claimed");
  });

  it("dismissed → dismissed；损坏的 verification JSON 不抛错", () => {
    expect(projectOpportunityStatus("dismissed", null)).toBe("dismissed");
    expect(projectOpportunityStatus("completed", "{not json")).toBe("fixed_claimed");
  });

  it("机会优先级映射保持 P0/P1/P2 语义", () => {
    expect(projectOpportunityPriority("P0").level).toBe("P0");
    expect(projectOpportunityPriority("P1").level).toBe("P1");
    expect(projectOpportunityPriority("P2").level).toBe("P2");
    expect(projectOpportunityPriority("weird").level).toBe("P2");
  });
});

describe("verify_detail 解析容错", () => {
  it("合法 JSON → 解析出 findings/affectedPages/auditId/depth", () => {
    const d = parseVerifyDetail(JSON.stringify({ auditId: 9, depth: "full", findings: 4, affectedPages: 3 }));
    expect(d).toEqual({ auditId: 9, depth: "full", findings: 4, affectedPages: 3 });
  });

  it("null / 非法 JSON → 全部 null，不抛错", () => {
    expect(parseVerifyDetail(null)).toEqual({ auditId: null, depth: null, findings: null, affectedPages: null });
    expect(parseVerifyDetail("oops")).toEqual({ auditId: null, depth: null, findings: null, affectedPages: null });
  });
});
