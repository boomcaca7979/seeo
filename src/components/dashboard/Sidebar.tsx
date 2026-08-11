"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowser } from "@/lib/supabase/browser";
import { isAuthEnabled } from "@/lib/auth-config";
import { useToast } from "@/components/dashboard/Toast";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  lite: "Lite",
  pro: "Pro",
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

const navItems: NavItem[] = [
  {
    label: "概览",
    href: "/app",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    label: "关键词概览",
    href: "/app/keyword-overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "拓词建议",
    href: "/app/keyword-expand",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "位置追踪",
    href: "/app/position-tracking",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <path d="M4 19V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4 19h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="m7 15 4-5 3 3 5-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "实时查排名",
    href: "/app/rank-check",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M11 8v3l2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "技术审计",
    href: "/app/audit",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <path d="M12 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M5.6 5.6 7.7 7.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16.3 16.3l2.1 2.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M3 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M18 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    label: "竞品分析",
    href: "/app/competitors",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="9" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 19c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 19c0-2.8 2.2-5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  {
    label: "内容优化",
    href: "/app/content",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 9h7M8 13h7M8 17h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "外链分析",
    href: "/app/backlinks",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <path d="M9 15 15 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M11 7l1-1a4 4 0 0 1 6 6l-1 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 17l-1 1a4 4 0 0 1-6-6l1-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "报告中心",
    href: "/app/reports",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "设置",
    href: "/app/settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

interface SidebarProps {
  displayName?: string;
  email?: string;
}

export default function Sidebar({ displayName, email }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const pathname = usePathname();
  const { show, Toast } = useToast();

  // 拉取当前用户套餐（用于显示套餐标识和升级 CTA）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/account/usage", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && json?.data?.plan) {
          setCurrentPlan(json.data.plan as string);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    if (!isAuthEnabled) {
      show("当前为演示模式，账号系统未启用", "info");
      return;
    }
    const supabase = createBrowser();
    // await 完成后再导航，避免导航中断 logout 请求（ERR_ABORTED）
    await supabase.auth.signOut({ scope: "global" });
    // 等待浏览器完全关闭 fetch 连接，避免导航中止底层 TCP
    await new Promise((resolve) => setTimeout(resolve, 200));
    window.location.assign("/login");
  };

  const userName = displayName ?? "本地开发";
  const userEmail = email ?? "dev@seeo.local";
  const avatarLetter = userName.charAt(0).toUpperCase();
  const planLabel = PLAN_LABELS[currentPlan] ?? currentPlan;
  // free / lite 显示升级 CTA；pro 不显示
  const showUpgradeCta = currentPlan === "free" || currentPlan === "lite";

  return (
    <aside
      className={`flex h-screen flex-none flex-col border-r border-line bg-card ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo */}
      <div className="flex h-16 flex-none items-center justify-between border-b border-line px-4">
        <Link href="/app" className="flex items-center gap-1.5 overflow-hidden">
          <span className="text-lg font-bold tracking-tight text-ink">
            See
          </span>
          <span className="text-lg font-bold tracking-tight text-ink">
            O
          </span>
        </Link>
      </div>

      {/* 导航：内部可滚动 */}
      <nav className="no-scrollbar flex-1 overflow-y-auto px-2 py-3">
        {navItems.map((item) => {
          const active =
            item.href === "/app"
              ? pathname === "/app"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`group relative mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-line-soft font-semibold text-ink"
                  : "font-medium text-ink-60 hover:bg-line-soft/60 hover:text-ink"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 bg-ink" />
              )}
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && (
                <span className="whitespace-nowrap">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 套餐标识 + 升级 CTA（仅 free 用户显示升级按钮） */}
      {!collapsed && (
        <div className="flex-none px-3 pb-2">
          <div className="rounded-lg border border-line-soft bg-paper px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-ink-40">当前套餐</span>
              <span className="font-sans text-xs font-medium text-ink">{planLabel}</span>
            </div>
            {showUpgradeCta && (
              <Link
                href="/pricing"
                className="mt-2 block w-full rounded-md bg-ink py-1.5 text-center font-sans text-xs font-medium text-card transition-colors hover:bg-ink/90"
              >
                升级套餐 →
              </Link>
            )}
          </div>
        </div>
      )}
      {collapsed && showUpgradeCta && (
        <div className="flex-none px-2 pb-1">
          <Link
            href="/pricing"
            title="升级套餐"
            className="flex h-7 w-full items-center justify-center rounded bg-ink text-card"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
              <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Link>
        </div>
      )}

      {/* 底部用户区：始终固定底部 */}
      <div className="flex-none border-t border-line px-3 py-3">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-card">
              {avatarLetter}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-ink">
                {userName}
              </div>
              <div className="truncate text-[10px] text-ink-40">
                {userEmail}
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="退出登录"
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-ink-40 hover:bg-line-soft hover:text-neg"
              aria-label="退出登录"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M15 12H4m0 0 4-4m-4 4 4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            title="退出登录"
            className="mx-auto flex h-8 w-8 items-center justify-center rounded text-ink-40 hover:bg-line-soft hover:text-neg"
            aria-label="退出登录"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M15 12H4m0 0 4-4m-4 4 4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* 折叠按钮 */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-9 flex-none items-center justify-center border-t border-line text-ink-40 hover:bg-line-soft hover:text-ink"
        aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-3.5 w-3.5 ${collapsed ? "rotate-180" : ""}`}
        >
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <Toast />
    </aside>
  );
}
