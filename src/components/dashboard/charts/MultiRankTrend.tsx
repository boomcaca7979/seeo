"use client";

// 多关键词排名趋势折线图（可勾选）——配色与网格取自 rank-theme（精修版，低饱和系列色）。
// 排名轴：RK_RANK_YAXIS_PROPS（reversed，数字越小越靠前，第 1 名在最上方）。
//
// 排版约定（第十五阶段整改）：
//   · 纵轴量程由 rankAxisScale 依据**图上真实出现的排名**推出，锚点仍是第 1 名，
//     因此不会被 min-max 截断夸大走势，也不会把前 20 名的数据压成顶端一小条。
//   · 系列颜色按**勾选前的顺序**固定：隐藏某条不会让其余曲线换色，图例与曲线始终一一对应。
//   · 图例是 HTML chip 行而不是 SVG <Legend>：长关键词名可截断、可换行，不会挤成一团。
//   · 历史 ≤ SPARSE_TREND_MAX 天时不画线（两点连成的"趋势"是假的），改为逐词对比列表。

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import { ChangeBadge } from "@/components/dashboard/Badges";
import {
  RK_GRID_PROPS,
  RK_RANK_YAXIS_PROPS,
  RK_SERIES,
  RK_TOOLTIP_ITEM_STYLE,
  RK_TOOLTIP_LABEL_STYLE,
  RK_TOOLTIP_STYLE,
  RK_XAXIS_PROPS,
} from "@/components/viz/rank-theme";
import { rankAxisScale, shortDateLabel, SPARSE_TREND_MAX } from "./rank-axis";
import ChartEmpty from "./ChartEmpty";

export interface MultiRankSeries {
  keyword: string;
  /** 30 天历史，每天一个 rank 点 */
  points: { date: string; rank: number | null }[];
}

interface Props {
  series: MultiRankSeries[];
  /** 最大叠加数，默认 5 */
  max?: number;
}

/**
 * 绘图区高度：由组件自己定死，而不是靠外层 ChartFrame 的 chartHeight 撑出满格。
 * 卡片高度改成由内容决定，稀疏数据时不会出现大片留白。
 */
const TREND_CHART_HEIGHT = 168;

/** 系列取色：按传入顺序固定，与是否被隐藏无关 */
function seriesColor(index: number): string {
  return RK_SERIES[index % RK_SERIES.length];
}

/** 首末两次真实记录：稀疏视图与 delta 都只读真实点，不插值 */
function endpoints(points: { date: string; rank: number | null }[]) {
  const ranked = points.filter((p) => p.rank !== null);
  if (ranked.length === 0) return null;
  const first = ranked[0];
  const last = ranked[ranked.length - 1];
  return {
    firstDate: shortDateLabel(first.date),
    lastDate: shortDateLabel(last.date),
    firstRank: first.rank as number,
    lastRank: last.rank as number,
    delta: (first.rank as number) - (last.rank as number),
    sameDay: first.date === last.date,
  };
}

/** 图例 chip 行：点击切换显隐，长名称截断并保留完整 title */
function SeriesLegend({
  series,
  hidden,
  onToggle,
}: {
  series: { keyword: string; color: string }[];
  hidden: Set<string>;
  onToggle: (keyword: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {series.map((s) => {
        const off = hidden.has(s.keyword);
        return (
          <button
            key={s.keyword}
            type="button"
            onClick={() => onToggle(s.keyword)}
            aria-pressed={!off}
            title={s.keyword}
            className={`flex max-w-[46%] items-center gap-1.5 font-mono text-xs transition-opacity ${
              off ? "text-ink-40 opacity-55 line-through" : "text-ink-60 hover:opacity-80"
            }`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="truncate">{s.keyword}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 多关键词排名趋势折线图（可勾选） */
export default function MultiRankTrend({ series, max = 5 }: Props) {
  const t = useTranslations("dashboard.shared.charts");
  const top = series.slice(0, max);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (!top.length || top.every((s) => s.points.length === 0)) {
    return <ChartEmpty message={t("multiRankEmpty")} hint={t("multiRankEmptyHint")} />;
  }

  const colored = top.map((s, i) => ({ ...s, color: seriesColor(i) }));

  // 合并日期：以出现过的真实日期为准（不补造缺失日期）
  const allDates: string[] = [];
  colored.forEach((s) => {
    s.points.forEach((p) => {
      if (!allDates.includes(p.date)) allDates.push(p.date);
    });
  });
  allDates.sort((a, b) => a.localeCompare(b));

  const toggle = (keyword: string) => {
    const next = new Set(hidden);
    if (next.has(keyword)) next.delete(keyword);
    else next.add(keyword);
    setHidden(next);
  };

  const visible = colored.filter((s) => !hidden.has(s.keyword));
  const legend = (
    <SeriesLegend
      series={colored.map((s) => ({ keyword: s.keyword, color: s.color }))}
      hidden={hidden}
      onToggle={toggle}
    />
  );

  // ---- 稀疏数据：两天连不出趋势，逐词列出真实首末名次 ----
  // 此时每行本身就承担图例（色块 + 名称）与开关，不再另排一份图例（名称重复、卡片更挤）。
  if (allDates.length <= SPARSE_TREND_MAX) {
    const rows = colored
      .map((s) => ({ keyword: s.keyword, color: s.color, end: endpoints(s.points) }))
      .filter((r) => r.end !== null);
    if (rows.length === 0) {
      return <ChartEmpty message={t("multiRankEmpty")} hint={t("multiRankEmptyHint")} />;
    }
    return (
      <div className="flex flex-col gap-2">
        <ul className="divide-y divide-line-soft">
          {rows.map((r) => {
            const off = hidden.has(r.keyword);
            return (
              <li key={r.keyword}>
                <button
                  type="button"
                  onClick={() => toggle(r.keyword)}
                  aria-pressed={!off}
                  title={r.keyword}
                  className={`flex w-full items-center gap-3 py-1.5 text-left transition-opacity ${
                    off ? "opacity-45" : "hover:opacity-80"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: r.color }}
                      aria-hidden
                    />
                    <span
                      className={`truncate font-sans text-xs text-ink ${off ? "line-through" : ""}`}
                    >
                      {r.keyword}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-40">
                    {r.end!.sameDay ? r.end!.lastDate : `${r.end!.firstDate} → ${r.end!.lastDate}`}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink">
                    #{r.end!.firstRank}
                    <span className="text-ink-40"> → </span>#{r.end!.lastRank}
                  </span>
                  <span className="w-12 shrink-0 text-right">
                    <ChangeBadge value={r.end!.delta} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line-soft pt-2 font-sans text-xs text-ink-40">
          <p>{t("sparseTrendHint", { days: allDates.length, min: SPARSE_TREND_MAX + 1 })}</p>
          <p className="mt-1">{t("rankSemantics")}</p>
        </div>
      </div>
    );
  }

  const chartData = allDates.map((date) => {
    const row: Record<string, string | number | null> = { day: shortDateLabel(date) };
    colored.forEach((s) => {
      const p = s.points.find((pp) => pp.date === date);
      row[s.keyword] = p ? p.rank : null;
    });
    return row;
  });

  const { domain, ticks } = rankAxisScale(
    visible.flatMap((s) => s.points.map((p) => p.rank))
  );

  return (
    <div className="flex flex-col gap-1.5">
      {legend}
      <div style={{ height: TREND_CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* top 留出 12px：量程顶端就是第 1 名，刻度文字不能被裁掉一半 */}
          <LineChart data={chartData} margin={{ top: 12, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid {...RK_GRID_PROPS} />
            <XAxis dataKey="day" {...RK_XAXIS_PROPS} tickMargin={8} minTickGap={28} interval="preserveStartEnd" />
            <YAxis {...RK_RANK_YAXIS_PROPS} domain={domain} ticks={ticks} width={30} />
            <Tooltip
              contentStyle={RK_TOOLTIP_STYLE}
              labelStyle={RK_TOOLTIP_LABEL_STYLE}
              itemStyle={RK_TOOLTIP_ITEM_STYLE}
              formatter={(v, n) => (v === null ? [t("notInTop100"), n] : [`#${v}`, n])}
            />
            {visible.map((s) => (
              <Line
                key={s.keyword}
                type="monotone"
                dataKey={s.keyword}
                stroke={s.color}
                strokeWidth={1.75}
                dot={{ r: 2, strokeWidth: 1, stroke: "#FFFFFF", fill: s.color }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="font-sans text-xs text-ink-40">
        {t("rankAxisHint", { best: domain[0], worst: domain[1] })}
      </p>
    </div>
  );
}
