"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ScoreRing from "@/components/dashboard/ScoreRing";
import { useToast } from "@/components/dashboard/Toast";
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

// 注：审计已改为同步执行（P1-1），不再需要轮询 /api/audit/status

const severityConfig = {
  error: { label: "错误", badge: "badge-err", bar: "#E14B4B", text: "text-neg", dot: "bg-neg" },
  warning: { label: "警告", badge: "badge-warn", bar: "#C98A0A", text: "text-warn", dot: "bg-warn" },
  notice: { label: "提示", badge: "badge-info", bar: "var(--color-ink-25)", text: "text-ink-40", dot: "bg-ink-25" },
} as const;

const categoryConfig = {
  critical: { label: "严重", badge: "badge-err", text: "text-neg" },
  warning: { label: "警告", badge: "badge-warn", text: "text-warn" },
  info: { label: "提示", badge: "badge-info", text: "text-ink-40" },
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

type AuditDepth = "quick" | "full";

interface ProjectItem {
  id: number;
  name: string;
  domain: string;
  healthScore: number | null;
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center font-mono text-sm text-ink-40">加载中…</div>}>
      <AuditPageInner />
    </Suspense>
  );
}

function AuditPageInner() {
  const { show, Toast } = useToast();
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
      depth === "quick" ? "快速审计进行中，正在审计首页…" : "深度审计进行中，正在爬取页面…",
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
        const msg = json?.error ?? "审计失败";
        show(msg, "error");
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
          // 仍在 running，更新进度
          if (pollJson.data?.pagesCrawled != null) {
            // 可选：更新 UI 显示已爬页数
          }
        }
        // 加载最终结果
        await loadLatest(domain);
        // 重新查询最新结果判断成功/失败
        const finalRes = await fetch(`/api/audit/latest?domain=${encodeURIComponent(domain.trim())}`, { cache: "no-store" });
        const finalJson = await finalRes.json();
        if (finalJson.data?.status === "failed") {
          const apiErr = finalJson.data?.error || finalJson?.error;
          const hint = depth === "full" ? "审计超时，请尝试「快速审计」模式" : "审计失败，请稍后重试";
          show(apiErr ? `${apiErr}（${hint}）` : hint, "error");
        } else {
          show(
            `审计完成：健康度 ${finalJson.data?.healthScore ?? 0} 分，已爬 ${finalJson.data?.pagesCrawled ?? 0} 页`,
            "success"
          );
        }
      } else {
        // 兼容旧同步模式（直接返回结果）
        if (json.data?.status === "failed") {
          const apiErr = json.data?.error || json?.error;
          const hint = depth === "full" ? "审计超时，请尝试「快速审计」模式" : "审计失败，请稍后重试";
          show(apiErr ? `${apiErr}（${hint}）` : hint, "error");
        } else {
          show(
            `审计完成：健康度 ${json.data?.healthScore ?? 0} 分，已爬 ${json.data?.pagesCrawled ?? 0} 页`,
            "success"
          );
        }
        await loadLatest(domain);
      }
    } catch (err) {
      show(`网络错误：${(err as Error).message}`, "error");
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
      const filename = `SeeO审计报告_${audit.domain}_${todayStr()}.pdf`;
      const blob = await generatePDF({
        title: `审计报告 · ${audit.domain}`,
        filename,
        elementId: "report-content",
      });
      downloadPDF(blob, filename);
      show("PDF 已下载", "success");
    } catch (err) {
      show(`PDF 生成失败：${(err as Error).message}`, "error");
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
          title: `审计报告 · ${audit.domain}`,
          data_json: JSON.stringify({
            healthScore: audit.healthScore,
            issues: audit.issues,
          }),
          project_id: null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        show("已保存到报表中心", "success");
        setExportOpen(false);
      } else {
        show(json?.error ?? "保存失败", "error");
      }
    } catch (err) {
      show(`保存失败：${(err as Error).message}`, "error");
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
      { bucket: "超时", count: 0 },
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
  }, [audit?.pagesDetail]);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8 print-area">
      {/* 打印专用页眉 */}
      <div className="mb-6 hidden border-b border-line pb-3 print:block">
        <div className="font-sans text-xs text-ink-40">SeeO · 技术审计报告</div>
        <h1 className="mt-1 font-display text-xl font-bold text-ink">
          {audit?.domain ?? domain} · {audit ? formatTime(audit.finishedAt ?? audit.startedAt) : formatTime(new Date().toISOString())}
        </h1>
      </div>

      {/* 页头 */}
      <div className="flex items-center gap-3 print:hidden">
        <span className="font-mono text-xs text-ink-40">05</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          技术 SEO 审计
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60 print:hidden">
        自建抓取检测，不消耗 SerpApi 额度。BFS 爬取同域名页面（上限 50 页），20+ 项检查并计算健康分。
      </p>

      {/* 工具栏 */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <form onSubmit={handleDomainChange} className="flex items-end gap-2">
          <div>
            <label className="font-sans text-xs text-ink-40">审计域名</label>
            <DomainSelect
              value={domain}
              onChange={(d) => {
                setDomain(d);
              }}
              className="mt-1.5 w-48 rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <button type="submit" className="btn-secondary">
            查看
          </button>
        </form>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openConfirm("quick")}
            disabled={auditing || starting}
            className="btn-primary disabled:opacity-60"
          >
            {auditing && activeDepth === "quick" ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                审计首页…
              </>
            ) : starting && pendingDepth === "quick" ? (
              "启动中…"
            ) : (
              "快速审计"
            )}
          </button>
          <button
            onClick={() => openConfirm("full")}
            disabled={auditing || starting}
            title="耗时较长，建议本地使用"
            className="btn-secondary disabled:opacity-60"
          >
            {auditing && activeDepth === "full" ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                深度审计中…
              </>
            ) : starting && pendingDepth === "full" ? (
              "启动中…"
            ) : (
              "深度审计"
            )}
          </button>
          {hasResult && (
            <button
              onClick={() => setExportOpen(true)}
              className="btn-secondary"
            >
              导出报告
            </button>
          )}
        </div>
      </div>

      {/* 上次审计信息 */}
      {!projectsLoading && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs text-ink-40 print:hidden">
          {audit ? (
            <>
              <span>域名：<span className="text-ink-60">{audit.domain}</span></span>
              <span>·</span>
              <span>上次审计：<span className="text-ink-60">{formatTime(audit.finishedAt ?? audit.startedAt)}</span></span>
              <span>·</span>
              <span>已爬取：<span className="text-ink-60">{audit.pagesCrawled.toLocaleString()} 个页面</span></span>
              {audit.status === "running" && (
                <>
                  <span>·</span>
                  <span className="text-warn">审计进行中…</span>
                </>
              )}
            </>
          ) : domain.trim() ? (
            <span>暂无审计记录，点击右侧按钮开始首次审计</span>
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
          <div className="mt-3 text-sm font-medium text-ink">先去工作台创建项目，或手动输入域名</div>
          <p className="mt-1 text-xs text-ink-40">审计域名会自动从你的项目列表中选择</p>
        </div>
      )}

      {/* 审计进度条（同步执行，显示加载态） */}
      {auditing && (
        <div className="card-a mt-4 p-5 print:hidden">
          <div className="flex items-center justify-between font-sans text-xs text-ink-40">
            <span>
              {activeDepth === "quick" ? "正在审计首页…" : "正在爬取并检测页面…"}
            </span>
            <span className="text-warn">
              {activeDepth === "quick" ? "首页" : "1-2 分钟"}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-warn"
              style={{ width: activeDepth === "quick" ? "100%" : "50%" }}
            />
          </div>
          <p className="mt-2 font-sans text-[10px] text-ink-40">
            {activeDepth === "quick"
              ? "预计 3-5 秒完成，请稍候"
              : "预计 1-2 分钟完成，请勿关闭页面"}
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
              <div className="font-display text-sm font-bold text-neg">审计未完成</div>
              <p className="mt-1 font-sans text-sm text-ink-60">
                {audit?.error
                  ? audit.error
                  : activeDepth === "full"
                    ? "深度审计可能因页面过多超时，请尝试「快速审计」模式（仅审计首页）"
                    : "爬虫未能完成抓取，请稍后重试"}
              </p>
              <p className="mt-1 font-sans text-xs text-ink-40">
                域名：{audit?.domain ?? domain} · {formatTime(audit?.finishedAt ?? audit?.startedAt ?? null)}
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
                  网站健康度
                </div>
                {/* 较上次审计变化 */}
                {audit?.comparison ? (
                  <div className="mt-2">
                    {audit.comparison.previous === null ? (
                      <span className="badge-info">首次审计</span>
                    ) : audit.comparison.scoreChange >= 5 ? (
                      <span className="badge-pos">↑ {audit.comparison.scoreChange} 分</span>
                    ) : audit.comparison.scoreChange <= -5 ? (
                      <span className="badge-err">↓ {Math.abs(audit.comparison.scoreChange)} 分</span>
                    ) : (
                      <span className="badge-info">持平</span>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 font-mono text-xs text-ink-40">基于真实爬取结果计算</div>
                )}
              </>
            ) : (
              <>
                <div className="flex h-[140px] w-[140px] items-center justify-center rounded-full border-2 border-dashed border-line">
                  <span className="font-mono text-xs text-ink-40">无数据</span>
                </div>
                <div className="mt-3 font-display text-base font-bold text-ink">
                  网站健康度
                </div>
                <div className="mt-0.5 font-mono text-xs text-ink-40">
                  发起审计后显示
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
                <span className="font-mono text-xs text-ink-40">错误</span>
              </div>
              <div className="mt-2 pl-2 font-mono text-3xl font-bold text-neg">
                {audit?.errors.toLocaleString() ?? 0}
              </div>
              <div className="mt-1 pl-2 font-mono text-[10px] text-ink-40">
                影响页面，需立即修复
              </div>
            </div>
            <div className="card-a relative overflow-hidden p-5">
              <span className="absolute left-0 top-0 h-full w-0.5" style={{ backgroundColor: severityConfig.warning.bar }} />
              <div className="flex items-center gap-2 pl-2">
                <span className="h-2 w-2 rounded-full bg-warn" />
                <span className="font-mono text-xs text-ink-40">警告</span>
              </div>
              <div className="mt-2 pl-2 font-mono text-3xl font-bold text-warn">
                {audit?.warnings.toLocaleString() ?? 0}
              </div>
              <div className="mt-1 pl-2 font-mono text-[10px] text-ink-40">
                建议尽快处理
              </div>
            </div>
            <div className="card-a relative overflow-hidden p-5">
              <span className="absolute left-0 top-0 h-full w-0.5" style={{ backgroundColor: severityConfig.notice.bar }} />
              <div className="flex items-center gap-2 pl-2">
                <span className="h-2 w-2 rounded-full bg-ink-25" />
                <span className="font-mono text-xs text-ink-40">提示</span>
              </div>
              <div className="mt-2 pl-2 font-mono text-3xl font-bold text-ink">
                {audit?.notices.toLocaleString() ?? 0}
              </div>
              <div className="mt-1 pl-2 font-mono text-[10px] text-ink-40">
                可择机优化
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
              <h2 className="font-display text-lg font-bold text-ink">审计概览图表</h2>
              <div className="hairline flex-1" />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* 检查项类别分布 横向堆叠条 */}
              <ChartCard
                title="检查项分布"
                subtitle="按类别（严重/警告/提示）显示通过/未通过数量"
                height={240}
                className="lg:col-span-7"
              >
                <AuditCoverageStacked data={coverageByCategory} />
              </ChartCard>

              {/* 通过情况 donut */}
              <ChartCard
                title="检查通过情况"
                subtitle={`通过 ${passCount} 项 / 未通过 ${failCount} 项`}
                height={240}
                className="lg:col-span-5"
              >
                <AuditPassDonut passed={passCount} failed={failCount} />
              </ChartCard>

              {/* 历史分数折线 */}
              <ChartCard
                title="历史审计分数"
                subtitle="近 10 次审计健康分变化"
                height={260}
                className="lg:col-span-7"
              >
                <AuditScoreTrend data={historyChart} />
              </ChartCard>

              {/* 响应时间分布柱状（深度审计页面明细） */}
              <ChartCard
                title="响应时间分布"
                subtitle={activeDepth === "full" ? "深度审计页面明细" : "需深度审计后显示"}
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
              问题清单
            </h2>
            <span className="font-mono text-xs text-ink-40">
              {hasResult ? `共 ${issueCount} 类问题` : "暂无数据"}
            </span>
          </div>

          {/* 筛选按钮 */}
          {hasResult && audit && audit.issues.length > 0 && (
            <div className="mt-3 flex gap-2">
              {([
                { key: "all" as const, label: "全部", count: audit.issues.length },
                { key: "error" as const, label: "错误", count: audit.issues.filter((i) => i.severity === "error").length },
                { key: "warning" as const, label: "警告", count: audit.issues.filter((i) => i.severity === "warning").length },
                { key: "notice" as const, label: "提示", count: audit.issues.filter((i) => i.severity === "notice").length },
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
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">检查项</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">级别</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">影响页面</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">示例 URL</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">详情</th>
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
                                {cfg.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-sm text-ink">
                              {issue.affectedPages.toLocaleString()}
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
                                  <span className="text-ink-40">问题详情：{issue.detail}</span>
                                  <span className="text-ink-60">修复建议：{issue.suggestion ?? "—"}</span>
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
              <div className="font-display text-base font-bold text-ink-40">暂无问题清单</div>
              <p className="mt-2 font-sans text-sm text-ink-40">
                {audit ? "审计尚未完成或未检测到问题" : "发起首次审计后，此处将展示真实检测结果"}
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
            <h2 className="font-display text-lg font-bold text-ink">历史对比</h2>
            <div className="hairline flex-1" />
          </div>

          {audit.comparison.previous === null ? (
            <div className="card-a mt-4 p-6 text-center">
              <span className="badge-info">首次审计</span>
              <p className="mt-2 font-mono text-xs text-ink-40">
                暂无历史数据，下次审计后将显示对比
              </p>
            </div>
          ) : (
            <div className="card-a mt-4 p-5">
              {/* 上次 vs 本次 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* 上次 */}
                <div className="rounded-lg border border-line bg-card p-4">
                  <div className="font-mono text-xs text-ink-40">上次审计</div>
                  <div className="mt-1 font-mono text-xs text-ink-60">
                    {formatTime(audit.comparison.previous.checkedAt)}
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-ink-60">
                    {audit.comparison.previous.score}
                    <span className="text-sm text-ink-40"> 分</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-40">
                    {audit.comparison.previous.issues} 个问题
                  </div>
                </div>

                {/* 变化箭头 */}
                <div className="flex flex-col items-center justify-center">
                  <div className="font-mono text-xs text-ink-40">变化</div>
                  <div className={`mt-1 font-mono text-2xl font-bold ${
                    audit.comparison.scoreChange > 0 ? "text-pos" :
                    audit.comparison.scoreChange < 0 ? "text-neg" : "text-ink-40"
                  }`}>
                    {audit.comparison.scoreChange > 0 ? "↑" : audit.comparison.scoreChange < 0 ? "↓" : "→"}
                    {" "}{Math.abs(audit.comparison.scoreChange)} 分
                  </div>
                  <div className={`mt-0.5 font-mono text-[10px] ${
                    audit.comparison.issuesChange < 0 ? "text-pos" :
                    audit.comparison.issuesChange > 0 ? "text-neg" : "text-ink-40"
                  }`}>
                    {audit.comparison.issuesChange > 0 ? "+" : ""}{audit.comparison.issuesChange} 个问题
                  </div>
                </div>

                {/* 本次 */}
                <div className="rounded-lg border-2 border-brand bg-brand/5 p-4">
                  <div className="font-mono text-xs text-brand">本次审计</div>
                  <div className="mt-1 font-mono text-xs text-ink-60">
                    {formatTime(audit.comparison.current.checkedAt)}
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-ink">
                    {audit.comparison.current.score}
                    <span className="text-sm text-ink-40"> 分</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-40">
                    {audit.comparison.current.issues} 个问题
                  </div>
                </div>
              </div>

              {/* 新增问题 / 已修复 / 未变化 */}
              <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* 新增问题 */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="badge-err">新增</span>
                    <span className="font-mono text-xs text-ink-40">
                      {audit.comparison.newIssues.length} 个新问题
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {audit.comparison.newIssues.length === 0 ? (
                      <div className="font-mono text-xs text-ink-40 py-2">无新增问题</div>
                    ) : (
                      audit.comparison.newIssues.slice(0, 8).map((issue, idx) => (
                        <div key={`new-${idx}`} className="rounded-md border border-line-soft bg-card px-3 py-2">
                          <div className="font-sans text-xs text-ink">
                            {issue.checkName}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-ink-40 truncate">
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
                    <span className="badge-pos">已修复</span>
                    <span className="font-mono text-xs text-ink-40">
                      {audit.comparison.resolvedIssues.length} 个问题已修复
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {audit.comparison.resolvedIssues.length === 0 ? (
                      <div className="font-mono text-xs text-ink-40 py-2">无已修复问题</div>
                    ) : (
                      audit.comparison.resolvedIssues.slice(0, 8).map((issue, idx) => (
                        <div key={`resolved-${idx}`} className="rounded-md border border-line-soft bg-card px-3 py-2">
                          <div className="font-sans text-xs text-ink">
                            {issue.checkName}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-ink-40 truncate">
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
                    {showUnchanged ? "▼" : "▶"} 未变化问题（{audit.comparison.unchangedIssues.length} 个）
                  </button>
                  {showUnchanged && (
                    <div className="mt-2 space-y-1.5">
                      {audit.comparison.unchangedIssues.map((issue, idx) => (
                        <div key={`unchanged-${idx}`} className="rounded-md border border-line-soft bg-card px-3 py-2">
                          <div className="font-sans text-xs text-ink-60">
                            {issue.checkName}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-ink-40 truncate">
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
            <h2 className="font-display text-lg font-bold text-ink">检查项覆盖</h2>
            <div className="hairline flex-1" />
          </div>
          <p className="mt-1.5 font-mono text-xs text-ink-40">
            共 {audit.coverage.length} 项检查 · 通过 {audit.coverage.filter((c) => c.passed).length} 项 · 未通过 {audit.coverage.filter((c) => !c.passed).length} 项
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
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
                  <div className="mt-1 font-mono text-[10px] text-ink-40">
                    {check.description}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={`badge-${check.category === "critical" ? "err" : check.category === "warning" ? "warn" : "info"}`}>
                      {catCfg.label}
                    </span>
                    <span className="font-mono text-[10px] text-ink-40">
                      {check.passed ? "通过" : `影响 ${check.affectedPages} 页`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 确认弹窗 */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={pendingDepth === "quick" ? "确认发起快速审计" : "确认发起深度审计"}
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              className="btn-secondary"
            >
              取消
            </button>
            <button
              onClick={handleConfirmAudit}
              className="btn-primary"
            >
              确认审计
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="font-sans text-sm text-ink">
            将对域名 <span className="font-mono text-brand">{domain}</span> 发起
            {pendingDepth === "quick" ? "快速" : "深度"}技术审计。
          </p>
          {pendingDepth === "quick" ? (
            <ul className="space-y-1.5 font-mono text-xs text-ink-40">
              <li>· 仅爬取首页（1 页），3-5 秒完成</li>
              <li>· 覆盖 80% 检查项（标题/描述/H1/alt/canonical/SSL 等）</li>
              <li>· 不包含重复标题/描述/H1、死链、sitemap（需多页交叉）</li>
              <li>· 同一域名 1 小时内仅允许审计一次</li>
            </ul>
          ) : (
            <ul className="space-y-1.5 font-mono text-xs text-ink-40">
              <li>· BFS 爬取同域名页面，上限 50 页</li>
              <li>· 并发 2，单页超时 10 秒，尊重 robots.txt</li>
              <li>· 20+ 项检查（含重复标题/描述/H1、死链、sitemap）</li>
              <li>· 预计 1-2 分钟完成，耗时较长建议本地使用</li>
              <li>· 同一域名 1 小时内仅允许审计一次</li>
            </ul>
          )}
        </div>
      </Modal>

      {/* 导出报告 Modal */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="导出审计报告"
      >
        <div className="space-y-3">
          <p className="font-sans text-xs text-ink-60">
            域名：{audit?.domain} · 健康度 {audit?.healthScore ?? 0} 分
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={exporting || saving}
              className="btn-primary disabled:opacity-60"
            >
              {exporting ? "生成中…" : "下载 PDF"}
            </button>
            <button
              onClick={handleSaveToReports}
              disabled={exporting || saving}
              className="btn-secondary disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存到报表中心"}
            </button>
          </div>
          <p className="font-sans text-[10px] text-ink-40">
            · PDF 在浏览器端即时生成，不占存储<br />
            · 保存到报表中心后可在报表页随时回看
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
            generatedAt={formatTime(audit.finishedAt ?? audit.startedAt)}
          />
        </div>
      )}

      <Toast />
    </div>
  );
}
