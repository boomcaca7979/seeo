"use client";

// ===== Site Audit Overview（单次审计专属概览 · 可视化优先） =====
//
// 四层结构（与 /app 工作台、问题标签共用同一套可视化规则）：
//   ① 审计范围条：域名 / 审计时间 / 深度 / 引擎与规则集版本
//   ② 关键指标卡：健康分 · 抓取页数 · 实际检查数量 · 发现的问题数量
//   ③ 数据可视化：健康分与检出数历史趋势 · 问题优先级分布 · 处理与验证状态分布
//   ④ 优先处理列表：优先级 / 问题 / 影响范围 / 状态 / 操作（深链到问题详情）
//   ⑤ 更多分析入口：本页不再铺开的内链 / 结构化数据 / AI 搜索 / 抓取页面 / 历史，
//      逐一给出真实数字并直达对应标签（数据不删除、只是归位）
//
// 任何图表在数据不足时显示真实空状态，绝不绘制虚构曲线或填充假数字。

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
} from "recharts";
import type { DashboardSnapshot, LocalizedText, RuleSnapshot, RuleSeverity } from "@/lib/seo/audit-dashboard";
import { explainTechnicalPriority } from "@/lib/seo/issue-priority";
import {
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TICK_STYLE,
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
  CHART_COLORS,
} from "@/components/dashboard/chart-theme";
import MetricCard from "@/components/viz/MetricCard";
import ChartFrame from "@/components/viz/ChartFrame";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { TONE_COLOR, unifiedStatusTone } from "@/components/viz/tokens";
import { SeverityBadge, fmtNum, EmptyBlock } from "./ui";

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
  /** 审计模式（quick/full）——历史表与口径提示用；旧载荷可能缺失 */
  depth?: "quick" | "full" | null;
  /** 该次审计实际抓取的页面数；旧载荷可能缺失 */
  pagesCrawled?: number | null;
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
  /** 审计域名：用于读取该域名的处理/验证状态（检测结果之外的真实记录） */
  domain: string;
  onNavigate: (params: Record<string, string>) => void;
}

interface ResolutionRow {
  rule_id: string;
  status: "open" | "in_progress" | "fixed_claimed" | "verified_resolved" | "dismissed";
  verify_status: "pass" | "fail" | "inconclusive" | null;
}

function formatDate(iso: string, locale: "en" | "zh"): string {
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null, locale: "en" | "zh"): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { hour12: false });
  } catch {
    return iso;
  }
}

function textOf(v: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : v[locale];
}

/** 优先级排序键：severity 主导，其次 affected ratio / score impact（仅用于排序展示，不做评分） */
function priorityOf(r: RuleSnapshot): number {
  const rank = r.severity === "error" ? 3 : r.severity === "warning" ? 2 : 1;
  return rank * 10000 + Math.round(r.affectedRatio * 1000) * 10 + Math.round(r.scoreImpact * 10);
}

const SEV_LABEL_KEY: Record<RuleSeverity, "sevError" | "sevWarning" | "sevNotice"> = {
  error: "sevError",
  warning: "sevWarning",
  notice: "sevNotice",
};

export default function AuditOverview({ snapshot, history, comparison, domain, onNavigate }: OverviewProps) {
  const t = useTranslations("dashboard.audit");
  const ta = useTranslations("dashboard.actions");
  const tv = useTranslations("dashboard.viz");
  const locale = useLocale() as "en" | "zh";
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  // ---- 处理与验证状态（真实处理记录；读不到就如实显示不可用） ----
  const [resolutions, setResolutions] = useState<Map<string, ResolutionRow>>(new Map());
  // 无域名时直接为 ready（初始值即终值，避免在 effect 体内同步 setState 触发级联渲染）
  const [resState, setResState] = useState<"loading" | "ready" | "error">(domain ? "loading" : "ready");
  useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/audit/issues/status?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setResState("error");
          return;
        }
        const rows = Array.isArray(json?.data?.resolutions) ? json.data.resolutions : [];
        const map = new Map<string, ResolutionRow>();
        for (const r of rows) {
          if (r && typeof r.rule_id === "string") map.set(r.rule_id as string, r as ResolutionRow);
        }
        setResolutions(map);
        setResState("ready");
      } catch {
        if (!cancelled) setResState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const failedRules = useMemo(
    () => snapshot.rules.filter((r) => r.status === "fail"),
    [snapshot]
  );

  /** 失败规则 + 真实优先级档位（唯一来源 issue-priority.ts） */
  const rankedRules = useMemo(
    () =>
      [...failedRules]
        .sort((a, b) => priorityOf(b) - priorityOf(a))
        .map((rule) => ({
          rule,
          level: explainTechnicalPriority({
            severity: rule.severity,
            affectedRatio: rule.affectedRatio,
            scoreImpact: rule.scoreImpact,
            pattern: rule.pattern,
            pageLevel: rule.pageLevel,
          }).priority.level,
        })),
    [failedRules]
  );

  const severityFindings = useMemo(() => {
    const bySeverity: Record<RuleSeverity, number> = { error: 0, warning: 0, notice: 0 };
    for (const f of snapshot.findings) bySeverity[f.severity]++;
    return bySeverity;
  }, [snapshot]);

  const totalAffectedPages = new Set(snapshot.findings.map((f) => f.url)).size;

  const priorityData = useMemo(() => {
    const counts = { P0: 0, P1: 0, P2: 0 };
    for (const r of rankedRules) counts[r.level]++;
    return (["P0", "P1", "P2"] as const).map((level) => ({
      level,
      value: counts[level],
      color: level === "P0" ? TONE_COLOR.neg : level === "P1" ? TONE_COLOR.warn : TONE_COLOR.info,
    }));
  }, [rankedRules]);

  const statusData = useMemo(() => {
    const counts = { open: 0, in_progress: 0, fixed_claimed: 0, verified_resolved: 0, dismissed: 0 };
    for (const r of failedRules) {
      const s = resolutions.get(r.ruleId)?.status ?? "open";
      counts[s]++;
    }
    return (["open", "in_progress", "fixed_claimed", "verified_resolved", "dismissed"] as const).map((s) => ({
      key: s,
      label: ta(`status.${s}` as "status.open"),
      value: counts[s],
      tone: unifiedStatusTone(s),
      color: TONE_COLOR[unifiedStatusTone(s)],
    }));
  }, [failedRules, resolutions, ta]);

  const verifyData = useMemo(() => {
    const counts = { pending: 0, fail: 0, pass: 0, inconclusive: 0 };
    for (const r of failedRules) {
      const s = resolutions.get(r.ruleId)?.verify_status ?? null;
      if (s === "pass") counts.pass++;
      else if (s === "fail") counts.fail++;
      else if (s === "inconclusive") counts.inconclusive++;
      else counts.pending++;
    }
    return [
      { key: "pending", label: tv("verifyPending"), value: counts.pending, color: TONE_COLOR.warn },
      { key: "fail", label: tv("verifyFail"), value: counts.fail, color: TONE_COLOR.neg },
      { key: "pass", label: tv("verifyPass"), value: counts.pass, color: TONE_COLOR.pos },
      { key: "inconclusive", label: tv("verifyInconclusive"), value: counts.inconclusive, color: TONE_COLOR.neutral },
    ];
  }, [failedRules, resolutions, tv]);

  const scoreDelta = comparison?.previous ? comparison.scoreChange : null;

  const trendData = useMemo(() => {
    return [...history]
      .filter((h) => h.score !== null)
      .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
      .map((h) => ({
        day: formatDate(h.checkedAt, locale),
        score: h.score as number,
        issues: h.issuesCount,
      }));
  }, [history, locale]);

  const coveragePct = Math.round(snapshot.coverage.ratio * 100);
  const hasTrend = trendData.length >= 2;

  return (
    <div className="space-y-4">
      {/* ===== ① 审计范围条 ===== */}
      <div className="card-a flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 font-mono text-xs text-ink-40">
        <span className="font-sans text-sm font-semibold text-ink">{domain || "—"}</span>
        <span>
          {t("lastAuditColon")}
          {formatDateTime(snapshot.generatedAt, locale)}
        </span>
        <span className="badge-info">{snapshot.depth === "full" ? t("depthFull") : t("depthQuick")}</span>
        {snapshot.partial ? <span className="badge-warn">{t("partialAudit")}</span> : null}
        <span className="badge-info">
          engine {snapshot.engineVersion} · rules {snapshot.ruleSetVersion}
        </span>
        <span className="ml-auto">
          {t("coverageTitle")}: {fmtNum(snapshot.coverage.passed)} / {fmtNum(snapshot.coverage.total)} ({coveragePct}%)
        </span>
      </div>

      {/* ===== ② 关键指标卡 ===== */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t("healthTitle")}
          value={snapshot.score}
          unit="/ 100"
          tone={snapshot.score >= 90 ? "pos" : snapshot.score >= 80 ? "pos" : snapshot.score >= 60 ? "warn" : "neg"}
          caption={
            scoreDelta === null
              ? t("noPreviousAudit")
              : scoreDelta > 0
                ? t("scoreUp", { n: scoreDelta })
                : scoreDelta < 0
                  ? t("scoreDown", { n: Math.abs(scoreDelta) })
                  : t("scoreFlat")
          }
          hint={t("hintHealthScore")}
          status={{
            label:
              snapshot.grade === "excellent"
                ? t("gradeExcellent")
                : snapshot.grade === "good"
                  ? t("gradeGood")
                  : snapshot.grade === "needs-attention"
                    ? t("gradeNeedsAttention")
                    : t("gradeCritical"),
            tone:
              snapshot.grade === "excellent" || snapshot.grade === "good"
                ? "pos"
                : snapshot.grade === "needs-attention"
                  ? "warn"
                  : "neg",
          }}
        />
        <MetricCard
          label={t("pagesCrawled")}
          value={fmtNum(snapshot.pagesCrawled)}
          caption={t("ovParseablePages", { n: fmtNum(snapshot.indexablePages) })}
          hint={t("hintPageHealth")}
          onClick={() => onNavigate({ view: "pages" })}
        />
        <MetricCard
          label={t("ovChecksExecuted")}
          value={fmtNum(snapshot.coverage.total)}
          caption={t("coverageSub", {
            passed: fmtNum(snapshot.coverage.passed),
            failed: fmtNum(snapshot.coverage.failed),
            total: fmtNum(snapshot.coverage.total),
          })}
          hint={t("ovChecksExecutedHint")}
        />
        <MetricCard
          label={t("findingsTitle")}
          value={fmtNum(snapshot.findings.length)}
          caption={`${t("affectedPagesLabel")}: ${fmtNum(totalAffectedPages)} · ${t("affectedRulesLabel")}: ${fmtNum(snapshot.coverage.failed)}`}
          hint={t("hintFindings")}
          onClick={() => onNavigate({ view: "issues" })}
        />
      </div>

      {/* Score breakdown（真实逐规则分数影响，可展开） */}
      {showScoreBreakdown && (
        <section className="card-a p-5">
          <h3 className="font-sans text-[0.9375rem] font-semibold text-ink">{t("scoreBreakdownTitle")}</h3>
          <p className="mt-0.5 font-sans text-xs text-ink-40">{t("scoreBreakdownSub")}</p>
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
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
        </section>
      )}

      {/* ===== ③ 数据可视化 ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 健康分与检出数历史趋势 */}
        <ChartFrame
          className="lg:col-span-7"
          title={t("healthTrendTitle")}
          subtitle={t("ovTrendSub")}
          right={
            <button onClick={() => setShowScoreBreakdown((v) => !v)} className="font-mono text-xs text-brand hover:underline">
              {showScoreBreakdown ? "▾" : "▸"} {t("viewScoreBreakdown")}
            </button>
          }
          isEmpty={!hasTrend}
          emptyTitle={t("noData")}
          emptyHint={trendData.length === 1 ? t("firstAuditHint") : t("ovTrendNeedTwo")}
          legend={[
            { label: t("healthScoreLabel"), tone: "accent" },
            { label: t("ovTrendSeriesIssues"), tone: "warn" },
          ]}
          height={hasTrend ? 220 : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
              <CartesianGrid {...COMMON_GRID_PROPS} />
              <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
              <YAxis yAxisId="score" domain={[0, 100]} {...COMMON_YAXIS_PROPS} />
              <YAxis yAxisId="issues" orientation="right" {...COMMON_YAXIS_PROPS} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                formatter={(v, name) => [
                  `${v}`,
                  name === "score" ? t("healthScoreLabel") : t("ovTrendSeriesIssues"),
                ]}
              />
              <Line
                yAxisId="score"
                type="monotone"
                dataKey="score"
                stroke={CHART_COLORS.accent}
                strokeWidth={2.5}
                dot={{ r: 3, fill: CHART_COLORS.accent, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="issues"
                type="monotone"
                dataKey="issues"
                stroke={CHART_COLORS.warn}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 3, fill: CHART_COLORS.warn, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>

        {/* 上次审计对比 */}
        <section className="card-a p-5 lg:col-span-5">
          <h3 className="font-sans text-[0.9375rem] font-semibold text-ink">{t("prevAuditTitle")}</h3>
          <p className="mt-0.5 font-sans text-xs text-ink-40">{t("prevAuditSub")}</p>
          {!comparison || !comparison.previous ? (
            <div className="mt-4">
              <EmptyBlock title={t("firstAuditBadge")} hint={t("firstAuditHint")} />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-line bg-card p-3 text-center">
                  <div className="font-mono text-xs text-ink-40">{t("prevAuditLabel")}</div>
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
                  <div className="font-mono text-xs text-brand">{t("currentAuditLabel")}</div>
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
              <p className="border-t border-line-soft pt-2 font-sans text-xs text-ink-40">
                {t("prevAuditNote")}
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 问题优先级分布 */}
        <ChartFrame
          title={t("ovPriorityDistTitle")}
          subtitle={t("ovPriorityDistSub")}
          legend={priorityData.map((p) => ({ label: p.level, tone: p.level === "P0" ? "neg" : p.level === "P1" ? "warn" : "info", value: p.value }))}
          isEmpty={rankedRules.length === 0}
          emptyTitle={t("ovNoOpenIssues")}
          emptyHint={t("ovNoOpenIssuesHint")}
          chartHeight={rankedRules.length === 0 ? undefined : 200}
          chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={priorityData} margin={{ top: 8, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid {...COMMON_GRID_PROPS} />
              <XAxis dataKey="level" {...COMMON_XAXIS_PROPS} />
              <YAxis allowDecimals={false} {...COMMON_YAXIS_PROPS} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                formatter={(v) => [`${v}`, t("affectedRulesLabel")]}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Bar dataKey="value" name={t("affectedRulesLabel")} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {priorityData.map((p) => (
                  <Cell key={p.level} fill={p.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          }
        >
          {/* 点击柱子对应的筛选入口（保持真实钻取能力） */}
          <div className="mt-3 flex flex-wrap gap-2">
            {(["error", "warning", "notice"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onNavigate({ view: "issues", severity: s })}
                className="flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25"
              >
                <SeverityBadge severity={s} label="" />
                {t(SEV_LABEL_KEY[s])}
                <span className="font-semibold text-ink">{fmtNum(severityFindings[s])}</span>
              </button>
            ))}
          </div>
        </ChartFrame>

        {/* 处理与验证状态分布 */}
        <ChartFrame
          title={t("ovStatusDistTitle")}
          subtitle={t("ovStatusDistSub")}
          legend={statusData.map((s) => ({ label: s.label, tone: s.tone, value: s.value }))}
          isEmpty={resState !== "ready"}
          emptyTitle={resState === "loading" ? t("crawling") : t("issuesResLoadFailed")}
          emptyHint={resState === "loading" ? undefined : t("ovStatusEmptyHint")}
          chartHeight={resState === "ready" ? 200 : undefined}
          chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusData} margin={{ top: 8, right: 8, bottom: 28, left: -20 }}>
              <CartesianGrid {...COMMON_GRID_PROPS} />
              <XAxis
                dataKey="label"
                interval={0}
                angle={-16}
                textAnchor="end"
                height={48}
                {...COMMON_XAXIS_PROPS}
                tick={{ ...CHART_TICK_STYLE, fontSize: 10 }}
              />
              <YAxis allowDecimals={false} {...COMMON_YAXIS_PROPS} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                formatter={(v) => [`${v}`, t("affectedRulesLabel")]}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Bar dataKey="value" name={t("affectedRulesLabel")} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {statusData.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          }
        >
          {/* 验证状态：把"未检测 ≠ 已解决"的口径讲清楚，并把待验证的规则指出来 */}
          <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
            <div className="flex flex-wrap gap-2">
              {verifyData.map((v) => (
                <StatusBadge
                  key={v.key}
                  label={`${v.label} ${v.value}`}
                  tone={v.key === "pass" ? "pos" : v.key === "fail" ? "neg" : v.key === "inconclusive" ? "neutral" : "warn"}
                />
              ))}
            </div>
            <p className="font-sans text-xs text-ink-40">{t("issuesStatusHint")}</p>
          </div>
        </ChartFrame>
      </div>

      {/* ===== ④ 优先处理列表 ===== */}
      <section className="card-a p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-sans text-[0.9375rem] font-semibold text-ink">{t("ovNeedsAttentionTitle")}</h3>
            <p className="mt-0.5 font-sans text-xs text-ink-40">{t("ovNeedsAttentionSub")}</p>
          </div>
          <button
            onClick={() => onNavigate({ view: "issues" })}
            className="font-mono text-xs text-brand hover:underline"
          >
            {t("viewAllIssues")} →
          </button>
        </header>

        <div className="mt-4">
          {rankedRules.length === 0 ? (
            <EmptyBlock title={t("ovNoOpenIssues")} hint={t("ovNoOpenIssuesHint")} />
          ) : (
            <>
              {/* 桌面端：紧凑表格 */}
              <div className="hidden md:block">
                <DataTable minWidthRem={46} ariaLabel={t("ovNeedsAttentionTitle")}>
                  <THead>
                    <Th width="7rem">{tv("thPriority")}</Th>
                    <Th>{tv("thIssue")}</Th>
                    <Th align="right" width="7rem">{tv("thScope")}</Th>
                    <Th width="10rem">{tv("thStatus")}</Th>
                    <Th align="right" width="5rem">{tv("thAction")}</Th>
                  </THead>
                  <TBody>
                    {rankedRules.slice(0, 8).map(({ rule, level }) => {
                      const res = resolutions.get(rule.ruleId)?.status ?? "open";
                      return (
                        <TR key={rule.ruleId} onClick={() => onNavigate({ view: "issues", issue: rule.ruleId })}>
                          <TD>
                            <span className="flex items-center gap-2">
                              <span className="badge-err font-mono">{level}</span>
                              <SeverityBadge severity={rule.severity} label="" />
                            </span>
                          </TD>
                          <TD>
                            <div className="font-sans text-sm font-medium text-ink">{textOf(rule.name, locale)}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-40">
                              <span>{rule.category}</span>
                              <span>·</span>
                              <span>{rule.pageLevel === "site" ? t("levelSite") : t("levelPage")}</span>
                              {rule.pattern === "site-wide" ? <span className="badge-warn">{t("patternSiteWide")}</span> : null}
                              {rule.scoreImpact > 0 ? (
                                <>
                                  <span>·</span>
                                  <span className="text-neg">-{rule.scoreImpact.toFixed(1)} {t("pointsUnit")}</span>
                                </>
                              ) : null}
                            </div>
                          </TD>
                          <TD align="right" numeric>
                            <div className="text-sm font-semibold text-ink">{fmtNum(rule.affectedPages)}</div>
                            <div className="text-xs text-ink-40">{Math.round(rule.affectedRatio * 100)}%</div>
                          </TD>
                          <TD>
                            <StatusBadge label={ta(`status.${res}` as "status.open")} tone={unifiedStatusTone(res)} />
                          </TD>
                          <TD align="right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigate({ view: "issues", issue: rule.ruleId });
                              }}
                              className="font-mono text-xs font-semibold text-brand hover:underline"
                            >
                              {tv("openAction")} →
                            </button>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </DataTable>
              </div>

              {/* 移动端：紧凑列表 */}
              <div className="md:hidden">
                {rankedRules.slice(0, 8).map(({ rule, level }) => {
                  const res = resolutions.get(rule.ruleId)?.status ?? "open";
                  return (
                    <button
                      key={rule.ruleId}
                      onClick={() => onNavigate({ view: "issues", issue: rule.ruleId })}
                      className="flex w-full flex-col gap-1 border-b border-line-soft py-2 text-left"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="badge-err font-mono">{level}</span>
                        <SeverityBadge severity={rule.severity} label="" />
                        <StatusBadge label={ta(`status.${res}` as "status.open")} tone={unifiedStatusTone(res)} />
                      </span>
                      <span className="font-sans text-sm font-medium text-ink">{textOf(rule.name, locale)}</span>
                      <span className="font-mono text-xs text-ink-40">
                        {tv("thScope")}: {fmtNum(rule.affectedPages)} ({Math.round(rule.affectedRatio * 100)}%)
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ===== ⑤ 更多分析入口（数据归位到各自的专属标签，不删除） ===== */}
      <section className="card-a p-5">
        <h3 className="font-sans text-[0.9375rem] font-semibold text-ink">{t("categoryTitle")}</h3>
        <p className="mt-0.5 font-sans text-xs text-ink-40">{t("categorySub")}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {snapshot.categories.map((c) => (
            <button
              key={c.category}
              onClick={() => onNavigate({ view: "issues", category: c.category })}
              className="rounded-lg border border-line bg-card p-3 text-left transition-colors hover:border-ink-25"
              aria-label={`${c.category} ${c.notEnoughData ? t("notEnoughData") : c.score}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-sans text-xs font-semibold text-ink">{c.category}</span>
                {c.notEnoughData ? (
                  <span className="font-mono text-xs text-ink-40">{t("notEnoughData")}</span>
                ) : (
                  <span className="font-mono text-lg font-semibold text-ink">{c.score}</span>
                )}
              </div>
              {!c.notEnoughData && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${c.score}%`,
                      backgroundColor: c.score >= 90 ? TONE_COLOR.pos : c.score >= 60 ? TONE_COLOR.warn : TONE_COLOR.neg,
                    }}
                  />
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-ink-40">
                <span>{c.rules} {t("rulesShort")}</span>
                <span>·</span>
                <span>{c.findings} {t("findingsTitle")}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {c.majorIssue ? (
                  <>
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: TONE_COLOR[c.majorIssue.severity === "error" ? "neg" : c.majorIssue.severity === "warning" ? "warn" : "neutral"] }}
                      aria-hidden
                    />
                    <span className="truncate text-ink-60">{textOf(c.majorIssue.name, locale)}</span>
                  </>
                ) : (
                  <span className="text-pos">{t("categoryHealthy")}</span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-line-soft pt-4">
          {([
            { view: "pages", label: t("tabPages"), value: `${fmtNum(snapshot.pagesCrawled)} ${t("pagesShort")}` },
            { view: "linking", label: t("tabLinking"), value: `${snapshot.linking.avgInternalLinks} ${t("avgInternalLinks")}` },
            { view: "structured", label: t("tabStructured"), value: `${fmtNum(snapshot.structuredData.pagesWithSD)} ${t("pagesShort")}` },
            { view: "ai", label: t("tabAi"), value: snapshot.aiSearch.llmsTxt?.status ?? t("notEnoughData") },
            { view: "history", label: t("tabHistory"), value: `${fmtNum(history.length)}` },
          ] as const).map((l) => (
            <button
              key={l.view}
              onClick={() => onNavigate({ view: l.view })}
              className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25"
            >
              <span className="font-semibold text-ink">{l.label}</span>
              <span className="text-ink-40">{l.value}</span>
              <span className="text-ink-40">→</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
