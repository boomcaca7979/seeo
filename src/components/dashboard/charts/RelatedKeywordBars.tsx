"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import {
  CHART_COLORS,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  COMMON_GRID_PROPS,
  formatNumber,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

export interface RelatedKeywordItem {
  keyword: string;
  volume: number;
}

interface Props {
  data: RelatedKeywordItem[];
  /** 展示前 N 个，默认 15 */
  topN?: number;
}

/** 相关词搜索量横向条形图（量级对比） */
export default function RelatedKeywordBars({ data, topN = 15 }: Props) {
  const t = useTranslations("dashboard.shared.charts");

  if (!data.length || data.every((d) => d.volume === 0)) {
    return <ChartEmpty message={t("relatedEmpty")} hint={t("relatedEmptyHint")} />;
  }

  const chartData = [...data]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, topN)
    .map((d) => ({
      name: d.keyword,
      volume: d.volume,
    }));

  // 最大值用于颜色映射
  const maxVol = Math.max(...chartData.map((d) => d.volume), 1);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
        barCategoryGap="20%"
      >
        <CartesianGrid {...COMMON_GRID_PROPS} horizontal={false} />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          tickFormatter={(v) => formatNumber(v)}
        />
        <YAxis
          type="category"
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          width={140}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: "rgba(17,24,39,.04)" }}
          formatter={(v) => [`${formatNumber(Number(v))}`, t("searchVolumeLabel")]}
        />
        <Bar dataKey="volume" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {chartData.map((d, i) => {
            // 量级映射：高=品牌黑 / 中=蓝 / 低=灰
            const ratio = d.volume / maxVol;
            const fill =
              ratio > 0.66
                ? CHART_COLORS.brand
                : ratio > 0.33
                ? CHART_COLORS.accent
                : CHART_COLORS.neutral;
            return <Cell key={i} fill={fill} />;
          })}
          <LabelList
            dataKey="volume"
            position="right"
            formatter={(v: unknown) => formatNumber(Number(v))}
            style={{
              fontSize: 10,
              fontFamily: "JetBrains Mono, monospace",
              fill: "#111827",
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
