// ===== 共享页面头部（面包屑 / 标题 / 辅助说明 / 工具栏 / 元信息条）=====
// 三个页面使用同一排布：面包屑 → [标题 …… 操作入口] → 说明 → 元信息条。

import type { ReactNode } from "react";
import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  crumbs?: Crumb[];
  title: ReactNode;
  subtitle?: ReactNode;
  /** 现有系统支持的操作入口（按钮/链接），右对齐 */
  actions?: ReactNode;
  /** 元信息条（域名 · 审计时间 · 范围 ……），等宽小字一行排布 */
  meta?: ReactNode;
  className?: string;
}

export default function PageHeader({
  crumbs,
  title,
  subtitle,
  actions,
  meta,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={className}>
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink-40">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden>/</span> : null}
              {c.href ? (
                <Link href={c.href} className="hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className="text-ink-60">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 font-sans text-sm text-ink-60">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {meta ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line pb-3 font-mono text-xs text-ink-40">
          {meta}
        </div>
      ) : null}
    </div>
  );
}
