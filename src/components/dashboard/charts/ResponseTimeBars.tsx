"use client";

import {
  Bar,
  BarChart,
  Cell,
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
  CHART_TICK_STYLE,
  COMMON_XAXIS_PROPS,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

interface ResponseTimeBucket {
  bucket: string;
  count: number;
}

interface Props {
  data: ResponseTimeBucket[];
}

/** 响应时间分布柱状图：按桶着色（快/中/慢） */
export default function ResponseTimeBars({ data }: Props) {
  const t = useTranslations("dashboard.shared.charts");

  if (!data.length || data.every((d) => d.count === 0)) {
    return <ChartEmpty message={t("responseEmpty")} hint={t("responseEmptyHint")} />;
  }

  const colors = [CHART_COLORS.pass, CHART_COLORS.warn, CHART_COLORS.error, "#6B7280"];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 4, left: -8 }}
        barCategoryGap="32%"
      >
        <XAxis dataKey="bucket" {...COMMON_XAXIS_PROPS} />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: "rgba(17,24,39,.04)" }}
          formatter={(v) => [`${v} ${t("pagesUnit")}`, t("countLabel")]}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
