"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link as LocaleLink } from "@/i18n/routing";
import { isLocaleRoutedPath, stripLocalePrefix } from "@/i18n/locale-routed-paths";
import { localePath } from "@/i18n/seo";
import { isAuthEnabled } from "@/lib/auth-config";
import { createBrowser } from "@/lib/supabase/browser";

// 浏览器可见路径（"/pricing" 或 "/zh/pricing"）。SSG prerender 时
// usePathname 不可靠（client page 内返回 null / 内部 /en 路径），
// 用 useSyncExternalStore 读取 window.location.pathname（hydration-safe）
const subscribeNoop = () => () => {};

export default function Navbar() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const browserPath = useSyncExternalStore(
    subscribeNoop,
    () => window.location.pathname,
    () => null
  );
  const effectivePath = browserPath ?? pathname;

  // 演示模式：开始分析直接进 /app；启用模式：进 /signup
  const primaryHref = isAuthEnabled ? "/signup" : "/app";
  const [mobileOpen, setMobileOpen] = useState(false);

  // 导航项：label 走 messages；href 为逻辑路径，
  // locale-routed 页（pricing/docs）按 locale 加 /zh 前缀
  // 锚点链接：首页用本地锚点，非首页用完整路径（含 locale 前缀）
  const isHome = stripLocalePrefix(effectivePath ?? "/") === "/";
  const homePrefix = locale === "zh" ? "/zh" : "/";
  const navItems = [
    { label: t("features"), href: isHome ? "#features" : `${homePrefix}#features` },
    { label: t("product"), href: isHome ? "#dashboard" : `${homePrefix}#dashboard` },
    { label: t("pricing"), href: "/pricing", routed: true },
    { label: t("docs"), href: "/docs", routed: true },
  ];

  // 语言切换：仅在 locale-routed 路径显示（/ ↔ /zh、/pricing ↔ /zh/pricing）
  // 切换 URL 用 localePath 自算：en 侧永远无前缀（不会出现 /en）
  const showLangSwitch = effectivePath
    ? isLocaleRoutedPath(effectivePath)
    : false;
  const otherLocale = locale === "zh" ? "en" : "zh";
  const switchHref = localePath(
    otherLocale,
    stripLocalePrefix(effectivePath ?? "/")
  );

  // Session 感知：loading 时不渲染「登录」，避免已登录用户看到误导性登录入口
  const [authState, setAuthState] = useState<"loading" | "authed" | "anon">("loading");
  useEffect(() => {
    // 演示模式无需检测（无真实登录，CTA 已指向 /app）
    if (!isAuthEnabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createBrowser();
        const { data: { user } } = await supabase.auth.getUser();
        if (!cancelled) setAuthState(user ? "authed" : "anon");
      } catch {
        if (!cancelled) setAuthState("anon");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const showLogin = isAuthEnabled && authState === "anon";
  const ctaHref = authState === "authed" ? "/app" : primaryHref;

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
    <header className="sticky top-0 z-50 w-full bg-card/95 backdrop-blur-sm border-b border-line">
      <nav className="site-shell flex h-16 items-center justify-between px-5 sm:px-8">
        {/* Logo */}
        <LocaleLink href="/" className="flex items-center gap-2" onClick={closeMobile}>
          <span className="font-display text-2xl font-semibold tracking-tight text-ink">
            See
          </span>
          <span className="font-display text-2xl font-semibold tracking-tight text-accent">
            O
          </span>
        </LocaleLink>

        {/* 桌面端导航 */}
        <ul className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => {
            const isActive = item.routed && effectivePath
              ? stripLocalePrefix(effectivePath) === item.href
              : false;
            return (
            <li key={item.href}>
              {item.routed ? (
                <LocaleLink
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`text-sm font-medium transition-colors hover:text-ink ${isActive ? "text-ink" : "text-ink-60"}`}
                >
                  {item.label}
                </LocaleLink>
              ) : (
                <a
                  href={item.href}
                  className={`text-sm font-medium transition-colors hover:text-ink ${isActive ? "text-ink" : "text-ink-60"}`}
                >
                  {item.label}
                </a>
              )}
            </li>
            );
          })}
        </ul>

        {/* 桌面端 CTA */}
        <div className="hidden items-center gap-3 md:flex">
          {showLangSwitch && (
            <Link
              href={switchHref}
              className="font-mono text-xs font-medium text-ink-60 transition-colors hover:text-ink"
            >
              {t("switchLang")}
            </Link>
          )}
          {showLogin && (
            <Link
              href="/login"
              className="text-sm font-medium text-ink-60 transition-colors hover:text-ink"
            >
              {t("login")}
            </Link>
          )}
          <Link
            href={ctaHref}
            className="btn-primary"
          >
            {t("cta")}
          </Link>
        </div>

        {/* 移动端汉堡按钮 */}
        <button
          type="button"
          aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          onClick={() => setMobileOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-60 transition-colors hover:text-ink md:hidden"
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
          className="border-t border-line bg-card md:hidden"
        >
          <ul className="site-shell flex flex-col px-5 py-3 sm:px-8">
            {navItems.map((item) => {
              const isActive = item.routed && effectivePath
                ? stripLocalePrefix(effectivePath) === item.href
                : false;
              const linkClass = `block py-3 text-sm font-medium transition-colors hover:text-ink ${isActive ? "text-ink" : "text-ink-60"}`;
              return (
              <li key={item.href}>
                {item.routed ? (
                  <LocaleLink
                    href={item.href}
                    onClick={closeMobile}
                    aria-current={isActive ? "page" : undefined}
                    className={linkClass}
                  >
                    {item.label}
                  </LocaleLink>
                ) : (
                  <a
                    href={item.href}
                    onClick={closeMobile}
                    aria-current={isActive ? "page" : undefined}
                    className={linkClass}
                  >
                    {item.label}
                  </a>
                )}
              </li>
              );
            })}
            <li className="mt-2 flex flex-col gap-3 border-t border-line pt-3">
              {showLangSwitch && (
                <Link
                  href={switchHref}
                  onClick={closeMobile}
                  className="block py-2 font-mono text-xs font-medium text-ink-60 transition-colors hover:text-ink"
                >
                  {t("switchLang")}
                </Link>
              )}
              {showLogin && (
                <Link
                  href="/login"
                  onClick={closeMobile}
                  className="block py-2 text-sm font-medium text-ink-60 transition-colors hover:text-ink"
                >
                  {t("login")}
                </Link>
              )}
              <Link
                href={ctaHref}
                onClick={closeMobile}
                className="btn-primary w-full"
              >
                {t("cta")}
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
