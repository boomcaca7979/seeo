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
import JsonLd from "@/components/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";
import { routing } from "@/i18n/routing";
import { defaultLocale, localeToOgLocale, type Locale } from "@/i18n/config";
import { localeUrl } from "@/i18n/seo";
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

const metaText: Record<Locale, { title: string; description: string; ogAlt: string }> = {
  en: {
    title: "SeeO — SEO Audits, Rank Tracking & Keyword Research",
    description:
      "SeeO is an all-in-one SEO platform: technical audits, daily rank tracking, keyword research, competitor and backlink analysis, and content optimization.",
    ogAlt: "SeeO — SEO Audits, Rank Tracking & Keyword Research",
  },
  zh: {
    title: "SeeO · 一站式 SEO 数据分析平台：关键词排名追踪与技术审计",
    description:
      "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心功能。每日自动刷新 Google 排名数据，生成可视化审计报告与健康评分，帮助你基于真实数据做出搜索优化决策，持续提升自然搜索流量。",
    ogAlt: "SeeO · 一站式 SEO 数据分析平台：关键词排名追踪与技术审计",
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

export async function generateMetadata({
  params,
}: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const loc: Locale = hasLocale(routing.locales, locale) ? locale : defaultLocale;
  const text = metaText[loc];

  return {
    metadataBase: new URL(SITE_URL),
    title: text.title,
    description: text.description,
    applicationName: "SeeO",
    openGraph: {
      type: "website",
      locale: localeToOgLocale[loc],
      url: localeUrl(loc, "/"),
      siteName: "SeeO",
      title: text.title,
      description: text.description,
      images: [
        {
          url: "/og.jpg",
          width: 1200,
          height: 630,
          alt: text.ogAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: text.title,
      description: text.description,
      images: ["/og.jpg"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
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
  // 无效 locale 的 404 由各页面 notFound() 触发（[locale]/not-found.tsx 承接），
  // layout 不再 notFound()：那会冒泡到全局 /_not-found（(default) layout 读取
  // cookies，多 root layouts 下运行时 500）。

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
        </NextIntlClientProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
