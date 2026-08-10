"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { TableSkeleton } from "@/components/dashboard/Skeleton";
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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

const typeConfig: Record<ReportType, { label: string; badge: string; desc: string }> = {
  ranking: { label: "排名", badge: "badge-warn", desc: "追踪关键词的当前排名与变化" },
  audit: { label: "审计", badge: "badge-warn", desc: "技术 SEO 审计结果与健康分" },
  content: { label: "内容", badge: "badge-warn", desc: "页面内容质量与可读性分析" },
  weekly: { label: "周报", badge: "badge-warn", desc: "本周排名/审计/关键词综合汇总" },
};

export default function ReportsPage() {
  const { show, Toast } = useToast();
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
        const { message } = handleBillingError(json, "导出失败");
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
      show(`已下载 ${filename}`, "success");
    } catch (err) {
      show(`网络错误：${(err as Error).message}`, "error");
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
          show("暂无审计数据，请先执行审计", "error");
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
          show("暂无内容检查数据，请先执行分析", "error");
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
          readabilityLevel: r.readability_level ?? "中等",
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
      show(`生成失败：${(err as Error).message}`, "error");
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
          const { message } = handleBillingError(json, "PDF 导出权限不足");
          show(message, "error");
          return;
        }
      } else {
        // 未保存的报告，仍需验证 pdf_export feature
        const verifyRes = await fetch(`/api/reports/pdf?id=0`, { cache: "no-store" });
        if (!verifyRes.ok && verifyRes.status !== 404) {
          // 404 是正常的（id=0 不存在），但 403 表示 feature 不允许
          const json = await verifyRes.json().catch(() => ({}));
          const { message } = handleBillingError(json, "PDF 导出权限不足");
          show(message, "error");
          return;
        }
      }

      const filename = `seeo-${selectedType}-${Date.now()}.pdf`;
      const blob = await generatePDF({
        title: `${typeConfig[selectedType].label}报告`,
        filename,
        elementId: "report-content",
      });
      downloadPDF(blob, filename);
      show("PDF 已下载", "success");
    } catch (err) {
      show(`PDF 生成失败：${(err as Error).message}`, "error");
    }
  };

  const handleSaveReport = async () => {
    try {
      let title = "";
      let dataJson = "";

      if (selectedType === "ranking" && rankData) {
        title = `排名报告 · ${rankData.domain}`;
        dataJson = JSON.stringify(rankData);
      } else if (selectedType === "audit" && auditData) {
        title = `审计报告 · ${auditData.domain}`;
        dataJson = JSON.stringify({ healthScore: auditData.healthScore, issues: auditData.issues });
      } else if (selectedType === "content" && contentData) {
        title = `内容报告 · ${contentData.url.slice(0, 40)}`;
        dataJson = JSON.stringify({ contentScore: contentData.contentScore, url: contentData.url });
      } else if (selectedType === "weekly" && weeklyData) {
        title = `周报 · ${weeklyData.period}`;
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
        show("已保存到报告中心", "success");
        await loadReports();
      } else {
        const { message } = handleBillingError(json, "保存失败");
        show(message, "error");
      }
    } catch (err) {
      show(`保存失败：${(err as Error).message}`, "error");
    }
  };

  const handleClosePreview = () => {
    if (savedReportId) {
      setPreviewOpen(false);
      return;
    }
    if (window.confirm("是否保存到报告中心？")) {
      void handleSaveReport().then(() => setPreviewOpen(false));
    } else {
      setPreviewOpen(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailToSend.trim()) {
      show("请输入收件人邮箱", "error");
      return;
    }
    if (!savedReportId) {
      show("请先保存报告", "error");
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
        show("邮件已发送", "success");
        setEmailModalOpen(false);
        setEmailToSend("");
      } else {
        const { message } = handleBillingError(json, "发送失败");
        show(message, "error");
      }
    } catch (err) {
      show(`发送失败：${(err as Error).message}`, "error");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDeleteReport = async (id: number) => {
    if (!window.confirm("确认删除该报告？")) return;
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (res.ok) {
        show("已删除", "success");
        await loadReports();
      } else {
        const json = await res.json().catch(() => ({}));
        show(json?.error ?? "删除失败", "error");
      }
    } catch (err) {
      show(`删除失败：${(err as Error).message}`, "error");
    }
  };

  const trackedCount = stats?.trackedCount ?? 0;
  const contentCount = stats?.contentCount ?? 0;

  const reportTypes: ReportType[] = ["ranking", "audit", "content", "weekly"];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">08</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          报表中心
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        生成、下载和分享 SEO 报告。
      </p>

      {/* 生成报告区 */}
      <div className="card-a mt-5 p-5">
        <div className="font-sans text-xs text-ink-40">报告类型</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {reportTypes.map((t) => {
            const cfg = typeConfig[t];
            const selected = selectedType === t;
            return (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  selected
                    ? "border-brand bg-brand/5"
                    : "border-line bg-card hover:border-ink-25"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={cfg.badge}>{cfg.label}</span>
                </div>
                <div className="mt-2 font-display text-sm font-bold text-ink">
                  {t === "ranking" ? "排名追踪报告" : t === "audit" ? "技术审计报告" : t === "content" ? "内容检查报告" : "综合周报"}
                </div>
                <div className="mt-1 font-sans text-xs text-ink-60">{cfg.desc}</div>
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
                生成中…
              </>
            ) : (
              "生成报告"
            )}
          </button>
        </div>
      </div>

      {/* CSV 快速导出 */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card-a flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="badge-warn">排名</span>
            <span className="font-mono text-[10px] text-ink-40">CSV</span>
          </div>
          <h3 className="mt-3 font-display text-base font-bold text-ink">关键词排名 CSV</h3>
          <p className="mt-1 font-sans text-xs text-ink-60">
            全部追踪关键词 + 近 30 天排名历史
          </p>
          <div className="mt-3 rounded-lg border border-line bg-card p-3">
            <div className="font-sans text-[10px] text-ink-40">已追踪</div>
            <div className="mt-1 font-mono text-2xl font-bold text-ink">
              {loading ? "—" : trackedCount.toLocaleString()}
            </div>
          </div>
          <div className="mt-5 flex-1" />
          <button
            onClick={() => handleDownloadCsv("rankings")}
            disabled={downloading === "rankings" || trackedCount === 0}
            className="btn-secondary disabled:opacity-50"
          >
            {downloading === "rankings" ? "生成中…" : "下载 CSV"}
          </button>
        </div>

        <div className="card-a flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="badge-warn">内容</span>
            <span className="font-mono text-[10px] text-ink-40">CSV</span>
          </div>
          <h3 className="mt-3 font-display text-base font-bold text-ink">内容检测 CSV</h3>
          <p className="mt-1 font-sans text-xs text-ink-60">
            最近 100 条内容检测记录
          </p>
          <div className="mt-3 rounded-lg border border-line bg-card p-3">
            <div className="font-sans text-[10px] text-ink-40">累计检测</div>
            <div className="mt-1 font-mono text-2xl font-bold text-ink">
              {loading ? "—" : contentCount.toLocaleString()}
            </div>
          </div>
          <div className="mt-5 flex-1" />
          <button
            onClick={() => handleDownloadCsv("content")}
            disabled={downloading === "content" || contentCount === 0}
            className="btn-secondary disabled:opacity-50"
          >
            {downloading === "content" ? "生成中…" : "下载 CSV"}
          </button>
        </div>
      </div>

      {/* 历史报告列表 */}
      <div className="mt-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-40">08-1</span>
          <h2 className="font-display text-lg font-bold text-ink">历史报告</h2>
          <div className="hairline flex-1" />
        </div>
        <div className="card-a mt-4 overflow-hidden">
          {reportsLoading ? (
            <TableSkeleton rows={3} />
          ) : reports.length === 0 ? (
            <div className="px-4 py-10 text-center font-sans text-xs text-ink-40">
              暂无报告，点击上方生成
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40">
                    <th className="px-4 py-3 text-left font-sans text-xs font-semibold text-ink-40">标题</th>
                    <th className="px-4 py-3 text-left font-sans text-xs font-semibold text-ink-40">类型</th>
                    <th className="px-4 py-3 text-left font-sans text-xs font-semibold text-ink-40">生成时间</th>
                    <th className="px-4 py-3 text-right font-sans text-xs font-semibold text-ink-40">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-b border-line-soft">
                      <td className="px-4 py-3 font-sans text-sm font-medium text-ink">{r.title}</td>
                      <td className="px-4 py-3">
                        <span className={typeConfig[r.type].badge}>{typeConfig[r.type].label}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-60">{formatTime(r.created_at)}</td>
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
                                  setAuditData({ ...data, projectName: data.domain, generatedAt: r.created_at, coverage: data.coverage ?? [] });
                                } else if (r.type === "content") {
                                  setContentData({ ...data, generatedAt: r.created_at });
                                } else if (r.type === "weekly") {
                                  setWeeklyData({ ...data, generatedAt: r.created_at });
                                }
                                setSavedReportId(r.id);
                                setPreviewOpen(true);
                              } catch {
                                show("报告数据解析失败", "error");
                              }
                            }}
                            className="rounded-md p-1.5 text-ink-40 hover:bg-paper hover:text-ink"
                            aria-label="查看"
                          >
                            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteReport(r.id)}
                            className="rounded-md p-1.5 text-ink-40 hover:bg-neg/10 hover:text-neg"
                            aria-label="删除"
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
        <h2 className="font-display text-sm font-bold text-ink">关于报告导出</h2>
        <ul className="mt-2 space-y-1.5 font-sans text-xs text-ink-40">
          <li>· PDF 报告基于 html2pdf.js 在浏览器端生成，无需服务器渲染</li>
          <li>· CSV 报告带 UTF-8 BOM，Excel 直接打开中文不乱码</li>
          <li>· 邮件发送基于 Resend，需配置 RESEND_API_KEY 环境变量</li>
          <li>· 全部基于本地 SQLite 真实数据，不消耗 SerpApi 额度</li>
        </ul>
      </div>

      {/* 报告预览 Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={handleClosePreview} aria-hidden />
          <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-line bg-card">
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
              <h3 className="font-display text-base font-bold text-ink">
                {typeConfig[selectedType].label}报告预览
              </h3>
              <button
                onClick={handleClosePreview}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-40 hover:bg-paper hover:text-ink"
                aria-label="关闭"
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
                {savedReportId ? `已保存 · ID ${savedReportId}` : "未保存"}
              </div>
              <div className="flex gap-2">
                {!savedReportId && (
                  <button onClick={handleSaveReport} className="btn-secondary">
                    保存到报告中心
                  </button>
                )}
                <button onClick={handleDownloadPdf} className="btn-primary">
                  下载 PDF
                </button>
                <button
                  onClick={() => setEmailModalOpen(true)}
                  disabled={!savedReportId}
                  className="btn-secondary disabled:opacity-50"
                >
                  发送邮件
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 邮件发送弹窗 */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEmailModalOpen(false)} aria-hidden />
          <div className="relative w-full max-w-md rounded-xl border border-line bg-card p-5">
            <h3 className="font-display text-base font-bold text-ink">发送报告邮件</h3>
            <div className="mt-4">
              <label className="font-sans text-xs text-ink-40">收件人邮箱</label>
              <input
                type="email"
                value={emailToSend}
                onChange={(e) => setEmailToSend(e.target.value)}
                placeholder="recipient@example.com"
                className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEmailModalOpen(false)} className="btn-secondary">
                取消
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !emailToSend.trim()}
                className="btn-primary disabled:opacity-60"
              >
                {sendingEmail ? "发送中…" : "发送"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
