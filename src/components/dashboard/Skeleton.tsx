"use client";

import { useTranslations } from "next-intl";

interface SkeletonProps {
  rows?: number;
  className?: string;
}

export function TableSkeleton({ rows = 5, className = "" }: SkeletonProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-line-soft bg-card px-4 py-3"
        >
          <div className="h-3.5 w-1/4 rounded bg-line-soft" />
          <div className="h-3.5 w-16 rounded bg-line-soft" />
          <div className="h-3.5 w-12 rounded bg-line-soft" />
          <div className="h-3.5 w-20 rounded bg-line-soft" />
          <div className="ml-auto h-3.5 w-10 rounded bg-line-soft" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-end gap-2 ${className}`}>
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-line-soft"
          style={{ height: `${20 + Math.abs(Math.sin(i / 3)) * 60}%` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title?: string;
  hint?: string;
}) {
  const t = useTranslations("dashboard.shared.skeleton");
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line font-mono text-2xl text-ink-40">
        ∅
      </div>
      <div className="mt-3 font-sans text-sm font-medium text-ink">
        {title ?? t("emptyTitle")}
      </div>
      <div className="mt-1 font-sans text-xs text-ink-60">{hint ?? t("emptyHint")}</div>
    </div>
  );
}
