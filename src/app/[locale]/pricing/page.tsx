// ===== /zh/pricing 骨架 =====
// Phase 0：复用现有中文定价页组件与基础 metadata，不做翻译。
// canonical/hreflang 按 locale 覆盖（en: /pricing · zh: /zh/pricing）。

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import PricingPage from "../../pricing/page";
import { metadata as pricingMetadata } from "../../pricing/layout";

interface LocalePricingPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocalePricingPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return {
    ...pricingMetadata,
    ...alternatesFor(loc, "/pricing"),
  };
}

export default async function LocalePricingPage({
  params,
}: LocalePricingPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PricingPage />;
}
