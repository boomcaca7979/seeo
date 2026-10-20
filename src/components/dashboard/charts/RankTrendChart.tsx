"use client";

// 单关键词排名趋势折线图——与 MultiRankTrend 共用同一套量程/标签规则（rank-axis）。
//
// 第十五阶段整改：
//   · 纵轴量程由真实名次推出，锚点仍是第 1 名（不是 min-max 截断，不夸大涨跌幅）。
//   · 横轴标签只留 MM-DD，密度交给 interval="preserveStartEnd" + minTickGap，不删数据点。
//   · 记录数 ≤ SPARSE_TREND_MAX 时不画线：两点一线是编造的趋势，改为逐条真实记录。
//   · 数据点显示为小圆点（原来 dot={false} + 仅 2 点，读起来像一条没有信息的直线）。

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import { ChangeBadge } from "@/components/dashboard/Badges";
import {
  RK,
  RK_GRID_PROPS,
  RK_RANK_YAXIS_PROPS,
  RK_TOOLTIP_ITEM_STYLE,
  RK_TOOLTIP_LABEL_STYLE,
  RK_TOOLTIP_STYLE,
  RK_XAXIS_PROPS,
} from "@/components/viz/rank-theme";
import { rankAxisScale, shortDateLabel, SPARSE_TREND_MAX } from "./rank-axis";

export interface RankTrendPoint {
  /** 历史记录日期（ISO） */
  date: string;
  /** null = 未进前 100 */
  rank: number | null;
}

interface Props {
  points: RankTrendPoint[];
}

/** 单次波动达到该名次差即标记为显著变化（沿用原有显示口径） */
const VOLATILITY_DELTA = 4;

const CHART_HEIGHT = 180;

/** 相邻两次记录之间的显著波动点：只用真实记录，不插值 */
function volatilityPoints(records: { day: string; rank: number | null }[]) {
  const marks: { key: string; day: string; rank: number; improved: boolean }[] = [];
  records.forEach((p, i) => {
    if (i === 0) return;
    const prev = records[i - 1].rank;
    if (p.rank === null || prev === null) return;
    if (Math.abs(p.rank - prev) < VOLATILITY_DELTA) return;
    // 名次数字变小 = 上升
    marks.push({ key: `${p.day}-${i}`, day: p.day, rank: p.rank, improved: p.rank < prev });
  });
  return marks;
}

/** 逐条记录附上「与上一条真实名次的差」，null 记录不参与比较 */
function withDelta(records: { day: string; rank: number | null }[]) {
  let prev: number | null = null;
  return records.map((r) => {
    const delta = r.rank !== null && prev !== null ? prev - r.rank : null;
    if (r.rank !== null) prev = r.rank;
    return { ...r, delta };
  });
}

export default function RankTrendChart({ points }: Props) {
  const t = useTranslations("dashboard.shared.charts");
  const records = points.map((p) => ({ day: shortDateLabel(p.date), rank: p.rank }));
  const { domain, ticks } = rankAxisScale(records.map((r) => r.rank));

  // ---- 稀疏：逐条列出真实记录，而不是把两点连成趋势线 ----
  if (records.length <= SPARSE_TREND_MAX) {
    const rows = withDelta(records);
    return (
      <div className="flex flex-col gap-2">
        <ul className="divide-y divide-line-soft">
          {rows.map((r, i) => (
            <li key={`${r.day}-${i}`} className="flex items-center gap-3 py-1.5">
              <span className="shrink-0 font-mono text-xs text-ink-40">{r.day}</span>
              <span className="font-mono text-sm font-semibold text-ink">
                {r.rank === null ? t("notInTop100") : `#${r.rank}`}
              </span>
              <span className="ml-auto w-12 shrink-0 text-right">
                {r.delta === null ? null : <ChangeBadge value={r.delta} />}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-line-soft pt-2 font-sans text-xs text-ink-40">
          <p>{t("sparseTrendHint", { days: records.length, min: SPARSE_TREND_MAX + 1 })}</p>
          <p className="mt-1">{t("rankSemantics")}</p>
        </div>
      </div>
    );
  }

  const volatile = volatilityPoints(records);

  return (
    <div className="flex flex-col gap-1.5">
      <div style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* top 留出 12px：量程顶端就是第 1 名，刻度文字不能被裁掉一半 */}
          <LineChart data={records} margin={{ top: 12, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid {...RK_GRID_PROPS} />
            <XAxis
              dataKey="day"
              {...RK_XAXIS_PROPS}
              tickMargin={8}
              minTickGap={28}
              interval="preserveStartEnd"
            />
            <YAxis {...RK_RANK_YAXIS_PROPS} domain={domain} ticks={ticks} width={30} />
            <Tooltip
              contentStyle={RK_TOOLTIP_STYLE}
              labelStyle={RK_TOOLTIP_LABEL_STYLE}
              itemStyle={RK_TOOLTIP_ITEM_STYLE}
              formatter={(v) => [v === null ? t("notInTop100") : `#${v}`, t("rankSeriesLabel")]}
            />
            <Line
              type="monotone"
              dataKey="rank"
              stroke={RK.accent}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 1, stroke: "#FFFFFF", fill: RK.accent }}
              activeDot={{ r: 4.5 }}
              isAnimationActive={false}
              connectNulls
            />
            {volatile.map((p) => (
              <ReferenceDot
                key={p.key}
                x={p.day}
                y={p.rank}
                r={4.5}
                fill={p.improved ? RK.up : RK.down}
                stroke="#FFFFFF"
                strokeWidth={2}
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
