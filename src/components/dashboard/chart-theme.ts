// ===== 共享 Recharts 主题（浅色纸面） =====
// 全 dashboard 图表统一引用，删除各自渐变 defs

/** 网格线 stroke */
export const CHART_GRID_STROKE = "#ECE9DD";

/** 刻度文字样式 */
export const CHART_TICK_STYLE = {
  fill: "rgba(20,18,26,.42)",
  fontSize: 10,
  fontFamily: "JetBrains Mono, monospace",
} as const;

/** 坐标轴线 stroke */
export const CHART_AXIS_STROKE = "#ECE9DD";

/** tooltip contentStyle */
export const CHART_TOOLTIP_STYLE = {
  background: "#FFFFFF",
  border: "1px solid #E4E1D2",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
  boxShadow: "none",
} as const;

/** tooltip labelStyle */
export const CHART_TOOLTIP_LABEL_STYLE = {
  color: "rgba(20,18,26,.62)",
} as const;

/** tooltip itemStyle */
export const CHART_TOOLTIP_ITEM_STYLE = {
  color: "#14121A",
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
  stroke: CHART_GRID_STROKE,
  vertical: false,
} as const;
