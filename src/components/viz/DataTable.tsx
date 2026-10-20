// ===== 共享数据表格原语（表头 / 行高 / 数字对齐 / 操作列统一）=====
// 无 hooks、无 i18n。桌面端使用真表格；移动端请改用调用方的紧凑卡片列表，
// 不要把整张表压到窄屏（避免横向溢出）。

import type { ReactNode } from "react";

export function DataTable({
  children,
  className = "",
  minWidthRem = 48,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  minWidthRem?: number;
  ariaLabel?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={ariaLabel}
        className={`w-full border-collapse text-left ${className}`}
        style={{ minWidth: `${minWidthRem}rem` }}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-line">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  width,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
}) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={`px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wide text-ink-40 ${alignClass} ${className}`}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-line-soft transition-colors ${
        onClick ? "cursor-pointer hover:bg-line-soft/50" : ""
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = "left",
  numeric = false,
  className = "",
  colSpan,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  /** 数字列：等宽 + 右对齐 + 表格数字对齐（tabular-nums） */
  numeric?: boolean;
  className?: string;
  colSpan?: number;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-3 align-middle text-sm ${numeric ? "font-mono tabular-nums" : ""} ${a} ${className}`}
    >
      {children}
    </td>
  );
}
