"use client";

// ===== Site Audit Dashboard 共享 UI 原语 =====
// 视觉 Token：error=红 / warning=橙 / notice=中性 / healthy=绿 / redirect=紫 / blocked=灰
// 所有颜色集中于此（与 chart-theme 一致），组件不得自造颜色。
// severity/health 始终带文字 + icon，不单靠颜色传达（可访问性）。

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PageHealth, RuleSeverity, ScoreGrade } from "@/lib/seo/audit-dashboard";

// ---------- 设计 Token（进入 Dashboard 共享层） ----------

export const SEVERITY_COLORS: Record<RuleSeverity, string> = {
  error: "#EF4444",
  warning: "#F59E0B",
  notice: "#9CA3AF",
};

export const HEALTH_COLORS: Record<PageHealth, string> = {
  healthy: "#22C55E",
  "needs-attention": "#F59E0B",
  critical: "#EF4444",
  redirect: "#8B5CF6",
  blocked: "#9CA3AF",
};

export const GRADE_COLORS: Record<ScoreGrade, string> = {
  excellent: "#22C55E",
  good: "#16A34A",
  "needs-attention": "#F59E0B",
  critical: "#EF4444",
};

/** 文字颜色 class（语义化，不依赖色值） */
export const SEVERITY_TEXT_CLASS: Record<RuleSeverity, string> = {
  error: "text-neg",
  warning: "text-warn",
  notice: "text-ink-40",
};

export const SEVERITY_BADGE_CLASS: Record<RuleSeverity, string> = {
  error: "badge-err",
  warning: "badge-warn",
  notice: "badge-info",
};

// ---------- Tooltip（原生 title，键盘可聚焦） ----------

export function Hint({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span
      className={`ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-line font-mono text-[0.625rem] leading-none text-ink-40 ${className}`}
      tabIndex={0}
      title={text}
      aria-label={text}
    >
      ?
    </span>
  );
}

// ---------- Severity / Health Badge（带文字，非纯颜色） ----------

export function SeverityBadge({
  severity,
  label,
}: {
  severity: RuleSeverity;
  label: string;
}) {
  return (
    <span className={SEVERITY_BADGE_CLASS[severity]}>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: SEVERITY_COLORS[severity] }}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function HealthBadge({
  health,
  label,
}: {
  health: PageHealth;
  label: string;
}) {
  const cls =
    health === "healthy"
      ? "badge-pos"
      : health === "critical"
        ? "badge-err"
        : health === "needs-attention" || health === "redirect"
          ? "badge-warn"
          : "badge-info";
  return (
    <span className={cls}>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: HEALTH_COLORS[health] }}
        aria-hidden
      />
      {label}
    </span>
  );
}

// ---------- 半圆 Health Gauge（主视觉） ----------

export function HealthGauge({
  score,
  gradeLabel,
  size = 190,
}: {
  score: number;
  gradeLabel: string;
  size?: number;
}) {
  const t = useTranslations("dashboard.audit");
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius; // 半圆
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = GRADE_COLORS[score >= 90 ? "excellent" : score >= 80 ? "good" : score >= 60 ? "needs-attention" : "critical"];

  return (
    <div className="relative inline-flex items-end justify-center" style={{ width: size, height: size / 2 + 28 }}>
      <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`} role="img" aria-label={`${t("healthTitle")} ${score} / 100`}>
        <path
          d={`M ${strokeWidth / 2 + 2} ${size / 2 + 10} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2 - 2} ${size / 2 + 10}`}
          fill="none"
          stroke="#ECE9DD"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={`M ${strokeWidth / 2 + 2} ${size / 2 + 10} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2 - 2} ${size / 2 + 10}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <div className="font-display text-4xl font-semibold tracking-tight text-ink">{score}</div>
        <div className="font-mono text-[0.6875rem] text-ink-40">{t("healthScoreLabel")} / 100</div>
        <div className="mt-0.5 font-sans text-sm font-semibold" style={{ color }}>
          {gradeLabel}
        </div>
      </div>
    </div>
  );
}

// ---------- KPI 卡片（可点击、带上下文与提示） ----------

export function StatTile({
  label,
  value,
  sub,
  hint,
  color,
  onClick,
  className = "",
  compact,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
  color?: string;
  onClick?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`card-a p-4 text-left ${onClick ? "cursor-pointer transition-colors hover:border-ink-25" : ""} ${className}`}
      aria-label={onClick ? label : undefined}
    >
      <div className="flex items-center font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">
        {label}
        {hint ? <Hint text={hint} /> : null}
      </div>
      <div className={`mt-1 font-mono font-semibold text-ink ${compact ? "text-xl" : "text-2xl"}`} style={color ? { color } : undefined}>
        {value}
      </div>
      {sub !== undefined ? <div className="mt-0.5 font-sans text-xs text-ink-40">{sub}</div> : null}
    </Comp>
  );
}

// ---------- 分段条（Page Health / HTTP Status 分布） ----------

export interface Segment {
  label: string;
  value: number;
  color: string;
}

export function SegmentedBar({ segments, height = 10 }: { segments: Segment[]; height?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return <div className="w-full rounded-full bg-line-soft" style={{ height }} />;
  }
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height }} role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
      {segments.map((s) =>
        s.value > 0 ? (
          <div
            key={s.label}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ) : null
      )}
    </div>
  );
}

// ---------- 通用指标行（分布图例） ----------

export function LegendRow({ segments, total }: { segments: Segment[]; total: number }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {segments.map((s) => (
        <div key={s.label} className="flex items-center justify-between gap-2 font-mono text-xs">
          <span className="flex items-center gap-1.5 text-ink-60">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </span>
          <span className="text-ink">
            {s.value}
            {total > 0 ? (
              <span className="text-ink-40"> ({Math.round((s.value / total) * 100)}%)</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- 分区卡片 ----------

export function SectionCard({
  title,
  subtitle,
  right,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card-a p-5 ${className}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-sans text-[0.9375rem] font-semibold text-ink">{title}</h3>
          {subtitle ? <p className="mt-0.5 font-sans text-xs text-ink-40">{subtitle}</p> : null}
        </div>
        {right ? <div className="flex-shrink-0">{right}</div> : null}
      </header>
      <div className={`mt-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

// ---------- 小百分比条 ----------

export function PctBar({ pct, color, label }: { pct: number; color: string; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      {label ? <span className="w-16 shrink-0 font-mono text-[0.6875rem] text-ink-40">{label}</span> : null}
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ---------- 空块 ----------

export function EmptyBlock({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line font-mono text-lg text-ink-40">∅</div>
      <div className="mt-2 font-sans text-sm font-medium text-ink-60">{title}</div>
      {hint ? <div className="mt-0.5 font-sans text-xs text-ink-40">{hint}</div> : null}
    </div>
  );
}

// ---------- 数字 ----------

export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}
