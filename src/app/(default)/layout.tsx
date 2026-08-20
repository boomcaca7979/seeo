import type { Metadata } from "next";
import { Montserrat, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { CookieBanner } from "@/components/cookie-banner";
import JsonLd from "@/components/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";
import { localeToHtmlLang } from "@/i18n/config";
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

// (default) 组承载工作台（/app）、支付结果与登录注册页（均自带或 robots 禁抓）；
// 此处为兜底 metadata，须与 [locale]/layout.tsx 营销首页的 title/description 区分
const siteTitle = "SeeO SEO 工作台：关键词研究、排名追踪与技术审计工具平台";
const siteDescription =
  "SeeO 工作台整合关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心模块。登录后可管理多个项目、监控关键词排名的每日变化、执行站点技术审计并导出可视化报告，所有数据集中在一个后台，方便你与团队协作完成日常 SEO 优化与数据复盘工作。";

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

// 本布局承载 /app（dashboard）、/login、/signup、/payment 等无 [locale] 段路由：
// UI locale 由 NEXT_LOCALE cookie → Accept-Language → en 解析（见 src/i18n/request.ts），
// 同一 URL 下输出 EN/ZH，不做双 URL。
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // BUG-004：未知根路径命中静态 /_not-found 壳时本 layout 仍会渲染，
  // getLocale() 内部 headers() 在静态上下文抛 DYNAMIC_SERVER_USAGE → 500。
  // 捕获后回退默认语言，保证 404 壳正常输出；动态路由（/app、/login 等）
  // cookies()/headers() 正常可用，行为不变。
  let locale: string;
  try {
    locale = await getLocale();
  } catch (err) {
    if (err instanceof Error && (err as Error & { digest?: string }).digest === "DYNAMIC_SERVER_USAGE") {
      locale = "en";
    } else {
      throw err;
    }
  }
  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return (
    <html
      lang={localeToHtmlLang[locale as "en" | "zh"] ?? "en"}
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink font-sans">
        {/* 全站实体：Organization + WebSite（真实字段，无编造数据） */}
        <JsonLd schema={organizationSchema()} />
        <JsonLd schema={websiteSchema()} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
