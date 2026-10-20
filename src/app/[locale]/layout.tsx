// ===== [locale] root layout（双语营销页）=====
// Phase 1：/ 与 /pricing 的英文、/zh 与 /zh/pricing 的中文均由此布局承载。
// 与 (default)/layout.tsx（legacy 中文页）构成 multiple root layouts：
//   - 本布局：<html lang> 随 locale 变化（en → "en"，zh → "zh-CN"）
//   - metadata（title/description/og:locale）按 locale 输出
//   - 静态渲染：generateStaticParams + setRequestLocale（不使用 headers()）

import type { Metadata } from "next";
import { Montserrat, JetBrains_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { CookieBanner } from "@/components/cookie-banner";
import AnalyticsBootstrap from "@/components/analytics/AnalyticsBootstrap";
import JsonLd from "@/components/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";
import { routing } from "@/i18n/routing";
import { defaultLocale, type Locale } from "@/i18n/config";
import "../globals.css";

// 英文主字体：Montserrat（变量字体，build 时经 next/font 自托管）
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://www.seeo.asia";

const metaText: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "SeeO — SEO Tool: Site Audits, Rank Tracking & Keyword Research",
    description:
      "SeeO is an all-in-one SEO tool: technical site audits, daily rank tracking, keyword research, competitor and backlink analysis, and content optimization.",
  },
  zh: {
    title: "SeeO · 一站式 SEO 数据分析平台：关键词排名追踪与技术审计",
    description:
      "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心功能。每日自动刷新 Google 排名数据，生成可视化审计报告与健康评分，帮助你基于真实数据做出搜索优化决策，持续提升自然搜索流量。",
  },
};

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

// 支持静态渲染：为每个 locale 预渲染
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// 无效 locale 段（/de/pricing、/app/<未注册> …）在**路由层**就不匹配本树，
// 直接由 global-not-found 输出 404 文档。旧实现放无效段进树、再由页面 notFound()
// 冒泡，Next 对动态渲染的 notFound() 输出 __next_error__ 错误壳：无 <html lang>、
// <body> 为空、robots 标签与框架注入的 noindex 并存。dynamicParams=false 才是
// 「正确的路由 fallback」：错误语言根本进不了 locale 路由树，本布局也无需读 cookie。
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const loc: Locale = hasLocale(routing.locales, locale) ? locale : defaultLocale;
  const text = metaText[loc];

  // 兜底 metadata：仅 title/description/canonical。
  // robots / openGraph / twitter 不在此输出——Next metadata 为浅合并，页面级
  // openGraph 会整体覆盖 layout 字段（曾导致子页缺 og:image/og:type，审计 S-04）；
  // layout 级 robots 会与 not-found 页的手动 noindex meta 并存形成冲突指令
  // （审计 S-07）。营销页统一走 seoMetadata()（含 robots/OG/Twitter）。
  return {
    metadataBase: new URL(SITE_URL),
    title: text.title,
    description: text.description,
    applicationName: "SeeO",
    // canonical 兜底（页面级 generateMetadata 会覆盖各自 canonical）。
    // hreflang 不走 metadata API（Next 16 序列化为 camelCase hrefLang），
    // 由各页面的 <HreflangAlternates /> 渲染标准小写 <link>。
    alternates: {
      canonical: loc === "en" ? "/" : "/zh",
    },
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  // dynamicParams=false 已让无效 locale 段在路由层 404，本布局只收到 en/zh。
  // 这里的收窄只是类型层面的兜底：layout 不调用 notFound()（那会冒泡到全局
  // /_not-found，而 (default) layout 读取 cookies，多 root layouts 下运行时 500），
  // 也不读 cookie 决定 lang（本布局必须保持静态渲染，读 cookie 会整批营销页动态化）。

  // schema inLanguage 需要 Locale 类型：与 generateMetadata 相同的收窄
  const loc: Locale = hasLocale(routing.locales, locale) ? locale : defaultLocale;

  // 启用静态渲染。注意必须传规范化后的 loc（而非原始 locale）：
  // 无效 locale（如 /this-page-not-exist）若原样传入，not-found 边界里的
  // getLocale()/getTranslations() 会因校验失败回退到 request config 的
  // cookie/header 解析，污染静态渲染 store → 运行时 500（BUG-004 同类）。
  setRequestLocale(loc);
  const messages = await getMessages();

  return (
    <html
      lang={loc === "zh" ? "zh-CN" : "en"}
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink font-sans">
        {/* Google AdSense publisher code（React 19 将 async script 提升至 <head>，SSR 原始 HTML 可见；
            next/script 的 beforeInteractive 在本项目 Next 16 下仅输出 preload link，无法通过 AdSense 验证） */}
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4267926791604017"
          crossOrigin="anonymous"
        />
        {/* 全站实体：Organization + WebSite（真实字段，无编造数据） */}
        <JsonLd schema={organizationSchema(loc)} />
        <JsonLd schema={websiteSchema(loc)} />
        <NextIntlClientProvider messages={messages}>
          {children}
          {/* CookieBanner 在 Provider 内：文案随 locale 输出 en/zh */}
          <CookieBanner />
          <AnalyticsBootstrap />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
