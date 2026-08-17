"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import {
  CHART_COLORS,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
  formatNumber,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

interface AlertPoint {
  date: string; // ISO 或 YYYY-MM-DD
  count: number;
}

interface Props {
  data: AlertPoint[];
}

function formatDay(iso: string): string {
  // 输出 MM-DD
  const d = new Date(iso.endsWith("Z") ? iso : iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}`;
}

/** 近 7 天预警数量面积图 */
export default function AlertAreaChart({ data }: Props) {
  const t = useTranslations("dashboard.shared.charts");

  if (!data.length || data.every((d) => d.count === 0)) {
    return <ChartEmpty message={t("alertEmpty")} hint={t("alertEmptyHint")} />;
  }

  const chartData = data.map((d) => ({
    day: formatDay(d.date),
    count: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={chartData}
        margin={{ top: 8, right: 16, bottom: 4, left: -8 }}
      >
        <defs>
          <linearGradient id="alertAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.warn} stopOpacity={0.25} />
            <stop offset="100%" stopColor={CHART_COLORS.warn} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...COMMON_GRID_PROPS} />
        <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
        <YAxis {...COMMON_YAXIS_PROPS} allowDecimals={false} />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          formatter={(v) => [t("alertCount", { n: formatNumber(Number(v)) }), t("alertLabel")]}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={CHART_COLORS.warn}
          strokeWidth={2}
          fill="url(#alertAreaFill)"
          dot={{ r: 3, fill: CHART_COLORS.warn, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
