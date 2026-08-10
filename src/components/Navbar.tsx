"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAuthEnabled } from "@/lib/auth-config";

const navItems = [
  { label: "功能", href: "#features" },
  { label: "产品", href: "#dashboard" },
  { label: "定价", href: "/pricing" },
  { label: "文档", href: "/docs" },
];

export default function Navbar() {
  // 演示模式：开始分析直接进 /app；启用模式：进 /signup
  const primaryHref = isAuthEnabled ? "/signup" : "/app";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Escape 关闭移动端菜单
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // 展开时锁定背景滚动
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-ink/95 backdrop-blur-sm">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2" onClick={closeMobile}>
          <span className="font-display text-2xl font-bold tracking-tight text-d-text">
            See
          </span>
          <span className="font-display text-2xl font-bold tracking-tight text-gold">
            O
          </span>
        </Link>

        {/* 桌面端导航 */}
        <ul className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* 桌面端 CTA */}
        <div className="hidden items-center gap-3 md:flex">
          {isAuthEnabled && (
            <Link
              href="/login"
              className="text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
            >
              登录
            </Link>
          )}
          <Link
            href={primaryHref}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            开始分析
          </Link>
        </div>

        {/* 移动端汉堡按钮 */}
        <button
          type="button"
          aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          onClick={() => setMobileOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-d-secondary transition-colors hover:text-d-text md:hidden"
        >
          {mobileOpen ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </nav>

      {/* 移动端展开菜单 */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          className="border-t border-d-muted/15 bg-ink md:hidden"
        >
          <ul className="mx-auto flex max-w-7xl flex-col px-5 py-3 sm:px-8">
            {navItems.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  onClick={closeMobile}
                  className="block py-3 text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="mt-2 flex flex-col gap-3 border-t border-d-muted/15 pt-3">
              {isAuthEnabled && (
                <Link
                  href="/login"
                  onClick={closeMobile}
                  className="block py-2 text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
                >
                  登录
                </Link>
              )}
              <Link
                href={primaryHref}
                onClick={closeMobile}
                className="inline-flex items-center justify-center rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
              >
                开始分析
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
