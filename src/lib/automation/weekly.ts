// ===== 每周报告生成（共享逻辑） =====
// 汇总过去 7 天的排名变化、审计情况和关键词追踪概况

import {
  getRankChangesSince,
  getAuditsSince,
  countTrackedKeywords,
  countActiveKeywords,
} from "@/lib/db";

export interface WeeklyReportResult {
  summary: string;
  details: {
    rankChanges: { up: number; down: number; out: number; total: number };
    audit: { avgScore: number | null; count: number };
    keywords: { total: number; active: number };
    generatedAt: string;
  };
}

/** 生成指定用户的每周报告摘要 */
export async function generateWeeklyReport(userId: string): Promise<WeeklyReportResult> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceISO = oneWeekAgo.toISOString();

  // 1. 排名变化摘要
  const rankChanges = await getRankChangesSince(userId, sinceISO);
  // change = newRank - oldRank；负值 = 上升（数字变小）
  const up = rankChanges.filter((r) => r.change !== null && r.change < 0).length;
  const down = rankChanges.filter((r) => r.change !== null && r.change > 0).length;
  const out = rankChanges.filter((r) => r.newRank === null && r.oldRank !== null).length;

  // 2. 审计摘要（取最近一周）
  const recentAudits = await getAuditsSince(userId, sinceISO);
  const validScores = recentAudits.filter((a) => a.health_score !== null);
  const avgScore = validScores.length > 0
    ? Math.round(validScores.reduce((s, a) => s + (a.health_score ?? 0), 0) / validScores.length)
    : null;

  // 3. 关键词追踪概况
  const totalKeywords = await countTrackedKeywords(userId);
  const activeKeywords = await countActiveKeywords(userId);

  const summary = `排名上升 ${up} / 下降 ${down} / 跌出 ${out}；审计均分 ${avgScore ?? "N/A"}；追踪 ${activeKeywords}/${totalKeywords} 词`;

  return {
    summary,
    details: {
      rankChanges: { up, down, out, total: rankChanges.length },
      audit: { avgScore, count: recentAudits.length },
      keywords: { total: totalKeywords, active: activeKeywords },
      generatedAt: now.toISOString(),
    },
  };
}
