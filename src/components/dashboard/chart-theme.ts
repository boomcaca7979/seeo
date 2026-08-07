// ===== 共享 Recharts 主题（Semrush 风格） =====
// 全 dashboard 图表统一引用，删除各自渐变 defs
// 色板：通过 #22C55E / 警告 #F59E0B / 错误 #EF4444 / 中性 #9CA3AF / 品牌黑 #111827

/** 统一色板（图表系列色） */
export const CHART_COLORS = {
  pass: "#22C55E", // 通过 / 正向
  warn: "#F59E0B", // 警告
  error: "#EF4444", // 错误
  neutral: "#9CA3AF", // 中性 / 未上榜
  brand: "#111827", // 品牌黑
  accent: "#2563EB", // 信息蓝
} as const;

/** 多系列默认色板（最多 8 条） */
export const CHART_SERIES_PALETTE = [
  "#111827",
  "#22C55E",
  "#F59E0B",
  "#2563EB",
  "#EF4444",
  "#9CA3AF",
  "#8B5CF6",
  "#06B6D4",
] as const;

/** 网格线 stroke */
export const CHART_GRID_STROKE = "#ECE9DD";

/** 刻度文字样式 */
export const CHART_TICK_STYLE = {
  fill: "rgba(17,24,39,.55)",
  fontSize: 11,
  fontFamily: "JetBrains Mono, monospace",
} as const;

/** 坐标轴线 stroke */
export const CHART_AXIS_STROKE = "#E5E7EB";

/** tooltip contentStyle */
export const CHART_TOOLTIP_STYLE = {
  background: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
  boxShadow: "0 4px 12px rgba(0,0,0,.06)",
  padding: "8px 10px",
} as const;

/** tooltip labelStyle */
export const CHART_TOOLTIP_LABEL_STYLE = {
  color: "rgba(17,24,39,.55)",
  marginBottom: 4,
} as const;

/** tooltip itemStyle */
export const CHART_TOOLTIP_ITEM_STYLE = {
  color: "#111827",
  padding: "2px 0",
} as const;

/** 排名类图表 Y 轴配置（reversed，第 1 名在最上） */
export const RANK_YAXIS_PROPS = {
  reversed: true,
  domain: [1, 100],
  axisLine: false,
  tickLine: false,
  tick: CHART_TICK_STYLE,
} as const;

/** 通用 X 轴配置 */
export const COMMON_XAXIS_PROPS = {
  axisLine: { stroke: CHART_AXIS_STROKE },
  tickLine: false,
  tick: CHART_TICK_STYLE,
} as const;

/** 通用 Y 轴配置（非排名） */
export const COMMON_YAXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  tick: CHART_TICK_STYLE,
} as const;

/** 通用 CartesianGrid 配置 */
export const COMMON_GRID_PROPS = {
  strokeDasharray: "3 3",
  stroke: "#EDEEF1",
  vertical: false,
} as const;

/** 数字千分位格式化 */
export function formatNumber(v: number): string {
  return v.toLocaleString("en-US");
}

/** Legend wrapper 样式 */
export const CHART_LEGEND_STYLE = {
  fontSize: 11,
  fontFamily: "JetBrains Mono, monospace",
  paddingTop: 8,
} as const;
