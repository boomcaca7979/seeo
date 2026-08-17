// ===== [locale] root layout（双语营销页）=====
// Phase 1：/ 与 /pricing 的英文、/zh 与 /zh/pricing 的中文均由此布局承载。
// 与 (default)/layout.tsx（legacy 中文页）构成 multiple root layouts：
//   - 本布局：<html lang> 随 locale 变化（en → "en"，zh → "zh-CN"）
//   - metadata（title/description/og:locale）按 locale 输出
//   - 静态渲染：generateStaticParams + setRequestLocale（不使用 headers()）

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { CookieBanner } from "@/components/cookie-banner";
import JsonLd from "@/components/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";
import { routing } from "@/i18n/routing";
import { defaultLocale, localeToHreflang, localeToOgLocale, type Locale } from "@/i18n/config";
import { localeUrl } from "@/i18n/seo";
import "../globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
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
      "Audit your website, track search rankings, research keywords, and uncover SEO opportunities with SeeO.",
    ogAlt: "SeeO — SEO Audits, Rank Tracking & Keyword Research",
  },
  zh: {
    title: "SeeO · SEO 数据分析、排名追踪与审计平台",
    description:
      "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心功能。每日自动刷新排名数据，生成可视化审计报告，帮助你基于真实数据做出搜索优化决策，持续提升自然搜索流量。",
    ogAlt: "SeeO · SEO 数据分析、排名追踪与审计平台",
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
    // 双向 hreflang（页面级 generateMetadata 会覆盖各自 canonical）
    alternates: {
      canonical: loc === "en" ? "/" : "/zh",
      languages: {
        [localeToHreflang.en]: localeUrl("en", "/"),
        [localeToHreflang.zh]: localeUrl("zh", "/"),
        "x-default": localeUrl("en", "/"),
      },
    },
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // 启用静态渲染
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale === "zh" ? "zh-CN" : "en"}
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-station text-y-text font-sans">
        {/* 全站实体：Organization + WebSite（真实字段，无编造数据） */}
        <JsonLd schema={organizationSchema()} />
        <JsonLd schema={websiteSchema()} />
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
