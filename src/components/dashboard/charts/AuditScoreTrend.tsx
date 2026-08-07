"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
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

interface HistoryItem {
  date: string;
  score: number;
}

interface Props {
  data: HistoryItem[];
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

/** 历史审计分数折线图（近 10 次） */
export default function AuditScoreTrend({ data }: Props) {
  if (!data.length) {
    return <ChartEmpty message="暂无历史分数" hint="审计 2 次以上显示趋势" />;
  }

  const chartData = data.slice(-10).map((d) => ({
    day: formatDate(d.date),
    score: d.score,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={chartData}
        margin={{ top: 8, right: 16, bottom: 4, left: -8 }}
      >
        <CartesianGrid {...COMMON_YAXIS_PROPS} strokeDasharray="3 3" stroke="#EDEEF1" vertical={false} />
        <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
        <YAxis
          domain={[0, 100]}
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          formatter={(v) => [`${v} 分`, "健康分"]}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke={CHART_COLORS.accent}
          strokeWidth={2.5}
          dot={{ r: 3, fill: CHART_COLORS.accent, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
