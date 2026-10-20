// ===== 关键词研究 / 排名追踪三页的专用配色与图表主题（精修版） =====
//
// 定位：**只服务这三页**（keyword-overview / keyword-expand / position-tracking）。
// 为什么单独一份而不是改全局 token：这些页面与已验收页面（/app、审计概览、审计问题页）
// 共用 viz 组件与 chart-theme，直接改全局色值会连带改变已经验收的界面。
// 因此这里提供一套更克制的色板，由三页显式引入；待三页验收通过后，可再统一回全局。
//
// 配色原则（用户明确要求）：
//   · 底色与面板保持低饱和中性（画布浅灰白 / 面板白 / 文字深炭灰），靠留白与细边框分层。
//   · 强调色 = 低饱和墨绿，只做克制点缀，不铺背景。
//   · 颜色必须表达信息含义：改善=绿、下降/错误=红、需要注意=柔和琥珀、无数据/未更新=中性灰。
//   · 不使用高饱和彩虹配色；系列色控制在 5 个低饱和、可区分的色相内。

export const RK = {
  /** 强调色：低饱和墨绿（主序列 / 链接 / 分布主色），克制使用 */
  accent: "#0F766E",
  accentDeep: "#115E59",
  /** 排名改善 / 成功 */
  up: "#15803D",
  /** 下降 / 错误 */
  down: "#B91C1C",
  /** 需要注意（柔和琥珀） */
  warn: "#B45309",
  /** 无数据 / 未更新 / 中性 */
  neutral: "#9CA3AF",
  neutralDeep: "#6B7280",
  /** 文字三级（与全局 ink 体系一致） */
  ink: "#111827",
  ink60: "#374151",
  ink40: "#6B7280",
  /** 图表网格 / 轴线（比默认更轻） */
  grid: "#EDEFF1",
  axis: "#D7DBE0",
  cursor: "rgba(17,24,39,.035)",
} as const;

/** 多关键词趋势的系列色：5 个低饱和、可区分的色相（非彩虹） */
export const RK_SERIES = ["#0F766E", "#475569", "#B45309", "#4D7C0F", "#9F1239"] as const;

/** 排名分段（1-3 / 4-10 / 11-100 / 未进前 100） */
export const RK_RANK_BUCKET = {
  top3: RK.up,
  top10: RK.warn,
  top100: RK.accent,
  unranked: RK.neutral,
} as const;

/** 意图类别（信息 / 商业 / 导航）：有限且易区分，不使用高饱和色 */
export const RK_INTENT = {
  informational: RK.accent,
  commercial: RK.warn,
  navigational: RK.neutral,
} as const;

// ---------- 统一图表主题（轴线 / 网格 / 刻度 / 悬停框 / 图例） ----------

export const RK_TICK_STYLE = {
  fill: RK.ink40,
  fontSize: 11,
  fontFamily: "JetBrains Mono, monospace",
} as const;

export const RK_GRID_PROPS = {
  strokeDasharray: "3 3",
  stroke: RK.grid,
  vertical: false,
} as const;

export const RK_XAXIS_PROPS = {
  axisLine: { stroke: RK.axis },
  tickLine: false,
  tick: RK_TICK_STYLE,
} as const;

export const RK_YAXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  tick: RK_TICK_STYLE,
} as const;

/** 排名轴：**数字越小越靠前**，因此反向（第 1 名在最上方）。方向不可更改。 */
export const RK_RANK_YAXIS_PROPS = {
  reversed: true,
  domain: [1, 100],
  axisLine: false,
  tickLine: false,
  tick: RK_TICK_STYLE,
} as const;

export const RK_TOOLTIP_STYLE = {
  background: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
  boxShadow: "0 6px 16px rgba(17,24,39,.07)",
  padding: "8px 10px",
} as const;

export const RK_TOOLTIP_LABEL_STYLE = {
  color: RK.ink60,
  marginBottom: 4,
} as const;

export const RK_TOOLTIP_ITEM_STYLE = {
  color: RK.ink,
  padding: "2px 0",
} as const;

export const RK_LEGEND_STYLE = {
  fontSize: 11,
  fontFamily: "JetBrains Mono, monospace",
  paddingTop: 8,
  color: RK.ink40,
} as const;

/** 链接（克制的墨绿，而非默认蓝） */
export const RK_LINK_CLASS = "text-[#0F766E] hover:underline";

// ---------- 分类色（域名等离散类别） ----------
// 低饱和、可区分，含中性灰作为次要类别；不使用刺眼彩虹色。
// 分配规则：按名称排序后依次取色 → 同一数据集内**同一名称颜色恒定**，
// 排序/筛选变化不会改变某一名下的颜色（跨数据集的颜色可能不同，属预期）。
export const RK_CATEGORY_SERIES = [
  "#0F766E", // 墨绿
  "#4D7C0F", // 柔和橄榄绿
  "#B45309", // 琥珀
  "#9F1239", // 砖红
  "#6B21A8", // 低饱和紫
  "#7C2D12", // 深棕
  "#9CA3AF", // 中性灰（最后兜底，避免常见域名数下出现重复色）
] as const;

export function categoryColorMap(names: string[]): Map<string, string> {
  const map = new Map<string, string>();
  [...new Set(names)]
    .sort()
    .forEach((n, i) => map.set(n, RK_CATEGORY_SERIES[i % RK_CATEGORY_SERIES.length]));
  return map;
}

/** 整数刻度：返回 [0, top] 域与等距整数刻度（步长随量级自适应，布局稳定、不产生小数刻度） */
export function intTicks(max: number): { domain: [number, number]; ticks: number[] } {
  const safeMax = Math.max(0, Math.floor(max));
  const step =
    safeMax <= 4 ? 1 : safeMax <= 10 ? 2 : safeMax <= 25 ? 5 : Math.ceil(safeMax / 5 / 10) * 10;
  const top = Math.max(step, Math.ceil(safeMax / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { domain: [0, top], ticks };
}
