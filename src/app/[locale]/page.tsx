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
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import HreflangAlternates from "@/components/HreflangAlternates";
import { softwareApplicationSchema } from "@/lib/seo/schema";

interface LocaleHomePageProps {
  params: Promise<{ locale: string }>;
}

const homeMeta = {
  en: {
    title: "SeeO: Free SEO Audit Tool - Find, Fix & Verify Issues",
    description:
      "Run a free technical SEO audit without signup: SeeO crawls your real site, prioritizes what to fix first with reasons, and re-audits to verify. Rank tracking included.",
  },
  zh: {
    title: "SeeO：免费 SEO 审计工具——找出先修什么，修完再验证效果",
    description:
      "免注册运行一次真实的技术 SEO 审计：SeeO 用自建爬虫逐页抓取你的网站，执行 45 项技术检查，按 P0/P1/P2 优先级告诉你先修什么、依据是什么；修复之后重新审计，验证问题是否真的解决。关键词研究与每日排名追踪包含在内，让每一次修复都有据可查。",
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
      </main>
      <Footer />
    </>
  );
}
