// ===== /guides/how-to-track-keyword-rankings（en）· /zh/guides/how-to-track-keyword-rankings（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import GuideKeywordRankingsPage from "../../../(default)/guides/how-to-track-keyword-rankings/page";

interface LocaleGuideKeywordRankingsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleGuideKeywordRankingsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({
    locale: loc,
    namespace: "guideKeywordRankings.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(
      loc,
      "/guides/how-to-track-keyword-rankings",
      t("title"),
      t("description")
    ),
  };
}

export default async function LocaleGuideKeywordRankingsPage({
  params,
}: LocaleGuideKeywordRankingsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/guides/how-to-track-keyword-rankings" />
      <GuideKeywordRankingsPage />
    </>
  );
}
