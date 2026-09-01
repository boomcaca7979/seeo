"use client";

// ===== Site Audit History：趋势 + 版本标记 + 审计对比表 =====
// 指标切换：Health Score / Findings / Errors / Warnings / Notices
// 引擎版本变化时在图例与表头明确标注（V1 与 V2 分数不同口径，不伪装同口径）。

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import { SectionCard, EmptyBlock, fmtNum } from "./ui";
import type { HistoryItem } from "./Overview";
import {
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
} from "@/components/dashboard/chart-theme";

type Metric = "score" | "findings" | "errors" | "warnings" | "notices";

function formatDate(iso: string, locale: "en" | "zh"): string {
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

const METRIC_COLORS: Record<Metric, string> = {
  score: "#2563EB",
  findings: "#111827",
  errors: "#EF4444",
  warnings: "#F59E0B",
  notices: "#9CA3AF",
};

export default function HistorySection({ history }: { history: HistoryItem[] }) {
  const t = useTranslations("dashboard.audit");
  const locale = useLocale() as "en" | "zh";
  const [metric, setMetric] = useState<Metric>("score");

  const rows = useMemo(() => {
    return [...history].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)).map((h) => ({
      ...h,
      day: formatDate(h.checkedAt, locale),
      findings: h.errors + h.warnings + h.notices,
    }));
  }, [history, locale]);

  const chartData = rows
    .filter((h) => h.score !== null)
    .map((h) => ({
      day: h.day,
      value: metric === "score" ? (h.score as number) : h[metric],
      engine: h.engineVersion ?? "v1",
      checkedAt: h.checkedAt,
    }));

  // 引擎版本切换点（用于标注）
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

  const metricLabel: Record<Metric, string> = {
    score: t("healthScoreLabel"),
    findings: t("findingsTitle"),
    errors: t("sevError"),
    warnings: t("sevWarning"),
    notices: t("sevNotice"),
  };

  const hasEngineChange = engineChanges.length > 0;

  return (
    <div className="space-y-4">
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
        {chartData.length < 2 ? (
          <EmptyBlock title={t("firstAuditBadge")} hint={t("firstAuditHint")} />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
                <CartesianGrid {...COMMON_GRID_PROPS} />
                <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
                <YAxis domain={metric === "score" ? [0, 100] : [0, "auto"]} {...COMMON_YAXIS_PROPS} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                  formatter={(v) => [String(v), metricLabel[metric]]}
                  labelFormatter={(label) => String(label)}
                />
                <Line type="monotone" dataKey="value" stroke={METRIC_COLORS[metric]} strokeWidth={2.5} dot={{ r: 4, fill: METRIC_COLORS[metric], strokeWidth: 0 }} activeDot={{ r: 6 }} isAnimationActive={false} />
                {engineChanges.map((c, i) => (
                  <ReferenceDot key={i} x={c.day} y={0} r={0} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {hasEngineChange && (
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[0.6875rem] text-ink-40">
            {engineChanges.map((c, i) => (
              <span key={i} className="badge-info">
                {c.day}: {t("engineUpdatedTo", { engine: c.engine })}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("auditHistoryTable")} subtitle={t("auditHistoryTableSub")} bodyClassName="mt-0">
        {rows.length === 0 ? (
          <EmptyBlock title={t("noData")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-soft bg-line-soft/40 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">
                  <th className="px-3 py-2 text-left font-semibold">{t("thDate")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("healthScoreLabel")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("thFindings")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("sevError")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("sevWarning")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("sevNotice")}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t("engineVersion")}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.id} className="border-b border-line-soft">
                    <td className="px-3 py-2 font-mono  text-ink-60">{r.day}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-ink">{r.score ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono  text-ink">{fmtNum(r.errors + r.warnings + r.notices)}</td>
                    <td className="px-3 py-2 text-right font-mono  text-neg">{r.errors}</td>
                    <td className="px-3 py-2 text-right font-mono  text-warn">{r.warnings}</td>
                    <td className="px-3 py-2 text-right font-mono  text-ink-40">{r.notices}</td>
                    <td className="px-3 py-2">
                      <span className="badge-info font-mono text-xs">{r.engineVersion ?? "v1"}{r.ruleSetVersion ? ` · ${r.ruleSetVersion}` : ""}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
