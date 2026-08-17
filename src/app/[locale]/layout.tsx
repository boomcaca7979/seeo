// ===== [locale] 布局（营销页双语路由骨架）=====
// Phase 0：仅建立 locale 上下文与静态渲染参数，不翻译任何业务页面。
// <html lang> 仍由上层根 layout 输出（当前全站内容为中文，lang="zh-CN" 语义正确；
// 英文内容在 Phase 1 迁移时切换，避免用 headers() 读取 locale 导致全站
// 动态渲染、破坏静态页面输出）。

import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

// 支持静态渲染：为每个 locale 预渲染
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // 启用静态渲染
  setRequestLocale(locale);

  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
