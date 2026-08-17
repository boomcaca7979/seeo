// ===== /zh/docs 骨架 =====
// Phase 0：复用现有中文文档页组件与基础 metadata，不做翻译。
// canonical/hreflang 按 locale 覆盖（en: /docs · zh: /zh/docs）。

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import DocsPage, { metadata as docsMetadata } from "../../docs/page";

interface LocaleDocsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleDocsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return {
    ...docsMetadata,
    ...alternatesFor(loc, "/docs"),
  };
}

export default async function LocaleDocsPage({
  params,
}: LocaleDocsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DocsPage />;
}
