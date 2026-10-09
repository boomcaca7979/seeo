"use client";

// ===== Owner Console 外壳（左侧主导航 + 顶部身份）=====
// 刻意与产品工作台（/app）分离：这是 owner 的经营控制台，不是面向用户的产品后台。

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin", label: "经营概览", hint: "今日经营状态" },
  { href: "/admin/customers", label: "客户管理", hint: "谁注册了、付了多少钱" },
  { href: "/admin/revenue", label: "收入分析", hint: "订阅收入 + 广告收入" },
  { href: "/admin/growth", label: "流量分析", hint: "搜索与转化" },
  { href: "/admin/data-sources", label: "数据来源", hint: "接入状态" },
];

export default function AdminShell({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-card lg:flex">
          <div className="border-b border-line px-4 py-4">
            <div className="text-sm font-semibold text-ink">SeeO 经营后台</div>
            <div className="mt-0.5 text-xs text-ink-40">老板专属 · 全中文经营视图</div>
          </div>
          <nav className="flex-1 p-2">
            {NAV.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mb-0.5 block rounded-md px-3 py-2 text-sm ${
                    active
                      ? "bg-brand text-white"
                      : "text-ink-60 hover:bg-line-soft hover:text-ink"
                  }`}
                >
                  <div className="font-medium">{item.label}</div>
                  <div
                    className={`text-xs ${active ? "text-white/70" : "text-ink-40"}`}
                  >
                    {item.hint}
                  </div>
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-line px-4 py-3 text-xs text-ink-40">
            <div className="truncate" title={email}>
              {email}
            </div>
            <div className="mt-1 text-ink-40">noindex · 仅 owner 可见</div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* 移动端横向导航 */}
          <div className="flex items-center gap-2 overflow-x-auto border-b border-line bg-card px-3 py-2 lg:hidden">
            {NAV.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-md px-3 py-1 text-xs ${
                    active ? "bg-brand text-white" : "text-ink-60"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="border-b border-line bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-base font-semibold text-ink">
                {NAV.find((n) =>
                  n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href)
                )?.label ?? "经营后台"}
              </h1>
              <div className="text-xs text-ink-40">
                数据源与口径见{" "}
                <Link href="/admin/data-sources" className="text-accent hover:underline">
                  数据来源
                </Link>
              </div>
            </div>
          </div>
          <main className="mx-auto w-full max-w-[1400px] px-4 py-4">{children}</main>
        </div>
      </div>
    </div>
  );
}
