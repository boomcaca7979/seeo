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
import {
  CHART_COLORS,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  CHART_TICK_STYLE,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

interface Props {
  up: number;
  down: number;
}

/** 今日上升 / 下降词数的正负柱状图 */
export default function RankChangeBars({ up, down }: Props) {
  if (up === 0 && down === 0) {
    return <ChartEmpty message="暂无升降数据" hint="刷新排名后显示" />;
  }

  const data = [
    { name: "上升", value: up },
    { name: "下降", value: -down },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }} barCategoryGap="40%">
        <XAxis dataKey="name" {...COMMON_XAXIS_PROPS} />
        <YAxis
          {...COMMON_YAXIS_PROPS}
          tickFormatter={(v) => String(Math.abs(v))}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: "rgba(17,24,39,.04)" }}
          formatter={(v) => [`${Math.abs(v as number)} 个词`, "数量"]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? CHART_COLORS.pass : CHART_COLORS.error} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// 占位避免未使用警告
void CHART_TICK_STYLE;
