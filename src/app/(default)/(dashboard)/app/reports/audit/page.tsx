"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import ScoreRing from "@/components/dashboard/ScoreRing";
import { TableSkeleton } from "@/components/dashboard/Skeleton";
import { formatNumber, intlLocale } from "@/lib/ui-locale";

interface IssueGroup {
  type: string;
  severity: "error" | "warning" | "notice";
  affectedPages: number;
  sampleUrl: string;
  detail: string;
  suggestion: string | null;
}

interface AuditData {
  id: number;
  domain: string;
  status: "running" | "completed" | "failed";
  pagesCrawled: number;
  healthScore: number | null;
  errors: number;
  warnings: number;
  notices: number;
  startedAt: string;
  finishedAt: string | null;
  issues: IssueGroup[];
}

const severityConfig = {
  error: { label: "severityError", badge: "badge-err", dot: "bg-neg", printColor: "#B23B34" },
  warning: { label: "severityWarning", badge: "badge-warn", dot: "bg-warn", printColor: "#8a6a00" },
  notice: { label: "severityNotice", badge: "badge-info", dot: "bg-ink-25", printColor: "#6b7280" },
} as const;

const STORAGE_KEY = "seeo:last-audit-domain";

function formatTime(iso: string | null, locale: "en" | "zh"): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(intlLocale(locale), { hour12: false });
  } catch {
    return iso;
  }
}

export default function AuditReportPrintPage() {
  const router = useRouter();
  const t = useTranslations("dashboard.printAudit");
  const locale = useLocale() as "en" | "zh";
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [domain, setDomain] = useState<string>("");
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const saved = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY) ?? "";
      } catch {
        return "";
      }
    })();
    if (!saved) {
      // 推迟到下一帧避免 effect 同步路径 setState
      const id = window.setTimeout(() => {
        setNotFound(true);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setDomain(saved), 0);
    void (async () => {
      try {
        const res = await fetch(`/api/audit/latest?domain=${encodeURIComponent(saved)}`, { cache: "no-store" });
        const json = await res.json();
        if (res.ok) {
          if (!json.data) {
            setNotFound(true);
          } else if (json.data.status !== "completed") {
            setNotFound(true);
          } else {
            setAudit(json.data as AuditData);
          }
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
    return () => window.clearTimeout(id);
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleBack = () => {
    router.push("/app/audit");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8 print:hidden">
        <TableSkeleton rows={4} />
        <div className="mt-4">
          <TableSkeleton rows={8} />
        </div>
      </div>
    );
  }

  if (notFound || !audit) {
    return (
      <div className="mx-auto max-w-3xl p-6 lg:p-8 print:hidden">
        <div className="card-a border border-dashed border-line p-12 text-center">
          <div className="font-display text-lg font-semibold text-ink">
            {t("emptyTitle")}
          </div>
          <p className="mt-3 font-sans text-sm text-ink-60">
            {domain
              ? t("emptyWithDomain", { domain })
              : t("emptyNoDomain")}
          </p>
          <p className="mt-1 font-mono text-xs text-ink-40">
            {t("emptyHint")}
          </p>
          <button
            onClick={handleBack}
            className="btn-primary mt-6"
          >
            {t("emptyAction")}
          </button>
        </div>
      </div>
    );
  }

  const healthScore = audit.healthScore ?? 0;
  const scoreLevel = healthScore >= 80 ? t("scoreLevelGood") : healthScore >= 60 ? t("scoreLevelPass") : t("scoreLevelPoor");

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8 print-area">
      {/* 操作栏（打印时隐藏） */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button
          onClick={handleBack}
          className="btn-secondary"
        >
          {t("backBtn")}
        </button>
        <button
          onClick={handlePrint}
          className="btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path d="M6 9V2h12v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <rect x="6" y="14" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          {t("printBtn")}
        </button>
      </div>

      {/* 报告头 */}
      <div className="card-a p-6 print-header">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-xs text-ink-40 print-mono">{t("reportLabel")}</div>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink print-title sm:text-3xl">
              {audit.domain}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-60 print-mono">
              <span>{t("metaTime", { value: formatTime(audit.finishedAt ?? audit.startedAt, locale) })}</span>
              <span>·</span>
              <span>{t("metaPages", { value: formatNumber(audit.pagesCrawled, locale) })}</span>
              <span>·</span>
              <span>{t("metaReportId", { value: `#${audit.id}` })}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 print-score-block">
            <ScoreRing score={healthScore} size={88} thickness={8} />
            <div>
              <div className="font-display text-base font-semibold text-ink print-title">{t("healthLabel")}</div>
              <div className="font-mono text-xs text-ink-40 print-mono">{scoreLevel}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 三级计数 */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="card-a p-5 print-card">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-neg print-dot-error" />
            <span className="font-mono text-xs text-ink-40 print-mono">{t("severityError")}</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-neg print-num-error">
            {formatNumber(audit.errors, locale)}
          </div>
          <div className="mt-1 font-mono text-xs text-ink-40 print-mono">{t("errorHint")}</div>
        </div>
        <div className="card-a p-5 print-card">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-warn print-dot-warning" />
            <span className="font-mono text-xs text-ink-40 print-mono">{t("severityWarning")}</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-warn print-num-warning">
            {formatNumber(audit.warnings, locale)}
          </div>
          <div className="mt-1 font-mono text-xs text-ink-40 print-mono">{t("warningHint")}</div>
        </div>
        <div className="card-a p-5 print-card">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-ink-25 print-dot-notice" />
            <span className="font-mono text-xs text-ink-40 print-mono">{t("severityNotice")}</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-ink print-num-notice">
            {formatNumber(audit.notices, locale)}
          </div>
          <div className="mt-1 font-mono text-xs text-ink-40 print-mono">{t("noticeHint")}</div>
        </div>
      </div>

      {/* 问题清单 */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink print-title">
            {t("issuesTitle")}
          </h2>
          <span className="font-mono text-xs text-ink-40 print-mono">
            {t("issuesCount", { n: audit.issues.length })}
          </span>
        </div>

        {audit.issues.length === 0 ? (
          <div className="card-a mt-4 border border-dashed border-line p-10 text-center">
            <div className="font-display text-base font-semibold text-ink-40">{t("noIssuesTitle")}</div>
            <p className="mt-2 font-sans text-sm text-ink-40">{t("noIssuesHint")}</p>
          </div>
        ) : (
          <div className="card-a mt-4 overflow-hidden print-table">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40 print-thead">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">{t("thType")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">{t("thSeverity")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">{t("thAffected")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">{t("thDetail")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">{t("thSampleUrl")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">{t("thSuggestion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.issues.map((issue, idx) => {
                    const cfg = severityConfig[issue.severity];
                    return (
                      <tr
                        key={`${issue.type}-${idx}`}
                        className="border-b border-line-soft print-row"
                      >
                        <td className="px-4 py-3 font-sans text-sm font-medium text-ink print-cell-title">
                          {issue.type}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`${cfg.badge} print-badge`}
                            data-severity={issue.severity}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} print-dot`} />
                            {t(cfg.label)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-ink print-cell">
                          {formatNumber(issue.affectedPages, locale)}
                        </td>
                        <td className="px-4 py-3 font-sans text-sm text-ink-60 print-cell">
                          {issue.detail}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-ink-60 print-cell">
                          <span className="block max-w-[200px] truncate" title={issue.sampleUrl}>
                            {issue.sampleUrl.replace(/^https?:\/\//, "")}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-sans text-sm text-ink-60 print-cell">
                          {issue.suggestion ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 页脚（打印时显示） */}
      <div className="mt-8 hidden border-t border-line-soft pt-4 font-mono text-xs text-ink-40 print-footer">
        {t("footer", { time: formatTime(audit.finishedAt ?? audit.startedAt, locale), domain: audit.domain })}
      </div>
    </div>
  );
}
