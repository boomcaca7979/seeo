// ===== 首页（/ 英文 · /zh 中文）=====
// 原 src/app/page.tsx 组合内联至此（旧文件在 multiple root layouts 重构中移除，
// 内容零变化）；英文文案替换在 Phase 1 进行。

import type { Metadata } from "next";
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
  setRequestLocale(locale);
  return (
    <>
      {/* 首页产品实体：SoftwareApplication（价格来自 PLAN_PRICING 单一来源） */}
      <JsonLd schema={softwareApplicationSchema()} />
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
