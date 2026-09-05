// ===== /features/rank-tracking（en）· /zh/features/rank-tracking（zh）=====
// 复用 (default)/features/rank-tracking/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import RankTrackingFeaturePage from "../../../(default)/features/rank-tracking/page";

interface LocaleRankTrackingPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleRankTrackingPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "rankTracking.meta" });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/features/rank-tracking", t("title"), t("description")),
  };
}

export default async function LocaleRankTrackingPage({
  params,
}: LocaleRankTrackingPageProps) {
  const { locale } = await params;
  // 无效 locale 段（如 /foobar 命中 [locale]）→ 404（[locale]/not-found.tsx）
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      {/* 标准小写 hreflang（React hoist 到 <head>） */}
      <HreflangAlternates path="/features/rank-tracking" />
      <RankTrackingFeaturePage />
    </>
  );
}
