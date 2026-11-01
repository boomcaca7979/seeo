"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { localePath } from "@/i18n/seo";

type NavChild = {
  labelKey: "keywordOverview" | "keywordMagic" | "keywordStrategy" | "keywordSaved";
  href: string;
};

type NavItem = {
  labelKey:
    | "overview"
    | "opportunities"
    | "actions"
    | "keywordResearch"
    | "positionTracking"
    | "rankCheck"
    | "audit"
    | "competitors"
    | "content"
    | "backlinks"
    | "reports"
    | "settings";
  href: string;
  icon: React.ReactNode;
  /** 二级导航：有 children 时父项是展开/收起开关，children 是可点击链接 */
  children?: readonly NavChild[];
};

const KEYWORD_CHILDREN: readonly NavChild[] = [
  { labelKey: "keywordOverview", href: "/app/keyword-overview" },
  { labelKey: "keywordMagic", href: "/app/keyword-magic" },
  { labelKey: "keywordStrategy", href: "/app/keyword-strategy" },
  { labelKey: "keywordSaved", href: "/app/keyword-saved" },
];

const navItems: NavItem[] = [
  {
    labelKey: "overview",
    href: "/app",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    labelKey: "opportunities",
    href: "/app/opportunities",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6L13 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    labelKey: "actions",
    href: "/app/actions",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="m8 12 2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    labelKey: "keywordResearch",
    href: "/app/keyword-overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    children: KEYWORD_CHILDREN,
  },
  {
    labelKey: "positionTracking",
    href: "/app/position-tracking",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M4 19V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4 19h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="m7 15 4-5 3 3 5-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    labelKey: "rankCheck",
    href: "/app/rank-check",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M11 8v3l2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    labelKey: "audit",
    href: "/app/audit",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
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
    labelKey: "competitors",
    href: "/app/competitors",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="9" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 19c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 19c0-2.8 2.2-5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  {
    labelKey: "content",
    href: "/app/content",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 9h7M8 13h7M8 17h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    labelKey: "backlinks",
    href: "/app/backlinks",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M9 15 15 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M11 7l1-1a4 4 0 0 1 6 6l-1 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 17l-1 1a4 4 0 0 1-6-6l1-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    labelKey: "reports",
    href: "/app/reports",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    labelKey: "settings",
    href: "/app/settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

interface SidebarProps {
  /** 移动端（<lg）抽屉开合状态；桌面端 sidebar 常驻 */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// 账户入口统一在 Topbar 右上角用户菜单（唯一入口）：侧边栏只负责导航与折叠。

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("dashboard.sidebar");
  const locale = useLocale() as "en" | "zh";
  // 分组展开状态：默认收起；子路由命中时自动展开（初始化时求值一次即可，
  // 因为组内切换不会改变"组是否激活"这一事实）
  const [keywordOpen, setKeywordOpen] = useState(() =>
    KEYWORD_CHILDREN.some(
      (c) => pathname === c.href || pathname.startsWith(`${c.href}/`)
    )
  );

  return (
    <aside
      className={`flex h-screen flex-none flex-col border-r border-line bg-card ${
        collapsed ? "w-16" : "w-60"
      } fixed inset-y-0 left-0 z-50 transition-[transform,visibility] duration-150 lg:static lg:translate-x-0 lg:visible ${
        // BUG-18：收起的抽屉只是 translate 出屏，visibility 仍为 visible →
        // 移动端 Tab 的前 10 个焦点全部落在看不见的导航链接上（实测 390px）。
        // 用 invisible 把它移出焦点与无障碍树；lg:visible 保证桌面端常驻不受影响。
        mobileOpen ? "translate-x-0" : "-translate-x-full invisible"
      }`}
    >
      {/* Logo：点击返回营销首页（EN → / · ZH → /zh，复用 localePath） */}
      <div className="flex h-16 flex-none items-center justify-between border-b border-line px-4">
        <Link
          href={localePath(locale, "/")}
          onClick={onMobileClose}
          aria-label="SeeO home"
          className="flex items-center gap-2 overflow-hidden"
        >
          <span className="text-lg font-semibold tracking-tight text-ink">
            See
          </span>
          <span className="text-lg font-semibold tracking-tight text-accent">
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
          const groupActive = item.children
            ? item.children.some(
                (c) => pathname === c.href || pathname.startsWith(`${c.href}/`)
              )
            : false;

          // 带二级导航的分组项：父项为展开/收起按钮
          if (item.children) {
            const open = keywordOpen;
            return (
              <div key={item.href}>
                <button
                  type="button"
                  onClick={() => {
                    if (collapsed) {
                      // 收起态下图标不足以承载子导航：先展开侧边栏再展开分组
                      setCollapsed(false);
                      setKeywordOpen(true);
                      return;
                    }
                    setKeywordOpen((o) => !o);
                  }}
                  aria-expanded={open}
                  title={collapsed ? t(item.labelKey) : undefined}
                  className={`group relative mb-0.5 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    groupActive
                      ? "bg-line-soft font-semibold text-ink"
                      : "font-medium text-ink-60 hover:bg-line-soft/60 hover:text-ink"
                  }`}
                >
                  {groupActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 bg-ink" />
                  )}
                  <span className="flex-shrink-0">{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 whitespace-nowrap text-left">
                        {t(item.labelKey)}
                      </span>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        className={`h-3.5 w-3.5 flex-shrink-0 text-ink-40 transition-transform ${open ? "rotate-90" : ""}`}
                        aria-hidden="true"
                      >
                        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </>
                  )}
                </button>
                {/* 二级导航：展开时渲染；子项缩进 + 小号文字 */}
                {open && !collapsed && (
                  <div role="group" aria-label={t(item.labelKey)}>
                    {item.children.map((child) => {
                      const childActive =
                        pathname === child.href ||
                        pathname.startsWith(`${child.href}/`);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onMobileClose}
                          className={`mb-0.5 flex items-center gap-2 rounded-md py-1.5 pl-11 pr-3 text-sm transition-colors ${
                            childActive
                              ? "bg-line-soft font-semibold text-ink"
                              : "font-medium text-ink-60 hover:bg-line-soft/60 hover:text-ink"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                              childActive ? "bg-ink" : "bg-ink-25"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="whitespace-nowrap">{t(child.labelKey)}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? t(item.labelKey) : undefined}
              onClick={onMobileClose}
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
                <span className="whitespace-nowrap">{t(item.labelKey)}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 折叠按钮（仅桌面） */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="hidden h-9 flex-none items-center justify-center border-t border-line text-ink-40 hover:bg-line-soft hover:text-ink lg:flex"
        aria-label={collapsed ? t("expand") : t("collapse")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-3.5 w-3.5 ${collapsed ? "rotate-180" : ""}`}
        >
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </aside>
  );
}
