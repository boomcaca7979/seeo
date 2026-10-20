// ===== 排名轴量程：锚定第 1 名，按真实数据范围给整数刻度 =====
//
// 为什么不再用固定 [1, 100]：绝大多数追踪词长期停在前 20 名内，
// 满量程会把曲线压成顶端一小条、下半张图全是留白（用户反馈的「空旷」根因）。
// 这里仍然以第 1 名为轴顶端锚点（不是 min-max 截断），
// 因此曲线走势的相对幅度不会被夸大；量程只随真实数据向上取整。

const MAX_RANK = 100;
const STEP_CANDIDATES = [1, 2, 5, 10, 20, 25];

/** 记录数不超过该值时连不出可信趋势，改用逐条列表（两点一线是假的趋势） */
export const SPARSE_TREND_MAX = 2;

export interface RankAxisScale {
  /** recharts reversed 轴使用：[1, hi]，1 在最上方 */
  domain: [number, number];
  /** 整数刻度，必含 1 与 hi，不会出现小数或重复值 */
  ticks: number[];
}

/**
 * 由图上真实出现的排名值推出量程与刻度。
 * 无数据时退回 [1, 10]，保证空图也有合理坐标系而不是 NaN。
 */
export function rankAxisScale(values: Array<number | null | undefined>): RankAxisScale {
  const ranks = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1);
  const maxRank = ranks.length ? Math.min(MAX_RANK, Math.max(...ranks)) : 10;

  const step = STEP_CANDIDATES.find((s) => Math.ceil(maxRank / s) <= 6) ?? 25;
  // 下限 2：全部记录都是第 1 名时量程会退化成 [1,1]（零高度区间），轴画不出来
  const hi = Math.min(MAX_RANK, Math.max(step, Math.ceil(maxRank / step) * step, 2));

  const ticks = new Set<number>([1, hi]);
  for (let v = step; v < hi; v += step) ticks.add(v);
  return { domain: [1, hi], ticks: [...ticks].sort((a, b) => a - b) };
}

/**
 * 横轴日期标签：只保留 MM-DD（30 天窗口里年份是冗余信息，完整日期在 Tooltip 里）。
 * 刻度密度交给 recharts 的 interval + minTickGap 处理，不在此处删数据点。
 */
export function shortDateLabel(date: string): string {
  return date.length >= 10 ? date.slice(5) : date;
}
