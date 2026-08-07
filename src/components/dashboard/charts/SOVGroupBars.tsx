"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_COLORS,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  COMMON_GRID_PROPS,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

export interface SOVBarSeries {
  domain: string;
  isSelf: boolean;
  /** SOV 百分比 0-100 */
  sov: number;
}

interface Props {
  data: SOVBarSeries[];
}

/** SOV 横向条形图（自己 vs 各竞品，自己用品牌黑、竞品用蓝） */
export default function SOVGroupBars({ data }: Props) {
  if (!data.length || data.every((d) => d.sov === 0)) {
    return <ChartEmpty message="暂无 SOV 数据" hint="刷新竞品排名后显示" />;
  }

  const chartData = [...data]
    .sort((a, b) => b.sov - a.sov)
    .map((d) => ({
      name: d.domain,
      sov: d.sov,
      isSelf: d.isSelf,
    }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
        barCategoryGap="32%"
      >
        <CartesianGrid {...COMMON_GRID_PROPS} horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          tickFormatter={(v) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          width={120}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: "rgba(17,24,39,.04)" }}
          formatter={(v) => [`${Number(v).toFixed(1)}%`, "SOV"]}
        />
        <Bar dataKey="sov" radius={[0, 4, 4, 0]} maxBarSize={26}>
          {chartData.map((d, i) => (
            <Cell
              key={i}
              fill={d.isSelf ? CHART_COLORS.brand : CHART_COLORS.accent}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
