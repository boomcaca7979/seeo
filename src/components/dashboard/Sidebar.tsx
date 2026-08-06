"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createBrowser } from "@/lib/supabase/browser";
import { isAuthEnabled } from "@/lib/auth-config";
import { useToast } from "@/components/dashboard/Toast";

type NavItem = {
  num: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  soon?: boolean;
};

const navItems: NavItem[] = [
  {
    num: "01",
    label: "工作台",
    href: "/app",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    num: "02",
    label: "关键词研究",
    href: "/app/keywords",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    num: "03",
    label: "排名追踪",
    href: "/app/rank-tracking",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <path d="M4 19V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4 19h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="m7 15 4-5 3 3 5-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    num: "04",
    label: "外链分析",
    href: "/app/backlinks",
    soon: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <path d="M9 15 15 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M11 7l1-1a4 4 0 0 1 6 6l-1 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 17l-1 1a4 4 0 0 1-6-6l1-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    num: "05",
    label: "技术审计",
    href: "/app/audit",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
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
    num: "06",
    label: "竞品分析",
    href: "/app/competitors",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="9" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 19c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 19c0-2.8 2.2-5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  {
    num: "07",
    label: "内容优化",
    href: "/app/content",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 9h7M8 13h7M8 17h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    num: "08",
    label: "报表",
    href: "/app/reports",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    num: "09",
    label: "设置",
    href: "/app/settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
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
  const pathname = usePathname();
  const router = useRouter();
  const { show, Toast } = useToast();

  const handleLogout = async () => {
    if (!isAuthEnabled) {
      show("当前为演示模式，账号系统未启用", "info");
      return;
    }
    const supabase = createBrowser();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const userName = displayName ?? "本地开发";
  const userEmail = email ?? "dev@seeo.local";
  const avatarLetter = userName.charAt(0).toUpperCase();

  return (
    <aside
      className={`flex flex-col bg-ink border-r border-white/5 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-white/5">
        <Link href="/app" className="flex items-center gap-1.5 overflow-hidden">
          <span className="font-display text-xl font-bold text-white whitespace-nowrap">
            See
          </span>
          <span className="font-display text-xl font-bold text-brand whitespace-nowrap">
            O
          </span>
        </Link>
        {!collapsed && (
          <span className="font-mono text-[10px] text-white/30">v1.0</span>
        )}
      </div>

      {/* 导航 */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto no-scrollbar">
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
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2.5 ${
                active
                  ? "text-brand"
                  : "text-white/60 hover:text-white"
              }`}
              style={active ? { backgroundColor: "rgba(255,212,0,0.06)" } : undefined}
            >
              {/* 高亮指示条 */}
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 bg-brand" />
              )}
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="font-mono text-[10px] text-white/30">
                    {item.num}
                  </span>
                  <span className="font-sans text-sm font-medium whitespace-nowrap">
                    {item.label}
                  </span>
                </>
              )}
              {!collapsed && item.soon && (
                <span
                  className="ml-auto font-mono text-[9px] text-white/40"
                  style={{ border: "1px solid currentColor", borderRadius: 2, padding: "1px 4px" }}
                >
                  soon
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 底部用户区 */}
      <div className="border-t border-white/5 px-3 py-3">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-brand font-mono text-xs font-bold text-ink">
              {avatarLetter}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-sans text-xs font-medium text-white truncate">
                {userName}
              </div>
              <div className="font-mono text-[10px] text-white/40 truncate">
                {userEmail}
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="退出登录"
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-white/40 hover:text-neg"
              aria-label="退出登录"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M15 12H4m0 0 4-4m-4 4 4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
        {collapsed && (
          <button
            onClick={handleLogout}
            title="退出登录"
            className="mx-auto flex h-8 w-8 items-center justify-center rounded text-white/40 hover:text-neg"
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
        className="flex h-10 items-center justify-center border-t border-white/5 text-white/30 hover:text-white/60"
        aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-3.5 w-3.5 ${collapsed ? "rotate-180" : ""}`}
        >
          <path
            d="M15 6l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <Toast />
    </aside>
  );
}
