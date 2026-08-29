"use client";

// ===== SEO Opportunities 页面（P1 / P4 产品化） =====
// 列表 + 状态流转 + 验证 + GitHub PR 执行闭环。
// 执行状态严格区分：Preview Ready → Approved → PR Created → Awaiting Review
// → Merged → Verifying → Completed（以及 Conflict / Failed / Manual）。
// 绝不显示模糊的 "Processing..."：每个状态都对应真实阶段。

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { SELECTED_PROJECT_KEY, PROJECT_CHANGED_EVENT } from "@/lib/project-selector";

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

const PRIORITY_STYLE: Record<string, string> = {
  P0: "bg-red-500/15 text-red-600 dark:text-red-400",
  P1: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  P2: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

/** 错误码 → 用户可读信息（不泄露 token / API 原始响应 / 堆栈） */
const ERROR_FRIENDLY: Record<string, string> = {
  GITHUB_PERMISSION_DENIED: "GitHub 没有修改该仓库的权限（请检查连接的凭证与仓库权限）",
  GITHUB_NOT_CONNECTED: "该项目尚未连接 GitHub 仓库",
  GITHUB_REPOSITORY_NOT_FOUND: "GitHub 仓库不存在或不可访问",
  GITHUB_REPOSITORY_ARCHIVED: "仓库已归档，不可写入",
  GITHUB_RATE_LIMITED: "GitHub API 速率受限，请稍后重试",
  EXECUTION_CONFLICT: "预览后目标文件已被修改，未应用任何变更",
  EXECUTION_SCOPE_TOO_LARGE: "变更规模超过安全上限",
  EXECUTION_NOT_SUPPORTED: "该变更类型暂不支持自动执行",
  EXECUTION_TARGET_NOT_FOUND: "无法确定目标文件（保持手动执行）",
  EXECUTION_NOT_APPROVED: "需要先批准该执行动作",
};

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
  const [githubError, setGithubError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectForm, setConnectForm] = useState({ owner: "", repository: "", token: "" });

  const loadGithub = useCallback(async (pid: string) => {
    setGithubError(null);
    try {
      const res = await fetch(`/api/integrations/github?project_id=${encodeURIComponent(pid)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "failed");
      setGithub(json.data ?? { connected: false });
    } catch {
      setGithub(null);
      setGithubError("GitHub 连接状态读取失败");
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
      if (!res.ok) throw new Error(json.error ?? "failed");
      setGithub(json.data);
      setConnectForm({ owner: "", repository: "", token: "" });
      show("GitHub 仓库已连接");
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
      if (!res.ok) throw new Error(json.error ?? "failed");
      setGithub({ connected: false });
      show("GitHub 已断开");
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
        if (!res.ok) throw new Error(json.error ?? "preview failed");
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
  }, [show]);

  async function actionOperation(opportunityId: number, operation: "approve" | "complete" | "execute" | "status") {
    setActionBusy(true);
    try {
      const body: Record<string, unknown> = { opportunity_id: opportunityId, operation };
      if (operation === "execute") {
        // spec 必须显式（UI 从 action plan 读取持久化的 file mapping，绝不猜 URL→文件）
        if (!action?.plan?.filePath || !action?.plan?.newContent) {
          show(ERROR_FRIENDLY.EXECUTION_TARGET_NOT_FOUND);
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
      if (!res.ok) throw new Error(ERROR_FRIENDLY[json.code] ?? json.error ?? "failed");
      if (operation === "execute") {
        show(`PR 已创建，等待人工审核：${json.data?.execution?.prUrl ?? ""}`);
        await loadAction(opportunityId);
      } else if (operation === "status") {
        setAction(json.data?.action ?? null);
        const stage = json.data?.status?.stage;
        if (stage === "awaiting_review") show("PR 开放中，等待人工审核与合并");
        else if (stage === "merged" || stage === "verifying") show("PR 已合并，验证已启动");
        else if (stage === "closed") show("PR 被关闭且未合并——action 已标记失败，请重新规划");
        else show("暂无 PR 状态（尚未执行）");
      } else {
        setAction(json.data?.action ?? null);
        show(operation === "approve" ? "已批准执行动作" : "已记录手动执行完成（验证已启动）");
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
      show("加载失败");
      setRows([]);
    }
  }, [show]);

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
      if (!res.ok) throw new Error(json.error ?? "scan failed");
      const summary = json.data as ScanSummary;
      show(`扫描完成：新增 ${summary.generated}，刷新 ${summary.refreshed}${summary.dataGaps.length > 0 ? `（缺口 ${summary.dataGaps.length}）` : ""}`);
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
      if (!res.ok) throw new Error(json.error ?? "failed");
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
      if (!res.ok) throw new Error(json.error ?? "verify failed");
      show("验证完成（rank 即时复检；GSC/AI 待数据）");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t("title")}</h1>
          <p className="mt-1 text-sm text-ink-60">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={runScan}
          disabled={scanning || !projectId}
          className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
        >
          {scanning ? t("scanning") : t("scanBtn")}
        </button>
      </div>

      {/* GitHub 连接卡片（P4 §27）：真实连接状态，不显示任何凭证） */}
      <div className="rounded-lg border border-line-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{t("github.title")}</span>
          {github?.connected ? (
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("github.connected")}</span>
          ) : (
            <span className="rounded bg-line-soft px-2 py-0.5 text-xs font-medium text-ink-60">{t("github.notConnected")}</span>
          )}
        </div>
        {githubError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{githubError}</p>}
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
                placeholder={t("github.ownerPlaceholder")}
                className="w-32 rounded border border-line-soft bg-transparent px-2 py-1 text-ink placeholder:text-ink-40"
              />
              <input
                value={connectForm.repository}
                onChange={(e) => setConnectForm((f) => ({ ...f, repository: e.target.value }))}
                placeholder={t("github.repoPlaceholder")}
                className="w-48 rounded border border-line-soft bg-transparent px-2 py-1 text-ink placeholder:text-ink-40"
              />
              <input
                value={connectForm.token}
                onChange={(e) => setConnectForm((f) => ({ ...f, token: e.target.value }))}
                type="password"
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

      {rows !== null && rows.length === 0 && (
        <div className="rounded-lg border border-line-soft p-8 text-center text-sm text-ink-60">{t("empty")}</div>
      )}

      <div className="space-y-3">
        {(rows ?? []).map((row) => (
          <div key={row.id} className="rounded-lg border border-line-soft p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLE[row.priority] ?? ""}`}>{row.priority}</span>
              <span className="rounded bg-line-soft px-2 py-0.5 font-mono text-xs text-ink-60">{row.type}</span>
              <span className="text-sm font-medium text-ink">{row.targetValue}</span>
              <span className="ml-auto text-xs text-ink-60">{row.status}</span>
            </div>
            {row.recommendation && <p className="mt-2 text-sm text-ink-80">{row.recommendation}</p>}
            {row.evidence.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-ink-60">
                {row.evidence.slice(0, 3).map((item, index) => (
                  <li key={index}>• [{item.source}] {item.summary}</li>
                ))}
              </ul>
            )}
            {expandedId === row.id && row.actionPlan && (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-60">
                {row.actionPlan.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            )}
            {expandedId === row.id && row.verification && row.verification.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {row.verification.map((check, index) => (
                  <span key={index} className={`rounded px-2 py-0.5 ${check.status === "pass" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : check.status === "failed" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-line-soft text-ink-60"}`}>
                    {check.check}: {check.status === "pending" ? t("pending") : check.status}
                  </span>
                ))}
              </div>
            )}
            {expandedId === row.id && (
              <div className="mt-3 rounded border border-line-soft p-3 text-xs">
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
                        {ERROR_FRIENDLY[action.errorCode] ?? action.result?.error ?? "执行失败"}
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
                        <div className="text-ink-40 font-mono">{action.result.branch}{action.result.commitSha ? ` @ ${action.result.commitSha.slice(0, 8)}` : ""}</div>
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
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="text-xs text-ink-60 underline" onClick={() => {
                const next = expandedId === row.id ? null : row.id;
                setExpandedId(next);
                if (next !== null) void loadAction(row.id);
              }}>
                {expandedId === row.id ? "▲" : "▼"} {t("actionPlan")}
              </button>
              <div className="ml-auto flex flex-wrap gap-2">
                {(nextActions[row.status] ?? []).map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => (action.status === "__verify" ? verify(row.id) : transition(row.id, action.status))}
                    className="rounded border border-line-soft px-2 py-1 text-xs text-ink disabled:opacity-50"
                  >
                    {t(action.label)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <Toast />
    </div>
  );
}
