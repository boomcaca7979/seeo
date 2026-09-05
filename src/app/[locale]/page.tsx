// ===== 首页（/ 英文 · /zh 中文）=====
// 原 src/app/page.tsx 组合内联至此（旧文件在 multiple root layouts 重构中移除）。
// 文案全部走 messages（en.json / zh.json），本文件只负责组合与 locale 接线。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FeatureCards from "@/components/FeatureCards";
import DashboardPreview from "@/components/DashboardPreview";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import HreflangAlternates from "@/components/HreflangAlternates";
import { softwareApplicationSchema } from "@/lib/seo/schema";

interface LocaleHomePageProps {
  params: Promise<{ locale: string }>;
}

const homeMeta = {
  en: {
    title: "SeeO — SEO Audits, Rank Tracking & Keyword Research",
    description:
      "SeeO is an all-in-one SEO platform: technical audits, daily rank tracking, keyword research, competitor and backlink analysis, and content optimization.",
  },
  zh: {
    title: "SeeO · 一站式 SEO 数据分析平台：关键词排名追踪与技术审计",
    description:
      "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心功能。每日自动刷新 Google 排名数据，生成可视化审计报告与健康评分，帮助你基于真实数据做出搜索优化决策，持续提升自然搜索流量。",
  },
} as const;

// 首页完整 metadata（title/desc + canonical + OG + Twitter + robots）：
// 页面级输出，不依赖 layout 兜底（layout 的 openGraph 会被页面浅合并覆盖）
export async function generateMetadata({
  params,
}: LocaleHomePageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const text = homeMeta[loc];
  return seoMetadata(loc, "/", text.title, text.description);
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
      </main>
      <Footer />
    </>
  );
}
