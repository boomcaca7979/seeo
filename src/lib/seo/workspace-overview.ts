// ===== 工作台首页（/app）可视化视图模型 =====
//
// 定位：为「网站概览」提供**只读聚合**，把已存在的数据整理成可直接渲染的视图模型。
//
// 硬边界（与本仓库既有约定一致）：
//   1. **不新增数据库表、不新增优先级算法、不新增机会类型、不新增外部数据源**。
//      一切派生自既有 `buildWorkQueue`（唯一队列/状态词表/优先级来源）与 `audits` 表。
//   2. **不伪造**：得不出真实数字的口径一律返回 null（由 UI 显示诚实空状态），
//      绝不用 0 / 100% / 示例曲线填充。
//   3. 趋势只在**同一域名存在 ≥2 次已完成审计**时才算"可比较"，否则返回 null。

import type { LocalizedText } from "./audit-checks";
import { buildWorkQueue, type UnifiedTaskStatus, type WorkQueue } from "./work-queue";
import { getAuditHistory } from "@/lib/db/audits";

export interface WorkspaceTaskItem {
  /** React key：队列任务 id 只在**单域名**内唯一（audit:<ruleId>），
   *  工作台聚合多个域名时必须补上域名前缀，否则同一规则在不同站点会撞 key。 */
  key: string;
  taskId: string;
  domain: string;
  level: "P0" | "P1" | "P2";
  source: "audit" | "opportunity";
  type: string;
  title: LocalizedText | null;
  fallbackTitle: string | null;
  target: string | null;
  /** 受影响页面数；机会任务为空缺（null） */
  affectedPages: number | null;
  /** 检出条数；机会任务为空缺（null） */
  findings: number | null;
  status: UnifiedTaskStatus;
  /** 真实执行入口（已由 work-queue 指向既有功能）；不可用时为 null 并带原因 */
  href: string | null;
  labelKey: string | null;
  unavailableReason: string | null;
  systemDetected: boolean;
}

export interface WorkspaceTrendPoint {
  /** 审计完成时间（ISO） */
  date: string;
  score: number | null;
  issues: number;
}

export interface WorkspaceAuditSnapshot {
  domain: string;
  healthScore: number | null;
  pagesCrawled: number | null;
  depth: "quick" | "full" | null;
  finishedAt: string | null;
  partial: boolean;
}

export interface WorkspaceOverviewData {
  hasProjects: boolean;
  /** 至少一个域名存在已完成审计 */
  hasAudit: boolean;
  auditedDomains: number;
  /** 最近一次审计（按完成时间在全部域名中取最新）；无则 null */
  audit: WorkspaceAuditSnapshot | null;
  counts: Record<UnifiedTaskStatus, number>;
  /** **技术问题**（audit 来源）的处理状态计数：口径与指标卡「未解决问题数」一致 */
  auditCounts: Record<UnifiedTaskStatus, number>;
  /** **技术问题**中待处理 + 进行中的优先级分布（机会任务不计入"问题"口径） */
  auditPriority: { P0: number; P1: number; P2: number };
  /** 技术问题（audit 来源）的验证状态分布 */
  verification: { pass: number; fail: number; inconclusive: number; pending: number };
  /** 最值得处理的开放事项（队列已按 状态 → 优先级 排序，不重排） */
  tasks: WorkspaceTaskItem[];
  /** 可比较的历史趋势（同一域名 ≥2 次已完成审计）；否则 null */
  trend: { domain: string; points: WorkspaceTrendPoint[] } | null;
  /** 真实数据缺口（UI 据此给出可执行入口，而非占位数字） */
  gaps: string[];
}

const MAX_DOMAINS = 5;
const MAX_TASKS = 8;
const TREND_LIMIT = 10;

function toTaskItem(domain: string, queue: WorkQueue, index: number): WorkspaceTaskItem | null {
  const task = queue.tasks[index];
  if (!task) return null;
  const primary = task.execution.primary;
  return {
    key: `${domain}::${task.id}`,
    taskId: task.id,
    domain,
    level: task.priority.level,
    source: task.source,
    type: task.type,
    title: task.title,
    fallbackTitle: task.fallbackTitle,
    target: task.target,
    affectedPages: task.affectedPages,
    findings: task.findings,
    status: task.status,
    href: task.execution.available && primary ? primary.href : null,
    labelKey: primary?.labelKey ?? null,
    unavailableReason: task.execution.available ? null : task.execution.unavailableReason,
    systemDetected: task.systemDetected,
  };
}

/**
 * 组装工作台首页视图模型。
 * 任何一步失败都不得阻塞工作台渲染：单域名队列构建失败按"无数据"处理。
 */
export async function getWorkspaceOverview(
  userId: string,
  projects: Array<{ id: number; domain: string }>
): Promise<WorkspaceOverviewData> {
  const scoped = projects.slice(0, MAX_DOMAINS);
  const queues = await Promise.all(
    scoped.map((p) =>
      buildWorkQueue({ userId, domain: p.domain, projectId: p.id }).catch(() => null)
    )
  );

  const counts: Record<UnifiedTaskStatus, number> = {
    open: 0,
    in_progress: 0,
    fixed_claimed: 0,
    verified_resolved: 0,
    dismissed: 0,
  };
  const auditCounts: Record<UnifiedTaskStatus, number> = {
    open: 0,
    in_progress: 0,
    fixed_claimed: 0,
    verified_resolved: 0,
    dismissed: 0,
  };
  const auditPriority = { P0: 0, P1: 0, P2: 0 };
  const verification = { pass: 0, fail: 0, inconclusive: 0, pending: 0 };
  const gapSet = new Set<string>();
  const candidates: Array<{ rank: number; item: WorkspaceTaskItem }> = [];
  let auditedDomains = 0;
  let audit: WorkspaceAuditSnapshot | null = null;
  let auditFinishedAt = "";

  for (let i = 0; i < queues.length; i++) {
    const queue = queues[i];
    const domain = scoped[i].domain;
    if (!queue) continue;

    for (const g of queue.coverage.gaps) gapSet.add(g);

    for (const t of queue.tasks) counts[t.status]++;
    for (const t of queue.tasks) {
      if (t.source !== "audit") continue;
      auditCounts[t.status]++;
      if (t.status !== "open" && t.status !== "in_progress") continue;
      auditPriority[t.priority.level]++;
    }
    // 验证状态分布：只统计技术问题（机会任务没有再审计验证通道）
    for (const t of queue.tasks) {
      if (t.source !== "audit") continue;
      const s = t.verification.status;
      if (s === "pass") verification.pass++;
      else if (s === "fail") verification.fail++;
      else if (s === "inconclusive") verification.inconclusive++;
      else verification.pending++;
    }

    for (let k = 0; k < queue.tasks.length; k++) {
      const t = queue.tasks[k];
      if (t.status !== "open" && t.status !== "in_progress") continue;
      const item = toTaskItem(domain, queue, k);
      if (!item) continue;
      const rank = t.priority.level === "P0" ? 0 : t.priority.level === "P1" ? 1 : 2;
      candidates.push({ rank, item });
    }

    if (queue.coverage.audit.available) {
      auditedDomains++;
      const finished = queue.coverage.audit.finishedAt ?? "";
      if (finished > auditFinishedAt) {
        auditFinishedAt = finished;
        audit = {
          domain,
          healthScore: queue.coverage.audit.healthScore,
          pagesCrawled: queue.coverage.audit.pagesCrawled,
          depth: queue.coverage.audit.depth,
          finishedAt: queue.coverage.audit.finishedAt,
          partial: queue.coverage.audit.partial,
        };
      }
    }
  }

  // 队列内部已按 状态→优先级 排序；此处只做一次稳定的档位重排，不引入第二套评分。
  candidates.sort((a, b) => a.rank - b.rank);
  const tasks = candidates.slice(0, MAX_TASKS).map((c) => c.item);

  // 趋势：只在"最近一次审计所属域名"存在 ≥2 次已完成审计时成立
  let trend: WorkspaceOverviewData["trend"] = null;
  if (audit) {
    const history = await getAuditHistory(userId, audit.domain, TREND_LIMIT).catch(() => []);
    const points: WorkspaceTrendPoint[] = history
      .slice()
      .reverse()
      .map((h) => ({
        date: h.finished_at ?? h.started_at,
        score: h.health_score,
        issues: (h.errors ?? 0) + (h.warnings ?? 0) + (h.notices ?? 0),
      }));
    if (points.length >= 2) trend = { domain: audit.domain, points };
  }

  return {
    hasProjects: scoped.length > 0,
    hasAudit: auditedDomains > 0,
    auditedDomains,
    audit,
    counts,
    auditCounts,
    auditPriority,
    verification,
    tasks,
    trend,
    gaps: [...gapSet],
  };
}
