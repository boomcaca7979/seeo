// ===== 共享分布条 + 图例（优先级分布 / 验证状态分布 / 页面健康分布） =====
// 无 hooks、无 i18n。所有段落都带文字标签与数值，不单靠颜色。

import type { ReactNode } from "react";
import { TONE_COLOR, type VizTone } from "./tokens";

export interface DistributionSegment {
  key: string;
  label: string;
  value: number;
  tone: VizTone;
  href?: string;
  onClick?: () => void;
}

export function DistributionBar({
  segments,
  height = 10,
  label,
}: {
  segments: DistributionSegment[];
  height?: number;
  label: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return <div className="w-full rounded-full bg-line-soft" style={{ height }} aria-hidden />;
  }
  return (
    <div
      className="flex w-full overflow-hidden rounded-full"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      {segments.map((s) =>
        s.value > 0 ? (
          <div
            key={s.key}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: TONE_COLOR[s.tone] }}
            title={`${s.label}: ${s.value}`}
          />
        ) : null
      )}
    </div>
  );
}

export function DistributionLegend({
  segments,
  total,
  showPercent = true,
  columns = 3,
}: {
  segments: DistributionSegment[];
  total?: number;
  showPercent?: boolean;
  columns?: 2 | 3;
}) {
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0);
  return (
    <div
      className={`grid gap-x-4 gap-y-1.5 ${
        columns === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"
      }`}
    >
      {segments.map((s) => {
        const content: ReactNode = (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-ink-60">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: TONE_COLOR[s.tone] }}
                aria-hidden
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 text-ink">
              {s.value}
              {showPercent && sum > 0 ? (
                <span className="text-ink-40"> ({Math.round((s.value / sum) * 100)}%)</span>
              ) : null}
            </span>
          </>
        );
        const cls =
          "flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 font-mono text-xs";
        return s.onClick || s.href ? (
          <button key={s.key} onClick={s.onClick} className={`${cls} transition-colors hover:bg-line-soft/60`}>
            {content}
          </button>
        ) : (
          <div key={s.key} className={cls}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
