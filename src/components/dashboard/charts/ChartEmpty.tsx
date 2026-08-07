"use client";

interface ChartEmptyProps {
  message?: string;
  hint?: string;
}

/** 图表空态：无数据时统一显示 */
export default function ChartEmpty({
  message = "暂无数据",
  hint,
}: ChartEmptyProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-40">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path d="M3 12h18M12 3v18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.3" />
        </svg>
      </div>
      <div className="mt-2 text-xs font-medium text-ink-60">{message}</div>
      {hint && <div className="mt-0.5 text-[10px] text-ink-40">{hint}</div>}
    </div>
  );
}
