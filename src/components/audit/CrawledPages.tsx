"use client";

// ===== Crawled Pages：抓取页面工作区 =====
//
// 结构（与已验收的 /app、审计概览、问题清单同一套设计语言）：
//   ① 指标卡：抓取页面数 / 成功响应 / 失败页面 / 有异常的页面（全部来自本次真实抓取）
//   ② HTTP 状态分布：真实 2xx/3xx/4xx/5xx/other 计数，点击即筛选（复用既有 status 筛选）
//   ③ 抓取统计：请求数 / 重定向 / 平均耗时 / 抓取错误
//   ④ 异常快筛 + 既有筛选（全部 URL 驱动）+ 数据表格（可排序、可展开页面详情）
//
// 诚实边界：
//   - 未抓取成功（ok=false）的页面不会被当作"成功"；无页面记录时给出独立空态，
//     不与"筛选无匹配"混淆；不生成任何虚构的状态分布。
//   - 页面级规则检出（error/warning/notice 计数）来自本次审计快照，不重新抓取。
//
// 冻结不变：URL 驱动的筛选（health/status/depth/sdStatus/pageType/severity/search/sort/dir/issue）、
//           issue 钻取 chip、搜索 debounce、分页、页面详情五层结构、onOpenIssue 深链。

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { DashboardSnapshot, PageSnapshot, PageHealth, LocalizedText } from "@/lib/seo/audit-dashboard";
import { SectionCard, HealthBadge, EmptyBlock, fmtNum, SegmentedBar, HTTP_STATUS_COLORS, type Segment } from "./ui";
import MetricCard from "@/components/viz/MetricCard";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";

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
  /** 异常快筛（视图层，基于已抓取记录派生） */
  failed?: string;
  abnormal?: string;
}

function textOf(v: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : v[locale];
}

/** HTTP 状态段 → 语义色（与审计概览的 HTTP 分布保持同一套取色） */
const HTTP_BUCKET_COLOR: Record<string, string> = {
  "2xx": HTTP_STATUS_COLORS["2xx"],
  "3xx": HTTP_STATUS_COLORS["3xx"],
  "4xx": HTTP_STATUS_COLORS["4xx"],
  "5xx": HTTP_STATUS_COLORS["5xx"],
  other: HTTP_STATUS_COLORS.other,
};

function statusBucket(status: number): string {
  return status >= 500 ? "5xx" : status >= 400 ? "4xx" : status >= 300 ? "3xx" : status >= 200 ? "2xx" : "other";
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

  // ---- 头部指标（全部来自本次真实抓取） ----
  const stats = useMemo(() => {
    const pages = snapshot.pages;
    const ok = pages.filter((p) => p.ok).length;
    return {
      pages: pages.length,
      ok,
      failed: pages.length - ok,
      withIssues: pages.filter((p) => p.issueCount > 0).length,
      findings: pages.reduce((a, p) => a + p.issueCount, 0),
    };
  }, [snapshot]);

  /** HTTP 分布：真实抓取记录的状态计数（与审计概览同口径） */
  const httpSegments: Segment[] = [
    { label: "2xx", value: snapshot.crawler.httpStatus["2xx"], color: HTTP_BUCKET_COLOR["2xx"] },
    { label: "3xx", value: snapshot.crawler.httpStatus["3xx"], color: HTTP_BUCKET_COLOR["3xx"] },
    { label: "4xx", value: snapshot.crawler.httpStatus["4xx"], color: HTTP_BUCKET_COLOR["4xx"] },
    { label: "5xx", value: snapshot.crawler.httpStatus["5xx"], color: HTTP_BUCKET_COLOR["5xx"] },
    { label: t("httpOther"), value: snapshot.crawler.httpStatus.other, color: HTTP_BUCKET_COLOR.other },
  ];
  // 段标签 → URL 筛选值（other 需映射回 "other"）
  const httpFilterValue = (label: string): string => (label === t("httpOther") ? "other" : label);
  const httpTotal = httpSegments.reduce((a, s) => a + s.value, 0);

  const filtered = useMemo(() => {
    const q = (filters.search ?? "").trim().toLowerCase();
    return snapshot.pages
      .filter((p) => {
        if (issueUrls && !issueUrls.has(p.url) && !issueUrls.has(p.finalUrl)) return false;
        if (filters.failed && p.ok) return false;
        if (filters.abnormal && p.issueCount === 0) return false;
        if (health && p.health !== health) return false;
        if (status) {
          if (statusBucket(p.status) !== status) return false;
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
  }, [snapshot, issueUrls, filters.search, filters.failed, filters.abnormal, health, status, depth, sdStatus, pageType, severity, sort, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sort === key) onNavigate({ dir: dir === "desc" ? "asc" : "desc" });
    else onNavigate({ sort: key, dir: "desc" });
  };

  const statusLabel = (p: PageSnapshot): string =>
    p.status === 0 ? (p.health === "redirect" ? "loop" : "err") : String(p.status);

  const hasFilters = !!(
    filters.search || filters.failed || filters.abnormal || health || status || depth || sdStatus || pageType || severity ||
    (filters.sort && filters.sort !== "issueCount") || filters.dir === "asc" || filters.issue
  );
  const clearAll = () =>
    onNavigate({ search: "", failed: "", abnormal: "", health: "", status: "", depth: "", sdStatus: "", pageType: "", severity: "", sort: "", dir: "", issue: "" });

  /** 异常快筛（全部基于已抓取记录派生，不新增抓取） */
  const quickFilters: Array<{ key: string; label: string; active: boolean; params: Record<string, string> }> = [
    { key: "all", label: t("qfAll"), active: !hasFilters, params: { failed: "", abnormal: "", health: "", status: "", depth: "", sdStatus: "", pageType: "", severity: "", search: "", issue: "", sort: "", dir: "" } },
    { key: "failed", label: t("qfFailed", { n: stats.failed }), active: !!filters.failed, params: { failed: "1", health: "", severity: "" } },
    { key: "abnormal", label: t("qfIssues", { n: stats.withIssues }), active: !!filters.abnormal, params: { abnormal: "1", failed: "", health: "", severity: "" } },
    { key: "redirect", label: t("qfRedirect"), active: health === "redirect", params: { health: "redirect", failed: "", abnormal: "" } },
  ];

  const sevClass = (s: "error" | "warning" | "notice") =>
    s === "error" ? "text-neg" : s === "warning" ? "text-warn" : "text-ink-40";

  return (
    <div className="space-y-4">
      {/* ===== ① 指标卡 ===== */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t("pcPages")}
          value={fmtNum(stats.pages)}
          caption={t("pcRequestsCaption", { requests: fmtNum(snapshot.pagesCrawled), redirects: fmtNum(snapshot.crawler.redirects) })}
          hint={t("pcPagesHint")}
          hintStyle="plain"
        />
        <MetricCard
          label={t("pcOk")}
          value={fmtNum(stats.ok)}
          caption={t("pcOkCaption")}
          hint={t("pcOkHint")}
          hintStyle="plain"
          tone={stats.ok > 0 ? "pos" : undefined}
        />
        <MetricCard
          label={t("pcFailed")}
          value={fmtNum(stats.failed)}
          caption={stats.failed > 0 ? t("pcFailedCaption") : t("pcFailedNone")}
          hint={t("pcFailedHint")}
          hintStyle="plain"
          tone={stats.failed > 0 ? "neg" : undefined}
        />
        <MetricCard
          label={t("pcWithIssues")}
          value={fmtNum(stats.withIssues)}
          caption={t("pcFindingsCaption", { n: fmtNum(stats.findings) })}
          hint={t("pcWithIssuesHint")}
          hintStyle="plain"
          tone={stats.withIssues > 0 ? "warn" : undefined}
        />
      </div>

      {/* ===== ② HTTP 状态分布 + ③ 抓取统计 ===== */}
      <SectionCard
          title={t("httpStatusTitle")}
          subtitle={t("pcHttpSub", { total: fmtNum(httpTotal) })}
        >
          <SegmentedBar segments={httpSegments} height={12} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {httpSegments.map((s) => (
              <button
                key={s.label}
                onClick={() => onNavigate({ status: httpFilterValue(s.label) })}
                className={`rounded-lg border px-2 py-2 text-left transition-colors hover:border-ink-25 ${
                  status === httpFilterValue(s.label) ? "border-brand bg-brand/5" : "border-line bg-card"
                }`}
                aria-label={`${s.label}: ${s.value}`}
              >
                <div className="font-mono text-lg font-semibold" style={{ color: s.color }}>{fmtNum(s.value)}</div>
                <div className="font-mono text-xs text-ink-40">
                  {s.label}
                  {httpTotal > 0 ? ` · ${Math.round((s.value / httpTotal) * 100)}%` : ""}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-3 border-t border-line-soft pt-2 font-sans text-xs text-ink-40">{t("pcHttpNote")}</p>
      </SectionCard>

      {/* ===== ④ 数据表格 ===== */}
      <SectionCard
        title={
          <span>
            {t("crawledPagesTitle")} <span className="font-mono text-xs text-ink-40">({fmtNum(stats.pages)})</span>
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

        {/* 异常快筛（一键定位失败 / 有异常 / 重定向页面） */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-sans text-xs text-ink-40">{t("qfLabel")}</span>
          {quickFilters.map((q) => (
            <button
              key={q.key}
              onClick={() => onNavigate(q.params)}
              className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                q.active ? "border-brand bg-brand/5 text-ink" : "border-line bg-card text-ink-60 hover:border-ink-25"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>

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

        {stats.pages === 0 ? (
          /* 独立空态：本次抓取没有可展示的页面记录（不与"筛选无匹配"混淆） */
          <EmptyBlock title={t("pcNoPagesTitle")} hint={t("pcNoPagesHint")} />
        ) : rows.length === 0 ? (
          <EmptyBlock title={t("noPagesMatch")} hint={t("clearFiltersHint")} />
        ) : (
          <DataTable minWidthRem={0} ariaLabel={t("crawledPagesTitle")}>
            <THead>
              <Th>
                <button onClick={() => toggleSort("url")} className="hover:text-ink">{t("thUrl")}{sort === "url" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
              </Th>
              <Th width="5rem">
                <button onClick={() => toggleSort("status")} className="hover:text-ink">{t("thStatus")}{sort === "status" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
              </Th>
              <Th width="9rem">{t("thHealth")}</Th>
              <Th align="right" width="8rem">
                <button onClick={() => toggleSort("issueCount")} className="hover:text-ink">{t("thIssues")}{sort === "issueCount" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
              </Th>
              <Th className="hidden lg:table-cell" width="8rem">{t("thPageType")}</Th>
              <Th align="right" className="hidden md:table-cell" width="6rem">
                <button onClick={() => toggleSort("wordCount")} className="hover:text-ink">{t("thWords")}{sort === "wordCount" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
              </Th>
              <Th align="right" className="hidden md:table-cell" width="6.5rem">
                <button onClick={() => toggleSort("responseTimeMs")} className="hover:text-ink">{t("thResponse")}{sort === "responseTimeMs" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
              </Th>
              <Th align="right" className="hidden sm:table-cell" width="5rem">
                <button onClick={() => toggleSort("depth")} className="hover:text-ink">{t("thDepth")}{sort === "depth" ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>
              </Th>
              <Th align="right" className="hidden sm:table-cell" width="6rem">{t("thRedirect")}</Th>
            </THead>
            <TBody>
              {rows.map((p) => (
                <PageRow
                  key={p.finalUrl}
                  p={p}
                  expanded={expanded === p.finalUrl}
                  onToggle={() => setExpanded(expanded === p.finalUrl ? null : p.finalUrl)}
                  statusLabel={statusLabel(p)}
                  findings={findingsByUrl.get(p.url) ?? findingsByUrl.get(p.finalUrl) ?? []}
                  onOpenIssue={onOpenIssue}
                  sevClass={sevClass}
                />
              ))}
            </TBody>
          </DataTable>
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
  sevClass,
}: {
  p: PageSnapshot;
  expanded: boolean;
  onToggle: () => void;
  statusLabel: string;
  findings: Array<{ ruleId: string; severity: string; message: unknown }>;
  onOpenIssue: (ruleId: string) => void;
  sevClass: (s: "error" | "warning" | "notice") => string;
}) {
  const t = useTranslations("dashboard.audit");
  const healthLabel = t(`health${p.health === "healthy" ? "Healthy" : p.health === "needs-attention" ? "NeedsAttention" : p.health === "critical" ? "Critical" : p.health === "redirect" ? "Redirect" : "Blocked"}`);
  const statusClass = p.status === 0 || p.status >= 500 ? "text-neg" : p.status >= 400 ? "text-warn" : p.status >= 300 ? "text-violet-600" : "text-pos";
  /** 问题严重度拆解：用文字计数替代无信息的圆点 */
  const sevBreakdown = (
    <>
      {p.errorCount > 0 && <span className={sevClass("error")} title={t("sevError")}>E{p.errorCount}</span>}
      {p.warningCount > 0 && <span className={sevClass("warning")} title={t("sevWarning")}>W{p.warningCount}</span>}
      {p.noticeCount > 0 && <span className={sevClass("notice")} title={t("sevNotice")}>N{p.noticeCount}</span>}
    </>
  );
  return (
    <>
      <TR className={expanded ? "bg-line-soft/40" : ""} onClick={onToggle}>
        <TD>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink-40">{expanded ? "▾" : "▸"}</span>
            <span className="block max-w-[260px] truncate font-mono text-xs text-ink" title={p.url}>
              {p.url.replace(/^https?:\/\//, "")}
            </span>
          </div>
        </TD>
        <TD>
          <span className={`font-mono text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
        </TD>
        <TD>
          <HealthBadge health={p.health as PageHealth} label={healthLabel} />
        </TD>
        <TD align="right" numeric>
          <span className="font-mono text-sm font-semibold text-ink">{p.issueCount}</span>
          <span className="ml-2 inline-flex items-center gap-1.5 font-mono text-xs">{sevBreakdown}</span>
        </TD>
        <TD className="hidden lg:table-cell">
          <span className="font-mono text-xs text-ink-60">{p.pageType ?? "—"}</span>
        </TD>
        <TD align="right" numeric className="hidden md:table-cell">
          <span className="text-ink-60">{p.wordCount !== null ? fmtNum(p.wordCount) : "—"}</span>
        </TD>
        <TD align="right" numeric className="hidden md:table-cell">
          <span className="text-ink-60">{p.responseTimeMs}ms</span>
        </TD>
        <TD align="right" numeric className="hidden sm:table-cell">
          <span className="text-ink-60">{p.depth}</span>
        </TD>
        <TD align="right" className="hidden sm:table-cell">
          {p.isRedirect ? (
            <span className="badge-warn whitespace-nowrap">{p.hops} hop{p.hops > 1 ? "s" : ""}</span>
          ) : (
            <span className="text-ink-40">—</span>
          )}
        </TD>
      </TR>
      {expanded && (
        <tr className="border-b border-line-soft bg-paper">
          <td colSpan={9} className="px-4 py-4">
            {/* ===== LEVEL 1 — Page Header：先回答"这一页健康吗、有没有问题" ===== */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft pb-3">
              <span className="min-w-0 flex-1 break-all font-mono text-xs font-semibold text-ink">{p.url}</span>
              <span className={`font-mono text-sm font-semibold ${statusClass}`}>{statusLabel}</span>
              <HealthBadge health={p.health as PageHealth} label={healthLabel} />
              <span className="badge-info font-mono">{p.pageType ?? "—"}</span>
              <span className="font-mono text-sm font-semibold text-ink">
                {p.issueCount} {t("thIssues")}
                <span className="ml-2 inline-flex items-center gap-1.5 font-mono text-xs">{sevBreakdown}</span>
              </span>
              <span className="font-mono text-xs text-ink-40">{p.responseTimeMs}ms · D{p.depth}</span>
            </div>

            {/* ===== LEVEL 2 — Primary Summary：核心内容事实 ===== */}
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-xs uppercase tracking-wide text-ink-40">{t("pageSummarySection")}</div>
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
              <div className="mb-1.5 font-mono text-xs uppercase tracking-wide text-ink-40">{t("crawlLinksSection")}</div>
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
              <div className="mb-1.5 font-mono text-xs uppercase tracking-wide text-ink-40">{t("sdSemanticSection")}</div>
              <div className="grid grid-cols-1 gap-1.5 font-mono text-xs sm:grid-cols-2">
                <DetailRow label={t("structuredDataTitle")} value={p.structuredDataStatus ? t(`sdStatus.${p.structuredDataStatus}`) : "—"} />
                <DetailRow label={t("schemaTypes")} value={p.structuredDataTypes.length > 0 ? p.structuredDataTypes.slice(0, 4).join(", ") : "—"} breakAll />
                <DetailRow label={t("semanticHtmlLabel")} value={p.semanticMainCount !== null ? String(p.semanticMainCount) : "—"} />
              </div>
            </div>

            {/* ===== LEVEL 5 — Findings ===== */}
            {findings.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 font-mono text-xs uppercase tracking-wide text-ink-40">{t("pageFindings")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {findings.map((f, i) => (
                    <button
                      key={`${f.ruleId}-${i}`}
                      onClick={() => onOpenIssue(f.ruleId)}
                      className={`font-mono text-xs transition-colors hover:border-ink-25 ${
                        f.severity === "error" ? "badge-err" : f.severity === "warning" ? "badge-warn" : "badge-info"
                      }`}
                    >
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
