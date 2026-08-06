"use client";

import Link from "next/link";
import { isAuthEnabled } from "@/lib/auth-config";

const navItems = [
  { label: "功能", href: "#features" },
  { label: "仪表盘", href: "#dashboard" },
  { label: "定价", href: "#cta" },
  { label: "文档", href: "#footer" },
];

export default function Navbar() {
  // 演示模式：开始分析直接进 /app；启用模式：进 /signup
  const primaryHref = isAuthEnabled ? "/signup" : "/app";

  return (
    <header className="sticky top-0 z-50 w-full bg-ink/95 backdrop-blur-sm">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="font-display text-2xl font-bold tracking-tight text-d-text">
            See
          </span>
          <span className="font-display text-2xl font-bold tracking-tight text-gold">
            O
          </span>
        </Link>

        {/* 导航项 */}
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

        {/* CTA */}
        <div className="flex items-center gap-3">
          {/* 演示模式隐藏登录入口 */}
          {isAuthEnabled && (
            <Link
              href="/login"
              className="hidden text-sm font-medium text-d-secondary transition-colors hover:text-d-text sm:inline"
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
      </nav>
    </header>
  );
}
