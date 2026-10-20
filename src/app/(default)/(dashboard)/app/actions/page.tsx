"use client";

// ===== Action Center（行动中心）=====
// 产品目标：把「看到数据」变成「知道下一步做什么，并且能验证是否真的改善」。
//
// 单一队列，两个真实来源：
//   - audit      技术审计问题（自研爬虫检测结果 + 处理状态 + 再次检测验证）
//   - opportunity 成长机会（既有 Opportunity Engine）
//
// 状态词表统一：open / in_progress / fixed_claimed / verified_resolved / dismissed。
// **标记完成 ≠ 已验证解决**：verified_resolved 只能由再审计的检测证据产生，客户端无法置位。
//
// 诚实边界：没有数据时展示 coverage.gaps 说明缺口，不用占位数字填充队列。

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { SELECTED_PROJECT_KEY, PROJECT_CHANGED_EVENT, validStoredProjectId, loadProjectList } from "@/lib/project-selector";
import MetricCard from "@/components/viz/MetricCard";
import PageHeader from "@/components/viz/PageHeader";
import { StatusBadge } from "@/components/viz/StatusBadge";
import {
  DistributionBar,
  DistributionLegend,
  type DistributionSegment,
} from "@/components/viz/DistributionBar";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { priorityTone, unifiedStatusTone } from "@/components/viz/tokens";

type LocalizedText = string | { en: string; zh: string };
type UnifiedStatus = "open" | "in_progress" | "fixed_claimed" | "verified_resolved" | "dismissed";

interface PriorityReason {
  code: string;
  value?: number;
}

interface ExecutionLink {
  href: string;
  labelKey: string;
  module: string;
}

interface TaskExecution {
  kind: string;
  primary: ExecutionLink | null;
  secondary: ExecutionLink[];
  available: boolean;
  unavailableReason: string | null;
}

interface TaskObservation {
  verdict: "pending" | "improved" | "unchanged" | "worse" | "indeterminate";
  baseline: Record<string, number | null> | null;
  baselineAt: string | null;
  latest: Record<string, number | null> | null;
  latestAt: string | null;
  observations: number;
  windowDays: number | null;
  note: string | null;
}

interface WorkTask {
  id: string;
  source: "audit" | "opportunity";
  type: string;
  title: LocalizedText | null;
  fallbackTitle: string | null;
  target: string | null;
  severity: "error" | "warning" | "notice" | null;
  priority: { level: "P0" | "P1" | "P2"; score: number; reasons: PriorityReason[] };
  effort: "low" | "medium" | "high";
  evidence: Array<{ source: string; ref: string; summary: string; capturedAt: string | null }>;
  recommendation: LocalizedText | null;
  recommendationText: string | null;
  recommendationI18n: LocalizedText | null;
  status: UnifiedStatus;
  verification: {
    status: "pass" | "fail" | "inconclusive" | null;
    auditId: number | null;
    findings: number | null;
    affectedPages: number | null;
    checkedAt: string | null;
  };
  systemDetected: boolean;
  provenance: "observed" | "inferred";
  verificationChannel: { verifiable: boolean; channelKey: string };
  execution: TaskExecution;
  observation: TaskObservation | null;
}

interface QueueCoverage {
  audit: {
    available: boolean;
    auditId: number | null;
    depth: "quick" | "full" | null;
    finishedAt: string | null;
    pagesCrawled: number | null;
    healthScore: number | null;
    partial: boolean;
  };
  /** 与请求 domain（= 当前项目）同范围的已追踪关键词数，不是账号总数 */
  tracking: { trackedKeywords: number };
  contributingSources: string[];
  opportunitySources: string[];
  verifiableTasks: number;
  observedTasks: number;
  gaps: string[];
}

interface WorkQueue {
  domain: string;
  projectId: number | null;
  generatedAt: string;
  tasks: WorkTask[];
  counts: Record<UnifiedStatus, number>;
  coverage: QueueCoverage;
}

interface ProjectLite {
  /** 项目 id 统一按 string 传递（鉴权模式 UUID / 演示模式整数），与顶部选择器同一契约 */
  id: string;
  name: string;
  domain: string;
}

const STATUS_ORDER: UnifiedStatus[] = [
  "open",
  "in_progress",
  "fixed_claimed",
  "verified_resolved",
  "dismissed",
];

/** 用户可置位的动作（与 /api/audit/issues/status 的 USER_SETTABLE_STATUSES 对齐） */
const USER_ACTIONS: Array<{ to: UnifiedStatus; labelKey: string }> = [
  { to: "in_progress", labelKey: "markInProgress" },
  { to: "fixed_claimed", labelKey: "markFixed" },
  { to: "dismissed", labelKey: "dismiss" },
  { to: "open", labelKey: "reopen" },
];

function pickText(value: LocalizedText | null, locale: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return locale === "zh" ? value.zh : value.en;
}

export default function ActionCenterPage() {
  const t = useTranslations("dashboard.actions");
  const locale = useLocale();
  const { show, Toast } = useToast();

  const [projects, setProjects] = useState<ProjectLite[] | null>(null);
  const [projectRef, setProjectRef] = useState<string | null>(null);
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<UnifiedStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ---- 项目列表（一次） ----
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void (async () => {
      try {
        // 共享取数入口：与 Topbar / 其他页面并发调用时只发一次 /api/projects
        const json = await loadProjectList();
        const list: ProjectLite[] = Array.isArray(json?.data)
          ? json.data.map((p) => ({ id: String(p.id), name: p.name, domain: p.domain }))
          : [];
        setProjects(list);
        if (list.length > 0) {
          let stored: string | null = null;
          try {
            stored = window.localStorage.getItem(SELECTED_PROJECT_KEY);
          } catch {
            stored = null;
          }
          const valid = validStoredProjectId(stored, list.map((p) => String(p.id)));
          setProjectRef(valid ?? String(list[0].id));
        } else {
          setLoading(false);
        }
      } catch {
        setProjects([]);
        setLoading(false);
        setError(t("networkError"));
      }
    })();
  }, [t]);

  // ---- 跟随 Topbar 的项目切换 ----
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string }>).detail;
      if (detail?.id) setProjectRef(detail.id);
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PROJECT_CHANGED_EVENT, onChange);
  }, []);

  const selectedProject = projects?.find((p) => String(p.id) === projectRef) ?? null;

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/actions/queue?domain=${encodeURIComponent(selectedProject.domain)}&project_id=${encodeURIComponent(String(selectedProject.id))}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (res.ok && json?.data) {
        setQueue(json.data as WorkQueue);
      } else {
        setQueue(null);
        setError(typeof json?.error === "string" ? json.error : t("loadFailed"));
      }
    } catch {
      setQueue(null);
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [selectedProject, t]);

  useEffect(() => {
    // 延后一拍执行：避免在 effect 体内同步 setState（React 规则），同时保证项目切换后重新拉取
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  // ---- 状态变更（仅审计来源可写；机会来源由机会页的完整状态机管理） ----
  async function updateStatus(task: WorkTask, to: UnifiedStatus) {
    if (!selectedProject || task.source !== "audit") return;
    setBusy(task.id);
    try {
      const res = await fetch("/api/audit/issues/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: selectedProject.domain, rule_id: task.type, status: to }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        show(typeof json?.error === "string" ? json.error : t("act.saveFailed"), "error");
        return;
      }
      await load();
    } catch {
      show(t("act.saveFailed"), "error");
    } finally {
      setBusy(null);
    }
  }

  const tasks = queue?.tasks ?? [];
  const visible = filter === "all" ? tasks : tasks.filter((x) => x.status === filter);

  // ---- 状态分布（点击图例筛选；全部来自 queue.counts，与队列规则一致） ----
  const statusSegments: DistributionSegment[] = queue
    ? STATUS_ORDER.map((s) => ({
        key: s,
        label: t(`status.${s}` as "status.open"),
        value: queue.counts[s] ?? 0,
        tone: unifiedStatusTone(s),
        onClick: () => setFilter((prev) => (prev === s ? "all" : s)),
      }))
    : [];

  return (
    <div className="dash-container p-4 lg:p-8">
      {/* Header */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <button
            onClick={() => void load()}
            disabled={loading || !selectedProject}
            className="btn-secondary flex-none disabled:opacity-60"
          >
            {loading ? t("refreshing") : t("refresh")}
          </button>
        }
        meta={
          queue ? (
            <>
              <span>
                {selectedProject
                  ? t("coverage.project", { name: selectedProject.name, domain: selectedProject.domain })
                  : t("coverage.noProject")}
              </span>
              <span>
                {queue.coverage.audit.available
                  ? t("coverage.auditOk", {
                      auditId: queue.coverage.audit.auditId ?? 0,
                      depth: queue.coverage.audit.depth === "full" ? "deep" : "quick",
                      pages: queue.coverage.audit.pagesCrawled ?? 0,
                    })
                  : t("coverage.auditMissing")}
              </span>
              {queue.coverage.audit.healthScore !== null && (
                <span>{t("coverage.health", { score: queue.coverage.audit.healthScore })}</span>
              )}
              <span>{t("coverage.tracking", { n: queue.coverage.tracking.trackedKeywords })}</span>
              <span>{t("coverage.opportunitySources", { n: queue.coverage.opportunitySources.length })}</span>
              <span>{t("coverage.verifiable", { n: queue.coverage.verifiableTasks })}</span>
              <span>{t("coverage.observed", { n: queue.coverage.observedTasks })}</span>
            </>
          ) : null
        }
      />

      {/* Error */}
      {error && (
        <div className="card-a mt-5 border-neg p-4">
          <p className="font-sans text-sm text-neg">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !queue && (
        <div className="mt-5 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-line bg-paper" />
          ))}
        </div>
      )}

      {/* Empty states */}
      {!loading && projects !== null && projects.length === 0 && (
        <div className="card-a mt-5 flex flex-col items-center justify-center py-14 text-center">
          <div className="font-display text-sm font-semibold text-ink">{t("empty.title")}</div>
          <p className="mt-1 max-w-md font-sans text-sm text-ink-40">{t("empty.body")}</p>
          <Link href="/app/audit" className="btn-primary mt-4">
            {t("empty.cta")}
          </Link>
        </div>
      )}

      {!loading && tasks.length === 0 && projects !== null && projects.length > 0 && (
        <div className="card-a mt-5 flex flex-col items-center justify-center py-14 text-center">
          <div className="font-display text-sm font-semibold text-ink">{t("empty.title")}</div>
          <p className="mt-1 max-w-md font-sans text-sm text-ink-40">{t("empty.body")}</p>
          <Link href="/app/audit" className="btn-primary mt-4">
            {t("empty.cta")}
          </Link>
        </div>
      )}

      {/* 指标卡（口径唯一来自 queue.counts，与队列规则一致；fixed_claimed ≠ verified_resolved） */}
      {queue && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            hintStyle="plain"
            label={t("mOpen")}
            value={queue.counts.open ?? 0}
            tone="warn"
            hint={t("mOpenHint")}
          />
          <MetricCard
            hintStyle="plain"
            label={t("mInProgress")}
            value={queue.counts.in_progress ?? 0}
            hint={t("mInProgressHint")}
          />
          <MetricCard
            hintStyle="plain"
            label={t("mClaimed")}
            value={queue.counts.fixed_claimed ?? 0}
            hint={t("mClaimedHint")}
            caption={t("mClaimedCaption")}
          />
          <MetricCard
            hintStyle="plain"
            label={t("mVerified")}
            value={queue.counts.verified_resolved ?? 0}
            tone="pos"
            hint={t("mVerifiedHint")}
          />
        </div>
      )}

      {/* 状态分布（点击图例筛选；fixed_claimed 与 verified_resolved 分开计数） */}
      {queue && tasks.length > 0 && (
        <div className="card-a mt-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("distStatus")}</div>
            <button
              onClick={() => setFilter("all")}
              className={`btn-secondary px-3 py-1 text-xs ${filter === "all" ? "ring-1 ring-ink-25" : ""}`}
            >
              {t("filterAll")} ({tasks.length})
            </button>
          </div>
          <div className="mt-3">
            <DistributionBar segments={statusSegments} label={t("distStatus")} />
          </div>
          <div className="mt-3">
            <DistributionLegend segments={statusSegments} />
          </div>
          <p className="mt-2 font-sans text-xs text-ink-40">{t("distHint")}</p>
        </div>
      )}

      {/* Coverage gaps（诚实的数据缺口；基础覆盖信息在页头 meta 条） */}
      {queue && queue.coverage.gaps.length > 0 && (
        <div className="card-a mt-5 p-4">
          <div className="font-sans text-xs font-semibold text-ink-60">{t("coverage.gapsTitle")}</div>
          <ul className="mt-1 list-disc pl-4">
            {queue.coverage.gaps.map((g) => (
              <li key={g} className="font-sans text-xs text-ink-40">
                {t(`gap.${g}` as "gap.no_completed_audit")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 筛选为空 */}
      {!loading && tasks.length > 0 && visible.length === 0 && (
        <div className="card-a mt-5 py-10 text-center font-sans text-sm text-ink-40">{t("noTasks")}</div>
      )}

      {/* Task list（紧凑表格 + 展开详情，机制不变） */}
      {visible.length > 0 && (
        <div className="mt-5">
          <DataTable minWidthRem={58} ariaLabel={t("title")}>
            <THead>
              <Th width="4.5rem">{t("colPriority")}</Th>
              <Th>{t("colTask")}</Th>
              <Th width="6rem">{t("colSource")}</Th>
              <Th width="13rem">{t("colTarget")}</Th>
              <Th width="10rem">{t("colStatus")}</Th>
              <Th width="11rem">{t("colNext")}</Th>
            </THead>
            <TBody>
              {visible.map((task) => {
                const isOpen = expanded === task.id;
                const title = pickText(task.title, locale) ?? task.fallbackTitle ?? task.type;
                const recommendation = pickText(task.recommendation, locale);
                const primary = task.execution.available ? task.execution.primary : null;
                return (
                  <Fragment key={task.id}>
                    <TR
                      onClick={() => setExpanded(isOpen ? null : task.id)}
                      className={isOpen ? "bg-line-soft/40" : ""}
                    >
                      <TD>
                        <StatusBadge label={task.priority.level} tone={priorityTone(task.priority.level)} />
                      </TD>
                      <TD>
                        <span className="block max-w-[18rem] truncate text-sm font-medium text-ink" title={title}>
                          {title}
                        </span>
                      </TD>
                      <TD>
                        <span className="whitespace-nowrap text-xs text-ink-60">
                          {t(task.source === "audit" ? "source.audit" : "source.opportunity")}
                        </span>
                      </TD>
                      <TD>
                        {task.target ? (
                          <span
                            className="block max-w-[12rem] truncate font-mono text-xs text-ink-40"
                            title={task.target}
                          >
                            {task.target.replace(/^https?:\/\//, "")}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-40">—</span>
                        )}
                      </TD>
                      <TD>
                        <StatusBadge
                          label={t(`status.${task.status}` as "status.open")}
                          tone={unifiedStatusTone(task.status)}
                        />
                      </TD>
                      <TD>
                        {primary ? (
                          <Link
                            href={primary.href}
                            onClick={(e) => e.stopPropagation()}
                            // 11rem 列宽容不下最长的「在审计中打开受影响页面」，
                            // truncate 会切掉尾词；与同行 TASK/TARGET 单元格一致补 title。
                            title={t(primary.labelKey as "act.openIssue")}
                            className="btn-secondary inline-block max-w-[10rem] truncate px-2 py-1 text-xs"
                          >
                            {t(primary.labelKey as "act.openIssue")} →
                          </Link>
                        ) : task.source === "opportunity" ? (
                          <Link
                            href="/app/opportunities"
                            onClick={(e) => e.stopPropagation()}
                            className="whitespace-nowrap font-mono text-xs text-brand hover:underline"
                          >
                            {t("act.openOpportunities")} →
                          </Link>
                        ) : (
                          <span
                            className="text-xs text-ink-40"
                            title={
                              task.execution.unavailableReason
                                ? t(`act.${task.execution.unavailableReason}` as "act.executionUnavailable")
                                : undefined
                            }
                          >
                            —
                          </span>
                        )}
                      </TD>
                    </TR>

                    {/* 展开详情：证据 / 优先级理由 / 建议 / 验证 / 观测 / 执行入口 / 状态置位（全部保留） */}
                    {isOpen && (
                      <TR className="bg-line-soft/20">
                        <TD colSpan={6}>
                          <div className="space-y-4 text-xs">
                            {/* 状态含义（明确区分"标记"与"已验证"） */}
                            <div className="flex flex-wrap items-center gap-2">
                              {task.severity && (
                                <span className={task.severity === "error" ? "badge-err" : task.severity === "warning" ? "badge-warn" : "badge-info"}>
                                  {t(`sev.${task.severity}` as "sev.error")}
                                </span>
                              )}
                              <span className={task.provenance === "observed" ? "badge-pos" : "badge-info"}>
                                {t(`provenance.${task.provenance}` as "provenance.observed")}
                              </span>
                              <span className="font-sans text-ink-60">
                                {t(`status.${task.status}_hint` as "status.open_hint")}
                              </span>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-3">
                              {/* 证据 */}
                              <div>
                                <div className="font-sans font-semibold text-ink-60">{t("evidenceTitle")}</div>
                                <ul className="mt-1 space-y-1">
                                  {task.evidence.map((e, i) => (
                                    <li key={`${e.ref}-${i}`} className="break-all font-mono text-ink-40">
                                      [{e.source}] {e.summary || e.ref}
                                    </li>
                                  ))}
                                  {task.evidence.length === 0 && <li className="font-sans text-ink-40">—</li>}
                                </ul>
                              </div>

                              {/* 优先级理由（可解释） */}
                              <div>
                                <div className="font-sans font-semibold text-ink-60">{t("priority.why")}</div>
                                <ul className="mt-1 list-disc pl-4">
                                  {task.priority.reasons.map((r, i) => (
                                    <li key={`${r.code}-${i}`} className="font-sans text-ink-40">
                                      {r.value !== undefined
                                        ? t(`reason.${r.code}` as "reason.effort_low", { value: r.value })
                                        : t(`reason.${r.code}` as "reason.effort_low")}
                                    </li>
                                  ))}
                                </ul>
                                <div className="mt-1 font-mono text-ink-40">
                                  {t(`effort.${task.effort}` as "effort.low")}
                                </div>
                              </div>

                              {/* 建议行动 + 验证 */}
                              <div>
                                <div className="font-sans font-semibold text-ink-60">{t("recommendationTitle")}</div>
                                <p className="mt-1 font-sans text-ink-60">
                                  {recommendation ?? pickText(task.recommendationI18n, locale) ?? task.recommendationText ?? "—"}
                                </p>
                                <div className="mt-1 font-mono text-ink-40">
                                  {t(`provenance.${task.provenance}` as "provenance.observed")} ·{" "}
                                  {t(`channel.${task.verificationChannel.channelKey}` as "channel.channel_none")}
                                </div>
                                <div className="mt-3 font-sans font-semibold text-ink-60">{t("verificationTitle")}</div>
                                <p className="mt-1 font-sans text-ink-60">
                                  {task.verification.status === "pass"
                                    ? t("verification.pass", { auditId: task.verification.auditId ?? 0 })
                                    : task.verification.status === "fail"
                                      ? t("verification.fail", {
                                          auditId: task.verification.auditId ?? 0,
                                          findings: task.verification.findings ?? 0,
                                          pages: task.verification.affectedPages ?? 0,
                                        })
                                      : task.verification.status === "inconclusive"
                                        ? t("verification.inconclusive", { auditId: task.verification.auditId ?? 0 })
                                        : t("verification.pending")}
                                </p>
                              </div>
                            </div>

                            {/* 结果反馈：执行前基线 → 后续观测（无基线时不伪造数字） */}
                            <div className="rounded-md border border-line bg-paper px-3 py-2">
                              <div className="font-sans font-semibold text-ink-60">{t("observation.title")}</div>
                              {task.observation ? (
                                <div className="mt-1 space-y-0.5">
                                  <div className="font-mono text-ink-60">
                                    {t(`observation.verdict.${task.observation.verdict}` as "observation.verdict.pending")}
                                    {task.observation.note
                                      ? ` · ${t(`observation.reason.${task.observation.note}` as "observation.reason.missing_metrics")}`
                                      : ""}
                                  </div>
                                  {/* Before → After：只展示两侧都有的同键指标，缺失侧如实显示 —，不编造百分比 */}
                                  {task.observation.baseline && task.observation.latest ? (
                                    <div className="font-mono text-ink-60">
                                      {Object.keys(task.observation.baseline)
                                        .filter(
                                          (k) =>
                                            task.observation!.baseline?.[k] !== null &&
                                            task.observation!.baseline?.[k] !== undefined &&
                                            task.observation!.latest?.[k] !== null &&
                                            task.observation!.latest?.[k] !== undefined
                                        )
                                        .map((k) => (
                                          <span key={k} className="mr-3">
                                            {k}: {String(task.observation!.baseline![k])} → {String(task.observation!.latest![k])}
                                          </span>
                                        )) || null}
                                    </div>
                                  ) : null}
                                  {(!task.observation.baseline ||
                                    !task.observation.latest ||
                                    Object.keys(task.observation.baseline).length === 0 ||
                                    Object.keys(task.observation.latest).length === 0) && (
                                    <>
                                      <div className="font-mono text-ink-40">
                                        {t("observation.baseline")}:{" "}
                                        {task.observation.baseline
                                          ? Object.entries(task.observation.baseline)
                                              .map(([k, v]) => `${k}=${v === null ? "—" : v}`)
                                              .join(" · ") || "—"
                                          : "—"}
                                      </div>
                                      <div className="font-mono text-ink-40">
                                        {t("observation.latest")}:{" "}
                                        {task.observation.latest
                                          ? Object.entries(task.observation.latest)
                                              .map(([k, v]) => `${k}=${v === null ? "—" : v}`)
                                              .join(" · ") || "—"
                                          : "—"}
                                      </div>
                                    </>
                                  )}
                                  <div className="font-mono text-ink-40">
                                    {t("observation.measurements", { n: task.observation.observations })}
                                    {task.observation.windowDays
                                      ? ` · ${t("observation.window", { n: task.observation.windowDays })}`
                                      : ""}
                                  </div>
                                  {/* 判定之后的下一步（有效 / 无变化 / 变差 / 无法判断 各自明确） */}
                                  <p className="mt-1 font-sans text-ink-60">
                                    {t(
                                      `observation.next.${task.observation.verdict}` as "observation.next.pending"
                                    )}
                                  </p>
                                </div>
                              ) : (
                                <p className="mt-1 font-sans text-ink-40">
                                  {!task.verificationChannel.verifiable
                                    ? t("observation.notVerifiable")
                                    : task.source === "opportunity"
                                      ? t("observation.trackFirst")
                                      : t("observation.noBaseline")}
                                </p>
                              )}
                            </div>

                            {/* 下一步：真实执行入口（无入口时如实说明，绝不留空按钮） */}
                            <div>
                              <div className="font-sans font-semibold text-ink-60">{t("act.nextStepTitle")}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                {task.execution.available && task.execution.primary ? (
                                  <>
                                    {/* labelKey 已含 act. 前缀（work-queue 产出 "act.openIssue"），不能再次拼接 */}
                                    <Link href={task.execution.primary.href} className="btn-primary px-3 py-1.5 text-xs">
                                      {t(task.execution.primary.labelKey as "act.openIssue")} →
                                    </Link>
                                    {task.execution.secondary.map((s) => (
                                      <Link key={s.href} href={s.href} className="btn-secondary px-3 py-1.5 text-xs">
                                        {t(s.labelKey as "act.rerunAudit")}
                                      </Link>
                                    ))}
                                  </>
                                ) : (
                                  <p className="font-sans text-ink-40">
                                    {task.execution.unavailableReason
                                      ? t(`act.${task.execution.unavailableReason}` as "act.executionUnavailable")
                                      : t("act.executionUnavailable")}
                                  </p>
                                )}
                                {task.source === "opportunity" && (
                                  <Link href="/app/opportunities" className="font-mono text-xs text-brand hover:underline">
                                    {t("act.openOpportunities")} →
                                  </Link>
                                )}
                              </div>
                            </div>

                            {/* 处理状态：技术问题可直接置位；机会按既有五步状态机管理（不强行合并状态模型） */}
                            <div className="flex flex-wrap items-center gap-2">
                              {task.source === "audit" ? (
                                USER_ACTIONS.filter((a) => a.to !== task.status).map((a) => (
                                  <button
                                    key={a.to}
                                    onClick={() => void updateStatus(task, a.to)}
                                    disabled={busy === task.id}
                                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-60"
                                  >
                                    {busy === task.id ? t("act.saving") : t(`act.${a.labelKey}` as "act.markFixed")}
                                  </button>
                                ))
                              ) : (
                                <span className="font-sans text-ink-40">{t("status.managedInEngine")}</span>
                              )}
                            </div>
                          </div>
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </DataTable>
        </div>
      )}

      <Toast />
    </div>
  );
}
