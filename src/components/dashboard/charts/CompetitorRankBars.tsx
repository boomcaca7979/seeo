"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_COLORS,
  CHART_LEGEND_STYLE,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

export interface CompetitorRankRow {
  /** 关键词 */
  keyword: string;
  /** domain -> rank（未进前 100 为 null） */
  ranks: { domain: string; isSelf: boolean; rank: number | null }[];
}

interface Props {
  data: CompetitorRankRow[];
}

/**
 * 竞品排名对比柱状图
 * 每行一个关键词，按 domain 分组柱状并排
 * rank=100 代表未上榜（占满高度），实际用 100-rank 显示（数值越高=排名越好）
 */
export default function CompetitorRankBars({ data }: Props) {
  if (!data.length) {
    return <ChartEmpty message="暂无排名对比" hint="选择关键词并刷新后显示" />;
  }

  // 取全部 domain（最多 5 个）
  const allDomains: string[] = [];
  data.forEach((row) => {
    row.ranks.forEach((r) => {
      if (!allDomains.includes(r.domain)) allDomains.push(r.domain);
    });
  });
  const domains = allDomains.slice(0, 5);

  if (domains.length === 0) {
    return <ChartEmpty message="暂无排名对比" hint="刷新竞品排名后显示" />;
  }

  // 反转 rank：用 101-rank 让数值越高=排名越靠前（柱越高=越好）
  const chartData = data.map((row) => {
    const item: Record<string, string | number> = { keyword: row.keyword };
    domains.forEach((dm) => {
      const r = row.ranks.find((rr) => rr.domain === dm);
      item[dm] = r && r.rank !== null ? 101 - r.rank : 0;
    });
    return item;
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 16, bottom: 4, left: -8 }}
        barGap="2"
        barCategoryGap="24%"
      >
        <CartesianGrid {...COMMON_GRID_PROPS} />
        <XAxis dataKey="keyword" {...COMMON_XAXIS_PROPS} />
        <YAxis
          domain={[0, 100]}
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          tickFormatter={(v) => (v === 0 ? "" : `#${101 - v}`)}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: "rgba(17,24,39,.04)" }}
          formatter={(v, n) => {
            const val = Number(v);
            if (val === 0) return ["未进前 100", n];
            return [`#${101 - val}`, n];
          }}
        />
        <Legend wrapperStyle={CHART_LEGEND_STYLE} />
        {domains.map((dm, i) => {
          // 自己用品牌黑，竞品用蓝
          const isSelf = data.some((row) =>
            row.ranks.some((r) => r.domain === dm && r.isSelf)
          );
          const fill = isSelf
            ? CHART_COLORS.brand
            : i % 2 === 1
            ? CHART_COLORS.accent
            : CHART_COLORS.pass;
          return (
            <Bar
              key={dm}
              dataKey={dm}
              fill={fill}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
