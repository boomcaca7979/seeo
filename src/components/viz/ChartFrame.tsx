// ===== 共享图表外框（统一标题 / 口径 / 图例 / 空状态 / 高度） =====
// 无 hooks、无 i18n：文案由调用方按 locale 传入。
// 空状态是"一等公民"：数据不足以形成图表时必须显式声明，绝不绘制虚构曲线。

import type { ReactNode } from "react";
import { TONE_COLOR, type VizTone } from "./tokens";

export interface ChartLegendItem {
  label: string;
  tone: VizTone;
  value?: string | number;
  /** 可选：直接指定色值（覆盖 tone 映射），供精修页面使用；不传则保持既有映射 */
  color?: string;
}

export interface ChartFrameProps {
  title: ReactNode;
  /** 数据口径说明（时间范围 / 统计对象），必须写清 */
  subtitle?: ReactNode;
  right?: ReactNode;
  legend?: ChartLegendItem[];
  /** true = 数据不足，渲染空状态而非图表 */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  /** 空状态下的可执行入口 */
  emptyAction?: ReactNode;
  /** 图表本体（单独占据固定高度，避免挤压下方注解） */
  chart?: ReactNode;
  /** 图表区高度（配合 chart 使用） */
  chartHeight?: number;
  /** 兼容写法：仅含图表时可直接用 height + children */
  height?: number;
  /** 图表下方的补充信息（状态徽标、口径注解、筛选入口等） */
  children?: ReactNode;
  /**
   * 空状态是否显示圆形图标底：
   *   true（默认）= 既有页面保持不变；false = 只留文字与入口，去掉装饰性圆形
   */
  showEmptyIcon?: boolean;
  className?: string;
  bodyClassName?: string;
}

function ChartEmptyBlock({
  title,
  hint,
  action,
  showIcon = true,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  showIcon?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-4 py-8 text-center ${
        showIcon ? "" : "py-7"
      }`}
    >
      {showIcon ? (
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-40">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
            <path
              d="M4 19h16M7 16V9m5 7V5m5 11v-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.5"
            />
          </svg>
        </div>
      ) : (
        <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ink-40">
          —
        </span>
      )}
      <div className={`${showIcon ? "mt-2" : "mt-1"} font-sans text-sm font-medium text-ink-60`}>
        {title}
      </div>
      {hint ? <div className="mt-1 max-w-sm font-sans text-xs text-ink-40">{hint}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export default function ChartFrame({
  title,
  subtitle,
  right,
  legend,
  isEmpty = false,
  emptyTitle = "",
  emptyHint,
  emptyAction,
  chart,
  chartHeight,
  height,
  children,
  showEmptyIcon = true,
  className = "",
  bodyClassName = "",
}: ChartFrameProps) {
  const resolvedChartHeight = chartHeight ?? height;
  const hasChart = chart !== undefined;
  return (
    <section className={`card-a p-5 ${className}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
          {subtitle ? (
            <p className="mt-0.5 font-sans text-xs text-ink-40">{subtitle}</p>
          ) : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </header>

      <div className={`mt-4 ${bodyClassName}`}>
        {isEmpty ? (
          <ChartEmptyBlock title={emptyTitle} hint={emptyHint} action={emptyAction} showIcon={showEmptyIcon} />
        ) : hasChart ? (
          <>
            {resolvedChartHeight !== undefined ? (
              <div style={{ height: resolvedChartHeight }}>{chart}</div>
            ) : (
              chart
            )}
            {children}
          </>
        ) : resolvedChartHeight !== undefined ? (
          <div style={{ height: resolvedChartHeight }}>{children}</div>
        ) : (
          children
        )}
      </div>

      {!isEmpty && legend && legend.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-soft pt-3">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 font-mono text-xs text-ink-60">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: l.color ?? TONE_COLOR[l.tone] }}
                aria-hidden
              />
              <span>{l.label}</span>
              {l.value !== undefined ? (
                <span className="font-semibold text-ink">{l.value}</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
