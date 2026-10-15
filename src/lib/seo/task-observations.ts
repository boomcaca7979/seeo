// ===== 结果反馈闭环：基线捕获与后续观测 =====
//
// 产品承诺：不把"用户点了完成"当成效果已经产生；也不在排名/流量没变化时草率断定"无效"。
//   基线   = 用户开始处理那一刻的真实指标（不可事后编造，永不被覆盖）
//   观测   = 后续真实数据（再审计 / 排名历史）
//   判定   = improved / unchanged / worse / **indeterminate**（数据不足时明确说"无法判断"）
//
// 可验证性边界（如实实现，不假装）：
//   技术问题  → 可由再次审计验证（已有检测引擎）
//   排名类机会 → 可由排名历史验证（需该关键词已被追踪且已有历史）
//   内容/竞品/AI 引用 → 当前无可靠的自动验证通道 → indeterminate + 原因

import type { DashboardSnapshot } from "./audit-dashboard";
import { getLatestAudit } from "@/lib/db/audits";
import { getOpportunityById } from "@/lib/db/opportunities";
import { listTrackedKeywords } from "@/lib/db/keywords";
import { getRankHistory } from "@/lib/db/rankings";
import {
  captureBaseline,
  recordObservation,
  listObservableTasks,
  type ObservationMetrics,
  type ObservationVerdict,
} from "@/lib/db/task-observations";

/** 与 queue 的任务 id 约定保持一致 */
export function auditTaskId(ruleId: string): string {
  return `audit:${ruleId}`;
}
export function opportunityTaskId(id: number): string {
  return `opp:${id}`;
}

// ---------- 纯函数：判定（可测试、可解释） ----------

/** 审计类：findings / affectedPages 越少越好（null = 本次审计未执行该规则 → 无法判断） */
export function computeAuditOutcome(
  baseline: ObservationMetrics | null,
  latest: ObservationMetrics | null
): { verdict: ObservationVerdict; reason: string } {
  if (!baseline || !latest) return { verdict: "indeterminate", reason: "missing_metrics" };
  const bFind = baseline.findings ?? null;
  const lFind = latest.findings ?? null;
  if (bFind === null || lFind === null) return { verdict: "indeterminate", reason: "rule_not_executed" };
  if (lFind < bFind) return { verdict: "improved", reason: "findings_decreased" };
  if (lFind > bFind) return { verdict: "worse", reason: "findings_increased" };
  return { verdict: "unchanged", reason: "findings_same" };
}

/** 排名类：position 越小越好；null = 未进入榜单 */
export function computeRankOutcome(
  baseline: ObservationMetrics | null,
  latest: ObservationMetrics | null
): { verdict: ObservationVerdict; reason: string } {
  if (!baseline || !latest) return { verdict: "indeterminate", reason: "missing_metrics" };
  const b = baseline.position ?? null;
  const l = latest.position ?? null;
  if (b === null && l === null) return { verdict: "indeterminate", reason: "not_ranking_both" };
  if (b === null && l !== null) return { verdict: "improved", reason: "entered_rankings" };
  if (b !== null && l === null) return { verdict: "worse", reason: "lost_ranking" };
  if ((l as number) < (b as number)) return { verdict: "improved", reason: "position_up" };
  if ((l as number) > (b as number)) return { verdict: "worse", reason: "position_down" };
  return { verdict: "unchanged", reason: "position_same" };
}

// ---------- 基线捕获 ----------

/** 技术问题基线：来自最近一次已完成审计的该规则指标 */
export async function captureAuditTaskBaseline(
  userId: string,
  domain: string,
  ruleId: string
): Promise<boolean> {
  const audit = await getLatestAudit(userId, domain);
  if (!audit?.dashboard_json) return false;
  let snapshot: DashboardSnapshot;
  try {
    snapshot = JSON.parse(audit.dashboard_json) as DashboardSnapshot;
  } catch {
    return false;
  }
  const rule = snapshot.rules.find((r) => r.ruleId === ruleId);
  if (!rule) return false;
  return captureBaseline({
    userId,
    domain,
    taskId: auditTaskId(ruleId),
    taskSource: "audit",
    kind: "audit",
    metrics: {
      findings: rule.findings,
      affectedPages: rule.affectedPages,
      healthScore: snapshot.score ?? audit.health_score ?? null,
    },
  });
}

/**
 * 排名类机会基线：仅当该机会的目标关键词确实被追踪且已有排名历史时才捕获。
 * 否则返回 false（不伪造基线）。
 */
export async function captureOpportunityBaseline(
  userId: string,
  domain: string,
  opportunityId: number
): Promise<boolean> {
  const opp = await getOpportunityById(userId, opportunityId);
  if (!opp || opp.target_type !== "keyword") return false;
  const keyword = opp.target_value;
  const tracked = await listTrackedKeywords(userId).catch(() => []);
  const match = tracked.find((k) => k.keyword === keyword && k.domain === domain);
  if (!match) return false;
  const history = await getRankHistory(userId, match.id, 30).catch(() => []);
  if (history.length === 0) return false;
  const latest = [...history].sort((a, b) => String(a.date).localeCompare(String(b.date))).pop();
  return captureBaseline({
    userId,
    domain,
    taskId: opportunityTaskId(opportunityId),
    taskSource: "opportunity",
    kind: "rank",
    metrics: { position: latest?.position ?? null, historyDays: history.length },
  });
}

// ---------- 后续观测（排名刷新后） ----------

/**
 * 排名刷新后对相关任务做真实观测——闭环的"执行后验证"一步。
 *
 * 背景：排名类机会声称可由排名历史验证（channel_rank），但此前观测只在再审计后
 * 触发（observeAfterAudit 借审计调度）。用户在 Position Tracking 刷新排名后，
 * 观测永远 pending——执行到验证的链路断在最后一步。
 *
 * 语义与 observeAfterAudit 的 rank 分支一致：相同目标（关键词）、相同指标
 * （position）、相同窗口（30 天历史）；本次观测用**刚写入的真实排名**。
 * 只对已有基线的任务写观测（recordObservation 仅作用于已有行，天然幂等）。
 *
 * @returns 更新了观测的任务数
 */
export async function observeRankForRefresh(
  userId: string,
  domain: string,
  keyword: string,
  position: number | null
): Promise<number> {
  const rows = await listObservableTasks(userId, domain).catch(() => []);
  let updated = 0;
  for (const row of rows) {
    if (row.kind !== "rank") continue;
    const oppId = Number(row.task_id.replace("opp:", ""));
    const opp = Number.isInteger(oppId) ? await getOpportunityById(userId, oppId).catch(() => null) : null;
    if (!opp || opp.target_value !== keyword) continue;
    const baseline = JSON.parse(row.baseline_json ?? "null") as ObservationMetrics | null;
    const outcome = computeRankOutcome(baseline, { position: position ?? null });
    await recordObservation({
      userId,
      domain,
      taskId: row.task_id,
      metrics: { position: position ?? null },
      verdict: outcome.verdict,
      windowDays: 30,
      note: outcome.reason,
    });
    updated++;
  }
  return updated;
}

// ---------- 后续观测（审计完成后） ----------

export interface ObserveSummary {
  observed: number;
  improved: number;
  unchanged: number;
  worse: number;
  indeterminate: number;
}

export const EMPTY_OBSERVE_SUMMARY: ObserveSummary = {
  observed: 0,
  improved: 0,
  unchanged: 0,
  worse: 0,
  indeterminate: 0,
};

/**
 * 审计完成后对已有基线的任务做一次真实观测。
 * - audit 类：用本次快照的规则指标比对
 * - rank 类：用该关键词的最新排名历史比对（与审计无关，但借同一次调度刷新）
 * 任何失败都不得影响审计结果（调用方负责 try/catch）。
 */
export async function observeAfterAudit(
  userId: string,
  domain: string,
  snapshot: DashboardSnapshot
): Promise<ObserveSummary> {
  const rows = await listObservableTasks(userId, domain);
  const summary: ObserveSummary = { ...EMPTY_OBSERVE_SUMMARY };
  const tracked = rows.some((r) => r.kind === "rank")
    ? await listTrackedKeywords(userId).catch(() => [])
    : [];

  for (const row of rows) {
    let metrics: ObservationMetrics | null = null;
    let outcome: { verdict: ObservationVerdict; reason: string } | null = null;

    if (row.kind === "audit") {
      const ruleId = row.task_id.startsWith("audit:") ? row.task_id.slice(6) : row.task_id;
      const rule = snapshot.rules.find((r) => r.ruleId === ruleId) ?? null;
      const baseline = JSON.parse(row.baseline_json ?? "null") as ObservationMetrics | null;
      // 规则本次未执行 → findings 记 null → 判定为 indeterminate（不硬判）
      metrics = {
        findings: rule ? rule.findings : null,
        affectedPages: rule ? rule.affectedPages : null,
      };
      outcome = computeAuditOutcome(baseline, metrics);
    } else if (row.kind === "rank") {
      const oppId = Number(row.task_id.replace("opp:", ""));
      const opp = Number.isInteger(oppId) ? await getOpportunityById(userId, oppId).catch(() => null) : null;
      const keyword = opp?.target_value ?? null;
      const match = keyword ? tracked.find((k) => k.keyword === keyword && k.domain === domain) : null;
      if (!match) {
        metrics = { position: null };
        outcome = { verdict: "indeterminate", reason: "keyword_not_tracked" };
      } else {
        const history = await getRankHistory(userId, match.id, 30).catch(() => []);
        const latest = [...history].sort((a, b) => String(a.date).localeCompare(String(b.date))).pop();
        metrics = { position: latest?.position ?? null };
        const baseline = JSON.parse(row.baseline_json ?? "null") as ObservationMetrics | null;
        outcome = computeRankOutcome(baseline, metrics);
      }
    } else {
      // content / competitor / ai → 当前无可靠自动验证通道
      metrics = {};
      outcome = { verdict: "indeterminate", reason: "no_verification_channel" };
    }

    if (!outcome) continue;
    await recordObservation({
      userId,
      domain,
      taskId: row.task_id,
      metrics: metrics ?? {},
      verdict: outcome.verdict,
      windowDays: 30,
      note: outcome.reason,
    });
    summary.observed++;
    if (outcome.verdict === "improved") summary.improved++;
    else if (outcome.verdict === "unchanged") summary.unchanged++;
    else if (outcome.verdict === "worse") summary.worse++;
    else summary.indeterminate++;
  }

  return summary;
}

/** 可验证性声明（UI 必须如实显示，不能承诺无法验证的效果） */
export function verificationChannelFor(kind: string): {
  verifiable: boolean;
  channelKey: string;
} {
  if (kind === "audit") return { verifiable: true, channelKey: "channel_audit" };
  if (kind === "rank") return { verifiable: true, channelKey: "channel_rank" };
  return { verifiable: false, channelKey: "channel_none" };
}
