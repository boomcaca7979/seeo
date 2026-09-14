// ===== /guides/how-to-analyze-backlinks（en）· /zh/guides/how-to-analyze-backlinks（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import GuideBacklinkAnalysisPage from "../../../(default)/guides/how-to-analyze-backlinks/page";

interface LocaleGuideBacklinkAnalysisPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleGuideBacklinkAnalysisPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({
    locale: loc,
    namespace: "guideBacklinkAnalysis.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(
      loc,
      "/guides/how-to-analyze-backlinks",
      t("title"),
      t("description")
    ),
  };
}

export default async function LocaleGuideBacklinkAnalysisPage({
  params,
}: LocaleGuideBacklinkAnalysisPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/guides/how-to-analyze-backlinks" />
      <GuideBacklinkAnalysisPage />
    </>
  );
}
