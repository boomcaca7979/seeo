// ===== /pricing（en）· /zh/pricing（zh）=====
// 复用 (default)/pricing/page 的客户端组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { localePath, seoMetadata } from "@/i18n/seo";
import { getDefaultPlanInfo } from "@/lib/billing";
import JsonLd from "@/components/JsonLd";
import HreflangAlternates from "@/components/HreflangAlternates";
import { breadcrumbSchema } from "@/lib/seo/schema";
import PricingPage from "../../(default)/pricing/page";

interface LocalePricingPageProps {
  params: Promise<{ locale: string }>;
}

const pricingMeta = {
  en: {
    title: "SeeO Pricing: Free, Lite & Pro Plans",
    description:
      "SeeO pricing: Free, Lite, and Pro plans. Start free, upgrade anytime — rank tracking, technical SEO audits, keyword research, and content optimization.",
    ogAlt: "SeeO Pricing",
  },
  zh: {
    title: "SeeO 定价方案：免费版、Lite 版与专业版套餐额度对比",
    description:
      "SeeO 定价方案：免费版适合起步验证，Lite 版与专业版解锁更多关键词追踪、技术审计、内容检查与竞品分析额度，专业版另含外链分析与报告导出能力。按需选择套餐，随时升级或续费，购买前可免费试用全部核心功能，再决定是否付费升级，结账流程简单清晰。",
    ogAlt: "SeeO 定价",
  },
} as const;

export async function generateMetadata({
  params,
}: LocalePricingPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const text = pricingMeta[loc];
  return seoMetadata(loc, "/pricing", text.title, text.description);
}

export default async function LocalePricingPage({
  params,
}: LocalePricingPageProps) {
  const { locale } = await params;
  // 无效 locale 段（如 /foobar 命中 [locale]）→ 404（[locale]/not-found.tsx）
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const loc = locale;
  return (
    <>
      {/* 标准小写 hreflang（React hoist 到 <head>） */}
      <HreflangAlternates path="/pricing" />
      {/* 面包屑按 locale 输出（zh 指向 /zh 与 /zh/pricing） */}
      <JsonLd
        schema={breadcrumbSchema(
          [
            { name: loc === "zh" ? "首页" : "Home", url: localePath(loc, "/") },
            { name: loc === "zh" ? "定价" : "Pricing", url: localePath(loc, "/pricing") },
          ],
          loc
        )}
      />
      {/* 服务端注入套餐价格（与 /api/plans fallback、JSON-LD Offer 同源）：
          首屏价格随 SSR HTML 输出，客户端挂载后经 /api/plans 刷新 DB 覆盖值 */}
      <PricingPage initialPlans={getDefaultPlanInfo()} />
    </>
  );
}
