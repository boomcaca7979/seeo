"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { localizeReportTitle, resolveAuditDetail, resolveAuditSuggestion } from "@/lib/seo/audit-legacy-text";
import { buildCoverageFromIssues } from "@/lib/seo/audit-checks";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError, resolveApiErrorMessage } from "@/lib/billing-error-client";
import { TableSkeleton } from "@/components/dashboard/Skeleton";
import { useEntitlements } from "@/components/billing/EntitlementsContext";
import { formatNumber, intlLocale } from "@/lib/ui-locale";
import RankingReport from "@/components/reports/RankingReport";
import AuditReport from "@/components/reports/AuditReport";
import ContentReport from "@/components/reports/ContentReport";
import WeeklyReport from "@/components/reports/WeeklyReport";
import { generatePDF, downloadPDF } from "@/lib/pdf/generator";

type ReportType = "ranking" | "audit" | "content" | "weekly";

interface LatestAuditInfo {
  id: number;
  domain: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  pagesCrawled: number;
  healthScore: number | null;
}

interface StatsData {
  trackedCount: number;
  contentCount: number;
  latestAudit: LatestAuditInfo | null;
}

interface ReportRow {
  id: number;
  project_id: number | null;
  type: ReportType;
  title: string;
  data_json: string;
  pdf_path: string | null;
  created_at: string;
}

interface TrackedKeyword {
  id: number;
  keyword: string;
  domain: string;
  todayPosition: number | null;
  yesterdayPosition: number | null;
  change: number | null;
  matchedUrl: string | null;
}

interface AuditIssueItem {
  checkId: string;
  checkName: string;
  severity: string;
  url: string;
  detail: string;
  suggestion: string | null;
}

interface AuditLatestData {
  id: number;
  domain: string;
  healthScore: number | null;
  issues: AuditIssueItem[];
  coverage: Array<{ id: string; name: string; passed: boolean }>;
}

interface ContentCheckFull {
  id: number;
  url: string;
  keyword: string;
  content_score: number | null;
  readability_score: number | null;
  readability_level: string | null;
  word_count: number;
  word_count_full: number | null;
  title_suggestions: string | null;
  keyword_density: string | null;
  heading_structure: string | null;
  top_keywords: string | null;
}

interface AutomationLog {
  id: number;
  type: string;
  status: string;
  summary: string | null;
  created_at: string;
}

const typeConfig: Record<ReportType, { badge: string }> = {
  ranking: { badge: "badge-warn" },
  audit: { badge: "badge-warn" },
  content: { badge: "badge-warn" },
  weekly: { badge: "badge-warn" },
};

export default function ReportsPage() {
  const t = useTranslations("dashboard.reportsPage");
  const locale = useLocale() as "en" | "zh";
  const typeLabel = (type: ReportType) => t(`types.${type}.label`);
  const typeName = (type: ReportType) => t(`types.${type}.name`);
  const typeDesc = (type: ReportType) => t(`types.${type}.desc`);
  const formatTime = (iso: string | null): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
      if (Number.isNaN(d.getTime())) return iso;
      const now = Date.now();
      const diff = now - d.getTime();
      if (diff < 60_000) return t("timeJustNow");
      if (diff < 3_600_000) return t("timeMinutesAgo", { count: Math.floor(diff / 60_000) });
      if (diff < 86_400_000) return t("timeHoursAgo", { count: Math.floor(diff / 3_600_000) });
      return d.toLocaleString(intlLocale(locale), { hour12: false });
    } catch {
      return iso;
    }
  };
  const { show, Toast } = useToast();
  const { features, loading: entitlementsLoading } = useEntitlements();
  const canExportPdf = entitlementsLoading ? false : features.pdf_export;
  const canEmailReport = entitlementsLoading ? false : features.email_report;
  const canExportExcel = entitlementsLoading ? false : features.excel_export;
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<"rankings" | "content" | null>(null);
  const [selectedType, setSelectedType] = useState<ReportType>("ranking");
  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailToSend, setEmailToSend] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [savedReportId, setSavedReportId] = useState<number | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const initRef = useRef(false);

  // 预览数据
  const [rankData, setRankData] = useState<{
    projectName: string;
    domain: string;
    keywords: Array<{ keyword: string; todayPosition: number | null; lastPosition: number | null; change: number | null; targetUrl: string | null }>;
    generatedAt: string;
  } | null>(null);
  const [auditData, setAuditData] = useState<{
    projectName: string;
    domain: string;
    healthScore: number;
    issues: Array<{ type: string; severity: string; url: string; detail: string; suggestion: string }>;
    coverage: Array<{ id: string; name: string; passed: boolean }>;
    generatedAt: string;
  } | null>(null);
  const [contentData, setContentData] = useState<{
    projectName: string;
    url: string;
    contentScore: number;
    readabilityScore: number;
    readabilityLevel: string;
    wordCount: number;
    keywordDensity: Array<{ keyword: string; count: number; density: number }>;
    titleSuggestions: string[];
    headingStructure: Array<{ level: number; text: string }>;
    topKeywords: Array<{ word: string; count: number }>;
    generatedAt: string;
  } | null>(null);
  const [weeklyData, setWeeklyData] = useState<{
    projectName: string;
    period: string;
    rankSummary: { up: number; down: number; out: number; total: number };
    auditSummary: { avgScore: number | null; count: number };
    keywordSummary: { total: number; active: number };
    generatedAt: string;
  } | null>(null);

  const loadStats = async () => {
    try {
      const res = await fetch("/api/reports/stats", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setStats(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const res = await fetch("/api/reports", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setReports(json.data ?? []);
    } catch {
      // ignore
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void loadStats();
    void loadReports();
  }, [loadReports]);

  const handleDownloadCsv = async (type: "rankings" | "content") => {
    setDownloading(type);
    try {
      const res = await fetch(`/api/reports/${type}`, { cache: "no-store" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const { message } = handleBillingError(json, t("errExport"));
        show(message, "error");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^";\s]+)"?/);
      const filename = match?.[1] ?? `seeo-${type}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show(t("downloadedToast", { filename }), "success");
    } catch (err) {
      show(t("networkErrorToast", { message: (err as Error).message }), "error");
    } finally {
      setDownloading(null);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setSavedReportId(null);
    try {
      const now = formatTime(new Date().toISOString());

      if (selectedType === "ranking") {
        const res = await fetch("/api/tracking", { cache: "no-store" });
        const json = await res.json();
        const keywords: TrackedKeyword[] = json.data ?? [];
        const domain = keywords[0]?.domain ?? "—";
        setRankData({
          projectName: domain,
          domain,
          keywords: keywords.map((k) => ({
            keyword: k.keyword,
            todayPosition: k.todayPosition,
            lastPosition: k.yesterdayPosition,
            change: k.change,
            targetUrl: k.matchedUrl,
          })),
          generatedAt: now,
        });
      } else if (selectedType === "audit") {
        const domain = stats?.latestAudit?.domain ?? "example.com";
        const res = await fetch(`/api/audit/latest?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
        const json = await res.json();
        const data: AuditLatestData = json.data;
        if (!data) {
          show(t("noAuditData"), "error");
          setGenerating(false);
          return;
        }
        setAuditData({
          projectName: data.domain,
          domain: data.domain,
          healthScore: data.healthScore ?? 0,
          issues: data.issues.map((i) => ({
            type: i.checkId,
            severity: i.severity,
            url: i.url,
            detail: i.detail,
            suggestion: i.suggestion ?? "",
          })),
          coverage: data.coverage ?? [],
          generatedAt: now,
        });
      } else if (selectedType === "content") {
        // 取最近一条内容检查
        const res = await fetch("/api/content/check?limit=1", { cache: "no-store" });
        const json = await res.json();
        const rows: ContentCheckFull[] = json.data ?? [];
        if (rows.length === 0) {
          show(t("noContentData"), "error");
          setGenerating(false);
          return;
        }
        const r = rows[0];
        let kd: Array<{ keyword: string; count: number; density: number }> = [];
        let ts: string[] = [];
        let hs: Array<{ level: number; text: string }> = [];
        let tk: Array<{ word: string; count: number }> = [];
        try { kd = r.keyword_density ? JSON.parse(r.keyword_density) : []; } catch { /* ignore */ }
        try { ts = r.title_suggestions ? JSON.parse(r.title_suggestions) : []; } catch { /* ignore */ }
        try { hs = r.heading_structure ? JSON.parse(r.heading_structure) : []; } catch { /* ignore */ }
        try { tk = r.top_keywords ? JSON.parse(r.top_keywords) : []; } catch { /* ignore */ }
        setContentData({
          projectName: r.url,
          url: r.url,
          contentScore: r.content_score ?? 0,
          readabilityScore: r.readability_score ?? 0,
          readabilityLevel: r.readability_level ?? t("defaultReadabilityLevel"),
          wordCount: r.word_count_full ?? r.word_count ?? 0,
          keywordDensity: kd,
          titleSuggestions: ts,
          headingStructure: hs,
          topKeywords: tk,
          generatedAt: now,
        });
      } else if (selectedType === "weekly") {
        const [trackingRes, logsRes] = await Promise.all([
          fetch("/api/tracking", { cache: "no-store" }),
          fetch("/api/automation/logs?limit=50", { cache: "no-store" }),
        ]);
        const trackingJson = await trackingRes.json();
        const logsJson = await logsRes.json();
        const keywords: TrackedKeyword[] = trackingJson.data ?? [];
        const logs: AutomationLog[] = logsJson.data ?? [];

        const up = keywords.filter((k) => k.change !== null && k.change > 0).length;
        const down = keywords.filter((k) => k.change !== null && k.change < 0).length;
        const out = keywords.filter((k) => k.todayPosition === null).length;
        const active = keywords.filter((k) => k.todayPosition !== null).length;

        const auditLogs = logs.filter((l) => l.type === "daily_refresh" && l.status === "success");
        const auditSummary = {
          avgScore: stats?.latestAudit?.healthScore ?? null,
          count: auditLogs.length,
        };

        const today = new Date();
        const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
        const period = `${weekAgo.getFullYear()}.${String(weekAgo.getMonth() + 1).padStart(2, "0")}.${String(weekAgo.getDate()).padStart(2, "0")} - ${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

        setWeeklyData({
          projectName: keywords[0]?.domain ?? "SeeO",
          period,
          rankSummary: { up, down, out, total: keywords.length },
          auditSummary,
          keywordSummary: { total: keywords.length, active },
          generatedAt: now,
        });
      }

      setPreviewOpen(true);
    } catch (err) {
      show(t("generateFailed", { message: (err as Error).message }), "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      // P3：先调服务端验证 PDF 导出权限
      // 若已保存报告，用 savedReportId 验证归属；否则用当前预览数据验证
      const verifyId = savedReportId ?? 0;
      if (verifyId > 0) {
        const verifyRes = await fetch(`/api/reports/pdf?id=${verifyId}`, { cache: "no-store" });
        if (!verifyRes.ok) {
          const json = await verifyRes.json().catch(() => ({}));
          const { message } = handleBillingError(json, t("pdfDenied"));
          show(message, "error");
          return;
        }
      } else {
        // 未保存的报告，仍需验证 pdf_export feature
        const verifyRes = await fetch(`/api/reports/pdf?id=0`, { cache: "no-store" });
        if (!verifyRes.ok && verifyRes.status !== 404) {
          // 404 是正常的（id=0 不存在），但 403 表示 feature 不允许
          const json = await verifyRes.json().catch(() => ({}));
          const { message } = handleBillingError(json, t("pdfDenied"));
          show(message, "error");
          return;
        }
      }

      const filename = `seeo-${selectedType}-${Date.now()}.pdf`;
      const blob = await generatePDF({
        title: t("pdfDocTitle", { type: typeLabel(selectedType) }),
        filename,
        elementId: "report-content",
      });
      downloadPDF(blob, filename);
      show(t("pdfDownloaded"), "success");
    } catch (err) {
      show(t("pdfFailed", { message: (err as Error).message }), "error");
    }
  };

  const handleSaveReport = async () => {
    try {
      let title = "";
      let dataJson = "";

      if (selectedType === "ranking" && rankData) {
        title = t("saveTitleRanking", { domain: rankData.domain });
        dataJson = JSON.stringify(rankData);
      } else if (selectedType === "audit" && auditData) {
        title = t("saveTitleAudit", { domain: auditData.domain });
        // coverage 一并存入快照：否则历史报告预览回退为空数组，显示"0/0 通过"
        dataJson = JSON.stringify({
          domain: auditData.domain,
          healthScore: auditData.healthScore,
          issues: auditData.issues,
          coverage: auditData.coverage,
        });
      } else if (selectedType === "content" && contentData) {
        title = t("saveTitleContent", { url: contentData.url.slice(0, 40) });
        dataJson = JSON.stringify({ contentScore: contentData.contentScore, url: contentData.url });
      } else if (selectedType === "weekly" && weeklyData) {
        title = t("saveTitleWeekly", { period: weeklyData.period });
        dataJson = JSON.stringify(weeklyData);
      } else {
        return;
      }

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selectedType, title, data_json: dataJson, project_id: null }),
      });
      const json = await res.json();
      if (res.ok) {
        setSavedReportId(json.data?.id ?? null);
        show(t("savedToast"), "success");
        await loadReports();
      } else {
        const { message } = handleBillingError(json, t("saveFailed"));
        show(message, "error");
      }
    } catch (err) {
      show(t("saveFailedToast", { message: (err as Error).message }), "error");
    }
  };

  const handleClosePreview = () => {
    if (savedReportId) {
      setPreviewOpen(false);
      return;
    }
    if (window.confirm(t("confirmSave"))) {
      void handleSaveReport().then(() => setPreviewOpen(false));
    } else {
      setPreviewOpen(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailToSend.trim()) {
      show(t("errEmailEmpty"), "error");
      return;
    }
    if (!savedReportId) {
      show(t("errSaveFirst"), "error");
      return;
    }
    setSendingEmail(true);
    try {
      const res = await fetch("/api/reports/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: savedReportId, email: emailToSend.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        show(t("emailSent"), "success");
        setEmailModalOpen(false);
        setEmailToSend("");
      } else {
        const { message } = handleBillingError(json, t("emailFailed"));
        show(message, "error");
      }
    } catch (err) {
      show(t("emailFailedToast", { message: (err as Error).message }), "error");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDeleteReport = async (id: number) => {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (res.ok) {
        show(t("deletedToast"), "success");
        await loadReports();
      } else {
        const json = await res.json().catch(() => ({}));
        show(resolveApiErrorMessage(json, undefined, t("deleteFailed")) || t("deleteFailed"), "error");
      }
    } catch (err) {
      show(t("deleteFailedToast", { message: (err as Error).message }), "error");
    }
  };

  const trackedCount = stats?.trackedCount ?? 0;
  const contentCount = stats?.contentCount ?? 0;

  const reportTypes: ReportType[] = ["ranking", "audit", "content", "weekly"];

  return (
    <div className="dash-container p-6 lg:p-8">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">08</span>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t("title")}
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-2 font-sans text-sm text-ink-60">
        {t("subtitle")}
      </p>

      {/* 生成报告区 */}
      <div className="card-a mt-5 p-5">
        <div className="font-sans text-xs text-ink-40">{t("reportTypeLabel")}</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {reportTypes.map((rt) => {
            const cfg = typeConfig[rt];
            const selected = selectedType === rt;
            return (
              <button
                key={rt}
                onClick={() => setSelectedType(rt)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  selected
                    ? "border-brand bg-brand/5"
                    : "border-line bg-card hover:border-ink-25"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={cfg.badge}>{typeLabel(rt)}</span>
                </div>
                <div className="mt-2 font-display text-sm font-semibold text-ink">
                  {typeName(rt)}
                </div>
                <div className="mt-1 font-sans text-xs text-ink-60">{typeDesc(rt)}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary disabled:opacity-60"
          >
            {generating ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t("generating")}
              </>
            ) : (
              t("generateBtn")
            )}
          </button>
        </div>
      </div>

      {/* CSV 快速导出 */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card-a flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="badge-warn">{typeLabel("ranking")}</span>
            <span className="font-mono text-xs text-ink-40">CSV</span>
          </div>
          <h3 className="mt-3 font-display text-base font-semibold text-ink">{t("csvRankingTitle")}</h3>
          <p className="mt-1 font-sans text-xs text-ink-60">
            {t("csvRankingDesc")}
          </p>
          <div className="mt-3 rounded-lg border border-line bg-card p-3">
            <div className="font-sans text-xs text-ink-40">{t("trackedLabel")}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-ink">
              {loading ? "—" : formatNumber(trackedCount, locale)}
            </div>
          </div>
          <div className="mt-5 flex-1" />
          {canExportExcel ? (
            <button
              onClick={() => handleDownloadCsv("rankings")}
              disabled={downloading === "rankings" || trackedCount === 0}
              className="btn-secondary disabled:opacity-50"
            >
              {downloading === "rankings" ? t("generating") : t("downloadCsv")}
            </button>
          ) : (
            <Link href="/pricing" className="btn-secondary inline-flex items-center justify-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("upgradeCsv")}
            </Link>
          )}
        </div>

        <div className="card-a flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="badge-warn">{typeLabel("content")}</span>
            <span className="font-mono text-xs text-ink-40">CSV</span>
          </div>
          <h3 className="mt-3 font-display text-base font-semibold text-ink">{t("csvContentTitle")}</h3>
          <p className="mt-1 font-sans text-xs text-ink-60">
            {t("csvContentDesc")}
          </p>
          <div className="mt-3 rounded-lg border border-line bg-card p-3">
            <div className="font-sans text-xs text-ink-40">{t("checksLabel")}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-ink">
              {loading ? "—" : formatNumber(contentCount, locale)}
            </div>
          </div>
          <div className="mt-5 flex-1" />
          {canExportExcel ? (
            <button
              onClick={() => handleDownloadCsv("content")}
              disabled={downloading === "content" || contentCount === 0}
              className="btn-secondary disabled:opacity-50"
            >
              {downloading === "content" ? t("generating") : t("downloadCsv")}
            </button>
          ) : (
            <Link href="/pricing" className="btn-secondary inline-flex items-center justify-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("upgradeCsv")}
            </Link>
          )}
        </div>
      </div>

      {/* 历史报告列表 */}
      <div className="mt-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-40">08-1</span>
          <h2 className="font-display text-lg font-semibold text-ink">{t("historyTitle")}</h2>
          <div className="hairline flex-1" />
        </div>
        <div className="card-a mt-4 overflow-hidden">
          {reportsLoading ? (
            <TableSkeleton rows={3} />
          ) : reports.length === 0 ? (
            <div className="px-4 py-10 text-center font-sans text-xs text-ink-40">
              {t("emptyReports")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40">
                    <th className="px-4 py-3 text-left font-sans text-xs font-semibold text-ink-40">{t("thTitle")}</th>
                    <th className="px-4 py-3 text-left font-sans text-xs font-semibold text-ink-40">{t("thType")}</th>
                    <th className="px-4 py-3 text-left font-sans text-xs font-semibold text-ink-40">{t("thTime")}</th>
                    <th className="px-4 py-3 text-right font-sans text-xs font-semibold text-ink-40">{t("thActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-b border-line-soft">
                      <td className="px-4 py-3 font-sans text-sm font-medium text-ink">{localizeReportTitle(r.title, locale)}</td>
                      <td className="px-4 py-3">
                        <span className={typeConfig[r.type].badge}>{typeLabel(r.type)}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-ink-60">{formatTime(r.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setSelectedType(r.type);
                              // 简化：直接用保存的数据恢复预览
                              try {
                                const data = JSON.parse(r.data_json);
                                if (r.type === "ranking") {
                                  setRankData({ ...data, generatedAt: r.created_at });
                                } else if (r.type === "audit") {
                                  // 历史快照读取层双语化（双向）：快照 detail/suggestion 为保存时 locale 的纯文本
                                  // （或更早的纯中文 / LText JSON），统一经 resolver 按当前 locale 输出
                                  const localizedIssues = (data.issues ?? []).map(
                                    (i: { type: string; severity: string; url: string; detail: string; suggestion?: string | null; checkId?: string; checkName?: string }) => ({
                                      ...i,
                                      checkId: i.checkId ?? i.type,
                                      detail: resolveAuditDetail(i.detail ?? "", locale) ?? "",
                                      suggestion: i.suggestion ? resolveAuditSuggestion(i.suggestion, locale) ?? "" : i.suggestion ?? "",
                                    })
                                  );
                                  // 旧快照未保存 coverage：从 issues（checkId）按当前 locale 重建，
                                  // 覆盖检查项全集，避免"检查项覆盖（0/0 通过）"
                                  const coverage = Array.isArray(data.coverage) && data.coverage.length > 0
                                    ? data.coverage
                                    : buildCoverageFromIssues(
                                        localizedIssues.map((i: { checkId: string }) => i.checkId),
                                        locale
                                      );
                                  setAuditData({ ...data, issues: localizedIssues, projectName: data.domain, generatedAt: r.created_at, coverage });
                                } else if (r.type === "content") {
                                  setContentData({ ...data, generatedAt: r.created_at });
                                } else if (r.type === "weekly") {
                                  setWeeklyData({ ...data, generatedAt: r.created_at });
                                }
                                setSavedReportId(r.id);
                                setPreviewOpen(true);
                              } catch {
                                show(t("parseFailed"), "error");
                              }
                            }}
                            className="rounded-md p-2 text-ink-40 hover:bg-paper hover:text-ink"
                            aria-label={t("viewLabel")}
                          >
                            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteReport(r.id)}
                            className="rounded-md p-2 text-ink-40 hover:bg-neg/10 hover:text-neg"
                            aria-label={t("deleteLabel")}
                          >
                            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 说明区 */}
      <div className="card-a mt-8 border-dashed border-line p-5">
        <h2 className="font-display text-sm font-semibold text-ink">{t("aboutTitle")}</h2>
        <ul className="mt-2 space-y-2 font-sans text-xs text-ink-40">
          <li>{t("aboutPdf")}</li>
          <li>{t("aboutCsv")}</li>
          <li>{t("aboutEmail")}</li>
          <li>{t("aboutData")}</li>
        </ul>
      </div>

      {/* 报告预览 Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={handleClosePreview} aria-hidden />
          <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-line bg-card">
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
              <h3 className="font-display text-base font-semibold text-ink">
                {t("previewTitle", { type: typeLabel(selectedType) })}
              </h3>
              <button
                onClick={handleClosePreview}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-40 hover:bg-paper hover:text-ink"
                aria-label={t("closeLabel")}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {selectedType === "ranking" && rankData && <RankingReport {...rankData} />}
              {selectedType === "audit" && auditData && <AuditReport {...auditData} />}
              {selectedType === "content" && contentData && <ContentReport {...contentData} />}
              {selectedType === "weekly" && weeklyData && <WeeklyReport {...weeklyData} />}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-4">
              <div className="font-sans text-xs text-ink-40">
                {savedReportId ? t("savedStatus", { id: savedReportId }) : t("notSavedStatus")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!savedReportId && (
                  <button onClick={handleSaveReport} className="btn-secondary">
                    {t("saveBtn")}
                  </button>
                )}
                {canExportPdf ? (
                  <button onClick={handleDownloadPdf} className="btn-primary">
                    {t("downloadPdfBtn")}
                  </button>
                ) : (
                  <Link href="/pricing" className="btn-primary inline-flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                      <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t("upgradePdf")}
                  </Link>
                )}
                {canEmailReport ? (
                  <button
                    onClick={() => setEmailModalOpen(true)}
                    disabled={!savedReportId}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {t("sendEmailBtn")}
                  </button>
                ) : (
                  <Link href="/pricing" className="btn-secondary inline-flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                      <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t("upgradeEmail")}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 邮件发送弹窗 */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEmailModalOpen(false)} aria-hidden />
          <div className="relative w-full max-w-md rounded-lg border border-line bg-card p-5">
            <h3 className="font-display text-base font-semibold text-ink">{t("emailModalTitle")}</h3>
            <div className="mt-4">
              <label className="font-sans text-xs text-ink-40">{t("emailLabel")}</label>
              <input
                type="email"
                value={emailToSend}
                onChange={(e) => setEmailToSend(e.target.value)}
                placeholder="recipient@example.com"
                className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEmailModalOpen(false)} className="btn-secondary">
                {t("cancelBtn")}
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !emailToSend.trim()}
                className="btn-primary disabled:opacity-60"
              >
                {sendingEmail ? t("sending") : t("sendBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
