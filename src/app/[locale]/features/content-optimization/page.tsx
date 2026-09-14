// ===== /features/content-optimization（en）· /zh/features/content-optimization（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import ContentOptimizationFeaturePage from "../../../(default)/features/content-optimization/page";

interface LocaleContentOptimizationPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleContentOptimizationPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "contentOptimization.meta" });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/features/content-optimization", t("title"), t("description")),
  };
}

export default async function LocaleContentOptimizationPage({
  params,
}: LocaleContentOptimizationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/features/content-optimization" />
      <ContentOptimizationFeaturePage />
    </>
  );
}
