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
  passed: number;
  failed: number;
}

/** 审计检查通过情况环形占比图 */
export default function AuditPassDonut({ passed, failed }: Props) {
  const total = passed + failed;
  if (total === 0) {
    return <ChartEmpty message="暂无通过情况数据" hint="发起审计后显示" />;
  }

  const data = [
    { name: "通过", value: passed },
    { name: "未通过", value: failed },
  ];
  const colors = [CHART_COLORS.pass, CHART_COLORS.error];

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
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={1}
            isAnimationActive={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i]} stroke="#fff" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            formatter={(v, n) => [`${v} 项 (${total > 0 ? Math.round(((v as number) / total) * 100) : 0}%)`, n]}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* 中心文字 */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold text-ink">{Math.round((passed / total) * 100)}%</div>
        <div className="mt-0.5 text-[10px] text-ink-40">
          {passed} / {total} 项
        </div>
      </div>
    </div>
  );
}
