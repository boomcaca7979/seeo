import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { CookieBanner } from "@/components/cookie-banner";
import JsonLd from "@/components/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";
import zhMessages from "../../../messages/zh.json";
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

const siteTitle = "SeeO · SEO 数据分析、排名追踪与审计平台";
const siteDescription =
  "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心功能。每日自动刷新排名数据，生成可视化审计报告，帮助你基于真实数据做出搜索优化决策，持续提升自然搜索流量。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: siteTitle,
  description: siteDescription,
  applicationName: "SeeO",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: "SeeO",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "SeeO · SEO 数据分析、排名追踪与审计平台",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
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
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-station text-y-text font-sans">
        {/* 全站实体：Organization + WebSite（真实字段，无编造数据） */}
        <JsonLd schema={organizationSchema()} />
        <JsonLd schema={websiteSchema()} />
        {/* legacy 中文页固定 zh locale（静态，无动态 API），保证 Navbar 等
            client 组件的 useTranslations 在无 [locale] 段的页面也能工作 */}
        <NextIntlClientProvider locale="zh" messages={zhMessages}>
          {children}
        </NextIntlClientProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
