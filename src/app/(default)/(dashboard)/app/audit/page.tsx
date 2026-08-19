"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import ChartCard from "@/components/dashboard/charts/ChartCard";
import AuditCoverageStacked from "@/components/dashboard/charts/AuditCoverageStacked";
import AuditPassDonut from "@/components/dashboard/charts/AuditPassDonut";
import AuditScoreTrend from "@/components/dashboard/charts/AuditScoreTrend";
import ResponseTimeBars from "@/components/dashboard/charts/ResponseTimeBars";
import { useEntitlements } from "@/components/billing/EntitlementsContext";

// 注：审计已改为同步执行（P1-1），不再需要轮询 /api/audit/status

const severityConfig = {
  error: { badge: "badge-err", bar: "#E14B4B", text: "text-neg", dot: "bg-neg" },
  warning: { badge: "badge-warn", bar: "#C98A0A", text: "text-warn", dot: "bg-warn" },
  notice: { badge: "badge-info", bar: "var(--color-ink-25)", text: "text-ink-40", dot: "bg-ink-25" },
} as const;

const categoryConfig = {
  critical: { badge: "badge-err", text: "text-neg" },
  warning: { badge: "badge-warn", text: "text-warn" },
  info: { badge: "badge-info", text: "text-ink-40" },
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

interface CheckCoverageItem {
  id: string;
  name: string;
  category: "critical" | "warning" | "info";
  weight: number;
  description: string;
  passed: boolean;
  affectedPages: number;
}

interface ComparisonData {
  current: { score: number; issues: number; checkedAt: string };
  previous: { score: number; issues: number; checkedAt: string } | null;
  scoreChange: number;
  issuesChange: number;
  newIssues: Array<{ checkId: string; checkName: string; message: string; url: string; severity: string }>;
  resolvedIssues: Array<{ checkId: string; checkName: string; message: string; url: string; severity: string }>;
  unchangedIssues: Array<{ checkId: string; checkName: string; message: string; url: string; severity: string }>;
}

interface HistoryItem {
  id: number;
  score: number | null;
  issuesCount: number;
  checkedAt: string;
}

interface PageDetailEntry {
  url: string;
  responseTimeMs: number;
  status: number;
  ok: boolean;
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
  coverage: CheckCoverageItem[];
  history: HistoryItem[];
  pagesDetail?: PageDetailEntry[];
  error?: string | null;
}

type FilterType = "all" | "error" | "warning" | "notice";

/** 将 SQLite datetime（UTC）转为本地时间可读字符串 */
function formatTime(
  iso: string | null,
  locale: Locale,
  tc: (key: "justNow" | "minutesAgo" | "hoursAgo", values?: { n: number }) => string
): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return tc("justNow");
    if (diff < 3_600_000) return tc("minutesAgo", { n: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return tc("hoursAgo", { n: Math.floor(diff / 3_600_000) });
    return d.toLocaleString(intlLocale(locale), { hour12: false });
  } catch {
    return iso;
  }
}

type AuditDepth = "quick" | "full";

interface ProjectItem {
  /** 项目 id：鉴权模式为 Supabase UUID string，演示模式为 SQLite 整数（string） */
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
  const severityLabel: Record<"error" | "warning" | "notice", string> = {
    error: t("sevError"),
    warning: t("sevWarning"),
    notice: t("sevNotice"),
  };
  const categoryLabel: Record<"critical" | "warning" | "info", string> = {
    critical: t("catCritical"),
    warning: t("catWarning"),
    info: t("catInfo"),
  };
  const { show, Toast } = useToast();
  const { features, loading: entitlementsLoading } = useEntitlements();
  const canFullAudit = entitlementsLoading ? false : features.full_audit;
  const canExportPdf = entitlementsLoading ? false : features.pdf_export;
  const searchParams = useSearchParams();
  const [domain, setDomain] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [pendingDepth, setPendingDepth] = useState<AuditDepth>("quick");
  const [activeDepth, setActiveDepth] = useState<AuditDepth>("quick");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadLatest = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit/latest?domain=${encodeURIComponent(d)}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setAudit(json.data ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载时拉取项目列表：有项目 → 默认选中第一个并自动加载审计；无项目 → 域名为空
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
        // 优先级：URL ?domain= 参数 > 项目列表第一个 > 空
        const queryDomain = searchParams.get("domain")?.trim();
        if (queryDomain) {
          setDomain(queryDomain);
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

  // 域名变化时加载审计结果（仅手动输入后触发）
  const lastLoadedDomain = useRef<string | null>(null);
  useEffect(() => {
    const d = domain.trim();
    if (d && lastLoadedDomain.current !== d) {
      lastLoadedDomain.current = d;
      const id = window.setTimeout(() => void loadLatest(d), 0);
      return () => window.clearTimeout(id);
    }
  }, [loadLatest, domain]);

  const handleConfirmAudit = async () => {
    const depth = pendingDepth;
    setConfirmOpen(false);
    setStarting(true);
    setActiveDepth(depth);
    setAuditing(true);
    show(
      depth === "quick" ? t("toastQuickRunning") : t("toastFullRunning"),
      "info"
    );
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

      // 异步模式：start API 返回 status=running，需要轮询直到完成
      if (json.data?.status === "running") {
        // 立即加载一次（显示 running 状态）
        await loadLatest(domain);
        // 轮询：每 3 秒查询一次，最多 100 次（5 分钟）
        const POLL_INTERVAL = 3000;
        const MAX_POLLS = 100;
        for (let i = 0; i < MAX_POLLS; i++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          const pollRes = await fetch(`/api/audit/latest?domain=${encodeURIComponent(domain.trim())}`, { cache: "no-store" });
          const pollJson = await pollRes.json();
          const status = pollJson.data?.status;
          if (status === "completed" || status === "failed") {
            break;
          }
          // data=null：审计记录丢失（createAudit 失败或被清理），不再轮询
          if (pollJson.data === null) {
            break;
          }
        }
        // 加载最终结果
        await loadLatest(domain);
        // 重新查询最新结果判断成功/失败
        const finalRes = await fetch(`/api/audit/latest?domain=${encodeURIComponent(domain.trim())}`, { cache: "no-store" });
        const finalJson = await finalRes.json();
        const finalStatus = finalJson.data?.status;
        if (finalStatus === "completed") {
          show(
            t("toastDone", { score: finalJson.data?.healthScore ?? 0, pages: finalJson.data?.pagesCrawled ?? 0 }),
            "success"
          );
        } else if (finalStatus === "failed") {
          const apiErr = finalJson.data?.error || finalJson?.error;
          const hint = depth === "full" ? t("hintTimeoutFull") : t("hintRetry");
          show(apiErr ? t("apiErrorWithHint", { error: apiErr, hint }) : hint, "error");
        } else if (finalStatus === "running") {
          // 轮询超时，审计仍在运行（after() 执行较慢或被限流）
          show(t("stillRunning"), "info");
        } else {
          // data=null：审计记录丢失
          show(t("recordMissing"), "error");
        }
      } else {
        // 兼容旧同步模式（直接返回结果）
        if (json.data?.status === "completed") {
          show(
            t("toastDone", { score: json.data?.healthScore ?? 0, pages: json.data?.pagesCrawled ?? 0 }),
            "success"
          );
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

  // ===== 导出报告 =====

  const todayStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const handleDownloadPdf = async () => {
    if (!audit) return;
    setExporting(true);
    try {
      // 服务端 PDF 导出权限校验（pdf_export feature gate）
      // 用 id=0 触发 feature 检查；feature 允许时路由返回 400（id 无效），属正常
      const verifyRes = await fetch(`/api/reports/pdf?id=0`, { cache: "no-store" });
      if (!verifyRes.ok) {
        const json = await verifyRes.json().catch(() => ({}));
        // 403 = FEATURE_NOT_AVAILABLE（feature 不允许），触发升级引导
        // 400/404 = feature 允许但 id 无效，继续生成 PDF
        if (verifyRes.status === 403) {
          const { message } = handleBillingError(json, t("pdfNoPermission"));
          show(message, "error");
          return;
        }
      }

      const filename = t("pdfFilename", { domain: audit.domain, date: todayStr() });
      const blob = await generatePDF({
        title: t("reportTitle", { domain: audit.domain }),
        filename,
        elementId: "report-content",
      });
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
    await loadLatest(domain.trim());
  };

  const hasResult = audit && audit.status === "completed";
  const hasFailed = audit && audit.status === "failed";
  const healthScore = audit?.healthScore ?? 0;
  const issueCount = audit?.issues.length ?? 0;

  const filteredIssues = audit
    ? filter === "all"
      ? audit.issues
      : audit.issues.filter((i) => i.severity === filter)
    : [];

  // ===== 图表数据聚合（前端聚合现有 audit 数据，不加新接口） =====
  const coverage = audit?.coverage;
  const coverageByCategory = useMemo(() => {
    if (!coverage) return [];
    const groups: Record<string, { passed: number; failed: number }> = {
      critical: { passed: 0, failed: 0 },
      warning: { passed: 0, failed: 0 },
      info: { passed: 0, failed: 0 },
    };
    coverage.forEach((c) => {
      const g = groups[c.category];
      if (g) {
        if (c.passed) g.passed += 1;
        else g.failed += 1;
      }
    });
    return [
      { category: "critical", passed: groups.critical.passed, failed: groups.critical.failed },
      { category: "warning", passed: groups.warning.passed, failed: groups.warning.failed },
      { category: "info", passed: groups.info.passed, failed: groups.info.failed },
    ];
  }, [coverage]);

  const passCount = coverage?.filter((c) => c.passed).length ?? 0;
  const failCount = coverage?.filter((c) => !c.passed).length ?? 0;

  const history = audit?.history;
  const historyChart = useMemo(() => {
    if (!history) return [];
    return history
      .filter((h) => h.score !== null)
      .map((h) => ({ date: h.checkedAt, score: h.score as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [history]);

  // 响应时间分布（按桶聚合：快<1s / 中1-3s / 慢>3s / 超时）
  const responseTimeData = useMemo(() => {
    const pagesDetail = audit?.pagesDetail ?? [];
    if (!pagesDetail.length) return [];
    const buckets = [
      { bucket: "<1s", count: 0 },
      { bucket: "1-3s", count: 0 },
      { bucket: "3-10s", count: 0 },
      { bucket: t("bucketTimeout"), count: 0 },
    ];
    for (const p of pagesDetail) {
      if (!p.ok) {
        buckets[3].count++;
      } else if (p.responseTimeMs < 1000) {
        buckets[0].count++;
      } else if (p.responseTimeMs < 3000) {
        buckets[1].count++;
      } else {
        buckets[2].count++;
      }
    }
    return buckets;
  }, [audit?.pagesDetail, t]);

  return (
    <div className="dash-container p-6 lg:p-8 print-area">
      {/* 打印专用页眉 */}
      <div className="mb-6 hidden border-b border-line pb-3 print:block">
        <div className="font-sans text-xs text-ink-40">{t("printHeader")}</div>
        {/* BUG-001：audit=null 时 SSR 渲染 new Date() 时间文本，与客户端 hydration 时刻必然不一致，
            触发 React 18 生产模式整树客户端重渲染，期间页面事件未挂载（点击「快速审计」无反应）。
            suppressHydrationWarning 抑制该 mismatch，保持 SSR 树有效。 */}
        <h1 className="mt-1 font-display text-xl font-bold text-ink" suppressHydrationWarning>
          {audit?.domain ?? domain} · {audit ? formatTime(audit.finishedAt ?? audit.startedAt, locale, tc) : formatTime(new Date().toISOString(), locale, tc)}
        </h1>
      </div>

      {/* 页头 */}
      <div className="flex items-center gap-3 print:hidden">
        <span className="font-mono text-xs text-ink-40">05</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {t("title")}
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60 print:hidden">
        {t("subtitle")}
      </p>

      {/* 工具栏 */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <form onSubmit={handleDomainChange} className="flex items-end gap-2">
          <div>
            <label className="font-sans text-xs text-ink-40">{t("domainLabel")}</label>
            <DomainSelect
              value={domain}
              onChange={(d) => {
                setDomain(d);
              }}
              className="mt-1.5 w-48 rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <button type="submit" className="btn-secondary">
            {t("viewBtn")}
          </button>
        </form>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openConfirm("quick")}
            disabled={auditing || starting}
            title={auditing || starting ? t("auditInProgress") : undefined}
            className="btn-primary disabled:opacity-60"
          >
            {auditing && activeDepth === "quick" ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t("quickAuditing")}
              </>
            ) : starting && pendingDepth === "quick" ? (
              t("starting")
            ) : (
              t("quickAudit")
            )}
          </button>
          {canFullAudit ? (
            <button
              onClick={() => openConfirm("full")}
              disabled={auditing || starting}
              title={t("fullAuditTip")}
              className="btn-secondary disabled:opacity-60"
            >
              {auditing && activeDepth === "full" ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {t("fullAuditing")}
                </>
              ) : starting && pendingDepth === "full" ? (
                t("starting")
              ) : (
                t("fullAudit")
              )}
            </button>
          ) : (
            <Link
              href="/pricing"
              title={t("fullAuditProTip")}
              className="btn-secondary inline-flex items-center gap-1.5"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("upgradeFullAudit")}
            </Link>
          )}
          {hasResult && (
            <button
              onClick={() => setExportOpen(true)}
              className="btn-secondary"
            >
              {t("exportReport")}
            </button>
          )}
        </div>
      </div>

      {/* 上次审计信息 */}
      {!projectsLoading && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs text-ink-40 print:hidden">
          {audit ? (
            <>
              <span>{t("domainColon")}<span className="text-ink-60">{audit.domain}</span></span>
              <span>·</span>
              <span>{t("lastAuditColon")}<span className="text-ink-60">{formatTime(audit.finishedAt ?? audit.startedAt, locale, tc)}</span></span>
              <span>·</span>
              <span>{t("pagesCrawledColon")}<span className="text-ink-60">{t("pagesUnit", { n: audit.pagesCrawled })}</span></span>
              {audit.status === "running" && (
                <>
                  <span>·</span>
                  <span className="text-warn">{t("auditInProgress")}</span>
                </>
              )}
            </>
          ) : domain.trim() ? (
            <span>{t("noAuditRecord")}</span>
          ) : null}
        </div>
      )}

      {/* 无项目空态 */}
      {!projectsLoading && projects.length === 0 && !domain.trim() && (
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

      {/* 审计进度条（同步执行，显示加载态） */}
      {auditing && (
        <div className="card-a mt-4 p-5 print:hidden">
          <div className="flex items-center justify-between font-sans text-xs text-ink-40">
            <span>
              {activeDepth === "quick" ? t("progressQuick") : t("progressFull")}
            </span>
            <span className="text-warn">
              {activeDepth === "quick" ? t("progressBadgeQuick") : t("progressBadgeFull")}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-warn"
              style={{ width: activeDepth === "quick" ? "100%" : "50%" }}
            />
          </div>
          <p className="mt-2 font-sans text-[0.625rem] text-ink-40">
            {activeDepth === "quick"
              ? t("etaQuick")
              : t("etaFull")
            }
          </p>
        </div>
      )}

      {/* 加载骨架 */}
      {(loading || projectsLoading) && !auditing && (
        <div className="mt-6 space-y-4 print:hidden">
          <TableSkeleton rows={3} />
          <TableSkeleton rows={6} />
        </div>
      )}

      {/* 审计失败提示 */}
      {!loading && hasFailed && (
        <div className="card-a mt-6 border-neg/30 bg-neg/5 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neg/15 font-mono text-sm text-neg">!</span>
            <div>
              <div className="font-display text-sm font-bold text-neg">{t("failedTitle")}</div>
              <p className="mt-1 font-sans text-sm text-ink-60">
                {audit?.error
                  ? audit.error
                  : activeDepth === "full"
                    ? t("failedHintFull")
                    : t("failedHintDefault")}
              </p>
              <p className="mt-1 font-sans text-xs text-ink-40">
                {t("domainColon")}{audit?.domain ?? domain} · {formatTime(audit?.finishedAt ?? audit?.startedAt ?? null, locale, tc)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 概览区 */}
      {!loading && !hasFailed && !projectsLoading && domain.trim() && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 健康度大环 + 较上次变化 */}
          <div className="card-a flex flex-col items-center justify-center p-6 lg:col-span-4">
            {hasResult ? (
              <>
                <ScoreRing score={healthScore} size={140} thickness={10} showLabel />
                <div className="mt-3 font-display text-base font-bold text-ink">
                  {t("healthTitle")}
                </div>
                {/* 较上次审计变化 */}
                {audit?.comparison ? (
                  <div className="mt-2">
                    {audit.comparison.previous === null ? (
                      <span className="badge-info">{t("firstAuditBadge")}</span>
                    ) : audit.comparison.scoreChange >= 5 ? (
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
              </>
            ) : (
              <>
                <div className="flex h-[140px] w-[140px] items-center justify-center rounded-full border-2 border-dashed border-line">
                  <span className="font-mono text-xs text-ink-40">{t("noData")}</span>
                </div>
                <div className="mt-3 font-display text-base font-bold text-ink">
                  {t("healthTitle")}
                </div>
                <div className="mt-0.5 font-mono text-xs text-ink-40">
                  {t("runAuditToShow")}
                </div>
              </>
            )}
          </div>

          {/* 三级问题计数 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-8">
            <div className="card-a relative overflow-hidden p-5">
              <span className="absolute left-0 top-0 h-full w-0.5" style={{ backgroundColor: severityConfig.error.bar }} />
              <div className="flex items-center gap-2 pl-2">
                <span className="h-2 w-2 rounded-full bg-neg" />
                <span className="font-mono text-xs text-ink-40">{t("sevError")}</span>
              </div>
              <div className="mt-2 pl-2 font-mono text-3xl font-bold text-neg">
                {formatNumber(audit?.errors ?? 0, locale)}
              </div>
              <div className="mt-1 pl-2 font-mono text-[0.625rem] text-ink-40">
                {t("errCaption")}
              </div>
            </div>
            <div className="card-a relative overflow-hidden p-5">
              <span className="absolute left-0 top-0 h-full w-0.5" style={{ backgroundColor: severityConfig.warning.bar }} />
              <div className="flex items-center gap-2 pl-2">
                <span className="h-2 w-2 rounded-full bg-warn" />
                <span className="font-mono text-xs text-ink-40">{t("sevWarning")}</span>
              </div>
              <div className="mt-2 pl-2 font-mono text-3xl font-bold text-warn">
                {formatNumber(audit?.warnings ?? 0, locale)}
              </div>
              <div className="mt-1 pl-2 font-mono text-[0.625rem] text-ink-40">
                {t("warnCaption")}
              </div>
            </div>
            <div className="card-a relative overflow-hidden p-5">
              <span className="absolute left-0 top-0 h-full w-0.5" style={{ backgroundColor: severityConfig.notice.bar }} />
              <div className="flex items-center gap-2 pl-2">
                <span className="h-2 w-2 rounded-full bg-ink-25" />
                <span className="font-mono text-xs text-ink-40">{t("sevNotice")}</span>
              </div>
              <div className="mt-2 pl-2 font-mono text-3xl font-bold text-ink">
                {formatNumber(audit?.notices ?? 0, locale)}
              </div>
              <div className="mt-1 pl-2 font-mono text-[0.625rem] text-ink-40">
                {t("noticeCaption")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 问题清单 */}
      {!loading && !hasFailed && !projectsLoading && domain.trim() && (
        <div className="mt-10">
        {/* 图表区：4 张图 */}
        {hasResult && (
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-ink-40">05-0</span>
              <h2 className="font-display text-lg font-bold text-ink">{t("chartsTitle")}</h2>
              <div className="hairline flex-1" />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* 检查项类别分布 横向堆叠条 */}
              <ChartCard
                title={t("chartCoverageTitle")}
                subtitle={t("chartCoverageSub")}
                height={240}
                className="lg:col-span-7"
              >
                <AuditCoverageStacked data={coverageByCategory} />
              </ChartCard>

              {/* 通过情况 donut */}
              <ChartCard
                title={t("chartPassTitle")}
                subtitle={t("chartPassSub", { passed: passCount, failed: failCount })}
                height={240}
                className="lg:col-span-5"
              >
                <AuditPassDonut passed={passCount} failed={failCount} />
              </ChartCard>

              {/* 历史分数折线 */}
              <ChartCard
                title={t("chartHistoryTitle")}
                subtitle={t("chartHistorySub")}
                height={260}
                className="lg:col-span-7"
              >
                <AuditScoreTrend data={historyChart} />
              </ChartCard>

              {/* 响应时间分布柱状（深度审计页面明细） */}
              <ChartCard
                title={t("chartResponseTitle")}
                subtitle={activeDepth === "full" ? t("chartResponseSubFull") : t("chartResponseSubEmpty")}
                height={260}
                className="lg:col-span-5"
              >
                <ResponseTimeBars data={responseTimeData} />
              </ChartCard>
            </div>
          </div>
        )}

        <div className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink">
              {t("issuesTitle")}
            </h2>
            <span className="font-mono text-xs text-ink-40">
              {hasResult ? t("issuesCount", { n: issueCount }) : t("noData")}
            </span>
          </div>

          {/* 筛选按钮 */}
          {hasResult && audit && audit.issues.length > 0 && (
            <div className="mt-3 flex gap-2">
              {([
                { key: "all" as const, label: t("filterAll"), count: audit.issues.length },
                { key: "error" as const, label: t("sevError"), count: audit.issues.filter((i) => i.severity === "error").length },
                { key: "warning" as const, label: t("sevWarning"), count: audit.issues.filter((i) => i.severity === "warning").length },
                { key: "notice" as const, label: t("sevNotice"), count: audit.issues.filter((i) => i.severity === "notice").length },
              ]).map((btn) => (
                <button
                  key={btn.key}
                  onClick={() => setFilter(btn.key)}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                    filter === btn.key
                      ? "border-ink-25 bg-ink text-paper"
                      : "border-line bg-card text-ink-60 hover:border-ink-25 hover:text-ink"
                  }`}
                >
                  {btn.label} <span className="ml-0.5 opacity-60">{btn.count}</span>
                </button>
              ))}
            </div>
          )}

          {hasResult && audit && audit.issues.length > 0 ? (
            <div className="card-a mt-4 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-soft bg-line-soft/40">
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thCheck")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thSeverity")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thAffected")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thSampleUrl")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thDetail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.map((issue) => {
                      const cfg = severityConfig[issue.severity];
                      const rowKey = issue.checkId;
                      const isExpanded = expandedRow === rowKey;
                      return (
                        <Fragment key={rowKey}>
                          <tr
                            className="border-b border-line-soft transition-colors hover:bg-line-soft/40 cursor-pointer"
                            onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                          >
                            <td className="px-4 py-3 font-sans text-sm font-medium text-ink">
                              {issue.checkName}
                            </td>
                            <td className="px-4 py-3">
                              <span className={cfg.badge}>
                                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                                {severityLabel[issue.severity]}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-sm text-ink">
                              {formatNumber(issue.affectedPages, locale)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-ink-60">
                              <span className="block max-w-[200px] truncate" title={issue.sampleUrl}>
                                {issue.sampleUrl.replace(/^https?:\/\//, "")}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-sans text-xs text-ink-60">
                              <div className="flex items-center gap-1">
                                <span className="truncate">{issue.detail}</span>
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={`h-3 w-3 flex-shrink-0 text-ink-40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                >
                                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="border-b border-line-soft bg-[#FBFAF4]">
                              <td colSpan={5} className="px-4 py-3">
                                <div className="flex flex-col gap-1 font-sans text-xs">
                                  <span className="text-ink-40">{t("issueDetailLabel")}{issue.detail}</span>
                                  <span className="text-ink-60">{t("suggestionLabel")}{issue.suggestion ?? "—"}</span>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card-a mt-4 border border-dashed border-line p-10 text-center">
              <div className="font-display text-base font-bold text-ink-40">{t("issuesEmptyTitle")}</div>
              <p className="mt-2 font-sans text-sm text-ink-40">
                {audit ? t("issuesEmptyRun") : t("issuesEmptyFirst")}
              </p>
            </div>
          )}
        </div>
        </div>
      )}

      {/* 历史对比区域 */}
      {!loading && hasResult && audit?.comparison && (
        <div className="mt-10">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-40">05-1</span>
            <h2 className="font-display text-lg font-bold text-ink">{t("comparisonTitle")}</h2>
            <div className="hairline flex-1" />
          </div>

          {audit.comparison.previous === null ? (
            <div className="card-a mt-4 p-6 text-center">
              <span className="badge-info">{t("firstAuditBadge")}</span>
              <p className="mt-2 font-mono text-xs text-ink-40">
                {t("firstAuditHint")}
              </p>
            </div>
          ) : (
            <div className="card-a mt-4 p-5">
              {/* 上次 vs 本次 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* 上次 */}
                <div className="rounded-lg border border-line bg-card p-4">
                  <div className="font-mono text-xs text-ink-40">{t("prevAuditLabel")}</div>
                  <div className="mt-1 font-mono text-xs text-ink-60">
                    {formatTime(audit.comparison.previous.checkedAt, locale, tc)}
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-ink-60">
                    {audit.comparison.previous.score}
                    <span className="text-sm text-ink-40">{" "}{t("pointsUnit")}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[0.625rem] text-ink-40">
                    {t("issuesUnit", { n: audit.comparison.previous.issues })}
                  </div>
                </div>

                {/* 变化箭头 */}
                <div className="flex flex-col items-center justify-center">
                  <div className="font-mono text-xs text-ink-40">{t("changeLabel")}</div>
                  <div className={`mt-1 font-mono text-2xl font-bold ${
                    audit.comparison.scoreChange > 0 ? "text-pos" :
                    audit.comparison.scoreChange < 0 ? "text-neg" : "text-ink-40"
                  }`}>
                    {audit.comparison.scoreChange > 0 ? "↑" : audit.comparison.scoreChange < 0 ? "↓" : "→"}
                    {" "}{Math.abs(audit.comparison.scoreChange)}{" "}{t("pointsUnit")}
                  </div>
                  <div className={`mt-0.5 font-mono text-[0.625rem] ${
                    audit.comparison.issuesChange < 0 ? "text-pos" :
                    audit.comparison.issuesChange > 0 ? "text-neg" : "text-ink-40"
                  }`}>
                    {audit.comparison.issuesChange > 0 ? "+" : ""}{t("issuesUnit", { n: audit.comparison.issuesChange })}
                  </div>
                </div>

                {/* 本次 */}
                <div className="rounded-lg border-2 border-brand bg-brand/5 p-4">
                  <div className="font-mono text-xs text-brand">{t("currentAuditLabel")}</div>
                  <div className="mt-1 font-mono text-xs text-ink-60">
                    {formatTime(audit.comparison.current.checkedAt, locale, tc)}
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-ink">
                    {audit.comparison.current.score}
                    <span className="text-sm text-ink-40">{" "}{t("pointsUnit")}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[0.625rem] text-ink-40">
                    {t("issuesUnit", { n: audit.comparison.current.issues })}
                  </div>
                </div>
              </div>

              {/* 新增问题 / 已修复 / 未变化 */}
              <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* 新增问题 */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="badge-err">{t("newBadge")}</span>
                    <span className="font-mono text-xs text-ink-40">
                      {t("newIssuesCount", { n: audit.comparison.newIssues.length })}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {audit.comparison.newIssues.length === 0 ? (
                      <div className="font-mono text-xs text-ink-40 py-2">{t("noNewIssues")}</div>
                    ) : (
                      audit.comparison.newIssues.slice(0, 8).map((issue, idx) => (
                        <div key={`new-${idx}`} className="rounded-md border border-line-soft bg-card px-3 py-2">
                          <div className="font-sans text-xs text-ink">
                            {issue.checkName}
                          </div>
                          <div className="mt-0.5 font-mono text-[0.625rem] text-ink-40 truncate">
                            {issue.message} · {issue.url.replace(/^https?:\/\//, "")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 已修复 */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="badge-pos">{t("resolvedBadge")}</span>
                    <span className="font-mono text-xs text-ink-40">
                      {t("resolvedCount", { n: audit.comparison.resolvedIssues.length })}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {audit.comparison.resolvedIssues.length === 0 ? (
                      <div className="font-mono text-xs text-ink-40 py-2">{t("noResolvedIssues")}</div>
                    ) : (
                      audit.comparison.resolvedIssues.slice(0, 8).map((issue, idx) => (
                        <div key={`resolved-${idx}`} className="rounded-md border border-line-soft bg-card px-3 py-2">
                          <div className="font-sans text-xs text-ink">
                            {issue.checkName}
                          </div>
                          <div className="mt-0.5 font-mono text-[0.625rem] text-ink-40 truncate">
                            {issue.message} · {issue.url.replace(/^https?:\/\//, "")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* 未变化（折叠） */}
              {audit.comparison.unchangedIssues.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowUnchanged(!showUnchanged)}
                    className="font-mono text-xs text-ink-60 hover:text-ink"
                  >
                    {showUnchanged ? "▼" : "▶"}{" "}{t("unchangedToggle", { n: audit.comparison.unchangedIssues.length })}
                  </button>
                  {showUnchanged && (
                    <div className="mt-2 space-y-1.5">
                      {audit.comparison.unchangedIssues.map((issue, idx) => (
                        <div key={`unchanged-${idx}`} className="rounded-md border border-line-soft bg-card px-3 py-2">
                          <div className="font-sans text-xs text-ink-60">
                            {issue.checkName}
                          </div>
                          <div className="mt-0.5 font-mono text-[0.625rem] text-ink-40 truncate">
                            {issue.message} · {issue.url.replace(/^https?:\/\//, "")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 检查项覆盖区域 */}
      {!loading && hasResult && audit?.coverage && audit.coverage.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-40">05-2</span>
            <h2 className="font-display text-lg font-bold text-ink">{t("coverageTitle")}</h2>
            <div className="hairline flex-1" />
          </div>
          <p className="mt-1.5 font-mono text-xs text-ink-40">
            {t("coverageSummary", {
              total: audit.coverage.length,
              passed: audit.coverage.filter((c) => c.passed).length,
              failed: audit.coverage.filter((c) => !c.passed).length,
            })}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {audit.coverage.map((check) => {
              const catCfg = categoryConfig[check.category];
              return (
                <div
                  key={check.id}
                  className={`card-a p-4 ${check.passed ? "" : "border-l-2"}`}
                  style={!check.passed ? { borderLeftColor: catCfg.text === "text-neg" ? "#E14B4B" : catCfg.text === "text-warn" ? "#C98A0A" : "var(--color-ink-25)" } : {}}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-sm font-medium text-ink">
                      {check.name}
                    </span>
                    {check.passed ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pos/10">
                        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-pos">
                          <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neg/10">
                        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-neg">
                          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[0.625rem] text-ink-40">
                    {check.description}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={`badge-${check.category === "critical" ? "err" : check.category === "warning" ? "warn" : "info"}`}>
                      {categoryLabel[check.category]}
                    </span>
                    <span className="font-mono text-[0.625rem] text-ink-40">
                      {check.passed ? t("checkPassed") : t("checkAffected", { n: check.affectedPages })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 下一步 CTA：添加关键词追踪（仅在审计成功完成后显示） */}
      {!loading && hasResult && audit && (
        <div className="mt-10">
          <div className="card-a flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div>
              <div className="font-display text-base font-bold text-ink">
                {t("nextStepTitle")}
              </div>
              <p className="mt-1 font-sans text-sm text-ink-60">
                {t("nextStepDesc")}
              </p>
            </div>
            <Link
              href={
                projects.find((p) => p.domain === audit.domain)
                  ? `/app/position-tracking?projectId=${encodeURIComponent(String(projects.find((p) => p.domain === audit.domain)!.id))}`
                  : "/app/position-tracking"
              }
              className="btn-primary whitespace-nowrap"
            >
              {t("nextStepCta")}
            </Link>
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
            <button
              onClick={() => setConfirmOpen(false)}
              className="btn-secondary"
            >
              {tc("cancel")}
            </button>
            <button
              onClick={handleConfirmAudit}
              className="btn-primary"
            >
              {t("confirmAuditBtn")}
            </button>
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
            <ul className="space-y-1.5 font-mono text-xs text-ink-40">
              <li>{t("quickPoint1")}</li>
              <li>{t("quickPoint2")}</li>
              <li>{t("quickPoint3")}</li>
              <li>{t("rateLimitPoint")}</li>
            </ul>
          ) : (
            <ul className="space-y-1.5 font-mono text-xs text-ink-40">
              <li>{t("fullPoint1")}</li>
              <li>{t("fullPoint2")}</li>
              <li>{t("fullPoint3")}</li>
              <li>{t("fullPoint4")}</li>
              <li>{t("rateLimitPoint")}</li>
            </ul>
          )}
        </div>
      </Modal>

      {/* 导出报告 Modal */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={t("exportTitle")}
      >
        <div className="space-y-3">
          <p className="font-sans text-xs text-ink-60">
            {t("exportMeta", { domain: audit?.domain ?? "", score: audit?.healthScore ?? 0 })}
          </p>
          <div className="flex flex-col gap-2">
            {canExportPdf ? (
              <button
                onClick={handleDownloadPdf}
                disabled={exporting || saving}
                className="btn-primary disabled:opacity-60"
              >
                {exporting ? t("generating") : t("downloadPdf")}
              </button>
            ) : (
              <Link href="/pricing" className="btn-primary inline-flex items-center justify-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                  <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t("upgradePdf")}
              </Link>
            )}
            <button
              onClick={handleSaveToReports}
              disabled={exporting || saving}
              className="btn-secondary disabled:opacity-60"
            >
              {saving ? t("saving") : t("saveToReports")}
            </button>
          </div>
          <p className="font-sans text-[0.625rem] text-ink-40">
            {t("exportNote1")}<br />
            {t("exportNote2")}
          </p>
        </div>
      </Modal>

      {/* 隐藏的审计报告渲染容器（用于 PDF 生成） */}
      {hasResult && audit && (
        <div style={{ position: "fixed", left: -9999, top: 0, pointerEvents: "none", opacity: 0 }}>
          <AuditReport
            projectName={audit.domain}
            domain={audit.domain}
            healthScore={audit.healthScore ?? 0}
            issues={audit.issues.map((i) => ({
              type: i.checkId,
              severity: i.severity,
              url: i.sampleUrl,
              detail: i.detail,
              suggestion: i.suggestion ?? "",
            }))}
            coverage={audit.coverage.map((c) => ({
              id: c.id,
              name: c.name,
              passed: c.passed,
            }))}
            generatedAt={formatTime(audit.finishedAt ?? audit.startedAt, locale, tc)}
          />
        </div>
      )}

      <Toast />
    </div>
  );
}
