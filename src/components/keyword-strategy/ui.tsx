// 关键词策略构造器 · 共享原子组件（意图条 / KD 值 / 状态徽标 / 按钮）
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { IntentMix } from "@/lib/seo/strategy-model";

export const INTENT_COLORS = ["#94a5f5", "#ffb020", "#37e3b5"] as const;
export const INTENT_LABELS = ["Informational", "Commercial", "Transactional"] as const;

export function IntentBar({ mix, label }: { mix: IntentMix; label: string }) {
  const total = mix[0] + mix[1] + mix[2];
  const title =
    total === 0
      ? "No intent data"
      : mix
          .map((v, i) => (v > 0 ? `${INTENT_LABELS[i]} ${v}%` : null))
          .filter(Boolean)
          .join(" · ");
  return (
    <div
      className="flex h-1.5 w-full max-w-[104px] items-center gap-px overflow-hidden rounded-full bg-[#eceeed]"
      title={title}
      aria-label={`${label} ${title}`}
    >
      {total > 0 &&
        mix.map((v, i) =>
          v > 0 ? (
            <span
              key={INTENT_LABELS[i]}
              className="h-full rounded-full"
              style={{ width: `${v}%`, backgroundColor: INTENT_COLORS[i] }}
            />
          ) : null
        )}
    </div>
  );
}

/** KD：null 显示「—」（无 provider 数据，绝不填 0） */
export function KdValue({ kd }: { kd: number | null }) {
  if (kd === null) return <span className="text-[#8a8c89]">—</span>;
  const good = kd < 30;
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
      <span>{Math.round(kd)}</span>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${good ? "bg-[#00aa7d]" : "bg-[#ffab00]"}`} aria-hidden="true" />
    </span>
  );
}

export type PageBadge = "high-potential" | "high-relevance";

export function PageBadgeTag({ kind }: { kind: PageBadge }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-[#c3f4e9] px-2 text-[0.75rem] leading-none text-[#00845f]">
      {kind === "high-potential" ? "High potential" : "High relevance"}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };
type OutlineBtnProps = BtnProps & { compact?: boolean };

/** 结果页顶部的白色描边按钮（Share / Add keywords / Export / Actions） */
export function OutlineButton({ className = "", compact = false, children, ...rest }: OutlineBtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex ${compact ? "h-6" : "h-8"} items-center justify-center gap-1.5 rounded-sm border border-[#d6d8d7] bg-white px-3 text-[0.8125rem] text-[#1a1e19] transition-colors hover:bg-[#f7f8f7] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 表格行尾的黑色主操作按钮 */
export function SolidButton({ className = "", children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center justify-center rounded-sm bg-[#191c19] px-2 text-[0.8125rem] font-medium whitespace-nowrap text-white transition-colors hover:bg-black disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({ className = "", children, ...rest }: BtnProps) {
  return (
    <button type="button" className={`text-[0.8125rem] text-[#245ee2] hover:underline ${className}`} {...rest}>
      {children}
    </button>
  );
}
