"use client";

// ===== SEO Opportunities 页面（P1 / P4 产品化 + viz 设计系统改版） =====
// 快速看出：有多少机会、哪些最值得处理、各自下一步是什么。
// 列表 + 状态流转 + 验证 + GitHub PR 执行闭环（状态机与机制不变）。
// 执行状态严格区分：Preview Ready → Approved → PR Created → Awaiting Review
// → Merged → Verifying → Completed（以及 Conflict / Failed / Manual）。
// 绝不显示模糊的 "Processing..."：每个状态都对应真实阶段。

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { resolveApiErrorMessage, readUiLocale } from "@/lib/billing-error-client";
import { SELECTED_PROJECT_KEY, PROJECT_CHANGED_EVENT } from "@/lib/project-selector";
import MetricCard from "@/components/viz/MetricCard";
import PageHeader from "@/components/viz/PageHeader";
import { StatusBadge } from "@/components/viz/StatusBadge";
import {
  DistributionBar,
  DistributionLegend,
  type DistributionSegment,
} from "@/components/viz/DistributionBar";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { priorityTone, type VizTone } from "@/components/viz/tokens";

interface OpportunityRow {
  id: number;
  type: string;
  targetType: string;
  targetValue: string;
  priority: "P0" | "P1" | "P2";
  impact: string | null;
  confidence: string | null;
  status: string;
  recommendation: string | null;
  evidence: Array<{ source: string; ref: string; summary: string }>;
  actionPlan: { executionMode: string; actionType: string; steps: string[] } | null;
  verification: Array<{ check: string; status: string; detail: string | null }> | null;
}

interface ActionRow {
  id: number;
  actionType: string;
  executionMode: string;
  status: string;
  plan: { steps?: string[]; recommendation?: string; filePath?: string; newContent?: string } | null;
  preview: {
    kind: string;
    target: string;
    currentState: string[];
    exactSteps: string[];
    expectedResult: string;
    verificationPlan: string[];
    rollbackNotes: string;
    githubFiles?: Array<{ path: string; before: string; beforeSha: string }>;
  } | null;
  result: { repository?: string; branch?: string; baseSha?: string; commitSha?: string; prNumber?: number; prUrl?: string; prState?: string; error?: string } | null;
  events: Array<{ event: string; by: string; at: string; detail?: string }>;
  approvedAt: string | null;
  approvedBy: string | null;
  errorCode: string | null;
}

interface GitHubConnection {
  connected: boolean;
  owner?: string;
  repository?: string;
  defaultBranch?: string;
  authMode?: string;
  connectedAt?: string;
}

interface ScanSummary {
  generated: number;
  refreshed: number;
  suppressed: number;
  dataGaps: string[];
}

/** 机会类型（与 Opportunity Engine 的枚举对齐；仅用于展示层配色/文案映射，不改引擎） */
const OP_TYPE_ORDER: string[] = [
  "rank_improvement",
  "lost_recovery",
  "content_refresh",
  "competitor_gap",
  "ctr",
  "ai_visibility",
  "technical",
];

const OP_TYPE_TONE: Record<string, VizTone> = {
  technical: "neg",
  content_refresh: "warn",
  rank_improvement: "pos",
  lost_recovery: "accent",
  competitor_gap: "info",
  ctr: "warn",
  ai_visibility: "pos",
};

const OP_STATUS_TONE: Record<string, VizTone> = {
  new: "warn",
  reviewed: "info",
  approved: "accent",
  in_progress: "info",
  completed: "pos",
  dismissed: "neutral",
};

const PRIORITY_LEVELS = ["P0", "P1", "P2"] as const;

/** GitHub 执行阶段（与后端 action.status + result 对应，不模糊化） */
type GithubStage = "preview_ready" | "approved" | "preparing" | "awaiting_review" | "merged" | "conflict" | "failed";

function githubStage(action: ActionRow | null): GithubStage | null {
  if (!action || action.executionMode !== "github") return null;
  if (action.status === "completed") return "merged";
  if (action.status === "failed") return action.errorCode === "EXECUTION_CONFLICT" ? "conflict" : "failed";
  if (action.status === "executing") return action.result?.prUrl ? "awaiting_review" : "preparing";
  if (action.status === "approved") return "approved";
  return action.preview ? "preview_ready" : "preview_ready";
}

// BUG-41：本页此前把服务端中文 error 原文与一组硬编码中文提示直接吐进 toast/正文，
// 英文界面下就是半中半英。改为按 code 命中 apiErrors catalog（EN/ZH）；
// 只传 code 不传 error —— 未知 code 落到调用方给的本地化兜底，绝不回显上游原文。
function friendlyError(code: string | undefined, fallback: string): string {
  return resolveApiErrorMessage(code ? { code } : {}, readUiLocale(), fallback);
}

export default function OpportunitiesPage() {
  const t = useTranslations("dashboard.opportunities");
  const { show, Toast } = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [action, setAction] = useState<ActionRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [github, setGithub] = useState<GitHubConnection | null>(null);
  const [githubError, setGithubError] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectForm, setConnectForm] = useState({ owner: "", repository: "", token: "" });
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<"P0" | "P1" | "P2" | null>(null);

  const loadGithub = useCallback(async (pid: string) => {
    setGithubError(false);
    try {
      const res = await fetch(`/api/integrations/github?project_id=${encodeURIComponent(pid)}`, { cache: "no-store" });
      const json = await res.json();
      // 读取失败只落到本地化的失败态（错误详情由各自 code 的 catalog 文案承担，不外泄原文）
      if (!res.ok) {
        setGithub(null);
        setGithubError(true);
        return;
      }
      setGithub(json.data ?? { connected: false });
    } catch {
      setGithub(null);
      setGithubError(true);
    }
  }, []);

  async function connectGithub() {
    if (!projectId || !connectForm.owner || !connectForm.repository) return;
    setConnectBusy(true);
    try {
      const res = await fetch(`/api/integrations/github?project_id=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: connectForm.owner,
          repository: connectForm.repository,
          ...(connectForm.token ? { token: connectForm.token } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyError(json.code, t("requestFailed")));
      setGithub(json.data);
      setConnectForm({ owner: "", repository: "", token: "" });
      show(t("githubConnected"));
    } catch (e) {
      show((e as Error).message);
    } finally {
      setConnectBusy(false);
    }
  }

  async function disconnectGithub() {
    if (!projectId) return;
    setConnectBusy(true);
    try {
      const res = await fetch(`/api/integrations/github?project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyError(json.code, t("requestFailed")));
      setGithub({ connected: false });
      show(t("githubDisconnected"));
    } catch (e) {
      show((e as Error).message);
    } finally {
      setConnectBusy(false);
    }
  }

  const loadAction = useCallback(async (opportunityId: number, operation?: "preview") => {
    setActionBusy(true);
    try {
      if (operation === "preview") {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunity_id: opportunityId, operation: "preview" }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(friendlyError(json.code, t("previewFailed")));
        setAction(json.data?.action ?? null);
        return;
      }
      const res = await fetch(`/api/actions?opportunity_id=${opportunityId}`, { cache: "no-store" });
      const json = await res.json();
      setAction(json.data?.action ?? null);
    } catch (e) {
      show((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }, [show, t]);

  async function actionOperation(opportunityId: number, operation: "approve" | "complete" | "execute" | "status") {
    setActionBusy(true);
    try {
      const body: Record<string, unknown> = { opportunity_id: opportunityId, operation };
      if (operation === "execute") {
        // spec 必须显式（UI 从 action plan 读取持久化的 file mapping，绝不猜 URL→文件）
        if (!action?.plan?.filePath || !action?.plan?.newContent) {
          show(friendlyError("EXECUTION_TARGET_NOT_FOUND", t("requestFailed")));
          setActionBusy(false);
          return;
        }
        body.file_path = action.plan.filePath;
        body.new_content = action.plan.newContent;
      }
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyError(json.code, t("requestFailed")));
      if (operation === "execute") {
        show(t("prCreated", { url: json.data?.execution?.prUrl ?? "" }));
        await loadAction(opportunityId);
      } else if (operation === "status") {
        setAction(json.data?.action ?? null);
        const stage = json.data?.status?.stage;
        if (stage === "awaiting_review") show(t("stageAwaitingReview"));
        else if (stage === "merged" || stage === "verifying") show(t("stageMerged"));
        else if (stage === "closed") show(t("stageClosed"));
        else show(t("stageNone"));
      } else {
        setAction(json.data?.action ?? null);
        show(operation === "approve" ? t("actionApproved") : t("manualCompleted"));
      }
      if (projectId) await load(projectId);
    } catch (e) {
      show((e as Error).message);
      await loadAction(opportunityId);
    } finally {
      setActionBusy(false);
    }
  }

  // 与 competitors 页一致：localStorage 选中项目 + Topbar 切换事件
  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyStored = () => {
      const stored = window.localStorage.getItem(SELECTED_PROJECT_KEY);
      if (stored) setProjectId((prev) => (prev === stored ? prev : stored));
    };
    const tid = window.setTimeout(applyStored, 0);
    const onProjectChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail && typeof detail.id === "string" && detail.id) {
        setProjectId((prev) => (prev === detail.id ? prev : detail.id));
      }
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
    window.addEventListener("storage", applyStored);
    return () => {
      window.clearTimeout(tid);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
      window.removeEventListener("storage", applyStored);
    };
  }, []);

  const load = useCallback(async (pid: string) => {
    setRows(null);
    try {
      const res = await fetch(`/api/opportunities?project_id=${encodeURIComponent(pid)}`, { cache: "no-store" });
      const json = await res.json();
      setRows(json.data?.opportunities ?? []);
    } catch {
      show(t("loadFailed"));
      setRows([]);
    }
  }, [show, t]);

  // effect 只依赖 projectId：useToast 的 show 每次渲染都是新引用，
  // 若把依赖它的 load/loadGithub 放进依赖数组会导致无限请求循环。
  // 用 ref 持有最新回调（P4 UI smoke 实测发现并修复的请求风暴缺陷）。
  const loadRef = useRef(load);
  const loadGithubRef = useRef(loadGithub);
  useEffect(() => {
    loadRef.current = load;
    loadGithubRef.current = loadGithub;
  });
  useEffect(() => {
    if (!projectId) return;
    // 延迟到下一帧，避免 effect 内同步 setState（react-compiler 规则）
    const tid = window.setTimeout(() => {
      void loadRef.current(projectId);
      void loadGithubRef.current(projectId);
    }, 0);
    return () => window.clearTimeout(tid);
  }, [projectId]);

  async function runScan() {
    if (!projectId) return;
    setScanning(true);
    try {
      const res = await fetch("/api/opportunities/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyError(json.code, t("scanFailed")));
      const summary = json.data as ScanSummary;
      show(
        summary.dataGaps.length > 0
          ? t("scanDoneWithGaps", { generated: summary.generated, refreshed: summary.refreshed, gaps: summary.dataGaps.length })
          : t("scanDone", { generated: summary.generated, refreshed: summary.refreshed })
      );
      await load(projectId);
    } catch (e) {
      show((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function transition(id: number, status: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/opportunities/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyError(json.code, t("requestFailed")));
      if (projectId) await load(projectId);
    } catch (e) {
      show((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function verify(id: number) {
    setBusyId(id);
    try {
      const res = await fetch("/api/opportunities/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyError(json.code, t("verifyFailed")));
      show(t("verifyDone"));
      if (projectId) await load(projectId);
    } catch (e) {
      show((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const nextActions: Record<string, Array<{ label: string; status: string }>> = {
    new: [{ label: "reviewBtn", status: "reviewed" }, { label: "dismissBtn", status: "dismissed" }],
    reviewed: [{ label: "approveBtn", status: "approved" }, { label: "dismissBtn", status: "dismissed" }],
    approved: [{ label: "startBtn", status: "in_progress" }, { label: "dismissBtn", status: "dismissed" }],
    in_progress: [{ label: "completeBtn", status: "completed" }, { label: "verifyBtn", status: "__verify" }],
  };

  const stage = githubStage(action);
  const stageLabel: Record<GithubStage, string> = {
    preview_ready: t("stage.previewReady"),
    approved: t("stage.approved"),
    preparing: t("stage.preparing"),
    awaiting_review: t("stage.awaitingReview"),
    merged: t("stage.merged"),
    conflict: t("stage.conflict"),
    failed: t("stage.failed"),
  };

  // ---- 派生统计（全部来自真实 rows，绝不虚构） ----
  const allRows = rows ?? [];
  const filteredRows = allRows.filter(
    (r) => (!typeFilter || r.type === typeFilter) && (!priorityFilter || r.priority === priorityFilter)
  );
  const p0Count = allRows.filter((r) => r.priority === "P0").length;
  const p1Count = allRows.filter((r) => r.priority === "P1").length;
  const p2Count = allRows.filter((r) => r.priority === "P2").length;
  const statusCount = (s: string) => allRows.filter((r) => r.status === s).length;
  const typeCount = (ty: string) => allRows.filter((r) => r.type === ty).length;
  const newCount = statusCount("new");
  const reviewedCount = statusCount("reviewed");
  const approvedCount = statusCount("approved");
  const inProgressCount = statusCount("in_progress");
  const completedCount = statusCount("completed");

  const OP_TYPES_KNOWN = new Set(OP_TYPE_ORDER);
  const typeLabel = (ty: string) => (OP_TYPES_KNOWN.has(ty) ? t(`opType.${ty}` as "opType.technical") : ty);
  const OP_STATUSES_KNOWN = new Set(Object.keys(OP_STATUS_TONE));
  const statusLabel = (s: string) => (OP_STATUSES_KNOWN.has(s) ? t(`opStatus.${s}` as "opStatus.new") : s);

  const typeSegments: DistributionSegment[] = OP_TYPE_ORDER.filter((ty) => typeCount(ty) > 0).map((ty) => ({
    key: ty,
    label: typeLabel(ty),
    value: typeCount(ty),
    tone: OP_TYPE_TONE[ty] ?? "info",
    onClick: () => setTypeFilter((prev) => (prev === ty ? null : ty)),
  }));

  const prioritySegments: DistributionSegment[] = PRIORITY_LEVELS.map((p) => ({
    key: p,
    label: p,
    value: p === "P0" ? p0Count : p === "P1" ? p1Count : p2Count,
    tone: priorityTone(p),
    onClick: () => setPriorityFilter((prev) => (prev === p ? null : p)),
  }));

  return (
    <div className="dash-container space-y-5 p-4 lg:p-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <button
            type="button"
            onClick={runScan}
            disabled={scanning || !projectId}
            className="btn-primary flex-none disabled:opacity-60"
          >
            {scanning ? t("scanning") : t("scanBtn")}
          </button>
        }
        meta={
          rows !== null ? (
            <>
              <span>{t("metaCount", { n: allRows.length })}</span>
              <span>
                {t("github.title")}:{" "}
                {github?.connected ? `${github.owner}/${github.repository}` : t("github.notConnected")}
              </span>
            </>
          ) : null
        }
      />

      {/* Loading skeleton */}
      {rows === null && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-line bg-paper" />
          ))}
        </div>
      )}

      {/* 指标卡（全部来自真实 rows；rows 为 null 时不渲染，不用 0 冒充） */}
      {rows !== null && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            hintStyle="plain"
            label={t("mAll")}
            value={allRows.length}
            hint={t("mAllHint")}
          />
          <MetricCard
            hintStyle="plain"
            label={t("mHigh")}
            value={p0Count + p1Count}
            tone={p0Count > 0 ? "neg" : p1Count > 0 ? "warn" : undefined}
            hint={t("mHighHint")}
            caption={t("mHighCaption", { p0: p0Count, p1: p1Count })}
          />
          <MetricCard
            hintStyle="plain"
            label={t("mNew")}
            value={newCount + reviewedCount}
            hint={t("mNewHint")}
            caption={t("mNewCaption", { n: newCount, r: reviewedCount })}
          />
          <MetricCard
            hintStyle="plain"
            label={t("mActive")}
            value={approvedCount + inProgressCount}
            hint={t("mActiveHint")}
            caption={t("mActiveCaption", { a: approvedCount, i: inProgressCount, c: completedCount })}
          />
        </div>
      )}

      {/* 分布（只有真实存在的类型才进类型分布；优先级三档都展示，0 是真实含义） */}
      {rows !== null && allRows.length > 0 && (
        <div className="card-a grid gap-6 p-4 sm:grid-cols-2">
          <div>
            <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("distType")}</div>
            <div className="mt-2">
              <DistributionBar segments={typeSegments} label={t("distType")} />
            </div>
            <div className="mt-3">
              <DistributionLegend segments={typeSegments} />
            </div>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("distPriority")}</div>
            <div className="mt-2">
              <DistributionBar segments={prioritySegments} label={t("distPriority")} />
            </div>
            <div className="mt-3">
              <DistributionLegend segments={prioritySegments} />
            </div>
            <p className="mt-2 font-sans text-xs text-ink-40">{t("distHint")}</p>
          </div>
        </div>
      )}

      {/* 空状态：真实的下一步入口（扫描） */}
      {rows !== null && allRows.length === 0 && (
        <div className="card-a flex flex-col items-center justify-center py-12 text-center">
          <div className="font-display text-sm font-semibold text-ink">{t("emptyTitle")}</div>
          <p className="mt-1 max-w-md font-sans text-sm text-ink-40">{t("empty")}</p>
          <button
            type="button"
            onClick={runScan}
            disabled={scanning || !projectId}
            className="btn-primary mt-4 disabled:opacity-60"
          >
            {scanning ? t("scanning") : t("scanBtn")}
          </button>
        </div>
      )}

      {rows !== null && allRows.length > 0 && (
        <>
          {/* 活动筛选提示 */}
          {(typeFilter || priorityFilter) && (
            <div className="flex flex-wrap items-center gap-2">
              {typeFilter && (
                <button type="button" onClick={() => setTypeFilter(null)} className="badge-info">
                  {t("filterType", { type: typeLabel(typeFilter) })} ✕
                </button>
              )}
              {priorityFilter && (
                <button type="button" onClick={() => setPriorityFilter(null)} className="badge-info">
                  {t("filterPriority", { p: priorityFilter })} ✕
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setTypeFilter(null);
                  setPriorityFilter(null);
                }}
                className="font-mono text-xs text-ink-40 underline"
              >
                {t("filterClear")}
              </button>
            </div>
          )}

          {filteredRows.length === 0 ? (
            <div className="card-a py-10 text-center font-sans text-sm text-ink-40">{t("filteredEmpty")}</div>
          ) : (
            <DataTable minWidthRem={62} ariaLabel={t("title")}>
              <THead>
                <Th width="5.5rem">{t("colPriority")}</Th>
                <Th width="8rem">{t("colType")}</Th>
                <Th>{t("colTarget")}</Th>
                <Th width="15rem">{t("colEvidence")}</Th>
                <Th width="7.5rem">{t("colStatus")}</Th>
                <Th width="9rem" align="right">{t("colAction")}</Th>
              </THead>
              <TBody>
                {filteredRows.map((row) => {
                  const firstAction = (nextActions[row.status] ?? [])[0];
                  return (
                    <Fragment key={row.id}>
                      <TR
                        onClick={() => {
                          const next = expandedId === row.id ? null : row.id;
                          setExpandedId(next);
                          if (next !== null) void loadAction(row.id);
                        }}
                        className={expandedId === row.id ? "bg-line-soft/40" : ""}
                      >
                        <TD>
                          <StatusBadge label={row.priority} tone={priorityTone(row.priority)} />
                        </TD>
                        <TD>
                          <span className="whitespace-nowrap rounded bg-line-soft px-1.5 py-0.5 font-mono text-xs text-ink-60">
                            {typeLabel(row.type)}
                          </span>
                        </TD>
                        <TD>
                          <span
                            className="block max-w-[16rem] truncate text-sm font-medium text-ink"
                            title={row.targetValue}
                          >
                            {row.targetValue}
                          </span>
                        </TD>
                        <TD>
                          {row.evidence.length > 0 ? (
                            <span
                              className="block max-w-[15rem] truncate text-xs text-ink-60"
                              title={row.evidence.map((e) => `[${e.source}] ${e.summary}`).join("\n")}
                            >
                              {row.evidence[0].summary}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-40">{t("noEvidence")}</span>
                          )}
                        </TD>
                        <TD>
                          <StatusBadge label={statusLabel(row.status)} tone={OP_STATUS_TONE[row.status] ?? "info"} />
                        </TD>
                        <TD align="right">
                          {firstAction ? (
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (firstAction.status === "__verify") void verify(row.id);
                                else void transition(row.id, firstAction.status);
                              }}
                              className="whitespace-nowrap rounded border border-line-soft px-2 py-1 text-xs text-ink disabled:opacity-50"
                            >
                              {t(firstAction.label)}
                            </button>
                          ) : (
                            <span className="text-xs text-ink-40">—</span>
                          )}
                        </TD>
                      </TR>

                      {/* 展开详情：保留全部既有机制（状态机 / GitHub PR / 验证） */}
                      {expandedId === row.id && (
                        <TR className="bg-line-soft/20">
                          <TD colSpan={6}>
                            <div className="space-y-3 text-xs">
                              {row.recommendation && <p className="text-sm text-ink-80">{row.recommendation}</p>}

                              {row.evidence.length > 0 && (
                                <div>
                                  <div className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-40">
                                    {t("colEvidence")}
                                  </div>
                                  <ul className="mt-1 space-y-1 text-ink-60">
                                    {row.evidence.map((item, index) => (
                                      <li key={index}>• [{item.source}] {item.summary}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {row.actionPlan && (
                                <div>
                                  <div className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-40">
                                    {t("actionPlan")}
                                  </div>
                                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-60">
                                    {row.actionPlan.steps.map((step, index) => (
                                      <li key={index}>{step}</li>
                                    ))}
                                  </ol>
                                </div>
                              )}

                              {row.verification && row.verification.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {row.verification.map((check, index) => (
                                    <span
                                      key={index}
                                      className={`rounded px-2 py-0.5 ${check.status === "pass" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : check.status === "failed" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-line-soft text-ink-60"}`}
                                    >
                                      {check.check}: {check.status === "pending" ? t("pending") : check.status}
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div className="rounded border border-line-soft p-3">
                                {actionBusy && <span className="text-ink-60">…</span>}
                                {action && (
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap gap-2 text-ink-60">
                                      <span>execution mode: {action.executionMode === "github" ? "GitHub PR" : action.executionMode}</span>
                                      {stage && <span className="rounded bg-line-soft px-2 py-0.5 font-medium text-ink">{stageLabel[stage]}</span>}
                                      {action.approvedAt && <span>approved: {action.approvedAt}{action.approvedBy ? ` (${action.approvedBy})` : ""}</span>}
                                    </div>

                                    {/* GitHub preview：真实 before/after（来自仓库实读） */}
                                    {action.preview?.githubFiles && action.preview.githubFiles.length > 0 && (
                                      <div className="space-y-1">
                                        <div className="font-medium text-ink">{t("previewTitle")} · {action.preview.githubFiles[0].path}</div>
                                        <pre className="overflow-x-auto rounded bg-line-soft p-2 text-xs leading-relaxed text-ink-60">{action.preview.githubFiles[0].before}</pre>
                                        <div className="text-ink-40">↓ {t("previewAfter")}（blob {action.preview.githubFiles[0].beforeSha.slice(0, 8)}）</div>
                                        {action.plan?.newContent && (
                                          <pre className="overflow-x-auto rounded bg-emerald-500/10 p-2 text-xs leading-relaxed text-ink-80">{action.plan.newContent}</pre>
                                        )}
                                      </div>
                                    )}

                                    {/* manual preview：结构化指令包（不伪造 diff） */}
                                    {action.preview && !action.preview.githubFiles && (
                                      <div className="space-y-1">
                                        <div className="font-medium text-ink">{t("previewTitle")}</div>
                                        <ol className="list-decimal space-y-1 pl-5">
                                          {action.preview.exactSteps.map((step, index) => <li key={index}>{step}</li>)}
                                        </ol>
                                        <div>→ {action.preview.expectedResult}</div>
                                        <div className="text-ink-40">rollback: {action.preview.rollbackNotes}</div>
                                      </div>
                                    )}

                                    {/* 冲突 UX（P4 §30）：明确告知 + 刷新预览恢复路径，绝不自动重试 */}
                                    {stage === "conflict" && (
                                      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                                        {t("conflictMsg")}
                                      </div>
                                    )}
                                    {stage === "failed" && action.errorCode && (
                                      <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-700 dark:text-red-400">
                                        {friendlyError(action.errorCode, t("execFailed"))}
                                      </div>
                                    )}

                                    {/* PR 真实状态（P4 §34）：PR created ≠ merged ≠ verified */}
                                    {action.result?.prUrl && (stage === "awaiting_review" || stage === "merged") && (
                                      <div className="space-y-1 rounded border border-line-soft p-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-medium text-ink">{t("prLabel")}</span>
                                          <a href={action.result.prUrl} target="_blank" rel="noopener noreferrer" className="rounded bg-ink px-2 py-0.5 font-medium text-paper">{t("openPrBtn")} →</a>
                                          <span className="text-ink-60">#{action.result.prNumber}</span>
                                        </div>
                                        <div className="font-mono text-ink-40">{action.result.branch}{action.result.commitSha ? ` @ ${action.result.commitSha.slice(0, 8)}` : ""}</div>
                                        {stage === "awaiting_review" && <div className="text-ink-60">{t("awaitingReviewHint")}</div>}
                                      </div>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                      <button type="button" disabled={actionBusy} onClick={() => void loadAction(row.id, "preview")} className="rounded border border-line-soft px-2 py-1 text-ink disabled:opacity-50">{t("previewBtn")}</button>
                                      {action.status === "planned" && <button type="button" disabled={actionBusy} onClick={() => actionOperation(row.id, "approve")} className="rounded border border-line-soft px-2 py-1 text-ink disabled:opacity-50">{t("approveActionBtn")}</button>}
                                      {/* GitHub 模式：approved → 创建 PR；executing → 刷新状态；不自动 merge */}
                                      {action.executionMode === "github" && action.status === "approved" && (
                                        <button type="button" disabled={actionBusy} onClick={() => void actionOperation(row.id, "execute")} className="rounded bg-ink px-2 py-1 font-medium text-paper disabled:opacity-50">{t("createPrBtn")}</button>
                                      )}
                                      {action.executionMode === "github" && (action.status === "executing" || action.status === "completed") && (
                                        <button type="button" disabled={actionBusy} onClick={() => void actionOperation(row.id, "status")} className="rounded border border-line-soft px-2 py-1 text-ink disabled:opacity-50">{t("refreshStatusBtn")}</button>
                                      )}
                                      {/* manual 模式：保持手动完成确认（不自动切换为 GitHub） */}
                                      {action.executionMode !== "github" && action.status === "approved" && <button type="button" disabled={actionBusy} onClick={() => actionOperation(row.id, "complete")} className="rounded border border-line-soft px-2 py-1 text-ink disabled:opacity-50">{t("manualCompleteBtn")}</button>}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* 全部状态流转动作（与既有状态机一致） */}
                              <div className="flex flex-wrap items-center gap-2">
                                {(nextActions[row.status] ?? []).map((na) => (
                                  <button
                                    key={na.status}
                                    type="button"
                                    disabled={busyId === row.id}
                                    onClick={() => (na.status === "__verify" ? void verify(row.id) : void transition(row.id, na.status))}
                                    className="rounded border border-line-soft px-2 py-1 text-ink disabled:opacity-50"
                                  >
                                    {t(na.label)}
                                  </button>
                                ))}
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
          )}
        </>
      )}

      {/* GitHub 连接卡片（P4 §27）：真实连接状态，不显示任何凭证 */}
      <div className="rounded-lg border border-line-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{t("github.title")}</span>
          {github?.connected ? (
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("github.connected")}</span>
          ) : (
            <span className="rounded bg-line-soft px-2 py-0.5 text-xs font-medium text-ink-60">{t("github.notConnected")}</span>
          )}
        </div>
        {githubError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t("githubStatusFailed")}</p>}
        {github?.connected ? (
          <div className="mt-2 space-y-1 text-xs text-ink-60">
            <div><span className="font-medium text-ink">{t("github.repository")}</span>: {github.owner}/{github.repository}</div>
            <div><span className="font-medium text-ink">{t("github.defaultBranch")}</span>: {github.defaultBranch}</div>
            <div><span className="font-medium text-ink">{t("github.authMode")}</span>: {github.authMode === "app" ? t("github.appMode") : t("github.patMode")}</div>
            <div className="flex gap-2 pt-1">
              <button type="button" disabled={connectBusy} onClick={() => void disconnectGithub()} className="rounded border border-line-soft px-2 py-1 text-ink disabled:opacity-50">{t("github.disconnectBtn")}</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-xs">
            <p className="text-ink-60">{t("github.connectHint")}</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={connectForm.owner}
                onChange={(e) => setConnectForm((f) => ({ ...f, owner: e.target.value }))}
                aria-label={t("github.ownerLabel")}
                placeholder={t("github.ownerPlaceholder")}
                className="w-32 rounded border border-line-soft bg-transparent px-2 py-1 text-ink placeholder:text-ink-40"
              />
              <input
                value={connectForm.repository}
                onChange={(e) => setConnectForm((f) => ({ ...f, repository: e.target.value }))}
                aria-label={t("github.repoLabel")}
                placeholder={t("github.repoPlaceholder")}
                className="w-48 rounded border border-line-soft bg-transparent px-2 py-1 text-ink placeholder:text-ink-40"
              />
              <input
                value={connectForm.token}
                onChange={(e) => setConnectForm((f) => ({ ...f, token: e.target.value }))}
                type="password"
                aria-label={t("github.tokenLabel")}
                placeholder={t("github.tokenPlaceholder")}
                className="w-56 rounded border border-line-soft bg-transparent px-2 py-1 text-ink placeholder:text-ink-40"
              />
              <button
                type="button"
                disabled={connectBusy || !connectForm.owner || !connectForm.repository}
                onClick={() => void connectGithub()}
                className="rounded bg-ink px-2 py-1 font-medium text-paper disabled:opacity-50"
              >
                {connectBusy ? t("github.connecting") : t("github.connectBtn")}
              </button>
            </div>
            <p className="text-ink-40">{t("github.tokenHint")}</p>
          </div>
        )}
      </div>

      <Toast />
    </div>
  );
}
