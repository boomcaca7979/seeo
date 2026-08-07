"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
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
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

interface ProjectScore {
  name: string;
  score: number;
}

interface Props {
  data: ProjectScore[];
}

/** 健康分着色：≥80 绿 / 60-79 橙 / <60 红 */
function colorOf(score: number): string {
  if (score >= 80) return CHART_COLORS.pass;
  if (score >= 60) return CHART_COLORS.warn;
  return CHART_COLORS.error;
}

/** 各项目健康分横向条形图（按分数排序） */
export default function HealthScoreBars({ data }: Props) {
  if (!data.length) {
    return <ChartEmpty message="暂无项目健康分" hint="审计项目后显示" />;
  }

  const chartData = [...data]
    .filter((d) => d.score !== null && d.score !== undefined)
    .sort((a, b) => b.score - a.score)
    .map((d) => ({
      name: d.name,
      score: d.score,
    }));

  if (!chartData.length) {
    return <ChartEmpty message="暂无审计结果" hint="项目审计后显示健康分" />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
        barCategoryGap="40%"
      >
        <XAxis
          type="number"
          domain={[0, 100]}
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
        />
        <YAxis
          type="category"
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          width={100}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: "rgba(17,24,39,.04)" }}
          formatter={(v) => [`${v} 分`, "健康分"]}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {chartData.map((d, i) => (
            <Cell key={i} fill={colorOf(d.score)} />
          ))}
          <LabelList
            dataKey="score"
            position="right"
            style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", fill: "#111827" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
