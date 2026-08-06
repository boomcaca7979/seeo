// ===== 审计历史对比 =====
// 对比当前审计与上一次审计的差异：新增问题 / 已修复 / 未变化

import type { AuditIssue } from "./audit-checks";

export interface AuditSnapshot {
  score: number;
  issues: AuditIssue[];
  checkedAt: string;
}

export interface AuditHistoryComparison {
  current: { score: number; issues: number; checkedAt: string };
  previous: { score: number; issues: number; checkedAt: string } | null;
  scoreChange: number; // 正 = 变好，负 = 变差
  issuesChange: number; // 正 = 新增问题，负 = 减少问题
  newIssues: AuditIssue[];
  resolvedIssues: AuditIssue[];
  unchangedIssues: AuditIssue[];
}

function issueKey(i: AuditIssue): string {
  return `${i.checkId}:${i.url}`;
}

export function compareAudits(
  current: AuditSnapshot,
  previous: AuditSnapshot | null
): AuditHistoryComparison {
  if (!previous) {
    return {
      current: { score: current.score, issues: current.issues.length, checkedAt: current.checkedAt },
      previous: null,
      scoreChange: 0,
      issuesChange: current.issues.length,
      newIssues: current.issues,
      resolvedIssues: [],
      unchangedIssues: [],
    };
  }

  const currentKeys = new Set(current.issues.map(issueKey));
  const previousKeys = new Set(previous.issues.map(issueKey));

  const newIssues = current.issues.filter((i) => !previousKeys.has(issueKey(i)));
  const resolvedIssues = previous.issues.filter((i) => !currentKeys.has(issueKey(i)));
  const unchangedIssues = current.issues.filter((i) => previousKeys.has(issueKey(i)));

  return {
    current: { score: current.score, issues: current.issues.length, checkedAt: current.checkedAt },
    previous: { score: previous.score, issues: previous.issues.length, checkedAt: previous.checkedAt },
    scoreChange: current.score - previous.score,
    issuesChange: current.issues.length - previous.issues.length,
    newIssues,
    resolvedIssues,
    unchangedIssues,
  };
}
