"use client";

// ===== Site Audit Issue Center + Issue Detail =====
// 数据：DashboardSnapshot（rules + findings）。
// 视图：
//  - 列表：搜索 / Severity / Category 筛选，Priority / Affected Pages / Findings /
//    Score Impact 排序，Group by（Issue / Severity / Category），Clear filters。
//  - Issue Detail：Severity / Category / Priority + Affected Pages / Ratio / Findings /
//    Metric + Why this matters / What SeeO found / How to fix + Affected URLs。
//  - Pattern 检测：同一规则多条 finding 消息归一化后完全一致 → 站点级/模板级问题。

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { DashboardSnapshot, RuleSnapshot, RuleSeverity, RuleCategory } from "@/lib/seo/audit-dashboard";
import { SectionCard, SeverityBadge, EmptyBlock, Hint, fmtNum, SEVERITY_COLORS } from "./ui";

type LocalizedText = string | { en: string; zh: string };

function textOf(v: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : v[locale];
}

/** 优先级：severity 主导，warning 覆盖面 ≥50% 提升为 high */
function priorityOf(r: RuleSnapshot): "high" | "medium" | "low" {
  if (r.severity === "error") return "high";
  if (r.severity === "warning") return r.affectedRatio >= 0.5 ? "high" : "medium";
  return "low";
}

function prioritySortKey(r: RuleSnapshot): number {
  const rank = r.severity === "error" ? 3 : r.severity === "warning" ? 2 : 1;
  return rank * 10000 + Math.round(r.affectedRatio * 1000) * 10 + Math.round(r.scoreImpact * 10);
}

interface IssuesCenterProps {
  snapshot: DashboardSnapshot;
  issue: string | null;
  filters: { severity?: string; category?: string; search?: string; sort?: string; group?: string; rule?: string; pageType?: string };
  /** P1-4：上次审计对比产生的新增问题规则 ID（无对比数据时不传 → 不显示 New badge） */
  newRuleIds?: Set<string>;
  onNavigate: (params: Record<string, string>) => void;
}

const SEVERITIES: RuleSeverity[] = ["error", "warning", "notice"];
const CATEGORIES: RuleCategory[] = ["crawlability", "indexability", "onpage", "content", "links", "structured-data", "performance", "sitemap", "ai-search"];
const SORTS = ["priority", "affected", "findings", "impact"] as const;
const GROUPS = ["issue", "severity", "category"] as const;

export default function IssuesCenter({ snapshot, issue, filters, newRuleIds, onNavigate }: IssuesCenterProps) {
  const t = useTranslations("dashboard.audit");
  const locale = useLocale() as "en" | "zh";
  // P1-7：Rule / PageType / Sort / Group 收进 Advanced filters（URL 状态不受影响；
  // 已有 advanced 筛选活动时默认展开，保证用户始终看得见当前生效条件）
  const [advancedOpen, setAdvancedOpen] = useState(!!(filters.rule || filters.pageType));

  const failedRules = useMemo(
    () => snapshot.rules.filter((r) => r.status === "fail"),
    [snapshot]
  );

  const pageTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of snapshot.pages) if (p.pageType) set.add(p.pageType);
    return [...set].sort();
  }, [snapshot]);

  const selected = issue ? snapshot.rules.find((r) => r.ruleId === issue) ?? null : null;

  // ---- Issue Detail ----
  if (selected) {
    return (
      <IssueDetail
        snapshot={snapshot}
        rule={selected}
        isNew={newRuleIds?.has(selected.ruleId) ?? false}
        onBack={() => onNavigate({ view: "issues" })}
        onOpenPages={() => onNavigate({ view: "pages", issue: selected.ruleId })}
      />
    );
  }

  // ---- Filtered / sorted / grouped list ----
  const q = (filters.search ?? "").toLowerCase();

  const filtered = failedRules.filter((r) => {
    if (filters.severity && r.severity !== filters.severity) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.rule && r.ruleId !== filters.rule) return false;
    if (filters.pageType) {
      const urls = new Set(snapshot.findings.filter((f) => f.ruleId === r.ruleId).map((f) => f.url));
      const hasType = [...urls].some((u) => {
        const p = snapshot.pages.find((x) => x.url === u || x.finalUrl === u);
        return p?.pageType === filters.pageType;
      });
      if (!hasType) return false;
    }
    if (q && !textOf(r.name, locale).toLowerCase().includes(q) && !r.ruleId.toLowerCase().includes(q)) return false;
    return true;
  });

  // 实时结果计数：filtered findings / affected pages / rules（与筛选同步）
  const filteredRuleIds = new Set(filtered.map((r) => r.ruleId));
  const filteredFindings = snapshot.findings.filter((f) => filteredRuleIds.has(f.ruleId));
  const filteredPages = new Set(filteredFindings.map((f) => f.url)).size;
  const resultSummary = {
    findings: filteredFindings.length,
    pages: filteredPages,
    rules: filteredRuleIds.size,
  };

  const sorted = [...filtered].sort((a, b) => {
    switch (filters.sort ?? "priority") {
      case "affected":
        return b.affectedPages - a.affectedPages;
      case "findings":
        return b.findings - a.findings;
      case "impact":
        return b.scoreImpact - a.scoreImpact;
      default:
        return prioritySortKey(b) - prioritySortKey(a);
    }
  });

  const groupBy = (filters.group ?? "issue") as (typeof GROUPS)[number];

  const ruleRow = (r: RuleSnapshot) => (
    <button
      key={r.ruleId}
      onClick={() => onNavigate({ view: "issues", issue: r.ruleId })}
      className="flex w-full items-center gap-3 border-b border-line-soft px-3 py-2 text-left transition-colors hover:bg-line-soft/40"
    >
      <SeverityBadge severity={r.severity} label="" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-sans text-sm font-medium text-ink">
          {textOf(r.name, locale)}
          {/* P1-4：仅状态提示，不改变 severity / score / priority */}
          {newRuleIds?.has(r.ruleId) ? <span className="badge-warn ml-2 align-middle font-mono text-[0.625rem]">{t("newIssueBadge")}</span> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[0.6875rem] text-ink-40">
          <span>{r.category}</span>
          <span>·</span>
          <span>{r.pageLevel === "site" ? t("levelSite") : t("levelPage")}</span>
          {r.pattern === "site-wide" ? (
            <span className="badge-warn">{t("patternSiteWide")}</span>
          ) : r.pattern === "repeated" ? (
            <span className="badge-info">{t("patternRepeated")}</span>
          ) : null}
          {r.scoreImpact > 0 ? (
            <>
              <span>·</span>
              <span className="text-neg">-{r.scoreImpact.toFixed(1)} {t("pointsUnit")}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="hidden w-24 text-right sm:block">
        <div className="font-mono text-sm font-semibold text-ink">{fmtNum(r.affectedPages)}</div>
        <div className="font-mono text-[0.625rem] text-ink-40">{Math.round(r.affectedRatio * 100)}%</div>
      </div>
      <div className="hidden w-16 text-right md:block">
        <div className="font-mono text-sm font-semibold text-ink">{fmtNum(r.findings)}</div>
        <div className="font-mono text-[0.625rem] text-ink-40">{t("findingsTitle")}</div>
      </div>
      <span className="w-14 text-right font-mono text-xs text-ink-40">→</span>
    </button>
  );

  const groups: Array<{ key: string; label: string; rules: RuleSnapshot[]; findings: number; pages: number }> = [];
  const groupCounts = (rs: RuleSnapshot[]) => {
    const ids = new Set(rs.map((r) => r.ruleId));
    const fs = snapshot.findings.filter((f) => ids.has(f.ruleId));
    return { findings: fs.length, pages: new Set(fs.map((f) => f.url)).size };
  };
  if (groupBy === "severity") {
    for (const s of SEVERITIES) {
      const g = sorted.filter((r) => r.severity === s);
      if (g.length) groups.push({ key: s, label: t(`sev${s === "error" ? "Error" : s === "warning" ? "Warning" : "Notice"}`), rules: g, ...groupCounts(g) });
    }
  } else if (groupBy === "category") {
    for (const c of CATEGORIES) {
      const g = sorted.filter((r) => r.category === c);
      if (g.length) groups.push({ key: c, label: c, rules: g, ...groupCounts(g) });
    }
  } else {
    groups.push({ key: "all", label: t("allIssues"), rules: sorted, ...groupCounts(sorted) });
  }

  const hasFilters = !!(filters.severity || filters.category || filters.search || filters.sort || filters.group || filters.rule || filters.pageType);

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("issuesTitle")}
        subtitle={
          <span className="flex items-center gap-2">
            <span>
              {fmtNum(resultSummary.findings)} {t("findingsTitle")}
            </span>
            <span>·</span>
            <span>
              {fmtNum(resultSummary.pages)} {t("affectedPagesLabel")}
            </span>
            <span>·</span>
            <span>
              {fmtNum(resultSummary.rules)} {t("affectedRulesLabel")}
            </span>
            <Hint text={t("hintFindings")} />
          </span>
        }
        bodyClassName="mt-0"
      >
        {/* Filters — P1-7 分层：Primary（Severity/Category/Search）常驻，Rule/PageType/Sort/Group 收进 Advanced */}
        <div className="mb-4 border-b border-line-soft pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
              {t("filterSeverity")}
              <select
                value={filters.severity ?? ""}
                onChange={(e) => onNavigate({ view: "issues", severity: e.target.value })}
                className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
              >
                <option value="">{t("filterAll")}</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{t(`sev${s === "error" ? "Error" : s === "warning" ? "Warning" : "Notice"}`)}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
              {t("filterCategory")}
              <select
                value={filters.category ?? ""}
                onChange={(e) => onNavigate({ view: "issues", category: e.target.value })}
                className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
              >
                <option value="">{t("filterAll")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <input
              value={filters.search ?? ""}
              onChange={(e) => onNavigate({ view: "issues", search: e.target.value })}
              placeholder={t("searchIssues")}
              aria-label={t("searchIssues")}
              className="w-44 rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
            <button
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className={`rounded-md border px-2 py-1.5 font-mono text-xs transition-colors ${advancedOpen || filters.rule || filters.pageType ? "border-brand/40 text-brand" : "border-line text-ink-60"} hover:border-ink-25 hover:text-ink`}
            >
              {advancedOpen ? "▾" : "▸"} {t("advancedFilters")}
              {filters.rule || filters.pageType ? <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 text-[0.625rem]">1+</span> : null}
            </button>
            {hasFilters ? (
              <button onClick={() => onNavigate({ view: "issues", severity: "", category: "", search: "", sort: "", group: "", rule: "", pageType: "", issue: "" })} className="rounded-md border border-line px-2 py-1.5 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink">
                ✕ {t("clearFilters")}
              </button>
            ) : null}
          </div>
          {advancedOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-line-soft/30 px-3 py-2">
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("filterRule")}
                <select
                  value={filters.rule ?? ""}
                  onChange={(e) => onNavigate({ view: "issues", rule: e.target.value })}
                  className="max-w-44 rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  <option value="">{t("filterAll")}</option>
                  {failedRules.map((r) => (
                    <option key={r.ruleId} value={r.ruleId}>{r.ruleId}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("filterPageType")}
                <select
                  value={filters.pageType ?? ""}
                  onChange={(e) => onNavigate({ view: "issues", pageType: e.target.value })}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  <option value="">{t("filterAll")}</option>
                  {pageTypes.map((pt) => (
                    <option key={pt} value={pt}>{pt}</option>
                  ))}
                </select>
              </label>
              <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("sortBy")}
                <select
                  value={filters.sort ?? "priority"}
                  onChange={(e) => onNavigate({ view: "issues", sort: e.target.value })}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  {SORTS.map((s) => (
                    <option key={s} value={s}>{t(`sort.${s}`)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("groupBy")}
                <select
                  value={groupBy}
                  onChange={(e) => onNavigate({ view: "issues", group: e.target.value })}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>{t(`group.${g}`)}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {sorted.length === 0 ? (
          <EmptyBlock title={t("issuesEmptyTitle")} hint={t("issuesEmptyRun")} />
        ) : (
          <div className="overflow-x-auto">
            {/* 表头 */}
            <div className="flex items-center gap-3 border-b border-line px-3 pb-2 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">
              <span className="flex-1">{t("thCheck")}</span>
              <span className="hidden w-24 text-right sm:block">{t("thAffected")}</span>
              <span className="hidden w-16 text-right md:block">{t("thFindings")}</span>
              <span className="w-14 text-right">{t("thDetail")}</span>
            </div>
            {groups.map((g) => (
              <div key={g.key}>
                {groups.length > 1 && (
                  <div className="flex items-center gap-2 bg-line-soft/40 px-3 py-1.5 font-mono text-xs font-semibold text-ink-60">
                    {g.label}
                    <span className="text-ink-40">({g.rules.length})</span>
                    <span className="ml-auto font-mono text-[0.6875rem] font-normal text-ink-40">
                      {fmtNum(g.findings)} {t("findingsTitle")} · {fmtNum(g.pages)} {t("affectedPagesLabel")}
                    </span>
                  </div>
                )}
                {g.rules.map(ruleRow)}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ===== Issue Detail =====

function IssueDetail({
  snapshot,
  rule,
  isNew,
  onBack,
  onOpenPages,
}: {
  snapshot: DashboardSnapshot;
  rule: RuleSnapshot;
  isNew: boolean;
  onBack: () => void;
  onOpenPages: () => void;
}) {
  const t = useTranslations("dashboard.audit");
  const locale = useLocale() as "en" | "zh";
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  const affected = useMemo(() => snapshot.findings.filter((f) => f.ruleId === rule.ruleId), [snapshot, rule]);
  const priority = priorityOf(rule);

  // Pattern：由后端多信号判定（site-wide / repeated / null=scattered）
  const isSiteWide = rule.pattern === "site-wide";
  const isRepeated = rule.pattern === "repeated";
  const patternLabel = isSiteWide ? t("patternSiteWide") : isRepeated ? t("patternRepeated") : t("patternScattered");
  const patternHint = isSiteWide
    ? t("patternSiteWideHint", { n: rule.findings })
    : isRepeated
      ? t("patternRepeatedHint", { n: rule.findings })
      : t("patternScatteredHint");

  // URL → 页面快照（Affected URLs 展示 status/type/depth/response）
  const pageByUrl = useMemo(() => {
    const m = new Map<string, (typeof snapshot.pages)[number]>();
    for (const p of snapshot.pages) {
      m.set(p.url, p);
      m.set(p.finalUrl, p);
    }
    return m;
  }, [snapshot]);

  const sampleMetrics = rule.sampleMetrics;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline">
        ← {t("backToIssues")}
      </button>

      {/* Issue Header */}
      <SectionCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            {textOf(rule.name, locale)}
            <SeverityBadge severity={rule.severity} label={t(`sev${rule.severity === "error" ? "Error" : rule.severity === "warning" ? "Warning" : "Notice"}`)} />
            {isNew ? <span className="badge-warn font-mono text-[0.625rem]">{t("newIssueBadge")}</span> : null}
            <span className="badge-info">{rule.category}</span>
            <span className="badge-info">{t(`priority.${priority}`)}</span>
          </span>
        }
        subtitle={
          <span className="font-mono text-xs text-ink-40">
            {rule.ruleId} · {rule.pageLevel === "site" ? t("levelSite") : t("levelPage")}
            {rule.scoreImpact > 0 ? ` · ${t("scoreImpactLabel")}: -${rule.scoreImpact.toFixed(1)}` : ""}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("thAffected")}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-ink">{fmtNum(rule.affectedPages)}</div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{Math.round(rule.affectedRatio * 100)}% · {t("ofIndexable", { n: snapshot.indexablePages })}</div>
          </div>
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("thFindings")}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-ink">{fmtNum(rule.findings)}</div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("findingsTitle")}</div>
          </div>
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("scoreImpactLabel")}</div>
            <div className={`mt-1 font-mono text-2xl font-semibold ${rule.scoreImpact > 0 ? "text-neg" : "text-ink"}`}>
              {rule.scoreImpact > 0 ? `-${rule.scoreImpact.toFixed(1)}` : "0"}
            </div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("pointsUnit")}</div>
          </div>
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("patternTitle")}</div>
            <div className={`mt-1 font-mono text-2xl font-semibold ${isSiteWide ? "text-warn" : "text-ink"}`}>{patternLabel}</div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{patternHint}</div>
          </div>
        </div>
      </SectionCard>

      {/* Why / What / How */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title={t("whyMatters")} subtitle={t("whyMattersSub")}>
          <p className="font-sans text-sm leading-relaxed text-ink-60">{textOf(rule.description, locale)}</p>
        </SectionCard>
        <SectionCard title={t("whatFound")} subtitle={t("whatFoundSub")}>
          <p className="font-sans text-sm leading-relaxed text-ink-60">
            {affected.length > 0 ? textOf(affected[0].message, locale) : "—"}
          </p>
          {sampleMetrics && Object.keys(sampleMetrics).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(sampleMetrics).map(([k, v]) => (
                <span key={k} className="badge-info font-mono">
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          ) : null}
        </SectionCard>
        <SectionCard title={t("howToFix")} subtitle={t("howToFixSub")}>
          <p className="font-sans text-sm leading-relaxed text-ink-60">{textOf(rule.recommendation, locale)}</p>
        </SectionCard>
      </div>

      {/* Affected URLs */}
      <SectionCard
        title={t("affectedUrlsTitle", { n: affected.length })}
        subtitle={t("affectedUrlsSub")}
        right={
          <button onClick={onOpenPages} className="font-mono text-xs text-brand hover:underline">
            {t("viewCrawledPages")} →
          </button>
        }
        bodyClassName="mt-0"
      >
        {affected.length === 0 ? (
          <EmptyBlock title={t("issuesEmptyTitle")} />
        ) : (
          <div className="max-h-96 overflow-auto">
            {affected.map((f, i) => {
              const pg = pageByUrl.get(f.url);
              return (
                <div key={`${f.url}-${i}`}>
                  <button
                    onClick={() => setExpandedUrl(expandedUrl === f.url ? null : f.url)}
                    className="flex w-full items-center gap-3 border-b border-line-soft px-3 py-2 text-left transition-colors hover:bg-line-soft/40"
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[f.severity] }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.url.replace(/^https?:\/\//, "")}</span>
                    <span className="hidden shrink-0 font-mono text-[0.6875rem] text-ink-40 lg:block">
                      {pg ? `${pg.status} · ${pg.pageType ?? "—"} · D${pg.depth} · ${pg.responseTimeMs}ms` : ""}
                    </span>
                    <span className="hidden max-w-[35%] truncate font-sans text-xs text-ink-40 xl:block">{textOf(f.message, locale)}</span>
                    <span className="font-mono text-xs text-ink-40">{expandedUrl === f.url ? "▾" : "▸"}</span>
                  </button>
                  {expandedUrl === f.url && (
                    <div className="border-b border-line-soft bg-[#FBFAF4] px-4 py-3">
                      <div className="space-y-1 font-mono text-xs">
                        <div className="break-all text-ink">{f.url}</div>
                        <div className="font-sans text-sm text-ink-60">{textOf(f.message, locale)}</div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {pg ? (
                            <>
                              <span className="badge-info">{t("thStatus")}: {pg.status}</span>
                              <span className="badge-info">{t("thPageType")}: {pg.pageType ?? "—"}</span>
                              <span className="badge-info">{t("thDepth")}: {pg.depth}</span>
                              <span className="badge-info">{t("thResponse")}: {pg.responseTimeMs}ms</span>
                              {pg.title ? <span className="badge-info truncate max-w-56" title={pg.title}>{t("titleLabel")}: {pg.title}</span> : null}
                            </>
                          ) : null}
                          {f.metrics && Object.keys(f.metrics).length > 0
                            ? Object.entries(f.metrics).map(([k, v]) => (
                                <span key={k} className="badge-info">{k}: {String(v)}</span>
                              ))
                            : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
