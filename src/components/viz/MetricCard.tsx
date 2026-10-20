"use client";

// ===== 共享关键指标卡（/app、/app/audit 概览、问题摘要共用）=====
//
// 统一的信息层级（三页一致）：
//   ① 标签（mono 小字，含口径提示）
//   ② 数值（页面上最大的数字层级）+ 单位
//   ③ 辅助信息（真实口径说明，如"较上次审计 +3"）
//   ④ 状态位（统一徽标；无状态时该行不占位）
//
// 诚实降级：value === null 表示"该口径当前无法得出"，必须传入 unavailableLabel /
// unavailableReason，卡片显示文字说明而不是 0 / 100%。

import type { ReactNode } from "react";
import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import { TONE_TEXT_CLASS, type VizTone } from "./tokens";

export interface MetricCardProps {
  label: string;
  /** null = 无法得出（显示 unavailableLabel，不用 0 冒充） */
  value: ReactNode | null;
  unit?: string;
  caption?: ReactNode;
  /** 数值语义色；不传 = 主要文字色 */
  tone?: VizTone;
  /** 口径提示（悬停/聚焦可见） */
  hint?: string;
  href?: string;
  onClick?: () => void;
  /** value === null 时的替换文案 */
  unavailableLabel?: string;
  /** value === null 时的原因说明 */
  unavailableReason?: string;
  /** 状态位（统一徽标语义） */
  status?: { label: string; tone: VizTone } | null;
  /** 次要卡片（用于问题摘要等紧凑区） */
  compact?: boolean;
  /**
   * 口径提示的呈现方式：
   *   chip  = 小圆形「?」芯片（默认，既有页面保持不变）
   *   plain = 标签本身带虚线下划线与悬停说明，**不使用任何圆形装饰**
   */
  hintStyle?: "chip" | "plain";
  className?: string;
}

function CardBody({
  label,
  value,
  unit,
  caption,
  tone,
  hint,
  unavailableLabel,
  unavailableReason,
  status,
  compact,
  hintStyle = "chip",
}: Omit<MetricCardProps, "href" | "onClick" | "className">) {
  const empty = value === null || value === undefined;
  return (
    <>
      <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-wide text-ink-40">
        {hint && hintStyle === "plain" ? (
          <span
            className="cursor-help truncate decoration-dotted underline decoration-line underline-offset-2"
            title={hint}
            tabIndex={0}
            aria-label={hint}
          >
            {label}
          </span>
        ) : (
          <span className="truncate">{label}</span>
        )}
        {hint && hintStyle === "chip" ? (
          <span
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-[0.625rem] leading-none text-ink-40"
            tabIndex={0}
            title={hint}
            aria-label={hint}
          >
            ?
          </span>
        ) : null}
      </div>

      {empty ? (
        <div className="mt-1">
          <div className="font-sans text-lg font-semibold text-ink-40">
            {unavailableLabel ?? "—"}
          </div>
          {unavailableReason ? (
            <div className="mt-0.5 font-sans text-xs text-ink-40">{unavailableReason}</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 flex items-baseline gap-1">
          <span
            className={`font-display font-semibold tracking-tight ${
              compact ? "text-2xl" : "text-3xl"
            } ${tone ? TONE_TEXT_CLASS[tone] : "text-ink"}`}
          >
            {value}
          </span>
          {unit ? <span className="font-mono text-xs text-ink-40">{unit}</span> : null}
        </div>
      )}

      {caption ? (
        <div className="mt-1 font-sans text-xs text-ink-60">{caption}</div>
      ) : null}

      {status ? (
        <div className="mt-2">
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
      ) : null}
    </>
  );
}

export default function MetricCard({
  href,
  onClick,
  className = "",
  ...body
}: MetricCardProps) {
  const base = `card-a block p-4 text-left ${className}`;
  if (href) {
    return (
      <Link href={href} className={`${base} transition-colors hover:border-ink-25`}>
        <CardBody {...body} />
      </Link>
    );
  }
  if (onClick) {
    return (
      <button onClick={onClick} className={`${base} transition-colors hover:border-ink-25`}>
        <CardBody {...body} />
      </button>
    );
  }
  return (
    <div className={base}>
      <CardBody {...body} />
    </div>
  );
}
