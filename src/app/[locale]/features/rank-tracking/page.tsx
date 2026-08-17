// ===== /features/rank-tracking（en）· /zh/features/rank-tracking（zh）=====
// 复用 (default)/features/rank-tracking/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale, localeToOgLocale } from "@/i18n/config";
import { alternatesFor, localeUrl } from "@/i18n/seo";
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
    openGraph: {
      url: localeUrl(loc, "/features/rank-tracking"),
      title: t("title"),
      description: t("description"),
      locale: localeToOgLocale[loc],
    },
    ...alternatesFor(loc, "/features/rank-tracking"),
  };
}

export default async function LocaleRankTrackingPage({
  params,
}: LocaleRankTrackingPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RankTrackingFeaturePage />;
}
