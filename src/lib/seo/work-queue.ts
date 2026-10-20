// ===== Action Center：统一工作队列 =====
//
// 目标（SeeO 产品承诺）：把"看到数据"变成"知道下一步做什么，并且能验证是否真的改善"。
//
// 设计原则：
//   1. **单一队列、单一状态词表** —— 审计技术问题与成长机会（seo_opportunities）
//      在 UI 上使用同一套状态：open / in_progress / fixed_claimed / verified_resolved / dismissed。
//      机会侧的状态由其既有状态机 + verification 投影而来（不新建第二套状态存储，避免互相矛盾）。
//   2. **优先级可解释** —— 不是只给一个 P0/P1/P2 标签，而是给出"为什么"：
//      严重度、受影响页面范围、分数影响、问题模式（模板级/重复）、修复成本、证据可靠性。
//   3. **标记完成 ≠ 已验证解决** —— verified_resolved 只能来自再次检测的证据。
//   4. **没有证据就不显示为发现** —— 缺少审计/排名/GSC 数据时返回 coverage 缺口，而不是填数。

import type { LocalizedText, RuleSeverity } from "@/lib/seo/audit-checks";
import { pickText } from "@/lib/seo/audit-checks";
import type { DashboardSnapshot } from "@/lib/seo/audit-dashboard";
import { getLatestAudit } from "@/lib/db/audits";
import { listTrackedKeywords } from "@/lib/db/keywords";
import { listOpportunities, type SeoOpportunityRow } from "@/lib/db/opportunities";
import {
  listResolutionsByDomain,
  type IssueResolutionStatus,
} from "@/lib/db/issue-resolutions";
import { listObservations, parseMetrics, type ObservationVerdict } from "@/lib/db/task-observations";
import { verificationChannelFor } from "./task-observations";
import { isDataForSeoConfigured } from "./dataforseo";
// 时间戳统一解析：SQLite `datetime('now')` 产出 "YYYY-MM-DD HH:MM:SS"（无时区标记），
// 手工拼 "Z" 是非 ISO 输入（严格解析器下为 NaN）→ 必须走 parseDbTimestamp（见 opportunity-service）。
import { parseDbTimestamp } from "./opportunity-service";

// ---------- 统一状态词表 ----------

export type UnifiedTaskStatus =
  | "open"
  | "in_progress"
  | "fixed_claimed"
  | "verified_resolved"
  | "dismissed";

export const UNIFIED_TASK_STATUSES: readonly UnifiedTaskStatus[] = [
  "open",
  "in_progress",
  "fixed_claimed",
  "verified_resolved",
  "dismissed",
] as const;

export type TaskSource = "audit" | "opportunity";

// 优先级纯函数唯一来源：issue-priority.ts（client 侧审计结果页复用同一份，不允许第二套评分）。
// 这里 re-export 保持既有公共 API（work-queue 的调用方/测试 import 路径不变）。
export type {
  PriorityLevel,
  EffortLevel,
  PriorityReason,
  TaskPriority,
  TechnicalPriorityInput,
} from "./issue-priority";
export { explainTechnicalPriority } from "./issue-priority";
import {
  explainTechnicalPriority,
  type PriorityLevel,
  type PriorityReason,
  type TaskPriority,
  type EffortLevel,
} from "./issue-priority";

/**
 * 产品价值分层（**纯派生**，不落库、不进状态机、不影响排序评分）：
 *   regain  — 曾拥有、现已丢失的搜索可见性（lost_recovery）
 *   capture — 已接近可突破位置的排名机会（rank_improvement / competitor_gap / ctr）
 *   improve — 已有页面的明确改善机会（content_refresh）
 *   issue   — 技术问题 / 基础修复。**没有明确搜索影响证据的技术问题绝不冒充增长机会**。
 * 数据层统一队列 ≠ 产品层同形：UI 按 valueCategory 分区呈现。
 */
export type TaskValueCategory = "regain" | "capture" | "improve" | "issue";

export const GROWTH_VALUE_CATEGORIES: readonly TaskValueCategory[] = [
  "regain",
  "capture",
  "improve",
] as const;

export function valueCategoryFor(source: TaskSource, type: string): TaskValueCategory {
  if (source === "opportunity") {
    if (type === "lost_recovery") return "regain";
    if (type === "rank_improvement" || type === "competitor_gap" || type === "ctr") return "capture";
    if (type === "content_refresh") return "improve";
  }
  // audit 来源一律是技术/基础问题；机会里的 technical / ai_visibility 同样归入基础问题层。
  return "issue";
}

export function isGrowthCategory(c: TaskValueCategory): boolean {
  return c !== "issue";
}

/** 优先级理由与任务优先级类型已移至 ./issue-priority.ts（见文件顶部 re-export） */

export interface TaskEvidence {
  source: string;
  ref: string;
  summary: string;
  capturedAt: string | null;
}

export interface TaskVerification {
  /** 服务端校验结果；null = 尚未校验（例如仅标记为已修复） */
  status: "pass" | "fail" | "inconclusive" | null;
  auditId: number | null;
  findings: number | null;
  affectedPages: number | null;
  checkedAt: string | null;
}

export interface WorkTask {
  /** 稳定 key：audit:<ruleId> / opp:<id> */
  id: string;
  source: TaskSource;
  /** 审计规则 id 或机会类型 */
  type: string;
  /** 受影响页面数（**显示用只读字段**：审计任务取自规则快照；机会任务无该口径 → null，不填 0） */
  affectedPages: number | null;
  /** 检出条数（**显示用只读字段**：审计任务取自规则快照；机会任务 → null，不填 0） */
  findings: number | null;
  title: LocalizedText | null;
  /** 机会侧为人类可读标题（已是单语言字符串，来自服务端生成时的推荐语） */
  fallbackTitle: string | null;
  target: string | null;
  severity: RuleSeverity | null;
  priority: TaskPriority;
  effort: EffortLevel;
  evidence: TaskEvidence[];
  /** 双语推荐语（审计规则自带） */
  recommendation: LocalizedText | null;
  /** 服务端生成时已是单语言的推荐语（机会引擎产物） */
  recommendationText: string | null;
  /** 机会引擎的双语推荐语（UI 按 locale 渲染，避免英文界面出现中文） */
  recommendationI18n: LocalizedText | null;
  status: UnifiedTaskStatus;
  verification: TaskVerification;
  /** 是否由系统检测直接得出（true）还是派生建议（false） */
  systemDetected: boolean;
  /** 已观测事实 / 系统推断 / 尚未验证的预期 —— UI 必须区分展示 */
  provenance: "observed" | "inferred";
  /** 可验证性声明：是否具备真实验证通道，以及是哪一个 */
  verificationChannel: { verifiable: boolean; channelKey: string };
  /** 到真实执行模块的入口（无入口时必须带原因，禁止空按钮） */
  execution: TaskExecution;
  /** 执行前基线与后续观测（无基线时为 null，不伪造） */
  observation: TaskObservationView | null;
  /** 产品价值分层（派生字段：由 source+type 纯函数映射，不落库、不影响排序） */
  valueCategory: TaskValueCategory;
}

export interface ExecutionLink {
  href: string;
  labelKey: string;
  /** 目标模块（用于 UI 提示这是真实功能，不是占位） */
  module: string;
}

export interface TaskExecution {
  kind:
    | "audit_fix"
    | "keyword_research"
    | "rank_tracking"
    | "content_optimize"
    | "competitor_review"
    | "none";
  primary: ExecutionLink | null;
  secondary: ExecutionLink[];
  available: boolean;
  /** 不可用原因（i18n key）；available=false 时必填 */
  unavailableReason: string | null;
}

export interface TaskObservationView {
  verdict: ObservationVerdict;
  baseline: Record<string, number | null> | null;
  baselineAt: string | null;
  latest: Record<string, number | null> | null;
  latestAt: string | null;
  observations: number;
  windowDays: number | null;
  note: string | null;
}

// ---------- 纯函数：执行入口映射（必须指向真实存在的功能） ----------

/** 机会类型 → 真实执行模块。禁止给不存在的功能造链接。 */
export function executionFor(params: {
  source: TaskSource;
  type: string;
  target: string | null;
  domain: string;
  targetType?: string | null;
}): TaskExecution {
  const none = (reason: string): TaskExecution => ({
    kind: "none",
    primary: null,
    secondary: [],
    available: false,
    unavailableReason: reason,
  });

  if (params.source === "audit") {
    const ruleId = params.type;
    return {
      kind: "audit_fix",
      // 审计页支持 ?view=issues&issue=<ruleId> 深链（见 page.tsx 的 issuesFilters）
      primary: {
        href: `/app/audit?domain=${encodeURIComponent(params.domain)}&view=issues&issue=${encodeURIComponent(ruleId)}`,
        labelKey: "act.openIssue",
        module: "audit",
      },
      secondary: [
        {
          href: `/app/audit?domain=${encodeURIComponent(params.domain)}`,
          labelKey: "act.rerunAudit",
          module: "audit",
        },
      ],
      available: true,
      unavailableReason: null,
    };
  }

  const target = params.target ?? "";
  const kq = encodeURIComponent(target);
  const dq = encodeURIComponent(params.domain);

  switch (params.type) {
    case "rank_improvement":
    case "lost_recovery":
    case "ctr":
      return {
        kind: "keyword_research",
        primary: { href: `/app/keyword-overview?keyword=${kq}`, labelKey: "act.researchKeyword", module: "keyword-overview" },
        secondary: [
          { href: `/app/position-tracking?keyword=${kq}&domain=${dq}`, labelKey: "act.trackKeyword", module: "position-tracking" },
        ],
        available: true,
        unavailableReason: null,
      };
    case "content_refresh":
      return {
        kind: "content_optimize",
        primary: {
          href: `/app/content?url=${kq}&domain=${dq}`,
          labelKey: "act.optimizePage",
          module: "content",
        },
        secondary: [{ href: `/app/keyword-expand`, labelKey: "act.expandKeywords", module: "keyword-expand" }],
        available: true,
        unavailableReason: null,
      };
    case "competitor_gap":
      return {
        kind: "competitor_review",
        primary: { href: `/app/competitors`, labelKey: "act.reviewCompetitors", module: "competitors" },
        secondary: [{ href: `/app/keyword-overview?keyword=${kq}`, labelKey: "act.researchKeyword", module: "keyword-overview" }],
        available: true,
        unavailableReason: null,
      };
    case "technical":
      return {
        kind: "audit_fix",
        primary: {
          href: `/app/audit?domain=${dq}&view=pages&search=${kq}`,
          labelKey: "act.openPage",
          module: "audit",
        },
        secondary: [{ href: `/app/audit?domain=${dq}`, labelKey: "act.rerunAudit", module: "audit" }],
        available: true,
        unavailableReason: null,
      };
    case "ai_visibility":
      // 当前没有 AI 引用优化的执行界面 → 如实说明，不造链接
      return none("reason_no_execution_surface");
    default:
      return none("reason_no_execution_surface");
  }
}

/** 机会类型 → 验证通道类别（**唯一来源**：优先级理由与任务 verificationChannel 必须一致） */
export function opportunityVerificationKind(type: string): string {
  if (type === "technical") return "audit";
  if (type === "rank_improvement" || type === "lost_recovery" || type === "ctr") return "rank";
  return type;
}

/** 机会优先级：在既有 P0/P1/P2 之上补齐"为什么"，并标注证据可靠度与可验证性 */
export function explainOpportunityPriority(opp: {
  priority: string;
  confidence: string | null;
  generatedAt: string;
  lastEvaluatedAt: string;
  evidenceCount: number;
  type: string;
}): TaskPriority {
  const base = projectOpportunityPriority(opp.priority);
  const reasons: PriorityReason[] = [{ code: "opportunity_engine" }];
  let score = base.score;

  if (opp.evidenceCount > 0) {
    reasons.push({ code: "evidence_linked", value: opp.evidenceCount });
  } else {
    // 无证据引用的机会不得被当作高可信
    score -= 2;
    reasons.push({ code: "evidence_missing" });
  }

  if (opp.confidence === "high") {
    score += 1;
    reasons.push({ code: "confidence_high" });
  } else if (opp.confidence === "low") {
    score -= 1;
    reasons.push({ code: "confidence_low" });
  }

  // 数据新鲜度：机会在扫描时被重新评估。
  // 无法解析的时间戳（非法/缺失）不得被静默当作新鲜数据 → 明确标记 unknown_data_age 并降权。
  const evaluated = parseDbTimestamp(opp.lastEvaluatedAt);
  if (evaluated === null) {
    score -= 2;
    reasons.push({ code: "unknown_data_age" });
  } else {
    const ageDays = (Date.now() - evaluated) / 86_400_000;
    if (ageDays > 30) {
      score -= 1;
      reasons.push({ code: "stale_data", value: Math.round(ageDays) });
    } else {
      reasons.push({ code: "recent_data", value: Math.max(0, Math.round(ageDays)) });
    }
  }

  const channel = verificationChannelFor(opportunityVerificationKind(opp.type));
  reasons.push({ code: channel.verifiable ? "verifiable_by_data" : "not_auto_verifiable" });

  const level: PriorityLevel = score >= 7 ? "P0" : score >= 4 ? "P1" : "P2";
  return { level, score, reasons };
}

export interface QueueCoverage {
  audit: {
    available: boolean;
    auditId: number | null;
    depth: "quick" | "full" | null;
    finishedAt: string | null;
    pagesCrawled: number | null;
    healthScore: number | null;
    partial: boolean;
  };
  /** 与队列同域（coverage 之下的 domain 字段）的已追踪关键词数——项目级范围，不是账号总数 */
  tracking: { trackedKeywords: number };
  /** 该队列中实际贡献了任务的数据来源 */
  contributingSources: string[];
  /** 实际存在的成长机会信号类型（来自机会引擎；空 = 尚未扫描出机会） */
  opportunitySources: string[];
  /** 具备真实自动验证通道的任务数（技术审计 / 排名） */
  verifiableTasks: number;
  /** 已捕获执行前基线的任务数（可进入效果反馈闭环） */
  observedTasks: number;
  /** 真实缺口（UI 必须如实展示，不得填数） */
  gaps: string[];
}

export interface WorkQueue {
  domain: string;
  projectId: number | null;
  generatedAt: string;
  tasks: WorkTask[];
  counts: Record<UnifiedTaskStatus, number>;
  coverage: QueueCoverage;
}

// ---------- 纯函数：优先级（可解释、deterministic） ----------
// explainTechnicalPriority / TechnicalPriorityInput 已抽至 ./issue-priority.ts
// （client 侧审计结果页复用同一份算法），此处仅 re-export，见文件顶部。

// ---------- 纯函数：校验判定 ----------

export interface RuleVerificationInput {
  /** 本次（最新）审计中该规则的 status */
  currentStatus: "pass" | "fail" | null;
  findings: number;
  affectedPages: number;
  auditId: number;
}

/**
 * 校验判定：**只有最新一次审计的真实检测结果能判定"已验证解决"**。
 *   - 规则本次执行且 pass  → pass（可置 verified_resolved）
 *   - 规则本次执行且 fail  → fail（保持 fixed_claimed，给出检出数字）
 *   - 规则本次未执行（null）→ inconclusive：**不下结论**，绝不把"没检测"当成"已解决"
 */
export function evaluateRuleVerification(input: RuleVerificationInput): {
  status: "pass" | "fail" | "inconclusive";
  findings: number;
  affectedPages: number;
} {
  if (input.currentStatus === null) {
    return { status: "inconclusive", findings: 0, affectedPages: 0 };
  }
  const stillFailing = input.currentStatus === "fail";
  return {
    status: stillFailing ? "fail" : "pass",
    findings: stillFailing ? input.findings : 0,
    affectedPages: stillFailing ? input.affectedPages : 0,
  };
}

// ---------- 纯函数：机会状态 → 统一状态 ----------

export function projectOpportunityStatus(
  status: string,
  verification: SeoOpportunityRow["verification_json"]
): UnifiedTaskStatus {
  let checks: Array<{ check: string; status: string }> = [];
  if (verification) {
    try {
      const parsed = JSON.parse(verification) as unknown;
      if (Array.isArray(parsed)) checks = parsed as Array<{ check: string; status: string }>;
    } catch {
      checks = [];
    }
  }
  const hasPass = checks.some((c) => c.status === "pass");
  if (status === "dismissed") return "dismissed";
  if (status === "completed") return hasPass ? "verified_resolved" : "fixed_claimed";
  if (status === "in_progress" || status === "approved") return "in_progress";
  return "open";
}

/** 机会优先级 → 统一等级（P0/P1/P2 语义一致，直接沿用） */
export function projectOpportunityPriority(priority: string): TaskPriority {
  const level: PriorityLevel = priority === "P0" ? "P0" : priority === "P1" ? "P1" : "P2";
  return { level, score: level === "P0" ? 8 : level === "P1" ? 5 : 2, reasons: [{ code: "opportunity_engine" }] };
}

/**
 * 结果反馈：观测结论 → 任务优先级（Decision → Execution → Result → Next Decision）。
 *   improved      → 降一档（任务已见效，下一步是"标记完成/处理下一件"，不是继续催促）
 *   worse         → 升一档（执行后变差，需要尽快重新检查）
 *   unchanged     → 保持档位，附"尚未显示改善"理由（不冒失败，也不冒成功）
 *   indeterminate → 保持档位，附"无法判断"理由
 * pending / 无观测 → 不调整。等级变化是**档位级**的（±1），与各来源解释器的
 * 绝对分数解耦，避免第二套评分标准。
 */
export function applyResultFeedback(task: WorkTask): void {
  const verdict = task.observation?.verdict;
  if (!verdict || verdict === "pending") return;
  const order: PriorityLevel[] = ["P2", "P1", "P0"];
  let idx = order.indexOf(task.priority.level);
  let code: string;
  if (verdict === "improved") {
    idx = Math.max(0, idx - 1);
    code = "result_improved";
  } else if (verdict === "worse") {
    idx = Math.min(order.length - 1, idx + 1);
    code = "result_worse";
  } else if (verdict === "unchanged") {
    code = "result_unchanged";
  } else {
    code = "result_indeterminate";
  }
  const level = order[idx];
  if (level === task.priority.level && task.priority.reasons.some((r) => r.code === code)) return;
  task.priority = {
    level,
    score: task.priority.score,
    reasons: [...task.priority.reasons, { code }],
  };
}

function parseEvidence(raw: string | null | undefined): TaskEvidence[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Record<string, unknown>>).map((e) => ({
      source: String(e.source ?? ""),
      ref: String(e.ref ?? ""),
      summary: String(e.summary ?? ""),
      capturedAt: e.capturedAt ? String(e.capturedAt) : null,
    }));
  } catch {
    return [];
  }
}

export function parseVerifyDetail(raw: string | null): {
  findings: number | null;
  affectedPages: number | null;
  auditId: number | null;
  depth: string | null;
} {
  if (!raw) return { findings: null, affectedPages: null, auditId: null, depth: null };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      findings: typeof p.findings === "number" ? p.findings : null,
      affectedPages: typeof p.affectedPages === "number" ? p.affectedPages : null,
      auditId: typeof p.auditId === "number" ? p.auditId : null,
      depth: typeof p.depth === "string" ? p.depth : null,
    };
  } catch {
    return { findings: null, affectedPages: null, auditId: null, depth: null };
  }
}

function toUnifiedResolutionStatus(s: IssueResolutionStatus): UnifiedTaskStatus {
  return s;
}

// ---------- 组装：统一队列 ----------

export interface BuildWorkQueueParams {
  userId: string;
  domain: string;
  projectId: number | null;
}

export async function buildWorkQueue(params: BuildWorkQueueParams): Promise<WorkQueue> {
  const { userId, domain, projectId } = params;
  const [audit, resolutions, tracked, observations] = await Promise.all([
    getLatestAudit(userId, domain),
    listResolutionsByDomain(userId, domain),
    // 关键词统计必须与本队列同域（项目级）：账号级总数会让「已追踪关键词数」和
    // no_tracked_keywords 判断在所有项目里都显示同一个数字。账号级额度仍用 countTrackedKeywords。
    listTrackedKeywords(userId, domain).catch(() => []),
    listObservations(userId, domain).catch(() => new Map()),
  ]);

  const observationView = (taskId: string): TaskObservationView | null => {
    const row = observations.get(taskId);
    if (!row) return null;
    return {
      verdict: (row.verdict ?? "pending") as ObservationVerdict,
      baseline: parseMetrics(row.baseline_json),
      baselineAt: row.baseline_at,
      latest: parseMetrics(row.latest_json),
      latestAt: row.latest_at,
      observations: row.observations,
      windowDays: row.window_days,
      note: row.note,
    };
  };

  const opportunities =
    projectId != null
      ? await listOpportunities(userId, { project_id: projectId, limit: 50 }).catch(() => [])
      : [];

  const completedAudit = audit && audit.status === "completed" ? audit : null;
  let snapshot: DashboardSnapshot | null = null;
  if (completedAudit?.dashboard_json) {
    try {
      snapshot = JSON.parse(completedAudit.dashboard_json) as DashboardSnapshot;
    } catch {
      snapshot = null;
    }
  }

  const tasks: WorkTask[] = [];
  const contributing = new Set<string>();
  const opportunitySources = new Set<string>();
  /** 已在队列中作为审计任务出现的规则（用于跨来源去重） */
  const auditRuleIds = new Set<string>();

  // ---- 来源 1：技术审计问题（真实检测） ----
  if (snapshot && completedAudit) {
    for (const rule of snapshot.rules) {
      const resolution = resolutions.get(rule.ruleId);
      const failing = rule.status === "fail";
      const status: UnifiedTaskStatus = resolution
        ? toUnifiedResolutionStatus(resolution.status)
        : failing
          ? "open"
          : "open";

      // 只保留：仍然失败的规则，或已有处理记录（用户已认领/已验证）的规则。
      // 已修复且无处理记录的规则不进入队列（避免把"已经没问题"当成任务）。
      if (!failing && !resolution) continue;

      const { priority, effort } = explainTechnicalPriority({
        severity: rule.severity,
        affectedRatio: rule.affectedRatio,
        scoreImpact: rule.scoreImpact,
        pattern: rule.pattern,
        pageLevel: rule.pageLevel,
      });

      const evidence: TaskEvidence[] = [];
      if (rule.sampleUrl) {
        evidence.push({
          source: "audit_issues",
          ref: rule.sampleUrl,
          summary: rule.sampleMessage ? pickText(rule.sampleMessage, "en") : "",
          capturedAt: completedAudit.finished_at,
        });
      }
      evidence.push({
        source: "audit",
        ref: `audit:${completedAudit.id}`,
        summary: `${rule.findings} findings / ${rule.affectedPages} pages`,
        capturedAt: completedAudit.finished_at,
      });

      const verifyDetail = parseVerifyDetail(resolution?.verify_detail ?? null);
      const auditTaskId = `audit:${rule.ruleId}`;
      tasks.push({
        id: auditTaskId,
        source: "audit",
        type: rule.ruleId,
        affectedPages: rule.affectedPages,
        findings: rule.findings,
        title: rule.name,
        fallbackTitle: null,
        target: rule.sampleUrl,
        severity: rule.severity,
        priority,
        effort,
        evidence,
        recommendation: rule.recommendation,
        recommendationText: null,
        recommendationI18n: null,
        status,
        verification: {
          status: resolution?.verify_status ?? null,
          auditId: resolution?.verified_audit_id ?? verifyDetail.auditId,
          findings: verifyDetail.findings,
          affectedPages: verifyDetail.affectedPages,
          checkedAt: resolution?.verified_at ?? null,
        },
        systemDetected: true,
        // 技术问题是自研爬虫的**直接观测事实**
        provenance: "observed",
        valueCategory: valueCategoryFor("audit", rule.ruleId),
        verificationChannel: verificationChannelFor("audit"),
        execution: executionFor({ source: "audit", type: rule.ruleId, target: rule.sampleUrl, domain }),
        observation: observationView(auditTaskId),
      });
      contributing.add("audit");
      auditRuleIds.add(rule.ruleId);
    }
  }

  // ---- 来源 2：成长机会（seo_opportunities，既有引擎） ----
  for (const opp of opportunities) {
    const status = projectOpportunityStatus(opp.status, opp.verification_json);
    if (status === "dismissed") continue;

    const oppSignals = parseOpportunitySignals(opp.signals_json);
    // 去重（跨面一致）：技术机会若与队列中的审计任务指向同一规则，
    // 由审计任务作为唯一代表（它带处理状态与再审计验证），避免同一问题出现两条。
    if (opp.type === "technical") {
      const ruleId = typeof oppSignals.ruleId === "string" ? oppSignals.ruleId : null;
      if (ruleId && auditRuleIds.has(ruleId)) continue;
    }

    const recommendationI18n = parseRecommendationI18n(oppSignals);
    const recommendationText = recommendationI18n
      ? recommendationI18n.en
      : parseOpportunityRecommendation(opp);
    const checks = parseOpportunityChecks(opp.verification_json);
    const evidence = parseEvidence(opp.evidence_json);
    const oppTaskId = `opp:${opp.id}`;
    tasks.push({
      id: oppTaskId,
      source: "opportunity",
      type: opp.type,
      // 机会任务没有"受影响页面数 / 检出条数"这一口径（不是审计检出）→ 保持 null，
      // 由 UI 显示为空缺，绝不用 0 冒充。
      affectedPages: null,
      findings: null,
      title: null,
      fallbackTitle: recommendationText ?? `${opp.type} · ${opp.target_value}`,
      target: opp.target_value,
      severity: null,
      priority: explainOpportunityPriority({
        priority: opp.priority,
        confidence: opp.confidence,
        generatedAt: opp.generated_at,
        lastEvaluatedAt: opp.last_evaluated_at,
        evidenceCount: evidence.length,
        type: opp.type,
      }),
      effort: "medium",
      evidence,
      recommendation: null,
      recommendationText,
      recommendationI18n,
      status,
      verification: {
        status: checks.some((c) => c.status === "pass")
          ? "pass"
          : checks.some((c) => c.status === "fail")
            ? "fail"
            : null,
        auditId: null,
        findings: null,
        affectedPages: null,
        checkedAt: checks.find((c) => c.checkedAt)?.checkedAt ?? null,
      },
      systemDetected: true,
      // 机会是基于已观测数据（排名/GSC/竞品）的**系统推断**，不是直接观测结论
      provenance: "inferred",
      valueCategory: valueCategoryFor("opportunity", opp.type),
      verificationChannel: verificationChannelFor(opportunityVerificationKind(opp.type)),
      execution: executionFor({
        source: "opportunity",
        type: opp.type,
        target: opp.target_value,
        domain,
        targetType: opp.target_type,
      }),
      observation: observationView(oppTaskId),
    });
    contributing.add("opportunities");
    opportunitySources.add(opp.type);
  }

  // 结果反馈（observe → priority 闭环的最后一步）：
  // 观测结论直接影响下一次排序——有效果的任务不再以高优先级催促重复执行，
  // 变差的任务升位要求重新检查，无法判断的保持原位并如实说明。
  // 复用 observation 数据，不另建第二套优先级引擎。
  for (const task of tasks) applyResultFeedback(task);

  // 排序：未解决优先 → 优先级 → 验证状态
  const STATUS_ORDER: Record<UnifiedTaskStatus, number> = {
    in_progress: 0,
    open: 1,
    fixed_claimed: 2,
    verified_resolved: 3,
    dismissed: 4,
  };
  const PRIORITY_ORDER: Record<PriorityLevel, number> = { P0: 0, P1: 1, P2: 2 };
  tasks.sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    const p = PRIORITY_ORDER[a.priority.level] - PRIORITY_ORDER[b.priority.level];
    if (p !== 0) return p;
    return a.id.localeCompare(b.id);
  });

  const counts: Record<UnifiedTaskStatus, number> = {
    open: 0,
    in_progress: 0,
    fixed_claimed: 0,
    verified_resolved: 0,
    dismissed: 0,
  };
  for (const t of tasks) counts[t.status]++;

  const gaps: string[] = [];
  if (!completedAudit) gaps.push("no_completed_audit");
  if (completedAudit && completedAudit.depth === "quick") gaps.push("quick_audit_only_homepage");
  if (snapshot?.partial) gaps.push("audit_partial");
  if (!completedAudit?.dashboard_json) gaps.push("no_dashboard_snapshot");
  if (tracked.length === 0) gaps.push("no_tracked_keywords");
  if (projectId == null) gaps.push("no_project_selected");
  if (projectId != null && opportunities.length === 0) gaps.push("no_growth_opportunities");
  // 外链机会：仅当第三方数据源确实可用时才可能存在；不可用时如实说明（不造数据）
  if (!isDataForSeoConfigured()) gaps.push("backlink_source_unavailable");

  return {
    domain,
    projectId,
    generatedAt: new Date().toISOString(),
    tasks,
    counts,
    coverage: {
      audit: {
        available: Boolean(completedAudit),
        auditId: completedAudit?.id ?? null,
        depth: completedAudit?.depth ?? null,
        finishedAt: completedAudit?.finished_at ?? null,
        pagesCrawled: snapshot?.pagesCrawled ?? completedAudit?.pages_crawled ?? null,
        healthScore: completedAudit?.health_score ?? null,
        partial: Boolean(snapshot?.partial),
      },
      tracking: { trackedKeywords: tracked.length },
      contributingSources: [...contributing],
      opportunitySources: [...opportunitySources].sort(),
      verifiableTasks: tasks.filter((t) => t.verificationChannel.verifiable).length,
      observedTasks: tasks.filter((t) => t.observation !== null).length,
      gaps,
    },
  };
}

/** 证据摘要默认沿用 pickText 的 en 值（UI 侧按 locale 重新渲染 title/recommendation） */

function parseOpportunitySignals(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 机会引擎的双语推荐语（存于 signals.recommendation_i18n） */
function parseRecommendationI18n(signals: Record<string, unknown>): { en: string; zh: string } | null {
  const raw = signals.recommendation_i18n;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.en !== "string" || typeof rec.zh !== "string" || !rec.en || !rec.zh) return null;
  return { en: rec.en, zh: rec.zh };
}

function parseOpportunityRecommendation(opp: SeoOpportunityRow): string | null {
  // 机会的推荐语存于 action_plan_json.steps 或 signals；取可读文本，缺失则返回 null
  if (opp.action_plan_json) {
    try {
      const plan = JSON.parse(opp.action_plan_json) as { steps?: unknown };
      if (Array.isArray(plan.steps) && plan.steps.length > 0) return String(plan.steps[0]);
    } catch {
      /* ignore */
    }
  }
  if (opp.signals_json) {
    try {
      const sig = JSON.parse(opp.signals_json) as { recommendation?: unknown };
      if (typeof sig.recommendation === "string") return sig.recommendation;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function parseOpportunityChecks(
  verification: string | null
): Array<{ check: string; status: string; checkedAt: string | null }> {
  if (!verification) return [];
  try {
    const parsed = JSON.parse(verification) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Record<string, unknown>>).map((c) => ({
      check: String(c.check ?? ""),
      status: String(c.status ?? ""),
      checkedAt: c.checkedAt ? String(c.checkedAt) : null,
    }));
  } catch {
    return [];
  }
}

/** 工作区级摘要（供项目首页"决策面板"使用，避免多拉数据） */
/** /app「今天先做这一件事」：从同一批队列里选出的唯一 top action（不做第二套排序） */
export interface TodayTopAction {
  taskId: string;
  domain: string;
  level: PriorityLevel;
  source: "audit" | "opportunity";
  type: string;
  title: LocalizedText | null;
  fallbackTitle: string | null;
  target: string | null;
  /** 可解释的"为什么是它"（前 3 条完整理由，code + value） */
  reasonCodes: Array<{ code: string; value?: number }>;
  execution: {
    available: boolean;
    href: string | null;
    labelKey: string | null;
    unavailableReason: string | null;
  };
}

/**
 * 增长机会卡（/app 第一屏「Search Growth Opportunities」）。
 * **与队列同源**：从 buildWorkQueue 已排序结果里筛选 valueCategory ∈ {regain, capture, improve}
 * 的 open 任务，仅按价值分层稳定性重排（regain → capture → improve），不引入第二套评分。
 */
export interface TopOpportunity {
  taskId: string;
  domain: string;
  level: PriorityLevel;
  valueCategory: TaskValueCategory;
  source: TaskSource;
  type: string;
  title: LocalizedText | null;
  fallbackTitle: string | null;
  /** 机会引擎的双语推荐语（UI 按 locale 渲染 WHAT） */
  recommendationI18n: { en: string; zh: string } | null;
  target: string | null;
  /** WHY：前 3 条可解释理由 */
  reasonCodes: Array<{ code: string; value?: number }>;
  /** EVIDENCE：真实证据摘要（来自机会引擎的 evidence_json） */
  evidence: Array<{ summary: string; capturedAt: string | null }>;
  execution: {
    available: boolean;
    /** 已附带机会上下文参数（from/otype/otitle/otitlezh/oreason） */
    href: string | null;
    labelKey: string | null;
    unavailableReason: string | null;
  };
}

/**
 * 机会卡 CTA 附带上下文参数：执行页据此显示"你为什么来到这里"。
 * 只用 URL 传递，不复制任何状态；解析失败时原样返回（绝不因上下文丢失而断链）。
 */
export function withOpportunityContext(
  href: string,
  ctx: { type: string; titleEn: string; titleZh: string | null; reasonCode: string | null }
): string {
  try {
    const u = new URL(href, "http://seeo.internal");
    u.searchParams.set("from", "opportunity");
    u.searchParams.set("otype", ctx.type);
    u.searchParams.set("otitle", ctx.titleEn);
    if (ctx.titleZh) u.searchParams.set("otitlezh", ctx.titleZh);
    if (ctx.reasonCode) u.searchParams.set("oreason", ctx.reasonCode);
    return `${u.pathname}${u.search}`;
  } catch {
    return href;
  }
}

/** 历史数据兼容：LocalizedText 可能是纯文本 string（无法双语渲染） */
function textOf(v: LocalizedText | null, locale: "en" | "zh"): string | null {
  if (v === null) return null;
  return typeof v === "string" ? v : v[locale];
}

function toLText(v: LocalizedText | null): { en: string; zh: string } | null {
  if (v === null || typeof v === "string") return null;
  return { en: v.en, zh: v.zh };
}

function toTopOpportunity(domain: string, task: WorkTask): TopOpportunity {
  const titleEn =
    textOf(task.recommendationI18n, "en") ??
    textOf(task.title, "en") ??
    task.fallbackTitle ??
    task.type;
  const titleZh = textOf(task.recommendationI18n, "zh") ?? textOf(task.title, "zh");
  const primary = task.execution.primary;
  return {
    taskId: task.id,
    domain,
    level: task.priority.level,
    valueCategory: task.valueCategory,
    source: task.source,
    type: task.type,
    title: task.title,
    fallbackTitle: task.fallbackTitle,
    recommendationI18n: toLText(task.recommendationI18n),
    target: task.target,
    reasonCodes: task.priority.reasons.slice(0, 3).map((r) => ({ code: r.code, value: r.value })),
    evidence: task.evidence
      .filter((e) => e.summary)
      .slice(0, 2)
      .map((e) => ({ summary: e.summary, capturedAt: e.capturedAt })),
    execution: {
      available: task.execution.available,
      href:
        task.execution.available && primary
          ? withOpportunityContext(primary.href, {
              type: task.type,
              titleEn,
              titleZh,
              reasonCode: task.priority.reasons[0]?.code ?? null,
            })
          : null,
      labelKey: primary?.labelKey ?? null,
      unavailableReason: task.execution.unavailableReason,
    },
  };
}

const GROWTH_RANK: Record<string, number> = { regain: 0, capture: 1, improve: 2 };

/** Action Center / 增长机会面板的视图模型（getWorkspaceActionSummary 的返回类型） */
export interface WorkspaceActionSummary {
  open: number;
  inProgress: number;
  fixedClaimed: number;
  verifiedResolved: number;
  auditedDomains: number;
  topAction: TodayTopAction | null;
  growth: {
    counts: { regain: number; capture: number; improve: number };
    top: TopOpportunity[];
    /** 各域名 coverage.gaps 的并集（去重）；UI 据此如实解释"为什么现在没有增长机会" */
    gaps: string[];
  };
}

/**
 * 队列构建的唯一入口。
 * /app 首页同一批项目既要出「可视化概览」又要出「增长机会面板」，两处若各自调用
 * getWorkspaceActionSummary / getWorkspaceOverview，就会对同一批域名构建两遍队列
 * （此前实测每域 2 次 × 最多 5 域 = 10 次，每次 5 条数据库查询）。
 * 现在两边共用同一份构建结果，语义不变。
 */
export async function buildWorkspaceQueues(
  userId: string,
  domains: string[],
  /** 可选的 domain → 项目 id 映射；提供后机会（seo_opportunities）才会进入统计与 top action */
  projects?: Array<{ id: number; domain: string }>
): Promise<Array<WorkQueue | null>> {
  const projectIdFor = (d: string): number | null =>
    projects?.find((p) => p.domain === d)?.id ?? null;
  return Promise.all(
    domains.map((d) =>
      buildWorkQueue({ userId, domain: d, projectId: projectIdFor(d) }).catch(() => null)
    )
  );
}

/**
 * 纯汇总（不访问数据库）：把已构建的队列聚合成 Action Center 视图模型。
 * 分类口径、稳定重排、top 3 上限与拆分前逐字一致——这里只搬位置，不改规则。
 */
export function summarizeActionQueues(summaries: Array<WorkQueue | null>): WorkspaceActionSummary {
  const out: WorkspaceActionSummary = {
    open: 0,
    inProgress: 0,
    fixedClaimed: 0,
    verifiedResolved: 0,
    auditedDomains: 0,
    topAction: null,
    growth: {
      counts: { regain: 0, capture: 0, improve: 0 },
      top: [],
      gaps: [],
    },
  };
  const gapSet = new Set<string>();
  const growthCandidates: Array<{ rank: number; opp: TopOpportunity }> = [];
  for (const s of summaries) {
    if (!s) continue;
    if (s.coverage.audit.available) out.auditedDomains++;
    out.open += s.counts.open;
    out.inProgress += s.counts.in_progress;
    out.fixedClaimed += s.counts.fixed_claimed;
    out.verifiedResolved += s.counts.verified_resolved;
    for (const g of s.coverage.gaps) gapSet.add(g);
    // 增长机会：队列已按 status → priority 排序，这里只筛 open + 增长分层，
    // 并按价值分层稳定重排（regain → capture → improve），不引入第二套评分。
    for (const t of s.tasks) {
      if (t.status !== "open" || t.valueCategory === "issue") continue;
      out.growth.counts[t.valueCategory]++;
      growthCandidates.push({ rank: GROWTH_RANK[t.valueCategory] ?? 9, opp: toTopOpportunity(s.domain, t) });
    }
    // top action：队列已按 status → priority 排序，取第一个 open 任务即可（同源，不重排）
    if (out.topAction === null) {
      const top = s.tasks.find((t) => t.status === "open");
      if (top) {
        out.topAction = {
          taskId: top.id,
          domain: s.domain,
          level: top.priority.level,
          source: top.source,
          type: top.type,
          title: top.title,
          fallbackTitle: top.fallbackTitle,
          target: top.target,
          reasonCodes: top.priority.reasons.slice(0, 3).map((r) => ({ code: r.code, value: r.value })),
          execution: {
            available: top.execution.available,
            href: top.execution.primary?.href ?? null,
            labelKey: top.execution.primary?.labelKey ?? null,
            unavailableReason: top.execution.unavailableReason,
          },
        };
      }
    }
  }
  growthCandidates.sort((a, b) => a.rank - b.rank); // Array.prototype.sort 稳定：同 rank 保持队列序
  out.growth.top = growthCandidates.slice(0, 3).map((c) => c.opp);
  out.growth.gaps = [...gapSet];
  return out;
}

/**
 * Action Center 数据（保留原有函数签名，供 /app/actions 等消费方继续使用）。
 * 内部先构建队列再汇总——与首页共用同一套 buildWorkspaceQueues / summarizeActionQueues。
 */
export async function getWorkspaceActionSummary(
  userId: string,
  domains: string[],
  projects?: Array<{ id: number; domain: string }>
): Promise<WorkspaceActionSummary> {
  const summaries = await buildWorkspaceQueues(userId, domains, projects);
  return summarizeActionQueues(summaries);
}
