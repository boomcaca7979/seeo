// ===== Owner Console 共享展示组件 =====
// 目标：信息密度高、能 10 秒判断经营状态；不是营销页，不做大图/动画/AI 面板。
// 视觉沿用站点设计 token（bg-paper / bg-card / border-line / text-ink-*）。

import Link from "next/link";
import type { ReactNode } from "react";

// ---------- 格式化 ----------

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function formatUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatMoney(cents: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  const sign = cents < 0 ? "-" : "";
  const amount = (Math.abs(cents) / 100).toFixed(2);
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${amount} ${currency}`;
}

export function formatPct(ratio: number | null | undefined, digits = 2): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 时间戳 → 紧凑可读（UTC 数据，展示保留原始时间，不做时区臆测） */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "");
}

// ---------- 基础块 ----------

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-card ${className}`}>{children}</div>
  );
}

export function Section({
  title,
  description,
  meta,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-card ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-ink-40">{description}</p>
          ) : null}
        </div>
        {meta ? <div className="text-xs text-ink-40">{meta}</div> : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  source,
  tone = "default",
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  source?: string;
  tone?: "default" | "warn" | "good" | "muted";
  /** 环比徽章；tone 语义 = 涨好（good）/跌坏（bad）/中性（muted） */
  delta?: { text: string; tone: "good" | "bad" | "muted" };
}) {
  const toneClass =
    tone === "warn"
      ? "text-warn"
      : tone === "good"
        ? "text-pos"
        : tone === "muted"
          ? "text-ink-40"
          : "text-ink";
  const deltaClass =
    delta?.tone === "good"
      ? "text-pos"
      : delta?.tone === "bad"
        ? "text-neg"
        : "text-ink-40";
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-3">
      <div className="text-xs font-medium text-ink-40">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {delta ? (
        <div className={`mt-1 text-xs font-medium ${deltaClass}`}>{delta.text}</div>
      ) : null}
      {hint ? <div className="mt-1 text-xs text-ink-40">{hint}</div> : null}
      {source ? (
        <div className="mt-1 text-xs leading-4 text-ink-40">{source}</div>
      ) : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const map: Record<string, string> = {
    neutral: "border-line bg-line-soft text-ink-60",
    good: "border-pos/30 bg-pos/10 text-pos",
    warn: "border-warn/30 bg-warn/10 text-warn",
    bad: "border-neg/30 bg-neg/10 text-neg",
    info: "border-accent/30 bg-accent/10 text-accent",
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/** 数据源不可用时的统一呈现（绝不显示 0 冒充） */
export function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-line-soft/60 px-3 py-2 text-xs text-ink-40">
      暂不可用 — {reason}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-ink-40">
      {children}
    </div>
  );
}

// ---------- 表格 ----------

export interface Column<T> {
  key: string;
  title: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  width?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyText = "暂无数据",
  compact = false,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyText?: string;
  compact?: boolean;
}) {
  if (rows.length === 0) return <Empty>{emptyText}</Empty>;
  const pad = compact ? "px-2 py-1.5" : "px-3 py-2";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${pad} text-xs font-medium text-ink-40 ${c.align === "right" ? "text-right" : ""}`}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="hover:bg-line-soft/50">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${pad} border-b border-line-soft align-top text-ink-60 ${
                    c.align === "right" ? "text-right tabular-nums" : ""
                  }`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 迷你趋势图（SVG，服务端渲染，无客户端依赖） ----------

export function TrendBars({
  values,
  labels,
  height = 40,
  color = "var(--color-brand)",
  formatValue,
}: {
  values: number[];
  labels: string[];
  height?: number;
  color?: string;
  formatValue?: (v: number) => string;
}) {
  if (values.length === 0) return <div className="text-xs text-ink-40">无数据</div>;
  const max = Math.max(...values, 1);
  const width = Math.max(values.length * 24, 240);
  const gap = 3;
  const barWidth = Math.max(2, width / values.length - gap);
  // 日期轴取首 / 中 / 尾三个刻度，30 天窗口也不会挤在一起
  const mid = Math.floor(values.length / 2);
  const tick = (i: number) => (labels[i] ?? "").slice(5); // MM-DD
  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-10 w-full"
        role="img"
        aria-label="趋势图"
      >
        {values.map((v, i) => {
          const h = max > 0 ? Math.round((v / max) * (height - 2)) : 0;
          return (
            <rect
              key={`${labels[i] ?? i}-${i}`}
              x={i * (barWidth + gap)}
              y={height - h}
              width={barWidth}
              height={Math.max(h, v > 0 ? 1 : 0)}
              fill={color}
              opacity={v > 0 ? 0.85 : 0}
            >
              <title>{`${labels[i] ?? ""}: ${formatValue ? formatValue(v) : v}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-ink-40">
        <span>{tick(0)}</span>
        <span>{values.length > 2 ? tick(mid) : ""}</span>
        <span className="text-ink-60">峰值 {formatValue ? formatValue(max) : max}</span>
        <span>{tick(values.length - 1)}</span>
      </div>
    </div>
  );
}

/** 窗口切换；默认 近24小时 / 近7天 / 近30天（1 天窗口按滚动 24 小时统计，非自然日） */
export function WindowSwitcher({
  current,
  basePath,
  extraQuery,
  windows = [
    { days: 1, label: "近24小时" },
    { days: 7, label: "近7天" },
    { days: 30, label: "近30天" },
  ],
}: {
  current: number;
  basePath: string;
  extraQuery?: Record<string, string>;
  windows?: Array<{ days: number; label: string }>;
}) {
  const build = (days: number) => {
    const sp = new URLSearchParams({ ...(extraQuery ?? {}), days: String(days) });
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line">
      {windows.map((w) => (
        <Link
          key={w.days}
          href={build(w.days)}
          className={`px-3 py-1 text-xs font-medium ${
            current === w.days
              ? "bg-brand text-white"
              : "bg-card text-ink-60 hover:bg-line-soft"
          }`}
        >
          {w.label}
        </Link>
      ))}
    </div>
  );
}
