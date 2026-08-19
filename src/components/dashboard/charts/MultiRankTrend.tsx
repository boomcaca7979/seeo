"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import {
  CHART_LEGEND_STYLE,
  CHART_SERIES_PALETTE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  COMMON_XAXIS_PROPS,
  RANK_YAXIS_PROPS,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

export interface MultiRankSeries {
  keyword: string;
  /** 30 天历史，每天一个 rank 点 */
  points: { date: string; rank: number | null }[];
}

interface Props {
  series: MultiRankSeries[];
  /** 最大叠加数，默认 5 */
  max?: number;
}

/** 多关键词排名趋势折线图（可勾选） */
export default function MultiRankTrend({ series, max = 5 }: Props) {
  const t = useTranslations("dashboard.shared.charts");
  const top = series.slice(0, max);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (!top.length || top.every((s) => s.points.length === 0)) {
    return <ChartEmpty message={t("multiRankEmpty")} hint={t("multiRankEmptyHint")} />;
  }

  // 合并日期：以最长序列为基准
  const allDates: string[] = [];
  top.forEach((s) => {
    s.points.forEach((p) => {
      if (!allDates.includes(p.date)) allDates.push(p.date);
    });
  });
  allDates.sort((a, b) => a.localeCompare(b));

  const chartData = allDates.map((date) => {
    const row: Record<string, string | number | null> = { day: date.slice(5) };
    top.forEach((s) => {
      const p = s.points.find((pp) => pp.date === date);
      row[s.keyword] = p ? p.rank : null;
    });
    return row;
  });

  const visibleSeries = top.filter((s) => !hidden.has(s.keyword));

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="88%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EDEEF1" vertical={false} />
          <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
          <YAxis {...RANK_YAXIS_PROPS} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            formatter={(v, n) => v === null ? [t("notInTop100"), n] : [`#${v}`, n]}
          />
          <Legend
            wrapperStyle={CHART_LEGEND_STYLE}
            onClick={(e: { value?: string }) => {
              if (!e.value) return;
              const next = new Set(hidden);
              if (next.has(e.value)) next.delete(e.value);
              else next.add(e.value);
              setHidden(next);
            }}
          />
          {visibleSeries.map((s, i) => (
            <Line
              key={s.keyword}
              type="monotone"
              dataKey={s.keyword}
              stroke={CHART_SERIES_PALETTE[i % CHART_SERIES_PALETTE.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {hidden.size > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-40">{t("hiddenLabel")}</span>
          {Array.from(hidden).map((kw) => (
            <button
              key={kw}
              onClick={() => {
                const next = new Set(hidden);
                next.delete(kw);
                setHidden(next);
              }}
              className="rounded-full border border-line bg-card px-2 py-0.5 text-xs text-ink-60 hover:bg-line-soft"
            >
              + {kw}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 text-right text-xs text-ink-40">
        {t("legendHint", { max })}
      </div>
    </div>
  );
}

// 占位避免未使用警告
