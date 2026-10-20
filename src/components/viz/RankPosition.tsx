// ===== 排名位置显示原语（三页共用一套排名语义） =====
//
// 关键语义（与用户约定一致）：
//   **排名数字越小越靠前**。因此"上升"= 位置数值变小，用正向色；"下降"= 数值变大，用负向色。
//   任何"没有数据"必须与"未进前 100"区分开——二者是完全不同的事实，绝不可混用。
//
// 配色取自 rank-theme（精修版：低饱和墨绿/绿/红/琥珀/中性灰），不使用圆形装饰。

import { RK, RK_RANK_BUCKET } from "./rank-theme";

export type RankBucket = "top3" | "top10" | "top100" | "unranked";

/** 位置 → 分段（1-3 / 4-10 / 11-100 / 未进前 100） */
export function rankBucket(position: number | null): RankBucket {
  if (position === null || !Number.isFinite(position)) return "unranked";
  if (position <= 3) return "top3";
  if (position <= 10) return "top10";
  return "top100";
}

/** 分段 → 颜色（Top3 绿 / Top10 琥珀 / Top100 墨绿 / 未进前 100 中性灰） */
export function rankColor(bucket: RankBucket): string {
  return RK_RANK_BUCKET[bucket];
}

/** 分段图例色（供分布条统一取色） */
export const RANK_BUCKET_COLOR: Record<RankBucket, string> = RK_RANK_BUCKET;

/**
 * 排名位置显示。
 * state 语义：
 *   live  有当前记录 → 显示 #N（按分段着色）
 *   stale 当前没有记录，但历史上刷新过 → 显示 staleLabel（如"今日未刷新"），中性色
 *   none  从未有记录 → 显示 noneLabel（如"尚无排名记录"），中性色
 */
export function RankPosition({
  position,
  state,
  staleLabel,
  noneLabel,
  unrankedLabel,
  className = "",
}: {
  position: number | null;
  state: "live" | "stale" | "none";
  staleLabel: string;
  noneLabel: string;
  /** position 为 null 且 state === "live" 时的文案（如"未进前 100"） */
  unrankedLabel: string;
  className?: string;
}) {
  if (state !== "live") {
    return (
      <span className="font-sans text-xs text-ink-40">
        {state === "stale" ? staleLabel : noneLabel}
      </span>
    );
  }

  if (position === null) {
    return <span className="font-sans text-xs text-ink-40">{unrankedLabel}</span>;
  }

  const bucket = rankBucket(position);
  return (
    <span className={`inline-flex items-baseline gap-0.5 ${className}`}>
      <span className="font-mono text-xs" style={{ color: RK.neutralDeep }}>
        #
      </span>
      <span className="font-mono text-base font-semibold" style={{ color: rankColor(bucket) }}>
        {position}
      </span>
    </span>
  );
}
