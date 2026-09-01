"use client";

// ===== Site Audit Overview（Semrush 级信息密度） =====
// 信息体系：Health 主视觉 → Severity(Errors/Warnings/Notices) → Page Health 分布
// → Coverage / Severity 分布 → Top Issues（优先级）→ Category → Issue 分布
// → HTTP → Content / Linking / Crawler → Structured Data / AI Search → Trend / 对比
//
// 全部数据来自同一份 DashboardSnapshot（单一数据源，无重复请求）。

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from "recharts";
import type { DashboardSnapshot, PageHealth, RuleSeverity, LocalizedText } from "@/lib/seo/audit-dashboard";
import {
  HealthGauge,
  StatTile,
  SeverityBadge,
  SegmentedBar,
  LegendRow,
  SectionCard,
  PctBar,
  EmptyBlock,
  Hint,
  fmtNum,
  SEVERITY_COLORS,
  HEALTH_COLORS,
  type Segment,
} from "./ui";
import {
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TICK_STYLE,
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
} from "@/components/dashboard/chart-theme";

export interface HistoryItem {
  id: number;
  score: number | null;
  issuesCount: number;
  errors: number;
  warnings: number;
  notices: number;
  checkedAt: string;
  engineVersion: string | null;
  ruleSetVersion: string | null;
}

export interface ComparisonData {
  current: { score: number; issues: number; checkedAt: string };
  previous: { score: number; issues: number; checkedAt: string } | null;
  scoreChange: number;
  issuesChange: number;
  newIssues: Array<{ checkId: string; checkName: string; message: string; url: string; severity: string }>;
  resolvedIssues: Array<{ checkId: string; checkName: string; message: string; url: string; severity: string }>;
  unchangedIssues: Array<{ checkId: string; checkName: string; message: string; url: string; severity: string }>;
}

interface OverviewProps {
  snapshot: DashboardSnapshot;
  history: HistoryItem[];
  comparison: ComparisonData | null;
  onNavigate: (params: Record<string, string>) => void;
}

function formatDate(iso: string, locale: "en" | "zh"): string {
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function textOf(v: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : v[locale];
}

/** 优先级排序键：severity 主导，其次 affected ratio / score impact */
function priorityOf(r: DashboardSnapshot["rules"][number]): number {
  const rank = r.severity === "error" ? 3 : r.severity === "warning" ? 2 : 1;
  return rank * 10000 + Math.round(r.affectedRatio * 1000) * 10 + Math.round(r.scoreImpact * 10);
}

export default function AuditOverview({ snapshot, history, comparison, onNavigate }: OverviewProps) {
  const t = useTranslations("dashboard.audit");
  const locale = useLocale() as "en" | "zh";
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  const totalFindings = snapshot.findings.length;
  const totalAffectedPages = new Set(snapshot.findings.map((f) => f.url)).size;
  const rulesFailed = snapshot.coverage.failed;

  const severityFindings = useMemo(() => {
    const bySeverity: Record<RuleSeverity, number> = { error: 0, warning: 0, notice: 0 };
    for (const f of snapshot.findings) bySeverity[f.severity]++;
    return bySeverity;
  }, [snapshot]);

  // 受影响页面按规则（用于分布图）
  const topRules = useMemo(() => {
    return [...snapshot.rules].filter((r) => r.status === "fail").sort((a, b) => priorityOf(b) - priorityOf(a));
  }, [snapshot]);

  // Page Health 分布
  const healthCounts = useMemo(() => {
    const counts: Record<PageHealth, number> = { healthy: 0, "needs-attention": 0, critical: 0, redirect: 0, blocked: 0 };
    for (const p of snapshot.pages) counts[p.health]++;
    return counts;
  }, [snapshot]);

  const healthSegments: Segment[] = [
    { label: t("healthHealthy"), value: healthCounts.healthy, color: HEALTH_COLORS.healthy },
    { label: t("healthNeedsAttention"), value: healthCounts["needs-attention"], color: HEALTH_COLORS["needs-attention"] },
    { label: t("healthCritical"), value: healthCounts.critical, color: HEALTH_COLORS.critical },
    { label: t("healthRedirect"), value: healthCounts.redirect, color: HEALTH_COLORS.redirect },
    { label: t("healthBlocked"), value: healthCounts.blocked, color: HEALTH_COLORS.blocked },
  ];

  const severitySegments: Segment[] = [
    { label: t("sevError"), value: severityFindings.error, color: SEVERITY_COLORS.error },
    { label: t("sevWarning"), value: severityFindings.warning, color: SEVERITY_COLORS.warning },
    { label: t("sevNotice"), value: severityFindings.notice, color: SEVERITY_COLORS.notice },
  ];

  const httpSegments: Segment[] = [
    { label: "2xx", value: snapshot.crawler.httpStatus["2xx"], color: "#22C55E" },
    { label: "3xx", value: snapshot.crawler.httpStatus["3xx"], color: "#8B5CF6" },
    { label: "4xx", value: snapshot.crawler.httpStatus["4xx"], color: "#F59E0B" },
    { label: "5xx", value: snapshot.crawler.httpStatus["5xx"], color: "#EF4444" },
    { label: t("httpOther"), value: snapshot.crawler.httpStatus.other, color: "#9CA3AF" },
  ];

  const gradeLabel =
    snapshot.grade === "excellent"
      ? t("gradeExcellent")
      : snapshot.grade === "good"
        ? t("gradeGood")
        : snapshot.grade === "needs-attention"
          ? t("gradeNeedsAttention")
          : t("gradeCritical");

  const scoreDelta = comparison?.previous ? comparison.scoreChange : null;

  // Trend chart data（带引擎版本标记）
  const trendData = useMemo(() => {
    return [...history]
      .filter((h) => h.score !== null)
      .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
      .map((h) => ({ day: formatDate(h.checkedAt, locale), score: h.score as number, engine: h.engineVersion ?? "v1" }));
  }, [history, locale]);

  const coveragePct = Math.round(snapshot.coverage.ratio * 100);

  return (
    <div className="space-y-4">
      {/* ===== 第一行：Health 主视觉 + Errors/Warnings/Notices ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-4"
          title={
            <span className="flex items-center gap-1.5">
              {t("healthTitle")}
              <Hint text={t("hintHealthScore")} />
            </span>
          }
          subtitle={t("healthSub", { crawled: fmtNum(snapshot.indexablePages) })}
        >
          <div className="flex flex-col items-center">
            <HealthGauge score={snapshot.score} gradeLabel={gradeLabel} />
            <div className="mt-3 flex items-center gap-2 font-mono text-xs">
              {scoreDelta === null ? (
                <span className="badge-info">{t("noPreviousAudit")}</span>
              ) : scoreDelta > 0 ? (
                <span className="badge-pos">{t("scoreUp", { n: scoreDelta })}</span>
              ) : scoreDelta < 0 ? (
                <span className="badge-err">{t("scoreDown", { n: Math.abs(scoreDelta) })}</span>
              ) : (
                <span className="badge-info">{t("scoreFlat")}</span>
              )}
              <span className="text-ink-40">{t("comparedWithPrev")}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-sans text-xs text-ink-40">
              <span>{t("gradeExcellent")} 90-100</span>·<span>{t("gradeGood")} 80-89</span>·
              <span>{t("gradeNeedsAttention")} 60-79</span>·<span>{t("gradeCritical")} 0-59</span>
            </div>
            <button
              onClick={() => setShowScoreBreakdown((v) => !v)}
              className="mt-3 inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
            >
              {showScoreBreakdown ? "▾" : "▸"} {t("viewScoreBreakdown")}
            </button>
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-8">
          <StatTile
            label={t("sevError")}
            value={fmtNum(severityFindings.error)}
            sub={t("errorsContext", { pages: fmtNum(new Set(snapshot.findings.filter((f) => f.severity === "error").map((f) => f.url)).size) })}
            hint={t("hintErrors")}
            color={SEVERITY_COLORS.error}
            onClick={() => onNavigate({ view: "issues", severity: "error" })}
          />
          <StatTile
            label={t("sevWarning")}
            value={fmtNum(severityFindings.warning)}
            sub={t("warningsContext", { pages: fmtNum(new Set(snapshot.findings.filter((f) => f.severity === "warning").map((f) => f.url)).size) })}
            hint={t("hintWarnings")}
            color={SEVERITY_COLORS.warning}
            onClick={() => onNavigate({ view: "issues", severity: "warning" })}
          />
          <StatTile
            label={t("sevNotice")}
            value={fmtNum(severityFindings.notice)}
            sub={t("noticesContext", { pages: fmtNum(new Set(snapshot.findings.filter((f) => f.severity === "notice").map((f) => f.url)).size) })}
            hint={t("hintNotices")}
            color={SEVERITY_COLORS.notice}
            onClick={() => onNavigate({ view: "issues", severity: "notice" })}
          />
          <div className="sm:col-span-3">
            <StatTile
              label={t("findingsTitle")}
              value={fmtNum(totalFindings)}
              sub={
                <span>
                  {t("affectedPagesLabel")}: <b className="text-ink">{fmtNum(totalAffectedPages)}</b> · {t("affectedRulesLabel")}: <b className="text-ink">{rulesFailed}</b>
                </span>
              }
              hint={t("hintFindings")}
              onClick={() => onNavigate({ view: "issues" })}
            />
          </div>
        </div>
      </div>

      {/* ===== Score Breakdown（可展开） ===== */}
      {showScoreBreakdown && (
        <SectionCard
          title={t("scoreBreakdownTitle")}
          subtitle={t("scoreBreakdownSub")}
        >
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
            {snapshot.scoreBreakdown.map((s) => (
              <div key={s.ruleId} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 font-mono text-xs">
                  <SeverityBadge severity={s.severity} label="" />
                  <span className="truncate text-ink-60">{s.ruleId}</span>
                </span>
                <span className="flex items-center gap-3 font-mono text-xs text-ink-40">
                  <span>{s.affectedPages} p · {Math.round(s.ratio * 100)}%</span>
                  <span className="w-16 text-right font-semibold text-ink">-{s.impact.toFixed(1)}</span>
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ===== 第二行：Top Issues（优先级） + Coverage ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-8"
          title={
            <span className="flex items-center gap-1.5">
              {t("topIssuesTitle")}
              <Hint text={t("hintTopIssues")} />
            </span>
          }
          subtitle={t("topIssuesSub")}
          right={
            <button onClick={() => onNavigate({ view: "issues" })} className="font-mono text-xs text-brand hover:underline">
              {t("viewAllIssues")} →
            </button>
          }
          bodyClassName="mt-3"
        >
          {topRules.length === 0 ? (
            <EmptyBlock title={t("issuesEmptyTitle")} hint={t("issuesEmptyRun")} />
          ) : (
            <div className="divide-y divide-line-soft">
              {topRules.slice(0, 5).map((r) => (
                <button
                  key={r.ruleId}
                  onClick={() => onNavigate({ view: "issues", issue: r.ruleId })}
                  className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-line-soft/40"
                >
                  <SeverityBadge severity={r.severity} label="" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-sans text-sm font-medium text-ink">{textOf(r.name, locale)}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[0.6875rem] text-ink-40">
                      <span>{r.category}</span>
                      <span>·</span>
                      <span>
                        {fmtNum(r.affectedPages)} {t("pagesUnit", { n: r.affectedPages })}
                      </span>
                      <span>·</span>
                      <span>{Math.round(r.affectedRatio * 100)}%</span>
                      {r.scoreImpact > 0 ? (
                        <>
                          <span>·</span>
                          <span className="text-neg">-{r.scoreImpact.toFixed(1)} {t("pointsUnit")}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="font-mono text-sm font-semibold text-ink">{fmtNum(r.findings)}</div>
                    <div className="font-mono text-[0.625rem] text-ink-40">{t("findingsTitle")}</div>
                  </div>
                  <span className="font-mono text-xs text-ink-40">→</span>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          className="lg:col-span-4"
          title={
            <span className="flex items-center gap-1.5">
              {t("coverageTitle")}
              <Hint text={t("hintCoverage")} />
            </span>
          }
          subtitle={t("coverageSub", { passed: fmtNum(snapshot.coverage.passed), failed: fmtNum(snapshot.coverage.failed), total: fmtNum(snapshot.coverage.total) })}
        >
          <div className="flex items-center gap-5">
            <div className="relative h-32 w-32 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[{ name: "pass", value: snapshot.coverage.passed }, { name: "fail", value: snapshot.coverage.failed }]} dataKey="value" innerRadius={42} outerRadius={60} startAngle={90} endAngle={-270} strokeWidth={0} isAnimationActive={false}>
                    <Cell fill="#22C55E" />
                    <Cell fill="#EF4444" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-mono text-2xl font-semibold text-ink">{coveragePct}%</div>
                <div className="font-mono text-[0.625rem] text-ink-40">{t("rulesPassedShort")}</div>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="flex items-center gap-1.5 text-ink-60">
                  <span className="h-2 w-2 rounded-sm bg-[#22C55E]" aria-hidden /> {t("rulesPassed")}
                </span>
                <span className="font-semibold text-ink">{fmtNum(snapshot.coverage.passed)}</span>
              </div>
              <button
                onClick={() => onNavigate({ view: "issues" })}
                className="flex w-full items-center justify-between rounded-md px-1 py-0.5 font-mono text-xs transition-colors hover:bg-line-soft/50"
              >
                <span className="flex items-center gap-1.5 text-ink-60">
                  <span className="h-2 w-2 rounded-sm bg-[#EF4444]" aria-hidden /> {t("rulesFailed")}
                </span>
                <span className="font-semibold text-ink">{fmtNum(snapshot.coverage.failed)}</span>
              </button>
              <div className="pt-1">
                <PctBar pct={coveragePct} color="#22C55E" />
              </div>
            </div>
          </div>
          <p className="mt-3 border-t border-line-soft pt-2 font-sans text-[0.6875rem] text-ink-40">
            {t("coverageVsHealthNote")}
          </p>
        </SectionCard>
      </div>

      {/* ===== 第三行：Page Health 分布 + Severity 分布（Donut） ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-7"
          title={
            <span className="flex items-center gap-1.5">
              {t("pageHealthTitle")}
              <Hint text={t("hintPageHealth")} />
            </span>
          }
          subtitle={t("pageHealthSub", { crawled: fmtNum(snapshot.pages.length) })}
          right={
            <button onClick={() => onNavigate({ view: "pages" })} className="font-mono text-xs text-brand hover:underline">
              {t("viewAllPages")} →
            </button>
          }
        >
          <SegmentedBar segments={healthSegments} height={14} />
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {healthSegments.map((s) => (
              <button
                key={s.label}
                onClick={() => onNavigate({ view: "pages", health: s.label === t("healthHealthy") ? "healthy" : s.label === t("healthNeedsAttention") ? "needs-attention" : s.label === t("healthCritical") ? "critical" : s.label === t("healthRedirect") ? "redirect" : "blocked" })}
                className="rounded-lg border border-line bg-card px-3 py-2 text-left transition-colors hover:border-ink-25"
              >
                <div className="font-mono text-lg font-semibold" style={{ color: s.color }}>{fmtNum(s.value)}</div>
                <div className="truncate font-mono text-[0.6875rem] text-ink-40">{s.label}</div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-5"
          title={
            <span className="flex items-center gap-1.5">
              {t("severityDistTitle")}
              <Hint text={t("hintSeverityDist")} />
            </span>
          }
          subtitle={t("severityDistSub")}
        >
          <div className="flex items-center gap-6">
            <div className="relative h-40 w-40 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={severitySegments} dataKey="value" nameKey="label" innerRadius={52} outerRadius={72} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                    {severitySegments.map((s) => (
                      <Cell key={s.label} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-mono text-2xl font-semibold text-ink">{fmtNum(totalFindings)}</div>
                <div className="font-mono text-[0.625rem] text-ink-40">{t("findingsTitle")}</div>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-ink-40">{t("affectedPagesLabel")}</span>
                <span className="font-semibold text-ink">{fmtNum(totalAffectedPages)}</span>
              </div>
              {severitySegments.map((s) => (
                <button
                  key={s.label}
                  onClick={() => onNavigate({ view: "issues", severity: s.label === t("sevError") ? "error" : s.label === t("sevWarning") ? "warning" : "notice" })}
                  className="flex w-full items-center justify-between rounded-md px-1 py-0.5 font-mono text-xs transition-colors hover:bg-line-soft/50"
                >
                  <span className="flex items-center gap-1.5 text-ink-60">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="text-ink">{fmtNum(s.value)}</span>
                </button>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ===== 第四行：Category Overview ===== */}
      <SectionCard
        title={
          <span className="flex items-center gap-1.5">
            {t("categoryTitle")}
            <Hint text={t("hintCategory")} />
          </span>
        }
        subtitle={t("categorySub")}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {snapshot.categories.map((c) => (
            <button
              key={c.category}
              onClick={() => onNavigate({ view: "issues", category: c.category })}
              className="rounded-lg border border-line bg-card p-3 text-left transition-colors hover:border-ink-25"
              aria-label={`${c.category} ${c.notEnoughData ? t("notEnoughData") : c.score}`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate font-sans text-xs font-semibold text-ink">{c.category}</span>
                {c.notEnoughData ? (
                  <span className="font-mono text-xs text-ink-40">{t("notEnoughData")}</span>
                ) : (
                  <span className="font-mono text-lg font-semibold text-ink">{c.score}</span>
                )}
              </div>
              {!c.notEnoughData && <PctBar pct={c.score} color={c.score >= 90 ? "#22C55E" : c.score >= 60 ? "#F59E0B" : "#EF4444"} />}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.6875rem] text-ink-40">
                <span>{c.rules} {t("rulesShort")}</span>
                <span>·</span>
                <span>{c.findings} {t("findingsTitle")}</span>
                <span>·</span>
                <span>{c.affectedPages} {t("pagesShort")}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[0.6875rem] text-ink-40">
                {c.majorIssue ? (
                  <>
                    <span className={`h-1.5 w-1.5 rounded-full ${c.majorIssue.severity === "error" ? "bg-neg" : c.majorIssue.severity === "warning" ? "bg-warn" : "bg-ink-25"}`} aria-hidden />
                    <span className="truncate text-ink-60">{textOf(c.majorIssue.name, locale)}</span>
                  </>
                ) : (
                  <span className="text-pos">{t("categoryHealthy")}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* ===== 第五行：Issue 分布（横向条形） + HTTP Status ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-7"
          title={t("issueDistTitle")}
          subtitle={t("issueDistSub")}
          right={
            <button onClick={() => onNavigate({ view: "issues" })} className="font-mono text-xs text-brand hover:underline">
              {t("viewAllIssues")} →
            </button>
          }
        >
          {topRules.length === 0 ? (
            <EmptyBlock title={t("issuesEmptyTitle")} />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topRules.slice(0, 8).map((r) => ({ name: r.ruleId, pages: r.affectedPages, color: SEVERITY_COLORS[r.severity] }))} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 24 }}>
                  <CartesianGrid {...COMMON_GRID_PROPS} />
                  <XAxis type="number" {...COMMON_YAXIS_PROPS} />
                  <YAxis type="category" dataKey="name" width={130} tick={CHART_TICK_STYLE} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                  <Bar dataKey="pages" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {topRules.slice(0, 8).map((r) => (
                      <Cell key={r.ruleId} fill={SEVERITY_COLORS[r.severity]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          className="lg:col-span-5"
          title={
            <span className="flex items-center gap-1.5">
              {t("httpStatusTitle")}
              <Hint text={t("hintHttpStatus")} />
            </span>
          }
          subtitle={t("httpStatusSub", { total: fmtNum(snapshot.crawler.pagesCrawled) })}
        >
          <SegmentedBar segments={httpSegments} height={12} />
          <LegendRow segments={httpSegments} total={snapshot.crawler.pagesCrawled} />
          <div className="mt-4 space-y-1.5 border-t border-line-soft pt-3">
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="text-ink-60">{t("crawlerStatsTitle")}</span>
              <span />
            </div>
            <CrawlerStatRow label={t("avgResponse")} value={`${snapshot.crawler.avgResponseMs}ms`} />
            <CrawlerStatRow label={t("fastestPage")} value={snapshot.crawler.fastestMs !== null ? `${snapshot.crawler.fastestMs}ms` : "—"} />
            <CrawlerStatRow label={t("slowestPage")} value={snapshot.crawler.slowestMs !== null ? `${snapshot.crawler.slowestMs}ms` : "—"} />
            <CrawlerStatRow label={t("redirectsCrawled")} value={fmtNum(snapshot.crawler.redirects)} />
          </div>
        </SectionCard>
      </div>

      {/* ===== 第六行：Content / Internal Linking / Structured Data / AI Search ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-4"
          title={
            <span className="flex items-center gap-1.5">
              {t("contentTitle")}
              <Hint text={t("hintContent")} />
            </span>
          }
          right={
            <button onClick={() => onNavigate({ view: "issues", category: "content" })} className="font-mono text-xs text-brand hover:underline">
              {t("viewCategoryIssues")} →
            </button>
          }
        >
          <div className="space-y-2">
            <CrawlerStatRow label={t("avgWordCount")} value={fmtNum(snapshot.content.avgWordCount)} />
            <button onClick={() => onNavigate({ view: "issues", category: "content" })} className="flex w-full items-center justify-between rounded-md px-1 py-0.5 font-mono text-xs transition-colors hover:bg-line-soft/50">
              <span className="text-ink-60">{t("lowContentPages")}</span>
              <span className="text-ink">{fmtNum(snapshot.content.lowContent)}</span>
            </button>
            <CrawlerStatRow label={t("veryLowContentPages")} value={fmtNum(snapshot.content.veryLowContent)} />
            <CrawlerStatRow label={t("avgTextHtmlRatio")} value={`${Math.round(snapshot.content.avgTextHtmlRatio * 1000) / 10}%`} />
            <div className="pt-1">
              <div className="mb-1 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">{t("contentByType")}</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(snapshot.content.byType).map(([type, n]) => (
                  <span key={type} className="badge-info">{type} {n}</span>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-4"
          title={
            <span className="flex items-center gap-1.5">
              {t("linkingTitle")}
              <Hint text={t("hintLinking")} />
            </span>
          }
          right={
            <button onClick={() => onNavigate({ view: "linking" })} className="font-mono text-xs text-brand hover:underline">
              {t("viewDetails")} →
            </button>
          }
        >
          <div className="space-y-2">
            <CrawlerStatRow label={t("avgInternalLinks")} value={snapshot.linking.avgInternalLinks.toString()} />
            <button onClick={() => onNavigate({ view: "pages" })} className="flex w-full items-center justify-between rounded-md px-1 py-0.5 font-mono text-xs transition-colors hover:bg-line-soft/50">
              <span className="text-ink-60">{t("zeroInternalLinks")}</span>
              <span className="text-ink">{fmtNum(snapshot.linking.zeroInternalLinks)}</span>
            </button>
            <CrawlerStatRow label={t("deepPages")} value={fmtNum(snapshot.linking.deepPages)} />
            <CrawlerStatRow label={t("possibleOrphans")} value={fmtNum(snapshot.linking.orphans)} />
            <CrawlerStatRow label={t("linksToRedirects")} value={fmtNum(snapshot.linking.linksToRedirects)} />
            <div className="pt-1">
              <div className="mb-1 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">{t("depthDist")}</div>
              <div className="grid grid-cols-5 gap-1">
                {Object.entries(snapshot.linking.depthDistribution).map(([d, n]) => (
                  <div key={d} className="rounded-md border border-line bg-card px-1 py-1 text-center">
                    <div className="font-mono text-sm font-semibold text-ink">{fmtNum(n)}</div>
                    <div className="font-mono text-[0.625rem] text-ink-40">D{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 lg:col-span-4">
          <SectionCard
            title={
              <span className="flex items-center gap-1.5">
                {t("structuredDataTitle")}
                <Hint text={t("hintStructuredData")} />
              </span>
            }
            right={
              <button onClick={() => onNavigate({ view: "structured" })} className="font-mono text-xs text-brand hover:underline">
                {t("viewDetails")} →
              </button>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {(["valid", "potential-issue", "invalid", "malformed", "none"] as const).map((s) => {
                const n = snapshot.structuredData.statusCounts[s] ?? 0;
                return (
                  <button
                    key={s}
                    onClick={() => onNavigate({ view: "structured", sdStatus: s })}
                    className="flex items-center justify-between rounded-lg border border-line bg-card px-2 py-2 font-mono text-xs transition-colors hover:border-ink-25"
                  >
                    <span className="truncate text-ink-60">{t(`sdStatus.${s}` as never, { defaultValue: s } as never)}</span>
                    <span className="font-semibold text-ink">{fmtNum(n)}</span>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title={
              <span className="flex items-center gap-1.5">
                {t("aiSearchTitle")}
                <Hint text={t("hintAiSearch")} />
              </span>
            }
            right={
              <button onClick={() => onNavigate({ view: "ai" })} className="font-mono text-xs text-brand hover:underline">
                {t("viewDetails")} →
              </button>
            }
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-ink-60">{t("llmsTxt")}</span>
                <span className={snapshot.aiSearch.llmsTxt?.status === "found" ? "text-pos" : "text-warn"}>
                  {t(`llmsStatus.${snapshot.aiSearch.llmsTxt?.status ?? "missing"}` as never, { defaultValue: snapshot.aiSearch.llmsTxt?.status ?? "missing" } as never)}
                </span>
              </div>
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-ink-60">{t("aiCrawlersBlocked")}</span>
                <span className="text-ink">{Object.values(snapshot.aiSearch.crawlers).filter((v) => v === "disallowed").length} / {Object.keys(snapshot.aiSearch.crawlers).length}</span>
              </div>
              <button onClick={() => onNavigate({ view: "ai" })} className="flex w-full items-center justify-between rounded-md px-1 py-0.5 font-mono text-xs transition-colors hover:bg-line-soft/50">
                <span className="text-ink-60">{t("semanticHtmlAffected")}</span>
                <span className="text-ink">{fmtNum(snapshot.aiSearch.semanticHtmlAffected)}</span>
              </button>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ===== 第七行：Trend + Previous Audit ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-7"
          title={
            <span className="flex items-center gap-1.5">
              {t("healthTrendTitle")}
              <Hint text={t("hintTrend")} />
            </span>
          }
          subtitle={t("healthTrendSub")}
          right={
            <button onClick={() => onNavigate({ view: "history" })} className="font-mono text-xs text-brand hover:underline">
              {t("viewHistory")} →
            </button>
          }
        >
          {trendData.length === 0 ? (
            <EmptyBlock title={t("noData")} hint={t("firstAuditHint")} />
          ) : trendData.length === 1 ? (
            <div className="flex h-40 flex-col items-center justify-center">
              <span className="badge-info">{t("firstAuditBadge")}</span>
              <p className="mt-2 font-mono text-xs text-ink-40">{t("firstAuditHint")}</p>
            </div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                  <CartesianGrid {...COMMON_GRID_PROPS} />
                  <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
                  <YAxis domain={[0, 100]} {...COMMON_YAXIS_PROPS} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} formatter={(v) => [`${v} ${t("pointsUnit")}`, t("healthScoreLabel")]} />
                  <Line type="monotone" dataKey="score" stroke="#2563EB" strokeWidth={2.5} dot={{ r: 3, fill: "#2563EB", strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          className="lg:col-span-5"
          title={t("prevAuditTitle")}
          subtitle={t("prevAuditSub")}
        >
          {!comparison || !comparison.previous ? (
            <EmptyBlock title={t("firstAuditBadge")} hint={t("firstAuditHint")} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-line bg-card p-3 text-center">
                  <div className="font-mono text-[0.6875rem] text-ink-40">{t("prevAuditLabel")}</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-ink-60">{comparison.previous.score}</div>
                  <div className="font-mono text-[0.625rem] text-ink-40">{formatDate(comparison.previous.checkedAt, locale)}</div>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <div className="font-mono text-xs text-ink-40">{t("changeLabel")}</div>
                  <div className={`mt-0.5 font-mono text-xl font-semibold ${comparison.scoreChange > 0 ? "text-pos" : comparison.scoreChange < 0 ? "text-neg" : "text-ink-40"}`}>
                    {comparison.scoreChange > 0 ? "↑" : comparison.scoreChange < 0 ? "↓" : "→"} {Math.abs(comparison.scoreChange)}
                  </div>
                </div>
                <div className="rounded-lg border-2 border-brand bg-brand/5 p-3 text-center">
                  <div className="font-mono text-[0.6875rem] text-brand">{t("currentAuditLabel")}</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-ink">{comparison.current.score}</div>
                  <div className="font-mono text-[0.625rem] text-ink-40">{formatDate(comparison.current.checkedAt, locale)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <div className="flex items-center justify-between rounded-md border border-line bg-card px-2 py-1.5">
                  <span className="text-ink-40">{t("newIssuesCount", { n: comparison.newIssues.length })}</span>
                  <span className="font-semibold text-neg">{comparison.newIssues.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-line bg-card px-2 py-1.5">
                  <span className="text-ink-40">{t("resolvedCount", { n: comparison.resolvedIssues.length })}</span>
                  <span className="font-semibold text-pos">{comparison.resolvedIssues.length}</span>
                </div>
              </div>
              <p className="border-t border-line-soft pt-2 font-sans text-[0.6875rem] text-ink-40">
                {t("prevAuditNote")}
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function CrawlerStatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-1 py-0.5 font-mono text-xs">
      <span className="text-ink-60">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
