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

// (default) 组承载工作台（/app）、支付结果与登录注册页——全部为私有/工具页，
// 不对搜索引擎开放索引（SEO 审计 S-03）。此处为兜底 metadata：EN 中性文案，
// 不输出营销 OpenGraph/Twitter（认证页各自的 page metadata 提供完整 OG），
// 避免出现审计 S-02 的「营销页元数据错挂到认证页」问题。
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "SeeO Account",
  description:
    "Sign in to SeeO to run technical SEO audits, track keyword rankings daily, and manage your projects.",
  applicationName: "SeeO",
  robots: {
    index: false,
    follow: true,
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
