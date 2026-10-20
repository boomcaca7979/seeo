"use client";

// 今日上升 / 下降词数 —— **共用水平基线**的水平分组条形图。
//
// 为什么用水平方向：原来的竖直版本把"上升"画在零线上方、"下降"画在零线下方，
// 两根柱不在同一条基线上（且负数刻度被 abs 抹掉后出现两个「6」，观众无法对比）。
// 现在两根柱都从同一条左侧基线（x=0）向右生长，行高、内边距、坐标轴完全一致，
// 数值标签固定在条形末端，不依赖数据量、不做任何硬编码定位。
//
// 颜色语义固定（不可为配色而改变）：上升=绿、下降=红。

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
  RK,
  RK_GRID_PROPS,
  RK_TICK_STYLE,
  RK_TOOLTIP_ITEM_STYLE,
  RK_TOOLTIP_LABEL_STYLE,
  RK_TOOLTIP_STYLE,
  RK_XAXIS_PROPS,
  intTicks,
} from "@/components/viz/rank-theme";
import ChartEmpty from "./ChartEmpty";

interface Props {
  up: number;
  down: number;
}

/** 今日上升 / 下降词数的水平分组条形图 */
export default function RankChangeBars({ up, down }: Props) {
  const t = useTranslations("dashboard.shared.charts");

  if (up === 0 && down === 0) {
    return <ChartEmpty message={t("rankChangeEmpty")} hint={t("rankChangeEmptyHint")} />;
  }

  const data = [
    { name: t("rising"), value: up, fill: RK.up },
    { name: t("falling"), value: down, fill: RK.down },
  ];
  const { domain, ticks } = intTicks(Math.max(up, down));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 36, bottom: 0, left: 0 }}
        barCategoryGap="45%"
      >
        <CartesianGrid {...RK_GRID_PROPS} horizontal={false} />
        <XAxis
          type="number"
          domain={domain}
          ticks={ticks}
          allowDecimals={false}
          {...RK_XAXIS_PROPS}
          tickMargin={6}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={44}
          tickLine={false}
          axisLine={false}
          tick={RK_TICK_STYLE}
        />
        <Tooltip
          contentStyle={RK_TOOLTIP_STYLE}
          labelStyle={RK_TOOLTIP_LABEL_STYLE}
          itemStyle={RK_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: RK.cursor }}
          formatter={(v) => [`${v} ${t("keywordsUnit")}`, t("countLabel")]}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={32} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", fill: RK.ink }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
