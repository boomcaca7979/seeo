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
    title: "SeeO — Find the SEO Problem Worth Fixing First, Then Verify the Fix",
    description:
      "Run a free technical SEO audit of your real site. SeeO tells you which issue is worth fixing first and why, and re-audits after your fix to verify whether it's actually resolved.",
  },
  zh: {
    title: "SeeO · 找出最值得先处理的 SEO 问题，修完再验证",
    description:
      "免费审计你的真实网站：SeeO 告诉你哪个技术问题最值得先处理、依据是什么；修复之后重新审计，验证问题是否真的解决。真实抓取、真实证据，不估算流量、不承诺排名。",
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
