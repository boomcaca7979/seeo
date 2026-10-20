"use client";

// ===== Site Audit History：概览指标 + 真实趋势 + 前后变化 + 审计记录表 =====
// 数据来源：/api/audit/latest 的 history（最近 10 次真实审计行）与 comparison（finding 级对比快照）。
// 诚实边界：
//   - 少于 2 次审计 → 趋势空状态，不画假趋势线；
//   - 引擎版本或审计深度混合 → 明确口径提示，不伪装同口径；
//   - "已不再检出"只来自 comparison 的 finding 级对比（checkId:url 键），绝不凭两个汇总数字宣称"已解决"；
//   - 验证状态语义不在本页重新解释，复用现有验证状态机文案。

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { SectionCard, EmptyBlock, fmtNum } from "./ui";
import MetricCard from "@/components/viz/MetricCard";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import type { HistoryItem, ComparisonData } from "./Overview";
import {
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
} from "@/components/dashboard/chart-theme";

type Metric = "score" | "findings" | "errors" | "warnings" | "notices";

const METRIC_COLORS: Record<Metric, string> = {
  // 健康分用已验收的墨绿（rank-theme 同色系）；其余按语义：发现=墨、错误=红、警告=琥珀、提示=灰
  score: "#0F766E",
  findings: "#111827",
  errors: "#B91C1C",
  warnings: "#B45309",
  notices: "#9CA3AF",
};

export default function HistorySection({
  history,
  comparison,
  viewingAuditId,
  onOpenAudit,
  onOpenIssue,
}: {
  history: HistoryItem[];
  comparison: ComparisonData | null;
  /** 当前正在查看的审计 id（用于高亮历史行；null = 最新） */
  viewingAuditId: number | null;
  onOpenAudit: (id: number) => void;
  onOpenIssue: (ruleId: string) => void;
}) {
  const t = useTranslations("dashboard.audit");
  const locale = useLocale() as "en" | "zh";
  const [metric, setMetric] = useState<Metric>("score");

  const rows = useMemo(() => {
    return [...history].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)).map((h) => ({
      ...h,
      day: formatDate(h.checkedAt, locale, false),
      findings: h.errors + h.warnings + h.notices,
    }));
  }, [history, locale]);

  const latest = rows.length > 0 ? rows[rows.length - 1] : null;
  const previous = comparison?.previous ?? null;

  const chartData = rows
    .filter((h) => (metric === "score" ? h.score !== null : true))
    .map((h) => ({
      day: h.day,
      value: metric === "score" ? (h.score as number) : h[metric],
      engine: h.engineVersion ?? "v1",
      checkedAt: h.checkedAt,
    }));

  // 口径提示：引擎版本变化 或 深度混合（quick 只查首页、full 覆盖多页，不可视为同口径）
  const engineChanges = useMemo(() => {
    const changes: Array<{ day: string; engine: string }> = [];
    let prev: string | null = null;
    for (const r of rows) {
      const v = r.engineVersion ?? "v1";
      if (prev !== null && prev !== v) changes.push({ day: r.day, engine: v });
      prev = v;
    }
    return changes;
  }, [rows]);
  const depthCounts = useMemo(() => {
    const quick = rows.filter((r) => (r.depth ?? "quick") === "quick").length;
    const full = rows.filter((r) => r.depth === "full").length;
    return { quick, full, mixed: quick > 0 && full > 0 };
  }, [rows]);
  const hasEngineChange = engineChanges.length > 0;

  // comparison 的 finding 级对比（checkId 聚合计数）
  const changeStats = useMemo(() => {
    if (!comparison || !comparison.previous) return null;
    const countByRule = (issues: ComparisonData["newIssues"]) => {
      const map = new Map<string, number>();
      for (const i of issues) map.set(i.checkId, (map.get(i.checkId) ?? 0) + 1);
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      newCount: comparison.newIssues.length,
      resolvedCount: comparison.resolvedIssues.length,
      unchangedCount: comparison.unchangedIssues.length,
      newRules: countByRule(comparison.newIssues),
      resolvedRules: countByRule(comparison.resolvedIssues),
    };
  }, [comparison]);

  const metricLabel: Record<Metric, string> = {
    score: t("healthScoreLabel"),
    findings: t("findingsTitle"),
    errors: t("sevError"),
    warnings: t("sevWarning"),
    notices: t("sevNotice"),
  };

  return (
    <div className="space-y-4">
      {/* ===== ① 历史概览指标卡（全部来自真实审计行与 comparison 快照） ===== */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t("hiCount")}
          value={fmtNum(history.length)}
          caption={latest ? t("hiCountCaption", { date: latest.day }) : t("hiNoData")}
          hint={t("hiCountHint")}
          hintStyle="plain"
        />
        <MetricCard
          label={t("hiLatestScore")}
          value={latest?.score !== null && latest?.score !== undefined ? fmtNum(latest.score) : "—"}
          caption={latest?.engineVersion ? `engine ${latest.engineVersion}${latest.ruleSetVersion ? ` · rules ${latest.ruleSetVersion}` : ""}` : t("hiScoreUnknown")}
          hint={t("hiLatestScoreHint")}
          hintStyle="plain"
        />
        <MetricCard
          label={t("hiCompare")}
          value={
            comparison?.previous && latest?.score !== null && latest?.score !== undefined
              ? `${comparison.scoreChange >= 0 ? "+" : ""}${comparison.scoreChange}`
              : "—"
          }
          caption={previous ? t("hiCompareCaption", { date: formatDate(previous.checkedAt, locale, false) }) : t("hiCompareNone")}
          hint={t("hiCompareHint")}
          hintStyle="plain"
          tone={previous && comparison ? (comparison.scoreChange > 0 ? "pos" : comparison.scoreChange < 0 ? "neg" : undefined) : undefined}
        />
        <MetricCard
          label={t("hiLatestFindings")}
          value={latest ? fmtNum(latest.findings) : "—"}
          caption={latest ? t("hiFindingsCaption", { e: latest.errors, w: latest.warnings, n: latest.notices }) : t("hiNoData")}
          hint={t("hiLatestFindingsHint")}
          hintStyle="plain"
          tone={latest && latest.findings > 0 ? "warn" : undefined}
        />
      </div>

      {/* ===== ② 趋势图（≥2 次才绘制；口径变化时明确提示） ===== */}
      <SectionCard
        title={t("healthTrendTitle")}
        subtitle={t("historySub", { n: history.length })}
        right={
          <div className="flex flex-wrap gap-1">
            {(Object.keys(metricLabel) as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                  metric === m ? "border-ink-25 bg-ink text-paper" : "border-line bg-card text-ink-60 hover:border-ink-25"
                }`}
              >
                {metricLabel[m]}
              </button>
            ))}
          </div>
        }
      >
        {hasEngineChange && (
          <div className="mb-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 font-mono text-xs text-warn">
            {t("engineChangeNote")}
          </div>
        )}
        {depthCounts.mixed && (
          <div className="mb-3 rounded-md border border-line bg-card px-3 py-2 font-mono text-xs text-ink-60">
            {t("hiScopeMixed", { quick: depthCounts.quick, full: depthCounts.full })}
          </div>
        )}
        {chartData.length < 2 ? (
          <EmptyBlock title={t("firstAuditBadge")} hint={t("firstAuditHint")} />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
                <CartesianGrid {...COMMON_GRID_PROPS} />
                <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
                <YAxis domain={metric === "score" ? [0, 100] : [0, "auto"]} allowDecimals={false} {...COMMON_YAXIS_PROPS} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                  formatter={(v) => [String(v), metricLabel[metric]]}
                  labelFormatter={(label) => String(label)}
                />
                <Line type="monotone" dataKey="value" stroke={METRIC_COLORS[metric]} strokeWidth={2.5} dot={{ r: 4, fill: METRIC_COLORS[metric], strokeWidth: 0 }} activeDot={{ r: 6 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {hasEngineChange && (
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-xs text-ink-40">
            {engineChanges.map((c, i) => (
              <span key={i} className="badge-info">
                {c.day}: {t("engineUpdatedTo", { engine: c.engine })}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ===== ③ 前后变化（finding 级对比；不可比较时如实说明） ===== */}
      <SectionCard title={t("hiChangeTitle")} subtitle={t("hiChangeSub")}>
        {!changeStats ? (
          <EmptyBlock title={t("hiChangeUnavailable")} hint={t("hiChangeUnavailableHint")} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <ChangeStat label={t("hiNew")} value={changeStats.newCount} tone="neg" />
              <ChangeStat label={t("hiResolved")} value={changeStats.resolvedCount} tone="pos" />
              <ChangeStat label={t("hiUnchanged")} value={changeStats.unchangedCount} tone="flat" />
            </div>
            <p className="font-sans text-xs text-ink-40">{t("hiChangeNote")}</p>
            {(changeStats.newRules.length > 0 || changeStats.resolvedRules.length > 0) && (
              <div className="space-y-2 border-t border-line-soft pt-3">
                {changeStats.newRules.length > 0 && (
                  <ChangeRuleRow
                    label={t("hiNew")}
                    rules={changeStats.newRules}
                    onOpenIssue={onOpenIssue}
                    badgeClass="badge-err"
                  />
                )}
                {changeStats.resolvedRules.length > 0 && (
                  <ChangeRuleRow
                    label={t("hiResolved")}
                    rules={changeStats.resolvedRules}
                    onOpenIssue={onOpenIssue}
                    badgeClass="badge-pos"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ===== ④ 审计记录表（点击行进入对应审计） ===== */}
      <SectionCard title={t("auditHistoryTable")} subtitle={t("auditHistoryTableSub")} bodyClassName="mt-0">
        {rows.length === 0 ? (
          <EmptyBlock title={t("noData")} />
        ) : (
          <DataTable minWidthRem={0} ariaLabel={t("auditHistoryTable")}>
            <THead>
              <Th className="whitespace-nowrap" width="10rem">{t("thDate")}</Th>
              <Th className="whitespace-nowrap" width="5.5rem">{t("thMode")}</Th>
              <Th className="whitespace-nowrap" align="right" width="5.5rem">{t("pagesCrawled")}</Th>
              <Th className="whitespace-nowrap" align="right" width="5.5rem">{t("healthScoreLabel")}</Th>
              <Th className="whitespace-nowrap" align="right" width="9rem">{t("thFindings")}</Th>
              <Th className="hidden whitespace-nowrap md:table-cell" width="8rem">{t("engineVersion")}</Th>
              <Th className="whitespace-nowrap" align="right" width="5rem">{t("thDetail")}</Th>
            </THead>
            <TBody>
              {[...rows].reverse().map((r) => {
                const isCurrent = viewingAuditId === r.id;
                return (
                  <TR
                    key={r.id}
                    className={`cursor-pointer transition-colors hover:bg-line-soft/40 ${isCurrent ? "bg-brand/5" : ""}`}
                    onClick={() => onOpenAudit(r.id)}
                  >
                    <TD>
                      <span className="font-mono text-xs text-ink" title={new Date(appendZ(r.checkedAt)).toLocaleString()}>{formatDate(r.checkedAt, locale, true)}</span>
                    </TD>
                    <TD>
                      <span className="badge-info font-mono text-xs">{r.depth === "full" ? t("depthFull") : t("depthQuick")}</span>
                    </TD>
                    <TD align="right" numeric>
                      <span className="text-ink-60">{r.pagesCrawled !== null && r.pagesCrawled !== undefined ? fmtNum(r.pagesCrawled) : "—"}</span>
                    </TD>
                    <TD align="right" numeric>
                      <span className="font-mono text-sm font-semibold text-ink">{r.score ?? "—"}</span>
                    </TD>
                    <TD align="right" numeric>
                      <span className="font-mono text-sm text-ink">{fmtNum(r.findings)}</span>
                      <span className="ml-2 inline-flex gap-1.5 font-mono text-xs">
                        {r.errors > 0 && <span className="text-neg" title={t("sevError")}>E{r.errors}</span>}
                        {r.warnings > 0 && <span className="text-warn" title={t("sevWarning")}>W{r.warnings}</span>}
                        {r.notices > 0 && <span className="text-ink-40" title={t("sevNotice")}>N{r.notices}</span>}
                      </span>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <span className="font-mono text-xs text-ink-60">{r.engineVersion ?? "v1"}{r.ruleSetVersion ? ` · ${r.ruleSetVersion}` : ""}</span>
                    </TD>
                    <TD align="right">
                      {isCurrent ? (
                        <span className="font-mono text-xs text-brand">{t("hiCurrent")}</span>
                      ) : (
                        <span className="font-mono text-xs text-brand hover:underline">{t("hiView")} →</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}

function ChangeStat({ label, value, tone }: { label: string; value: number; tone: "neg" | "pos" | "flat" }) {
  const colorClass = tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-left">
      <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-semibold ${colorClass}`}>{fmtNum(value)}</div>
    </div>
  );
}

function ChangeRuleRow({
  label,
  rules,
  onOpenIssue,
  badgeClass,
}: {
  label: string;
  rules: Array<[string, number]>;
  onOpenIssue: (ruleId: string) => void;
  badgeClass: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 font-mono text-xs text-ink-60">{label}:</span>
      {rules.map(([ruleId, n]) => (
        <button
          key={ruleId}
          onClick={() => onOpenIssue(ruleId)}
          className={`${badgeClass} whitespace-nowrap font-mono text-xs transition-colors hover:border-ink-25`}
        >
          {ruleId} · {n}
        </button>
      ))}
    </div>
  );
}

/** ISO → "2026/10/15 16:17"（zh）/"Oct 15, 16:17"（en）；withTime=false 时只到日 */
function formatDate(iso: string, locale: "en" | "zh", withTime: boolean): string {
  try {
    const d = new Date(appendZ(iso));
    if (Number.isNaN(d.getTime())) return iso;
    if (withTime) {
      return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      });
    }
    return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** DB 时间无 Z 后缀（UTC 裸值），补 Z 保证按 UTC 解析 */
function appendZ(iso: string): string {
  return iso.endsWith("Z") ? iso : iso + "Z";
}
