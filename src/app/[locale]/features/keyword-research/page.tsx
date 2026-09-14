// ===== /features/keyword-research（en）· /zh/features/keyword-research（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import KeywordResearchFeaturePage from "../../../(default)/features/keyword-research/page";

interface LocaleKeywordResearchPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleKeywordResearchPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "keywordResearch.meta" });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/features/keyword-research", t("title"), t("description")),
  };
}

export default async function LocaleKeywordResearchPage({
  params,
}: LocaleKeywordResearchPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/features/keyword-research" />
      <KeywordResearchFeaturePage />
    </>
  );
}
