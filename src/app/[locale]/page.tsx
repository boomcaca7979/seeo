// ===== 首页（/ 英文 · /zh 中文）=====
// 原 src/app/page.tsx 组合内联至此（旧文件在 multiple root layouts 重构中移除）。
// 文案全部走 messages（en.json / zh.json），本文件只负责组合与 locale 接线。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { isLocale, defaultLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import { notFoundPageMetadata } from "@/lib/not-found-meta";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FeatureCards from "@/components/FeatureCards";
import DashboardPreview from "@/components/DashboardPreview";
import HomeUseCases from "@/components/HomeUseCases";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import HreflangAlternates from "@/components/HreflangAlternates";
import { softwareApplicationSchema } from "@/lib/seo/schema";

interface LocaleHomePageProps {
  params: Promise<{ locale: string }>;
}

const homeMeta = {
  en: {
    title: "SeeO: All-in-One SEO Toolkit — Keywords, Rankings & Audits",
    description:
      "SeeO is an all-in-one SEO toolkit and analytics platform: technical audits with prioritized fixes, keyword research with intent labels, daily rank tracking, competitor analysis and content optimization.",
  },
  zh: {
    title: "SeeO：综合 SEO 工具平台——关键词、排名与技术审计",
    description:
      "SeeO 是综合 SEO 工具与数据分析平台：技术审计逐页检查并给出修复优先级，关键词研究扩展选词并标注意图，每日排名追踪验证效果，另有竞品分析与内容优化。",
  },
} as const;

// 首页完整 metadata（title/desc + canonical + OG + Twitter + robots）：
// 页面级输出，不依赖 layout 兜底（layout 的 openGraph 会被页面浅合并覆盖）
export async function generateMetadata({
  params,
}: LocaleHomePageProps): Promise<Metadata> {
  const { locale } = await params;
  // 无效 locale 段 → 本页组件里 notFound()。metadata 也必须同步输出 404：
  // 客户端 hydration 只按路由树（layout + page）解析 metadata，不看 not-found 边界，
  // 少了这一行首屏正确的 404 标题会被首页营销标题覆盖。
  if (!isLocale(locale)) return notFoundPageMetadata(defaultLocale);
  const text = homeMeta[locale];
  return seoMetadata(locale, "/", text.title, text.description);
}

export default async function LocaleHomePage({ params }: LocaleHomePageProps) {
  const { locale } = await params;
  // 无效 locale 段（如 /foobar 命中 [locale]）→ 404（[locale]/not-found.tsx）
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const loc = locale;
  return (
    <>
      {/* 标准小写 hreflang（React hoist 到 <head>） */}
      <HreflangAlternates path="/" />
      {/* 首页产品实体：SoftwareApplication（价格来自 PLAN_PRICING 单一来源，语言随 locale） */}
      <JsonLd schema={softwareApplicationSchema(loc)} />
      <Navbar />
      <main className="flex-1">
        <Hero />
        <FeatureCards />
        <DashboardPreview />
        <HomeUseCases />
      </main>
      <Footer />
    </>
  );
}
