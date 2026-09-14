// ===== /features/competitor-analysis（en）· /zh/features/competitor-analysis（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import CompetitorAnalysisFeaturePage from "../../../(default)/features/competitor-analysis/page";

interface LocaleCompetitorAnalysisPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleCompetitorAnalysisPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "competitorAnalysis.meta" });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/features/competitor-analysis", t("title"), t("description")),
  };
}

export default async function LocaleCompetitorAnalysisPage({
  params,
}: LocaleCompetitorAnalysisPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/features/competitor-analysis" />
      <CompetitorAnalysisFeaturePage />
    </>
  );
}
