"use client";

import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  height?: number;
  children: ReactNode;
  className?: string;
}

/** 图表统一外层卡片：白底 + 细边框 + 圆角 8px + 标题栏 */
export default function ChartCard({
  title,
  subtitle,
  right,
  height,
  children,
  className = "",
}: ChartCardProps) {
  return (
    <div className={`card-a p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-ink-40 truncate">{subtitle}</p>
          )}
        </div>
        {right && <div className="flex-shrink-0">{right}</div>}
      </div>
      {height !== undefined ? (
        <div className="mt-4" style={{ height }}>
          {children}
        </div>
      ) : (
        <div className="mt-4">{children}</div>
      )}
    </div>
  );
}
