// ===== /pricing（en）· /zh/pricing（zh）=====
// 复用 (default)/pricing/page 的客户端组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { isLocale, localeToOgLocale } from "@/i18n/config";
import { alternatesFor, localePath, localeUrl } from "@/i18n/seo";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";
import PricingPage from "../../(default)/pricing/page";

interface LocalePricingPageProps {
  params: Promise<{ locale: string }>;
}

const pricingMeta = {
  en: {
    title: "Pricing · SeeO",
    description:
      "SeeO pricing: Free, Lite, and Pro plans. Start free, upgrade anytime — rank tracking, technical SEO audits, keyword research, and content optimization.",
    ogAlt: "SeeO Pricing",
  },
  zh: {
    title: "定价 · SeeO",
    description:
      "SeeO 定价方案：免费版、Lite 版、专业版。按需选择关键词追踪、技术审计与竞品分析功能。",
    ogAlt: "SeeO 定价",
  },
} as const;

export async function generateMetadata({
  params,
}: LocalePricingPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const text = pricingMeta[loc];
  return {
    title: text.title,
    description: text.description,
    openGraph: {
      url: localeUrl(loc, "/pricing"),
      title: text.title,
      description: text.description,
      locale: localeToOgLocale[loc],
    },
    ...alternatesFor(loc, "/pricing"),
  };
}

export default async function LocalePricingPage({
  params,
}: LocalePricingPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = isLocale(locale) ? locale : "en";
  return (
    <>
      {/* 面包屑按 locale 输出（zh 指向 /zh 与 /zh/pricing） */}
      <JsonLd
        schema={breadcrumbSchema([
          { name: loc === "zh" ? "首页" : "Home", url: localePath(loc, "/") },
          { name: loc === "zh" ? "定价" : "Pricing", url: localePath(loc, "/pricing") },
        ])}
      />
      <PricingPage />
    </>
  );
}
