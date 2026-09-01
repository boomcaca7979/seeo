"use client";

// ===== Crawled Pages：所有被抓取页面的分析表格 =====
// 列：URL / Status / Health / Issues / Severity / Page Type / Words / Response / Depth / Redirect
// P1-3：全部筛选状态 URL 驱动（health/status/depth/sdStatus/pageType/severity/search/sort/dir/issue），
//       Back / Forward / Reload / 直链均可恢复；Search 本地即时输入 + debounce 写 URL。
// P1-1：issue=<ruleId> 过滤只显示该规则受影响页面（数据来自已保存的 snapshot，不重新抓取）。
// P1-2：Page Detail 展开区按 Summary-first 分五层：Page Header → Primary Summary
//       → Crawl & Links → Structured Data & Semantic → Findings。

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { DashboardSnapshot, PageSnapshot, PageHealth, LocalizedText } from "@/lib/seo/audit-dashboard";
import { SectionCard, HealthBadge, EmptyBlock, fmtNum, SEVERITY_COLORS } from "./ui";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

type SortKey = "url" | "status" | "responseTimeMs" | "depth" | "issueCount" | "wordCount" | "internalLinks";

export interface PagesFilters {
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
}

function textOf(v: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : v[locale];
}

export default function CrawledPages({
  snapshot,
  filters,
  onNavigate,
  onOpenIssue,
}: {
  snapshot: DashboardSnapshot;
  filters: PagesFilters;
  onNavigate: (params: Record<string, string>) => void;
  onOpenIssue: (ruleId: string) => void;
}) {
  const t = useTranslations("dashboard.audit");
  const locale = useLocale() as "en" | "zh";

  // Search：本地即时输入 + debounce 写 URL（URL 为唯一持久状态源）。
  // Back/Forward/直链导致 URL search 变化时，用渲染期调整同步本地输入（React 推荐的 props 派生模式）。
  const urlSearch = filters.search ?? "";
  const [searchLocal, setSearchLocal] = useState(urlSearch);
  const [prevUrlSearch, setPrevUrlSearch] = useState(urlSearch);
  if (urlSearch !== prevUrlSearch) {
    setPrevUrlSearch(urlSearch);
    setSearchLocal(urlSearch);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (v: string) => {
    setSearchLocal(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onNavigate({ search: v });
    }, SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const { health, status, depth, sdStatus, pageType, severity } = filters;
  const sort = (filters.sort ?? "issueCount") as SortKey;
  const dir = (filters.dir === "asc" ? "asc" : "desc") as "asc" | "desc";
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const healthOptions: Array<{ v: string; label: string }> = [
    { v: "healthy", label: t("healthHealthy") },
    { v: "needs-attention", label: t("healthNeedsAttention") },
    { v: "critical", label: t("healthCritical") },
    { v: "redirect", label: t("healthRedirect") },
    { v: "blocked", label: t("healthBlocked") },
  ];

  const sdOptions = ["valid", "potential-issue", "invalid", "malformed", "none"] as const;

  const pageTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of snapshot.pages) if (p.pageType) set.add(p.pageType);
    return [...set].sort();
  }, [snapshot]);

  const findingsByUrl = useMemo(() => {
    const map = new Map<string, Array<{ ruleId: string; severity: string; message: unknown }>>();
    for (const f of snapshot.findings) {
      const arr = map.get(f.url) ?? [];
      arr.push(f);
      map.set(f.url, arr);
    }
    return map;
  }, [snapshot]);

  // P1-1：issue 过滤——该规则受影响的 URL 集合（来自已保存 findings，不重新请求）
  const issueRule = filters.issue ? snapshot.rules.find((r) => r.ruleId === filters.issue) ?? null : null;
  const issueUrls = useMemo(() => {
    if (!filters.issue) return null;
    return new Set(snapshot.findings.filter((f) => f.ruleId === filters.issue).map((f) => f.url));
  }, [snapshot, filters.issue]);

  const filtered = useMemo(() => {
    const q = (filters.search ?? "").trim().toLowerCase();
    return snapshot.pages
      .filter((p) => {
        if (issueUrls && !issueUrls.has(p.url) && !issueUrls.has(p.finalUrl)) return false;
        if (health && p.health !== health) return false;
        if (status) {
          const bucket = p.status >= 500 ? "5xx" : p.status >= 400 ? "4xx" : p.status >= 300 ? "3xx" : p.status >= 200 ? "2xx" : "other";
          if (bucket !== status) return false;
        }
        if (depth) {
          const bucket = p.depth <= 3 ? String(p.depth) : "4+";
          if (bucket !== depth) return false;
        }
        if (sdStatus && (p.structuredDataStatus ?? "none") !== sdStatus) return false;
        if (pageType && p.pageType !== pageType) return false;
        if (severity === "error" && p.errorCount === 0) return false;
        if (severity === "warning" && p.warningCount === 0) return false;
        if (severity === "notice" && p.noticeCount === 0) return false;
        if (q && !p.url.toLowerCase().includes(q) && !(p.title ?? "").toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sort];
        const bv = b[sort];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
        return dir === "asc" ? cmp : -cmp;
      });
  }, [snapshot, issueUrls, filters.search, health, status, depth, sdStatus, pageType, severity, sort, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sort === key) onNavigate({ dir: dir === "desc" ? "asc" : "desc" });
    else onNavigate({ sort: key, dir: "desc" });
  };

  const statusLabel = (p: PageSnapshot): string =>
    p.status === 0 ? (p.health === "redirect" ? "loop" : "err") : String(p.status);

  const hasFilters = !!(filters.search || health || status || depth || sdStatus || pageType || severity || (filters.sort && filters.sort !== "issueCount") || filters.dir === "asc" || filters.issue);
  const clearAll = () => onNavigate({ search: "", health: "", status: "", depth: "", sdStatus: "", pageType: "", severity: "", sort: "", dir: "", issue: "" });

  return (
    <div className="space-y-4">
      <SectionCard
        title={
          <span>
            {t("crawledPagesTitle")} <span className="font-mono text-xs text-ink-40">({fmtNum(snapshot.pages.length)})</span>
          </span>
        }
        subtitle={t("crawledPagesSub", { crawled: fmtNum(snapshot.pagesCrawled), indexable: fmtNum(snapshot.indexablePages) })}
        bodyClassName="mt-0"
      >
        {/* P1-1：issue 活动筛选 chip（可清除，来自 Issue Detail 的钻取上下文） */}
        {issueRule && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2">
            <span className="font-mono text-xs text-ink-60">
              {t("issueFilterChip", { name: textOf(issueRule.name, locale) })}
              <span className="ml-1.5 font-semibold text-ink">
                · {t("pagesUnit", { n: issueUrls?.size ?? issueRule.affectedPages })}
              </span>
            </span>
            <button
              onClick={() => onNavigate({ issue: "" })}
              className="ml-auto rounded-md border border-line bg-card px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink"
              aria-label={t("clearIssueFilter")}
            >
              ✕ {t("clearIssueFilter")}
            </button>
          </div>
        )}

        {/* Filters（全部 URL 驱动） */}
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line-soft pb-4">
          <input
            value={searchLocal}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t("searchPages")}
            aria-label={t("searchPages")}
            className="w-52 rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
          <select value={health} onChange={(e) => onNavigate({ health: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink" aria-label={t("filterHealth")}>
            <option value="">{t("filterHealth")}: {t("filterAll")}</option>
            {healthOptions.map((h) => (
              <option key={h.v} value={h.v}>{h.label}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => onNavigate({ status: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink" aria-label={t("filterStatus")}>
            <option value="">{t("filterStatus")}: {t("filterAll")}</option>
            {["2xx", "3xx", "4xx", "5xx", "other"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={pageType} onChange={(e) => onNavigate({ pageType: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink" aria-label={t("filterPageType")}>
            <option value="">{t("filterPageType")}: {t("filterAll")}</option>
            {pageTypes.map((pt) => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
          <select value={depth} onChange={(e) => onNavigate({ depth: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink" aria-label={t("filterDepth")}>
            <option value="">{t("filterDepth")}: {t("filterAll")}</option>
            {["0", "1", "2", "3", "4+"].map((d) => (
              <option key={d} value={d}>D{d}</option>
            ))}
          </select>
          <select value={sdStatus} onChange={(e) => onNavigate({ sdStatus: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink" aria-label={t("filterSdStatus")}>
            <option value="">{t("filterSdStatus")}: {t("filterAll")}</option>
            {sdOptions.map((s) => (
              <option key={s} value={s}>{t(`sdStatus.${s}`)}</option>
            ))}
          </select>
          <select value={severity} onChange={(e) => onNavigate({ severity: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink" aria-label={t("filterSeverity")}>
            <option value="">{t("filterSeverity")}: {t("filterAll")}</option>
            <option value="error">{t("sevError")}</option>
            <option value="warning">{t("sevWarning")}</option>
            <option value="notice">{t("sevNotice")}</option>
          </select>
          {hasFilters ? (
            <button onClick={clearAll} className="ml-auto rounded-md border border-line px-2 py-1.5 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink">
              ✕ {t("clearFilters")}
            </button>
          ) : null}
          <span className={`${hasFilters ? "" : "ml-auto"} font-mono text-xs text-ink-40`}>
            {t("pagesUnit", { n: filtered.length })}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyBlock title={t("noPagesMatch")} hint={t("clearFiltersHint")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-soft bg-line-soft/40 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">
                  <th className="px-3 py-2 text-left font-semibold">
                    <button onClick={() => toggleSort("url")} className="hover:text-ink">{t("thUrl")}{sort === "url" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    <button onClick={() => toggleSort("status")} className="hover:text-ink">{t("thStatus")}{sort === "status" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">{t("thHealth")}</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    <button onClick={() => toggleSort("issueCount")} className="hover:text-ink">{t("thIssues")}{sort === "issueCount" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
                  </th>
                  <th className="hidden px-3 py-2 text-left font-semibold lg:table-cell">{t("thPageType")}</th>
                  <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">
                    <button onClick={() => toggleSort("wordCount")} className="hover:text-ink">{t("thWords")}{sort === "wordCount" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
                  </th>
                  <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">
                    <button onClick={() => toggleSort("responseTimeMs")} className="hover:text-ink">{t("thResponse")}{sort === "responseTimeMs" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
                  </th>
                  <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">
                    <button onClick={() => toggleSort("depth")} className="hover:text-ink">{t("thDepth")}{sort === "depth" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
                  </th>
                  <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">{t("thRedirect")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <PageRow
                    key={p.finalUrl}
                    p={p}
                    expanded={expanded === p.finalUrl}
                    onToggle={() => setExpanded(expanded === p.finalUrl ? null : p.finalUrl)}
                    statusLabel={statusLabel(p)}
                    findings={findingsByUrl.get(p.url) ?? findingsByUrl.get(p.finalUrl) ?? []}
                    onOpenIssue={onOpenIssue}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="font-mono text-xs text-ink-40">
              {t("showingPages", { from: (current - 1) * PAGE_SIZE + 1, to: Math.min(current * PAGE_SIZE, filtered.length), total: filtered.length })}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={current <= 1}
                className="rounded-md border border-line px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 disabled:opacity-40"
              >
                ←
              </button>
              <span className="px-2 font-mono text-xs text-ink-40">{current} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={current >= totalPages}
                className="rounded-md border border-line px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function PageRow({
  p,
  expanded,
  onToggle,
  statusLabel,
  findings,
  onOpenIssue,
}: {
  p: PageSnapshot;
  expanded: boolean;
  onToggle: () => void;
  statusLabel: string;
  findings: Array<{ ruleId: string; severity: string; message: unknown }>;
  onOpenIssue: (ruleId: string) => void;
}) {
  const t = useTranslations("dashboard.audit");
  const healthLabel = t(`health${p.health === "healthy" ? "Healthy" : p.health === "needs-attention" ? "NeedsAttention" : p.health === "critical" ? "Critical" : p.health === "redirect" ? "Redirect" : "Blocked"}`);
  return (
    <>
      <tr
        className="cursor-pointer border-b border-line-soft transition-colors hover:bg-line-soft/40"
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink-40">{expanded ? "▾" : "▸"}</span>
            <span className="block max-w-[240px] truncate font-mono text-xs text-ink" title={p.url}>
              {p.url.replace(/^https?:\/\//, "")}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 font-mono ">
          <span className={`${p.status >= 500 ? "text-neg" : p.status >= 400 ? "text-warn" : p.status >= 300 ? "text-violet-600" : "text-pos"}`}>
            {statusLabel}
          </span>
        </td>
        <td className="px-3 py-2">
          <HealthBadge health={p.health as PageHealth} label={healthLabel} />
        </td>
        <td className="px-3 py-2 text-right">
          <span className="font-mono text-sm font-semibold text-ink">{p.issueCount}</span>
          <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
            {p.errorCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS.error }} title={`${p.errorCount} error`} aria-label={`${p.errorCount} error`} />}
            {p.warningCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS.warning }} title={`${p.warningCount} warning`} aria-label={`${p.warningCount} warning`} />}
            {p.noticeCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS.notice }} title={`${p.noticeCount} notice`} aria-label={`${p.noticeCount} notice`} />}
          </span>
        </td>
        <td className="hidden px-3 py-2 font-mono  text-ink-60 lg:table-cell">{p.pageType ?? "—"}</td>
        <td className="hidden px-3 py-2 text-right font-mono  text-ink-60 md:table-cell">{p.wordCount !== null ? fmtNum(p.wordCount) : "—"}</td>
        <td className="hidden px-3 py-2 text-right font-mono  text-ink-60 md:table-cell">{p.responseTimeMs}ms</td>
        <td className="hidden px-3 py-2 text-right font-mono  text-ink-60 sm:table-cell">{p.depth}</td>
        <td className="hidden px-3 py-2 text-right font-mono  sm:table-cell">
          {p.isRedirect ? (
            <span className="badge-warn">{p.hops} hop{p.hops > 1 ? "s" : ""}</span>
          ) : (
            <span className="text-ink-40">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-line-soft bg-[#FBFAF4]">
          <td colSpan={9} className="px-4 py-4">
            {/* ===== P1-2 LEVEL 1 — Page Header：先回答"这一页健康吗、有没有问题" ===== */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft pb-3">
              <span className="min-w-0 flex-1 break-all font-mono text-xs font-semibold text-ink">{p.url}</span>
              <span className={`font-mono text-sm font-semibold ${p.status >= 500 ? "text-neg" : p.status >= 400 ? "text-warn" : p.status >= 300 ? "text-violet-600" : "text-pos"}`}>
                {statusLabel}
              </span>
              <HealthBadge health={p.health as PageHealth} label={healthLabel} />
              <span className="badge-info font-mono">{p.pageType ?? "—"}</span>
              <span className="font-mono text-sm font-semibold text-ink">
                {p.issueCount} {t("thIssues")}
                <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
                  {p.errorCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS.error }} title={`${p.errorCount} error`} aria-label={`${p.errorCount} error`} />}
                  {p.warningCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS.warning }} title={`${p.warningCount} warning`} aria-label={`${p.warningCount} warning`} />}
                  {p.noticeCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS.notice }} title={`${p.noticeCount} notice`} aria-label={`${p.noticeCount} notice`} />}
                </span>
              </span>
              <span className="font-mono text-xs text-ink-40">{p.responseTimeMs}ms · D{p.depth}</span>
            </div>

            {/* ===== LEVEL 2 — Primary Summary：核心内容事实 ===== */}
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">{t("pageSummarySection")}</div>
              <div className="space-y-1.5 font-mono text-xs">
                <DetailRow label={t("titleLabel")} value={p.title ?? "—"} breakAll />
                <DetailRow label={t("descriptionLabel")} value={p.description ?? "—"} breakAll />
                <DetailRow label={t("h1Label")} value={p.h1 ?? "—"} breakAll />
                <DetailRow label={t("canonicalLabel")} value={p.canonical ?? "—"} breakAll />
                <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                  <DetailRow label={t("thWords")} value={p.wordCount !== null ? fmtNum(p.wordCount) : "—"} />
                  <DetailRow label={t("textHtmlRatio")} value={p.textHtmlRatio !== null ? `${Math.round(p.textHtmlRatio * 1000) / 10}%` : "—"} />
                  <DetailRow label={t("thResponse")} value={`${p.responseTimeMs}ms`} />
                  <DetailRow label={t("finalUrl")} value={p.finalUrl !== p.url ? p.finalUrl : "—"} mono breakAll />
                </div>
              </div>
            </div>

            {/* ===== LEVEL 3 — Crawl / Links ===== */}
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">{t("crawlLinksSection")}</div>
              <div className="grid grid-cols-2 gap-x-6 font-mono text-xs sm:grid-cols-4">
                <DetailRow label={t("thDepth")} value={String(p.depth)} />
                <DetailRow label={t("internalLinks")} value={p.internalLinks !== null ? fmtNum(p.internalLinks) : "—"} />
                <DetailRow label={t("inLinksLabel")} value={p.inLinks !== null ? fmtNum(p.inLinks) : "—"} />
                <DetailRow label={t("externalLinksLabel")} value={p.externalLinks !== null ? fmtNum(p.externalLinks) : "—"} />
                <DetailRow label={t("thRedirect")} value={p.isRedirect ? `${p.hops} hop${p.hops > 1 ? "s" : ""}` : "—"} />
                <DetailRow label={t("sourceLabel")} value={p.source} />
                <DetailRow label={t("contentStatus")} value={p.contentStatus ?? "—"} />
              </div>
            </div>

            {/* ===== LEVEL 4 — Structured Data / Semantic ===== */}
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">{t("sdSemanticSection")}</div>
              <div className="grid grid-cols-1 gap-1.5 font-mono text-xs sm:grid-cols-2">
                <DetailRow label={t("structuredDataTitle")} value={p.structuredDataStatus ? t(`sdStatus.${p.structuredDataStatus}`) : "—"} />
                <DetailRow label={t("schemaTypes")} value={p.structuredDataTypes.length > 0 ? p.structuredDataTypes.slice(0, 4).join(", ") : "—"} breakAll />
                <DetailRow label={t("semanticHtmlLabel")} value={p.semanticMainCount !== null ? String(p.semanticMainCount) : "—"} />
              </div>
            </div>

            {/* ===== LEVEL 5 — Findings ===== */}
            {findings.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">{t("pageFindings")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {findings.map((f, i) => (
                    <button
                      key={`${f.ruleId}-${i}`}
                      onClick={() => onOpenIssue(f.ruleId)}
                      className="badge-info font-mono text-xs transition-colors hover:border-ink-25"
                    >
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[f.severity as keyof typeof SEVERITY_COLORS] }} aria-hidden />
                      {f.ruleId}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DetailRow({ label, value, mono = true, breakAll }: { label: string; value: string; mono?: boolean; breakAll?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-ink-40">{label}</span>
      <span className={`min-w-0 text-right text-ink ${mono ? "font-mono" : ""} ${breakAll ? "break-all" : "truncate"}`}>{value}</span>
    </div>
  );
}
