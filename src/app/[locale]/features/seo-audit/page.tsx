// ===== /zh/features/seo-audit 骨架 =====
// Phase 0：复用现有中文功能页组件与基础 metadata，不做翻译。
// canonical/hreflang 按 locale 覆盖（en: /features/seo-audit · zh: /zh/features/seo-audit）。

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import SeoAuditFeaturePage, {
  metadata as seoAuditMetadata,
} from "../../../(default)/features/seo-audit/page";

interface LocaleSeoAuditPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleSeoAuditPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return {
    ...seoAuditMetadata,
    ...alternatesFor(loc, "/features/seo-audit"),
  };
}

export default async function LocaleSeoAuditPage({
  params,
}: LocaleSeoAuditPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SeoAuditFeaturePage />;
}
