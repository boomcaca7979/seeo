// ===== 第二阶段核心逻辑测试：执行入口映射 / 效果判定边界 / 机会优先级可解释性 =====
// 只测"核心数据链路与状态边界"，不追求数量：
//   1. 每个任务都必须给出**真实存在**的执行入口；没有入口时必须带原因（禁止空按钮）
//   2. "效果判定"必须在数据不足时明确 indeterminate，不得硬判有效/无效
//   3. 机会优先级必须可解释，且无证据/过期数据必须被降权

import { describe, it, expect } from "vitest";
import { applyResultFeedback, executionFor, explainOpportunityPriority, opportunityVerificationKind, valueCategoryFor, withOpportunityContext } from "./work-queue";
import { evaluateLostRecovery, evaluateContentCheck, daysAgoLabel } from "./opportunity-service";
import { computeAuditOutcome, computeRankOutcome, verificationChannelFor } from "./task-observations";

describe("A. 执行入口映射：必须指向真实功能，否则如实说明", () => {
  it("技术问题 → 审计页的具体问题深链（带 domain / view / issue）", () => {
    const ex = executionFor({ source: "audit", type: "missing-h1", target: "https://x.test/", domain: "x.test" });
    expect(ex.available).toBe(true);
    expect(ex.kind).toBe("audit_fix");
    expect(ex.primary?.href).toBe("/app/audit?domain=x.test&view=issues&issue=missing-h1");
    expect(ex.primary?.module).toBe("audit");
  });

  it("排名类机会 → 关键词研究深链（带 keyword），并附排名追踪入口", () => {
    for (const type of ["rank_improvement", "lost_recovery", "ctr"]) {
      const ex = executionFor({ source: "opportunity", type, target: "seo tools", domain: "x.test" });
      expect(ex.available, type).toBe(true);
      expect(ex.primary?.href).toBe("/app/keyword-overview?keyword=seo%20tools");
      expect(ex.secondary.some((s) => s.href.startsWith("/app/position-tracking?keyword="))).toBe(true);
    }
  });

  it("内容机会 → 内容优化深链（带 url / domain）", () => {
    const ex = executionFor({
      source: "opportunity",
      type: "content_refresh",
      target: "https://x.test/blog/post",
      domain: "x.test",
    });
    expect(ex.primary?.href).toBe("/app/content?url=https%3A%2F%2Fx.test%2Fblog%2Fpost&domain=x.test");
    expect(ex.primary?.module).toBe("content");
  });

  it("竞品差距 → 竞品页 + 关键词研究作为第二步", () => {
    const ex = executionFor({ source: "opportunity", type: "competitor_gap", target: "crm software", domain: "x.test" });
    expect(ex.primary?.href).toBe("/app/competitors");
    expect(ex.secondary[0]?.href).toBe("/app/keyword-overview?keyword=crm%20software");
  });

  it("无执行界面的机会类型 → available=false 且**必须**给出原因（不得给空按钮）", () => {
    const ex = executionFor({ source: "opportunity", type: "ai_visibility", target: "brand", domain: "x.test" });
    expect(ex.available).toBe(false);
    expect(ex.primary).toBeNull();
    expect(ex.unavailableReason).toBe("reason_no_execution_surface");
  });

  it("不变式：available=true 时 primary 必须存在（不允许「可用但没有入口」）", () => {
    const cases = [
      { source: "audit" as const, type: "missing-h1", target: "https://x.test/", domain: "x.test" },
      { source: "opportunity" as const, type: "rank_improvement", target: "kw", domain: "x.test" },
      { source: "opportunity" as const, type: "unknown_type", target: "kw", domain: "x.test" },
    ];
    for (const c of cases) {
      const ex = executionFor(c);
      if (ex.available) expect(ex.primary).not.toBeNull();
      else expect(ex.unavailableReason).not.toBeNull();
    }
  });
});

describe("B. 效果判定边界：数据不足必须 indeterminate", () => {
  it("技术问题：检出数下降 → improved；上升 → worse；持平 → unchanged", () => {
    expect(computeAuditOutcome({ findings: 3 }, { findings: 1 }).verdict).toBe("improved");
    expect(computeAuditOutcome({ findings: 1 }, { findings: 3 }).verdict).toBe("worse");
    expect(computeAuditOutcome({ findings: 2 }, { findings: 2 }).verdict).toBe("unchanged");
  });

  it("技术问题：最新审计未执行该规则（findings=null）→ indeterminate，不得判为已改善", () => {
    const r = computeAuditOutcome({ findings: 3 }, { findings: null });
    expect(r.verdict).toBe("indeterminate");
    expect(r.reason).toBe("rule_not_executed");
  });

  it("排名：上升 → improved；下跌 → worse；新上榜 → improved；跌出榜 → worse", () => {
    expect(computeRankOutcome({ position: 12 }, { position: 8 }).verdict).toBe("improved");
    expect(computeRankOutcome({ position: 8 }, { position: 12 }).verdict).toBe("worse");
    expect(computeRankOutcome({ position: null }, { position: 5 }).verdict).toBe("improved");
    expect(computeRankOutcome({ position: 5 }, { position: null }).verdict).toBe("worse");
    expect(computeRankOutcome({ position: 5 }, { position: 5 }).verdict).toBe("unchanged");
  });

  it("排名：两次都不在榜 / 缺指标 → indeterminate（不把「没变化」当「无效」）", () => {
    expect(computeRankOutcome({ position: null }, { position: null }).verdict).toBe("indeterminate");
    expect(computeRankOutcome(null, { position: 3 }).verdict).toBe("indeterminate");
  });

  it("可验证通道声明：审计与排名可验证；内容/竞品/AI 明确不可自动验证", () => {
    expect(verificationChannelFor("audit").verifiable).toBe(true);
    expect(verificationChannelFor("rank").verifiable).toBe(true);
    expect(verificationChannelFor("content_refresh").verifiable).toBe(false);
    expect(verificationChannelFor("competitor_gap").verifiable).toBe(false);
  });
});

describe("C. 机会优先级：可解释 + 无证据/过期降权", () => {
  const base = {
    priority: "P1",
    confidence: "medium",
    generatedAt: new Date().toISOString(),
    lastEvaluatedAt: new Date().toISOString(),
    type: "rank_improvement",
  };

  it("有证据 + 高可信 + 数据新鲜 → 分数高于无证据/过期", () => {
    const good = explainOpportunityPriority({ ...base, evidenceCount: 2, confidence: "high" });
    const noEvidence = explainOpportunityPriority({ ...base, evidenceCount: 0 });
    expect(good.score).toBeGreaterThan(noEvidence.score);
    expect(good.reasons.map((r) => r.code)).toContain("evidence_linked");
    expect(noEvidence.reasons.map((r) => r.code)).toContain("evidence_missing");
  });

  it("数据过期（>30 天）→ 扣分并给出 stale_data 理由", () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const stale = explainOpportunityPriority({ ...base, evidenceCount: 1, lastEvaluatedAt: old });
    expect(stale.reasons.map((r) => r.code)).toContain("stale_data");
  });

  it("回归：SQLite 空格格式时间戳（datetime('now')）必须可解析 → recent_data，不得静默失效", () => {
    // 真实 seo_opportunities.last_evaluated_at 形态；旧逻辑拼 "Z" 后按 NaN 处理（跳过新鲜度判断）
    const sqliteFormat = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    const r = explainOpportunityPriority({ ...base, evidenceCount: 1, lastEvaluatedAt: sqliteFormat });
    expect(r.reasons.map((x) => x.code)).toContain("recent_data");
    expect(r.reasons.map((x) => x.code)).not.toContain("unknown_data_age");
  });

  it("回归：时间戳无法解析 → unknown_data_age 明确降权，不得当作新鲜数据", () => {
    const good = explainOpportunityPriority({ ...base, evidenceCount: 1 });
    const unknown = explainOpportunityPriority({ ...base, evidenceCount: 1, lastEvaluatedAt: "not-a-date" });
    expect(unknown.reasons.map((r) => r.code)).toContain("unknown_data_age");
    expect(unknown.reasons.map((r) => r.code)).not.toContain("recent_data");
    expect(unknown.score).toBeLessThan(good.score);
  });

  it("每条优先级都必须说明是否可用数据验证", () => {
    const r = explainOpportunityPriority({ ...base, evidenceCount: 1 });
    const codes = r.reasons.map((x) => x.code);
    expect(codes.some((c) => c === "verifiable_by_data" || c === "not_auto_verifiable")).toBe(true);
  });

  it("一致性回归：优先级里的可验证性声明必须与任务的验证通道**同源**（曾出现 rank 机会被标成 not_auto_verifiable）", () => {
    for (const type of [
      "rank_improvement",
      "lost_recovery",
      "ctr",
      "content_refresh",
      "competitor_gap",
      "ai_visibility",
      "technical",
    ]) {
      const p = explainOpportunityPriority({ ...base, type, evidenceCount: 1 });
      const channel = verificationChannelFor(opportunityVerificationKind(type));
      const codes = p.reasons.map((r) => r.code);
      expect(codes, type).toContain(channel.verifiable ? "verifiable_by_data" : "not_auto_verifiable");
    }
  });
});

// ---------------------------------------------------------------------------
// D. 稀疏真实排名数据（生产数据里 position 多为 null = 未进前 100）
//    —— 旧实现只比较"最后两行"，导致"曾达 #1、现已跌出榜单"的真实机会被完全漏掉。
// ---------------------------------------------------------------------------
describe("D. 稀疏排名：曾进榜但当前未进 → 必须产生恢复机会", () => {
  const base = {
    keywordId: 1,
    keyword: "sample kw",
    location: "中国",
    device: "PC",
    currentUrl: null,
    previousUrl: null,
  };

  it("相邻两行都无排名，但窗口内曾达 #1 → lost_recovery P0（旧实现漏报）", () => {
    const c = evaluateLostRecovery({
      ...base,
      currentRank: null,
      previousRank: null,
      bestRankInWindow: 1,
      lastRankedDate: "2026-09-28",
      windowRows: 13,
      rankedRows: 1,
    });
    expect(c).not.toBeNull();
    expect(c!.type).toBe("lost_recovery");
    expect(c!.priority).toBe("P0");
    expect(c!.evidence[0].summary).toContain("#1");
  });

  it("窗口内从未进榜 → 不产生机会（不伪造）", () => {
    const c = evaluateLostRecovery({
      ...base,
      currentRank: null,
      previousRank: null,
      bestRankInWindow: null,
      windowRows: 17,
      rankedRows: 0,
    });
    expect(c).toBeNull();
  });

  it("当前仍有排名 → 不属于恢复机会；旧字段缺失时也不误报", () => {
    expect(evaluateLostRecovery({ ...base, currentRank: 5, previousRank: 3 })).toBeNull();
    // 兼容：老调用方未提供窗口字段（undefined）时，无证据即不产生机会
    expect(evaluateLostRecovery({ ...base, currentRank: null, previousRank: null })).toBeNull();
  });
});

describe("E. 内容机会：过期或达标的结果不产生机会", () => {
  it("30 天内低分 → 产生机会；得分达标 → 不产生", () => {
    const fresh = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    expect(evaluateContentCheck({ url: "https://x.test/a", keyword: "kw", score: 43, createdAt: fresh })).not.toBeNull();
    expect(evaluateContentCheck({ url: "https://x.test/a", keyword: "kw", score: 88, createdAt: fresh })).toBeNull();
  });

  // BUG-22：证据摘要恒为英文（审计侧走 pickText(..., "en")），所以天数也要按英文单复数，
  // 否则英文界面直接出现 "1 days ago" 这种可见语病。
  it("1 天前的证据写作 \"1 day ago\"，不出现 \"1 days ago\"", () => {
    const oneDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    const c = evaluateContentCheck({ url: "https://x.test/a", keyword: "kw", score: 43, createdAt: oneDay });
    expect(c).not.toBeNull();
    expect(c!.evidence[0].summary).toContain("(1 day ago)");
    expect(c!.evidence[0].summary).not.toContain("1 days ago");
  });

  it("daysAgoLabel：仅 1 用单数（0 / 多位数保持复数）", () => {
    expect(daysAgoLabel(1)).toBe("1 day ago");
    expect(daysAgoLabel(0)).toBe("0 days ago");
    expect(daysAgoLabel(3)).toBe("3 days ago");
  });

  it("超过 30 天的旧结果 → 不作为机会依据（避免用过时结果指导改动）", () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    expect(evaluateContentCheck({ url: "https://x.test/a", keyword: "kw", score: 20, createdAt: old })).toBeNull();
  });
});

describe("F. 结果反馈：观测结论 → 优先级（observe → result → priority）", () => {
  function makeTask(verdict: string | null) {
    return {
      id: "audit:missing-h1",
      priority: { level: "P1" as const, score: 5, reasons: [{ code: "severity_error" }] },
      observation: verdict
        ? { verdict, baseline: { findings: 3 }, latest: { findings: 1 }, observations: 1 }
        : null,
    };
  }

  it("无观测 / pending → 不调整（不凭空产生结果反馈）", () => {
    for (const v of [null, "pending"]) {
      const t = makeTask(v);
      applyResultFeedback(t as never);
      expect(t.priority.level).toBe("P1");
      expect(t.priority.reasons.every((r) => !r.code.startsWith("result_"))).toBe(true);
    }
  });

  it("improved → 降一档（P1→P2），不再以原优先级催促重复执行", () => {
    const t = makeTask("improved");
    applyResultFeedback(t as never);
    expect(t.priority.level).toBe("P2");
    expect(t.priority.reasons.map((r) => r.code)).toContain("result_improved");
  });

  it("improved 已在最低档（P2）→ 保持 P2，不产生负档位", () => {
    const t = { ...makeTask("improved"), priority: { level: "P2" as const, score: 2, reasons: [] } };
    applyResultFeedback(t as never);
    expect(t.priority.level).toBe("P2");
  });

  it("worse → 升一档（P1→P0），变差需要尽快重新检查", () => {
    const t = makeTask("worse");
    applyResultFeedback(t as never);
    expect(t.priority.level).toBe("P0");
    expect(t.priority.reasons.map((r) => r.code)).toContain("result_worse");
  });

  it("unchanged / indeterminate → 保持档位，但理由如实标注（不冒成功也不冒失败）", () => {
    const u = makeTask("unchanged");
    applyResultFeedback(u as never);
    expect(u.priority.level).toBe("P1");
    expect(u.priority.reasons.map((r) => r.code)).toContain("result_unchanged");

    const i = makeTask("indeterminate");
    applyResultFeedback(i as never);
    expect(i.priority.level).toBe("P1");
    expect(i.priority.reasons.map((r) => r.code)).toContain("result_indeterminate");
  });
});

describe("G. 产品价值分层：增长机会与技术问题语义分离（纯派生，不落库、不影响排序）", () => {
  it("机会类型映射：lost_recovery→regain，rank/competitor/ctr→capture，content_refresh→improve", () => {
    expect(valueCategoryFor("opportunity", "lost_recovery")).toBe("regain");
    expect(valueCategoryFor("opportunity", "rank_improvement")).toBe("capture");
    expect(valueCategoryFor("opportunity", "competitor_gap")).toBe("capture");
    expect(valueCategoryFor("opportunity", "ctr")).toBe("capture");
    expect(valueCategoryFor("opportunity", "content_refresh")).toBe("improve");
  });

  it("技术问题绝不冒充增长机会：audit 来源与 opportunity.technical/ai_visibility 一律 issue", () => {
    // 没有明确搜索影响证据的技术问题，只标为 Technical Issue / Fix
    expect(valueCategoryFor("audit", "missing-h1")).toBe("issue");
    expect(valueCategoryFor("audit", "inline-css")).toBe("issue");
    expect(valueCategoryFor("opportunity", "technical")).toBe("issue");
    expect(valueCategoryFor("opportunity", "ai_visibility")).toBe("issue");
    expect(valueCategoryFor("opportunity", "unknown_type")).toBe("issue");
  });

  it("上下文随行：机会 CTA 深链追加 from/otype/otitle/otitlezh/oreason，原查询参数保留", () => {
    const href = withOpportunityContext("/app/keyword-overview?keyword=seo%20tools", {
      type: "lost_recovery",
      titleEn: "Recover rankings for \"seo tools\"",
      titleZh: "恢复「seo tools」的排名",
      reasonCode: "opportunity_engine",
    });
    expect(href).toContain("/app/keyword-overview");
    // URLSearchParams 把空格编码为 "+"（语义等价 %20，服务端/客户端解析结果一致）
    expect(href).toContain("keyword=seo+tools");
    expect(href).toContain("from=opportunity");
    expect(href).toContain("otype=lost_recovery");
    expect(href).toContain("oreason=opportunity_engine");
    // decodeURIComponent 不转换 "+"；URLSearchParams 语义里 "+" = 空格
    const decoded = decodeURIComponent(href).replace(/\+/g, " ");
    expect(decoded).toContain('Recover rankings for "seo tools"');
    expect(decoded).toContain("恢复「seo tools」的排名");
  });

  it("上下文随行：无 zh 标题时不写 otitlezh；非法输入原样返回（绝不断链）", () => {
    const href = withOpportunityContext("/app/content?url=https%3A%2F%2Fx.test%2Fa", {
      type: "content_refresh",
      titleEn: "Refresh https://x.test/a",
      titleZh: null,
      reasonCode: null,
    });
    expect(href).not.toContain("otitlezh");
    expect(href).not.toContain("oreason");
    expect(href).toContain("url=https%3A%2F%2Fx.test%2Fa");
  });
});
