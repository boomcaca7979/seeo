"use client";

// ===== SEO Opportunities 页面（P1） =====
// 列表（P0→P2）+ 状态流转 + 验证。数据来自 /api/opportunities*。
// 不声称自动执行：action plan 标注 manual execution；验证显示 PASS/PENDING。

import { useCallback, useEffect, useState } from "react";
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

export default function OpportunitiesPage() {
  const t = useTranslations("dashboard.opportunities");
  const { show, Toast } = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  useEffect(() => {
    if (!projectId) return;
    // 延迟到下一帧，避免 effect 内同步 setState（react-compiler 规则）
    const tid = window.setTimeout(() => void load(projectId), 0);
    return () => window.clearTimeout(tid);
  }, [projectId, load]);

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
                  <span key={index} className="rounded bg-line-soft px-2 py-0.5 text-ink-60">
                    {check.check}: {check.status === "pending" ? t("pending") : check.status}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="text-xs text-ink-60 underline" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
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
