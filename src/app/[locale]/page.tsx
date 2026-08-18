// ===== 首页（/ 英文 · /zh 中文）=====
// 原 src/app/page.tsx 组合内联至此（旧文件在 multiple root layouts 重构中移除）。
// 文案全部走 messages（en.json / zh.json），本文件只负责组合与 locale 接线。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import FeatureCards from "@/components/FeatureCards";
import DashboardPreview from "@/components/DashboardPreview";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import HreflangAlternates from "@/components/HreflangAlternates";
import { softwareApplicationSchema } from "@/lib/seo/schema";

interface LocaleHomePageProps {
  params: Promise<{ locale: string }>;
}

// canonical/hreflang 按 locale 输出（en: / · zh: /zh + 双向 hreflang）
export async function generateMetadata({
  params,
}: LocaleHomePageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return alternatesFor(loc, "/");
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
        <Ticker />
        <FeatureCards />
        <DashboardPreview />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
