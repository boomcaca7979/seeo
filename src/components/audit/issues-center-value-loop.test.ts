// ===== 首次价值闭环：审计结果页「先做这一件事」接线回归（源级断言，本仓库页面测试惯例）=====
// 验证四处接线不被回退：
//   1. IssuesCenter 只从唯一来源 issue-priority.ts 取优先级算法（不允许第二套评分）
//   2. 判断卡（data-testid=audit-top-action）只使用真实快照 + 完整清单保留
//   3. 并列时如实说明（tieHint），不冒充唯一答案
//   4. Issue Detail 有「为什么先处理它」与「SeeO 如何验证」两个真实内容区块

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ISSUES_CENTER_SRC = readFileSync(
  fileURLToPath(new URL("./IssuesCenter.tsx", import.meta.url)),
  "utf-8"
);
const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../messages/zh.json", import.meta.url)), "utf-8"));

const VALUE_KEYS = [
  "doFirstTitle", "doFirstSub", "whyNowTitle", "whyNowSub", "evidenceTitle",
  "topActionOpenCta", "tieHint", "verifyBodyTop", "verifyTitle", "verifySub", "verifyBody",
] as const;

describe("审计结果页「先做这一件事」接线", () => {
  it("优先级算法唯一来源：IssuesCenter 从 issue-priority 导入 selectTopIssue/explainTechnicalPriority，禁止内联第二套评分", () => {
    expect(ISSUES_CENTER_SRC).toContain('from "@/lib/seo/issue-priority"');
    expect(ISSUES_CENTER_SRC).toContain("selectTopIssue(snapshot.rules)");
    // 不允许在组件内重新实现打分（历史 priorityOf/prioritySortKey 仅做排序辅助，不算评分）
    expect(ISSUES_CENTER_SRC).not.toMatch(/function explainTechnicalPriority/);
  });

  it("判断卡渲染 WHAT/WHY/EVIDENCE/ACTION/VERIFY 且保留完整清单（SectionCard 仍在）", () => {
    expect(ISSUES_CENTER_SRC).toContain('data-testid="audit-top-action"');
    expect(ISSUES_CENTER_SRC).toContain('t("doFirstTitle")');
    expect(ISSUES_CENTER_SRC).toContain('t("whyNowTitle")');
    expect(ISSUES_CENTER_SRC).toContain('t("evidenceTitle")');
    expect(ISSUES_CENTER_SRC).toContain('t("topActionOpenCta")');
    expect(ISSUES_CENTER_SRC).toContain('t("verifyBodyTop")');
    // 完整问题清单不能被判断卡替换
    expect(ISSUES_CENTER_SRC).toContain('t("issuesTitle")');
  });

  it("数据不足以唯一区分时如实说明并列（tieHint 渲染，en/zh 文案齐备）", () => {
    expect(ISSUES_CENTER_SRC).toContain('t("tieHint"');
    for (const k of VALUE_KEYS) {
      expect(typeof EN.dashboard.audit[k], `en.${k}`).toBe("string");
      expect(typeof ZH.dashboard.audit[k], `zh.${k}`).toBe("string");
      expect(EN.dashboard.audit[k].length).toBeGreaterThan(0);
      expect(ZH.dashboard.audit[k].length).toBeGreaterThan(0);
    }
  });

  it("Issue Detail 接入「为什么先处理它」（同一算法）与「SeeO 如何验证」（真实再审计语义）", () => {
    expect(ISSUES_CENTER_SRC).toContain("explainTechnicalPriority({");
    expect(ISSUES_CENTER_SRC).toContain('t("verifyTitle")');
    expect(ISSUES_CENTER_SRC).toContain('t("verifyBody")');
    // 诚实边界文案必须出现：未检测 ≠ 已修复
    expect(EN.dashboard.audit.verifyBody).toContain("inconclusive");
    expect(ZH.dashboard.audit.verifyBody).toContain("无法判断");
  });

  it("判断卡只对无 issue 参数的列表视图出现（点进 Detail 后不重复占据首屏）", () => {
    expect(ISSUES_CENTER_SRC).toMatch(/topSelection && !issue/);
  });
});
