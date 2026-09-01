"use client";

// ===== Site Audit（V2 第二阶段）：产品级 Dashboard =====
// 结构：Overview / Issues / Crawled Pages / Internal Linking / Structured Data /
//       AI Search / History（view 参数切换，issue 参数进入 Issue Detail）
// 数据：单一 /api/audit/latest 返回 AuditResult + dashboard 快照，无重复请求。
// 保留：Quick/Deep 审计、轮询、PDF 导出、保存到报告、项目/域名选择。

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { formatNumber, intlLocale, type Locale } from "@/lib/ui-locale";
import Link from "next/link";
import ScoreRing from "@/components/dashboard/ScoreRing";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import Modal from "@/components/dashboard/Modal";
import { TableSkeleton } from "@/components/dashboard/Skeleton";
import AuditReport from "@/components/reports/AuditReport";
import { generatePDF, downloadPDF } from "@/lib/pdf/generator";
import DomainSelect from "@/components/dashboard/DomainSelect";
import AuditScoreTrend from "@/components/dashboard/charts/AuditScoreTrend";
import { useEntitlements } from "@/components/billing/EntitlementsContext";
import AuditOverview, { type HistoryItem, type ComparisonData } from "@/components/audit/Overview";
import IssuesCenter from "@/components/audit/IssuesCenter";
import CrawledPages from "@/components/audit/CrawledPages";
import { LinkingSection, StructuredDataSection, AiSearchSection, CrawlerStatsSection } from "@/components/audit/Analysis";
import HistorySection from "@/components/audit/HistorySection";
import type { DashboardSnapshot } from "@/lib/seo/audit-dashboard";

const severityConfig = {
  error: { badge: "badge-err", bar: "#EF4444", text: "text-neg", dot: "bg-neg" },
  warning: { badge: "badge-warn", bar: "#F59E0B", text: "text-warn", dot: "bg-warn" },
  notice: { badge: "badge-info", bar: "#9CA3AF", text: "text-ink-40", dot: "bg-ink-25" },
} as const;

interface IssueGroup {
  checkId: string;
  checkName: string;
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
  comparison: ComparisonData | null;
  coverage: Array<{ id: string; name: string; category: string; weight: number; description: string; passed: boolean; affectedPages: number }>;
  history: HistoryItem[];
  pagesDetail?: Array<{ url: string; responseTimeMs: number; status: number; ok: boolean }>;
  dashboard: DashboardSnapshot | null;
  error?: string | null;
}

type AuditDepth = "quick" | "full";
type ViewKey = "overview" | "issues" | "pages" | "linking" | "structured" | "ai" | "history";

interface ProjectItem {
  id: string;
  name: string;
  domain: string;
  healthScore: number | null;
}

export default function AuditPage() {
  const tc = useTranslations("dashboard.common");
  return (
    <Suspense fallback={<div className="p-8 text-center font-mono text-sm text-ink-40">{tc("loading")}</div>}>
      <AuditPageInner />
    </Suspense>
  );
}

function AuditPageInner() {
  const t = useTranslations("dashboard.audit");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as Locale;
  const { show, Toast } = useToast();
  const { features, loading: entitlementsLoading } = useEntitlements();
  const canFullAudit = entitlementsLoading ? false : features.full_audit;
  const canExportPdf = entitlementsLoading ? false : features.pdf_export;

  const searchParams = useSearchParams();
  const router = useRouter();

  // ---- 视图状态（searchParams 驱动，支持直接 URL） ----
  const view = (searchParams.get("view") ?? "overview") as ViewKey;
  const selectedIssue = searchParams.get("issue");
  // P0-1：rule / pageType 必须读回，否则 IssuesCenter 的筛选器静默失效
  const issuesFilters = {
    severity: searchParams.get("severity") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    group: searchParams.get("group") ?? undefined,
    rule: searchParams.get("rule") ?? undefined,
    pageType: searchParams.get("pageType") ?? undefined,
  };
  // P1-3：Pages 全部筛选条件 URL 化（issue 在 pages 视图下 = 按规则过滤受影响页面）
  const pagesFilters = {
    health: searchParams.get("health") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    depth: searchParams.get("depth") ?? undefined,
    sdStatus: searchParams.get("sdStatus") ?? undefined,
    pageType: searchParams.get("pageType") ?? undefined,
    severity: searchParams.get("severity") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    dir: searchParams.get("dir") ?? undefined,
    issue: searchParams.get("issue") ?? undefined,
  };

  const navigate = useCallback(
    (params: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
      // 显式 null 值清除对应参数
      for (const [k, v] of Object.entries(params)) {
        if (v === "" || v === undefined) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/app/audit?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // ---- 数据状态 ----
  const [domain, setDomain] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [auditing, setAuditing] = useState(false);
  // P1-5：运行期来自 status 端点的实时爬取页数（轻量轮询，不拉全量载荷）
  const [progressPages, setProgressPages] = useState<number | null>(null);
  const [pendingDepth, setPendingDepth] = useState<AuditDepth>("quick");
  const [activeDepth, setActiveDepth] = useState<AuditDepth>("quick");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadLatest = useCallback(async (d: string): Promise<AuditData | null> => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit/latest?domain=${encodeURIComponent(d)}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        const data = json.data ?? null;
        setAudit(data);
        return data;
      }
      return null;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载时拉取项目列表
  const didInitProjectsRef = useRef(false);
  useEffect(() => {
    if (didInitProjectsRef.current) return;
    didInitProjectsRef.current = true;
    (async () => {
      setProjectsLoading(true);
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = await res.json();
        const list: ProjectItem[] = (json.data ?? []).map((p: ProjectItem) => ({
          id: p.id,
          name: p.name,
          domain: p.domain,
          healthScore: p.healthScore,
        }));
        setProjects(list);
        // 优先级：URL ?domain= 参数 > localStorage 上次审计域名 > 项目列表第一个 > 空
        // （F2：审计完成写入 seeo:last-audit-domain 后刷新，必须恢复同一域名，
        //   否则回退到项目列表第一个，刚审计的结果看起来"消失"）
        const queryDomain = searchParams.get("domain")?.trim();
        let lastAuditDomain = "";
        try {
          lastAuditDomain = window.localStorage.getItem("seeo:last-audit-domain")?.trim() ?? "";
        } catch {
          lastAuditDomain = "";
        }
        if (queryDomain) {
          setDomain(queryDomain);
        } else if (lastAuditDomain) {
          setDomain(lastAuditDomain);
        } else if (list.length > 0) {
          setDomain(list[0].domain);
        } else {
          setDomain("");
        }
      } catch {
        setDomain("");
      } finally {
        setProjectsLoading(false);
      }
    })();
  }, [loadLatest, searchParams]);

  // 域名变化时加载
  const lastLoadedDomain = useRef<string | null>(null);
  useEffect(() => {
    const d = domain.trim();
    if (d && lastLoadedDomain.current !== d) {
      lastLoadedDomain.current = d;
      const id = window.setTimeout(() => void loadLatest(d), 0);
      return () => window.clearTimeout(id);
    }
  }, [loadLatest, domain]);

  // ---- 审计执行（沿用第一阶段异步模式） ----
  const handleConfirmAudit = async () => {
    const depth = pendingDepth;
    setConfirmOpen(false);
    setStarting(true);
    setActiveDepth(depth);
    setAuditing(true);
    setProgressPages(null);
    show(depth === "quick" ? t("toastQuickRunning") : t("toastFullRunning"), "info");
    try {
      const res = await fetch("/api/audit/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.trim(), depth }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("auditFailed"));
        show(message, "error");
        return;
      }
      try {
        localStorage.setItem("seeo:last-audit-domain", domain.trim());
      } catch {
        // ignore
      }
      if (json.data?.status === "running") {
        await loadLatest(domain);
        // P1-5：运行期只轮询轻量 status 端点（不反复下载完整 latest 载荷）
        const auditId: number | undefined = json.data.auditId;
        const POLL_INTERVAL = 3000;
        const MAX_POLLS = 100;
        let finalStatus: string | undefined;
        for (let i = 0; i < MAX_POLLS; i++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          if (auditId !== undefined) {
            try {
              const pollRes = await fetch(`/api/audit/status?id=${auditId}`, { cache: "no-store" });
              const pollJson = await pollRes.json();
              const data = pollJson.data;
              if (!data) break;
              if (typeof data.pagesCrawled === "number") setProgressPages(data.pagesCrawled);
              if (data.status === "completed" || data.status === "failed") {
                finalStatus = data.status;
                break;
              }
            } catch {
              // 网络抖动：下轮重试
            }
          } else {
            // 兜底：无 auditId（不应发生）时退回 latest 轮询
            const pollRes = await fetch(`/api/audit/latest?domain=${encodeURIComponent(domain.trim())}`, { cache: "no-store" });
            const pollJson = await pollRes.json();
            const status = pollJson.data?.status;
            if (status === "completed" || status === "failed") {
              finalStatus = status;
              break;
            }
            if (pollJson.data === null) break;
          }
        }
        // 完成后仅取一次完整结果（删除原先的重复 latest 请求）
        const finalAudit = await loadLatest(domain);
        if (finalAudit?.status === "completed" || finalStatus === "completed") {
          show(t("toastDone", { score: finalAudit?.healthScore ?? 0, pages: finalAudit?.dashboard?.pagesCrawled ?? finalAudit?.pagesCrawled ?? 0 }), "success");
        } else if (finalAudit?.status === "failed" || finalStatus === "failed") {
          const apiErr = finalAudit?.error || json?.error;
          const hint = depth === "full" ? t("hintTimeoutFull") : t("hintRetry");
          show(apiErr ? t("apiErrorWithHint", { error: apiErr, hint }) : hint, "error");
        } else if (finalAudit?.status === "running") {
          show(t("stillRunning"), "info");
        } else {
          show(t("recordMissing"), "error");
        }
      } else {
        if (json.data?.status === "completed") {
          show(t("toastDone", { score: json.data?.healthScore ?? 0, pages: json.data?.pagesCrawled ?? 0 }), "success");
        } else if (json.data?.status === "failed") {
          const apiErr = json.data?.error || json?.error;
          const hint = depth === "full" ? t("hintTimeoutFull") : t("hintRetry");
          show(apiErr ? t("apiErrorWithHint", { error: apiErr, hint }) : hint, "error");
        } else {
          show(t("statusAbnormal"), "error");
        }
        await loadLatest(domain);
      }
    } catch (err) {
      show(t("networkErrorWith", { message: (err as Error).message }), "error");
    } finally {
      setStarting(false);
      setAuditing(false);
    }
  };

  const openConfirm = (depth: AuditDepth) => {
    setPendingDepth(depth);
    setConfirmOpen(true);
  };

  // ---- PDF 导出 / 保存报告（沿用） ----
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const handleDownloadPdf = async () => {
    if (!audit) return;
    setExporting(true);
    try {
      const verifyRes = await fetch(`/api/reports/pdf?id=0`, { cache: "no-store" });
      if (!verifyRes.ok) {
        const json = await verifyRes.json().catch(() => ({}));
        if (verifyRes.status === 403) {
          const { message } = handleBillingError(json, t("pdfNoPermission"));
          show(message, "error");
          return;
        }
      }
      const filename = t("pdfFilename", { domain: audit.domain, date: todayStr() });
      const blob = await generatePDF({ title: t("reportTitle", { domain: audit.domain }), filename, elementId: "report-content" });
      downloadPDF(blob, filename);
      show(t("pdfDownloaded"), "success");
    } catch (err) {
      show(t("pdfFailed", { message: (err as Error).message }), "error");
    } finally {
      setExporting(false);
    }
  };

  const handleSaveToReports = async () => {
    if (!audit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "audit",
          title: t("reportTitle", { domain: audit.domain }),
          data_json: JSON.stringify({
            healthScore: audit.healthScore,
            issues: audit.issues,
            coverage: audit.coverage,
          }),
          project_id: null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        show(t("savedToReports"), "success");
        setExportOpen(false);
      } else {
        const { message } = handleBillingError(json, t("saveFailed"));
        show(message, "error");
      }
    } catch (err) {
      show(t("saveFailedWith", { message: (err as Error).message }), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDomainChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuditing(false);
    const d = domain.trim();
    if (d && searchParams.get("domain") !== d) {
      router.replace(`/app/audit?domain=${encodeURIComponent(d)}`, { scroll: false });
    }
    await loadLatest(d);
  };

  const hasResult = audit && audit.status === "completed";
  const hasFailed = audit && audit.status === "failed";
  const hasDashboard = !!audit?.dashboard;

  const formatTime = (iso: string | null): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(intlLocale(locale), { hour12: false });
    } catch {
      return iso;
    }
  };

  // ---- Tab 定义 ----
  const tabs: Array<{ key: ViewKey; label: string }> = [
    { key: "overview", label: t("tabOverview") },
    { key: "issues", label: t("tabIssues") },
    { key: "pages", label: t("tabPages") },
    { key: "linking", label: t("tabLinking") },
    { key: "structured", label: t("tabStructured") },
    { key: "ai", label: t("tabAi") },
    { key: "history", label: t("tabHistory") },
  ];

  return (
    <div className="dash-container p-4 lg:p-8 print-area">
      {/* 打印专用页眉 */}
      <div className="mb-6 hidden border-b border-line pb-3 print:block">
        <div className="font-sans text-xs text-ink-40">{t("printHeader")}</div>
        {/* BUG-001：audit=null 时 SSR 渲染 new Date() 时间文本，与客户端 hydration 时刻必然不一致，
            触发 React 18 生产模式整树客户端重渲染，期间页面事件未挂载（点击「快速审计」无反应）。
            suppressHydrationWarning 抑制该 mismatch，保持 SSR 树有效。 */}
        <h1 className="mt-1 font-display text-xl font-semibold text-ink" suppressHydrationWarning>
          {audit?.domain ?? domain} · {audit ? formatTime(audit.finishedAt ?? audit.startedAt) : formatTime(new Date().toISOString())}
        </h1>
      </div>

      {/* ===== Header（高密度） ===== */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between print:hidden">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 font-sans text-sm text-ink-60">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => openConfirm("quick")}
            disabled={auditing || starting}
            title={auditing || starting ? t("auditInProgress") : undefined}
            className="btn-primary disabled:opacity-60"
          >
            {auditing && activeDepth === "quick" ? t("quickAuditing") : starting && pendingDepth === "quick" ? t("starting") : t("quickAudit")}
          </button>
          {canFullAudit ? (
            <button onClick={() => openConfirm("full")} disabled={auditing || starting} title={t("fullAuditTip")} className="btn-secondary disabled:opacity-60">
              {auditing && activeDepth === "full" ? t("fullAuditing") : starting && pendingDepth === "full" ? t("starting") : t("fullAudit")}
            </button>
          ) : (
            <Link href="/pricing" title={t("fullAuditProTip")} className="btn-secondary inline-flex items-center gap-2">
              {t("upgradeFullAudit")}
            </Link>
          )}
          {hasResult && (
            <button onClick={() => setExportOpen(true)} className="btn-secondary">
              {t("exportReport")}
            </button>
          )}
        </div>
      </div>

      {/* ===== Audit Meta 条（域名 / 状态 / 时间 / 页数 / 模式） ===== */}
      {!projectsLoading && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3 font-mono text-xs text-ink-40 print:hidden">
          <form onSubmit={handleDomainChange} className="flex items-center gap-2">
            {/* R2：等页面初始化（URL > localStorage > 项目一）确定 domain 后再挂载，
                避免 DomainSelect 的"无值→选第一个项目"先于初始化生效，出现瞬态覆盖 */}
            {projectsLoading ? (
              <div className="h-10 w-44 animate-pulse rounded-md border border-line bg-paper" />
            ) : (
              <DomainSelect value={domain} onChange={setDomain} className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none" />
            )}
            <button type="submit" className="btn-secondary px-2 py-1.5 text-xs">{t("viewBtn")}</button>
          </form>
          {audit ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-pos" aria-hidden />
                {t("statusCompleted")}
              </span>
              <span>·</span>
              <span>{t("lastAuditColon")}{formatTime(audit.finishedAt ?? audit.startedAt)}</span>
              <span>·</span>
              <span>
                {t("crawledColon")}
                {/* P1-6：单一可信来源——V2 用 dashboard 快照，legacy 才读 DB 列 */}
                <b className="text-ink">{audit.dashboard ? audit.dashboard.pagesCrawled : audit.pagesCrawled}</b>
              </span>
              <span>·</span>
              <span className="badge-info">{audit.dashboard?.depth === "full" ? t("depthFull") : t("depthQuick")}</span>
              {audit.dashboard?.partial ? <span className="badge-warn">{t("partialAudit")}</span> : null}
              {audit.dashboard?.engineVersion ? <span className="badge-info">engine {audit.dashboard.engineVersion} · rules {audit.dashboard.ruleSetVersion}</span> : null}
            </>
          ) : domain.trim() ? (
            <span>{t("noAuditRecord")}</span>
          ) : null}
          {audit?.status === "running" && <span className="text-warn">{t("auditInProgress")}</span>}
          {audit?.status === "failed" && <span className="text-neg">{t("failedTitle")}</span>}
        </div>
      )}

      {/* 运行进度 */}
      {auditing && (
        <div className="card-a mt-4 p-5 print:hidden">
          <div className="flex items-center justify-between font-sans text-xs text-ink-40">
            <span>{activeDepth === "quick" ? t("progressQuick") : t("progressFull")}</span>
            <span className="text-warn">{progressPages !== null ? `${t("crawling")} ${progressPages} / 50` : t("starting")}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-soft">
            <div className="h-full rounded-full bg-warn transition-all" style={{ width: `${progressPages !== null ? Math.min(100, (progressPages / 50) * 100) : 4}%` }} />
          </div>
          <p className="mt-2 font-sans text-xs text-ink-40">{activeDepth === "quick" ? t("etaQuick") : t("etaFull")}</p>
        </div>
      )}

      {/* ===== Tab 导航 ===== */}
      {!loading && hasResult && (
        <nav className="mt-4 flex flex-wrap gap-1 border-b border-line print:hidden" aria-label={t("navLabel")} role="tablist">
          {tabs.map((tab) => {
            const active = view === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={active}
                onClick={() => navigate({ view: tab.key })}
                className={`-mb-px border-b-2 px-3 py-2 font-sans text-sm transition-colors ${
                  active ? "border-brand font-semibold text-ink" : "border-transparent text-ink-40 hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* 加载骨架 */}
      {(loading || projectsLoading) && !auditing && (
        <div className="mt-6 space-y-4 print:hidden">
          <TableSkeleton rows={3} />
          <TableSkeleton rows={6} />
        </div>
      )}

      {/* 无项目空态 */}
      {!projectsLoading && projects.length === 0 && !domain.trim() && !loading && (
        <div className="card-a mt-6 flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-ink-40">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
          <div className="mt-3 text-sm font-medium text-ink">{t("emptyProjectsTitle")}</div>
          <p className="mt-1 text-xs text-ink-40">{t("emptyProjectsHint")}</p>
        </div>
      )}

      {/* 失败状态 */}
      {!loading && hasFailed && (
        <div className="card-a mt-6 border-neg/30 bg-neg/5 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neg/15 font-mono text-sm text-neg">!</span>
            <div>
              <div className="font-display text-sm font-semibold text-neg">{t("failedTitle")}</div>
              <p className="mt-1 font-sans text-sm text-ink-60">{activeDepth === "full" ? t("failedHintFull") : t("failedHintDefault")}</p>
              {audit?.error ? <p className="mt-1 break-all font-mono text-xs text-ink-40">{audit.error}</p> : null}
              <div className="mt-3">
                <button onClick={() => openConfirm("quick")} className="btn-primary">{t("retryBtn")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 主内容区 ===== */}
      {!loading && hasResult && audit && (
        <div className="mt-6">
          {/* 旧引擎审计提示 */}
          {!hasDashboard && (
            <div className="mb-4 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 font-sans text-sm text-warn print:hidden">
              {t("legacyAuditNote")}
            </div>
          )}

          {hasDashboard ? (
            <RenderDashboard audit={audit} view={view} selectedIssue={selectedIssue} issuesFilters={issuesFilters} pagesFilters={pagesFilters} navigate={navigate} />
          ) : (
            <LegacyResult audit={audit} activeDepth={activeDepth} locale={locale} />
          )}
        </div>
      )}
      {/* 无审计记录 */}
      {!loading && !hasResult && !hasFailed && !auditing && !projectsLoading && domain.trim() && (
        <div className="card-a mt-6 flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line text-ink-40">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 font-sans text-sm font-medium text-ink">{t("noAuditRecord")}</div>
          <p className="mt-1 font-sans text-xs text-ink-40">{t("runAuditToShow")}</p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => openConfirm("quick")} className="btn-primary">{t("quickAudit")}</button>
          </div>
        </div>
      )}

      {/* 确认弹窗 */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={pendingDepth === "quick" ? t("confirmQuickTitle") : t("confirmFullTitle")}
        footer={
          <>
            <button onClick={() => setConfirmOpen(false)} className="btn-secondary">{tc("cancel")}</button>
            <button onClick={handleConfirmAudit} className="btn-primary">{t("confirmAuditBtn")}</button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="font-sans text-sm text-ink">
            {t.rich("confirmBody", {
              domainVal: domain,
              depth: pendingDepth === "quick" ? t("depthQuick") : t("depthFull"),
              domain: (chunks) => <span className="font-mono text-brand">{chunks}</span>,
            })}
          </p>
          {pendingDepth === "quick" ? (
            <ul className="space-y-2 font-mono text-xs text-ink-40">
              <li>{t("quickPoint1")}</li>
              <li>{t("quickPoint2")}</li>
              <li>{t("quickPoint3")}</li>
              <li>{t("rateLimitPoint")}</li>
            </ul>
          ) : (
            <ul className="space-y-2 font-mono text-xs text-ink-40">
              <li>{t("fullPoint1")}</li>
              <li>{t("fullPoint2")}</li>
              <li>{t("fullPoint3")}</li>
              <li>{t("fullPoint4")}</li>
              <li>{t("rateLimitPoint")}</li>
            </ul>
          )}
        </div>
      </Modal>

      {/* 导出 Modal */}
      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title={t("exportTitle")}>
        <div className="space-y-3">
          <p className="font-sans text-xs text-ink-60">{t("exportMeta", { domain: audit?.domain ?? "", score: audit?.healthScore ?? 0 })}</p>
          <div className="flex flex-col gap-2">
            {canExportPdf ? (
              <button onClick={handleDownloadPdf} disabled={exporting || saving} className="btn-primary disabled:opacity-60">
                {exporting ? t("generating") : t("downloadPdf")}
              </button>
            ) : (
              <Link href="/pricing" className="btn-primary inline-flex items-center justify-center gap-2">{t("upgradePdf")}</Link>
            )}
            <button onClick={handleSaveToReports} disabled={exporting || saving} className="btn-secondary disabled:opacity-60">
              {saving ? t("saving") : t("saveToReports")}
            </button>
          </div>
          <p className="font-sans text-xs text-ink-40">
            {t("exportNote1")}<br />
            {t("exportNote2")}
          </p>
        </div>
      </Modal>

      {/* 隐藏的 PDF 渲染容器 */}
      {hasResult && audit && (
        <div style={{ position: "fixed", left: -9999, top: 0, pointerEvents: "none", opacity: 0 }}>
          <AuditReport
            projectName={audit.domain}
            domain={audit.domain}
            healthScore={audit.healthScore ?? 0}
            issues={audit.issues.map((i) => ({ type: i.checkId, severity: i.severity, url: i.sampleUrl, detail: i.detail, suggestion: i.suggestion ?? "" }))}
            coverage={audit.coverage.map((c) => ({ id: c.id, name: c.name, passed: c.passed }))}
            generatedAt={formatTime(audit.finishedAt ?? audit.startedAt)}
          />
        </div>
      )}

      <Toast />
    </div>
  );
}

// ===== Dashboard 视图路由（单一数据源） =====

function RenderDashboard({
  audit,
  view,
  selectedIssue,
  issuesFilters,
  pagesFilters,
  navigate,
}: {
  audit: AuditData;
  view: ViewKey;
  selectedIssue: string | null;
  issuesFilters: { severity?: string; category?: string; search?: string; sort?: string; group?: string; rule?: string; pageType?: string };
  pagesFilters: {
    health?: string;
    status?: string;
    depth?: string;
    sdStatus?: string;
    pageType?: string;
    severity?: string;
    search?: string;
    sort?: string;
    dir?: string;
    issue?: string;
  };
  navigate: (p: Record<string, string>) => void;
}) {
  const snapshot = audit.dashboard!;
  const go = (p: Record<string, string>) => navigate({ view: p.view ?? "issues", ...p });
  // P1-4：来自 comparison 的真实新增问题规则（禁止按时间猜测；无对比数据则不显示）
  const newRuleIds = new Set((audit.comparison?.newIssues ?? []).map((i) => i.checkId));

  if (view === "issues") {
    return <IssuesCenter snapshot={snapshot} issue={selectedIssue} filters={issuesFilters} newRuleIds={newRuleIds} onNavigate={go} />;
  }
  if (view === "pages") {
    return (
      <CrawledPages
        snapshot={snapshot}
        filters={pagesFilters}
        onNavigate={(p) => navigate({ view: "pages", ...p })}
        onOpenIssue={(ruleId) => navigate({ view: "issues", issue: ruleId })}
      />
    );
  }
  if (view === "linking") {
    return (
      <div className="space-y-4">
        <LinkingSection snapshot={snapshot} onOpenPages={(params) => navigate({ view: "pages", ...params })} />
        <CrawlerStatsSection snapshot={snapshot} />
      </div>
    );
  }
  if (view === "structured") {
    return <StructuredDataSection snapshot={snapshot} onNavigate={go} />;
  }
  if (view === "ai") {
    return <AiSearchSection snapshot={snapshot} />;
  }
  if (view === "history") {
    return <HistorySection history={audit.history} />;
  }
  return <AuditOverview snapshot={snapshot} history={audit.history} comparison={audit.comparison} onNavigate={navigate} />;
}

// ===== 旧引擎审计的降级视图 =====

function LegacyResult({
  audit,
  activeDepth,
  locale,
}: {
  audit: AuditData;
  activeDepth: AuditDepth;
  locale: Locale;
}) {
  const t = useTranslations("dashboard.audit");
  const healthScore = audit.healthScore ?? 0;
  const filtered = audit.issues;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="card-a flex flex-col items-center justify-center p-6 lg:col-span-4">
          <ScoreRing score={healthScore} size={140} thickness={10} showLabel />
          <div className="mt-3 font-display text-base font-semibold text-ink">{t("healthTitle")}</div>
          {audit.comparison?.previous ? (
            <div className="mt-2">
              {audit.comparison.scoreChange >= 5 ? (
                <span className="badge-pos">{t("scoreUp", { n: audit.comparison.scoreChange })}</span>
              ) : audit.comparison.scoreChange <= -5 ? (
                <span className="badge-err">{t("scoreDown", { n: Math.abs(audit.comparison.scoreChange) })}</span>
              ) : (
                <span className="badge-info">{t("scoreFlat")}</span>
              )}
            </div>
          ) : (
            <div className="mt-2 font-mono text-xs text-ink-40">{t("scoreNote")}</div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-8">
          {(["error", "warning", "notice"] as const).map((sev) => (
            <div key={sev} className="card-a relative overflow-hidden p-5">
              <span className="absolute left-0 top-0 h-full w-0.5" style={{ backgroundColor: severityConfig[sev].bar }} />
              <div className="flex items-center gap-2 pl-2">
                <span className={`h-2 w-2 rounded-full ${severityConfig[sev].dot}`} />
                <span className="font-mono text-xs text-ink-40">{t(`sev${sev === "error" ? "Error" : sev === "warning" ? "Warning" : "Notice"}`)}</span>
              </div>
              <div className="mt-2 pl-2 font-mono text-3xl font-semibold text-ink">
                {formatNumber(sev === "error" ? audit.errors : sev === "warning" ? audit.warnings : audit.notices, locale)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-a p-5">
        <h2 className="font-display text-lg font-semibold text-ink">{t("issuesTitle")}</h2>
        {filtered.length === 0 ? (
          <p className="mt-4 font-sans text-sm text-ink-40">{t("issuesEmptyTitle")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-soft bg-line-soft/40 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">
                  <th className="px-3 py-2 text-left font-semibold">{t("thCheck")}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t("thSeverity")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("thAffected")}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t("thSampleUrl")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((issue) => (
                  <tr key={issue.checkId} className="border-b border-line-soft">
                    <td className="px-3 py-2 font-sans text-sm text-ink">{issue.checkName}</td>
                    <td className="px-3 py-2">
                      <span className={severityConfig[issue.severity].badge}>
                        <span className={`h-1.5 w-1.5 rounded-full ${severityConfig[issue.severity].dot}`} />
                        {t(`sev${issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Warning" : "Notice"}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-ink">{issue.affectedPages}</td>
                    <td className="px-3 py-2 font-mono  text-ink-60">{issue.sampleUrl.replace(/^https?:\/\//, "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {audit.history.length > 1 && (
        <div className="card-a p-5">
          <h2 className="font-display text-lg font-semibold text-ink">{t("chartHistoryTitle")}</h2>
          <p className="mt-1 font-mono text-xs text-ink-40">{t("chartHistorySub")}</p>
          <div className="mt-3 h-44">
            <AuditScoreTrend
              data={audit.history
                .filter((h) => h.score !== null)
                .map((h) => ({ date: h.checkedAt, score: h.score as number }))}
            />
          </div>
        </div>
      )}
      <p className="font-mono text-xs text-ink-40">{t("legacyDetailNote")} · {activeDepth}</p>
    </div>
  );
}
