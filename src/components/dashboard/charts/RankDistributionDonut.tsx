"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  CHART_COLORS,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

interface Props {
  top3: number;
  top10: number;
  top100: number;
  unranked: number;
}

const SEGMENTS = [
  { key: "top3", label: "Top 3", color: CHART_COLORS.pass },
  { key: "top10", label: "Top 4-10", color: CHART_COLORS.warn },
  { key: "top100", label: "Top 11-100", color: CHART_COLORS.accent },
  { key: "unranked", label: "未进前 100", color: CHART_COLORS.neutral },
] as const;

/** 全部追踪词的排名分布环形占比图 */
export default function RankDistributionDonut({
  top3,
  top10,
  top100,
  unranked,
}: Props) {
  const values = { top3, top10, top100, unranked };
  const total = top3 + top10 + top100 + unranked;
  if (total === 0) {
    return <ChartEmpty message="暂无追踪词" hint="添加追踪词后显示分布" />;
  }

  const data = SEGMENTS.map((s) => ({
    name: s.label,
    value: values[s.key],
  }));

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="58%"
            outerRadius="92%"
            paddingAngle={1}
            isAnimationActive={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={SEGMENTS[i].color} stroke="#fff" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            formatter={(v, n) => [`${v} 个词 (${total > 0 ? Math.round(((v as number) / total) * 100) : 0}%)`, n]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold text-ink">{total}</div>
        <div className="mt-0.5 text-[10px] text-ink-40">追踪词总数</div>
      </div>
    </div>
  );
}

export { SEGMENTS as RANK_SEGMENTS };
