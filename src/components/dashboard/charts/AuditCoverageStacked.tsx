"use client";

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import {
  CHART_COLORS,
  CHART_LEGEND_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  CHART_TICK_STYLE,
} from "@/components/dashboard/chart-theme";
import ChartEmpty from "./ChartEmpty";

interface CategoryData {
  category: string;
  passed: number;
  failed: number;
}

interface Props {
  data: CategoryData[];
}

/** 审计检查项按类别的横向堆叠条形图：通过/未通过 */
export default function AuditCoverageStacked({ data }: Props) {
  const t = useTranslations("dashboard.shared.charts");

  const categoryLabel: Record<string, string> = {
    critical: t("severityCritical"),
    warning: t("severityWarning"),
    info: t("severityInfo"),
  };

  if (!data.length || data.every((d) => d.passed === 0 && d.failed === 0)) {
    return <ChartEmpty message={t("coverageEmpty")} hint={t("coverageEmptyHint")} />;
  }

  const chartData = data.map((d) => ({
    name: categoryLabel[d.category] ?? d.category,
    [t("passed")]: d.passed,
    [t("failed")]: d.failed,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        barCategoryGap="30%"
      >
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={CHART_TICK_STYLE}
          width={50}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
          cursor={{ fill: "rgba(17,24,39,.04)" }}
        />
        <Legend wrapperStyle={CHART_LEGEND_STYLE} />
        <Bar
          dataKey={t("passed")}
          stackId="a"
          fill={CHART_COLORS.pass}
          radius={[0, 0, 0, 0]}
          maxBarSize={26}
        />
        <Bar
          dataKey={t("failed")}
          stackId="a"
          fill={CHART_COLORS.error}
          radius={[0, 4, 4, 0]}
          maxBarSize={26}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
