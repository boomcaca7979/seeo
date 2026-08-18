// ===== /features/backlink-analysis（en）· /zh/features/backlink-analysis（zh）=====
// 复用 (default)/features/backlink-analysis/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale, localeToOgLocale } from "@/i18n/config";
import { alternatesFor, localeUrl } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import BacklinkAnalysisFeaturePage from "../../../(default)/features/backlink-analysis/page";

interface LocaleBacklinksPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleBacklinksPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "backlinks.meta" });
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      url: localeUrl(loc, "/features/backlink-analysis"),
      title: t("title"),
      description: t("description"),
      locale: localeToOgLocale[loc],
    },
    ...alternatesFor(loc, "/features/backlink-analysis"),
  };
}

export default async function LocaleBacklinksPage({
  params,
}: LocaleBacklinksPageProps) {
  const { locale } = await params;
  // 无效 locale 段（如 /foobar 命中 [locale]）→ 404（[locale]/not-found.tsx）
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      {/* 标准小写 hreflang（React hoist 到 <head>） */}
      <HreflangAlternates path="/features/backlink-analysis" />
      <BacklinkAnalysisFeaturePage />
    </>
  );
}
