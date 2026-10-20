// ===== 共享徽标（优先级 / 状态 / 验证） =====
// 无 hooks、无 i18n：标签一律由调用方按 locale 传入，保证同一徽标在三页同义同色。

import type { ReactNode } from "react";
import { TONE_BADGE_CLASS, TONE_COLOR, type VizTone } from "./tokens";

/**
 * 统一状态徽标。带圆点 + 文字（不单靠颜色传达语义，满足可访问性）。
 * 任何"无法判断 / 无数据"都必须有自己的 tone，绝不用正向色冒充。
 */
export function StatusBadge({
  label,
  tone,
  dot = true,
  title,
  color,
}: {
  label: ReactNode;
  tone: VizTone;
  dot?: boolean;
  title?: string;
  /** 可选：直接指定色值（同时作用于文字与描边，因为徽标边框用 currentColor）；不传则走 tone 映射 */
  color?: string;
}) {
  return (
    <span className={TONE_BADGE_CLASS[tone]} title={title} style={color ? { color } : undefined}>
      {dot ? (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color ?? TONE_COLOR[tone] }}
          aria-hidden
        />
      ) : null}
      {label}
    </span>
  );
}

/** 纯色小方块（图例用，避免与徽标混淆） */
export function ToneSwatch({ tone, className = "" }: { tone: VizTone; className?: string }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-sm ${className}`}
      style={{ backgroundColor: TONE_COLOR[tone] }}
      aria-hidden
    />
  );
}
