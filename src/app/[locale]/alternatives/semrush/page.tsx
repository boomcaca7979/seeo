// ===== /alternatives/semrush（en）· /zh/alternatives/semrush（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import AlternativesPageContent from "@/components/AlternativesPageContent";

interface LocaleSemrushAlternativePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleSemrushAlternativePageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "alternativesSemrush.meta" });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/alternatives/semrush", t("title"), t("description")),
  };
}

export default async function LocaleSemrushAlternativePage({
  params,
}: LocaleSemrushAlternativePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/alternatives/semrush" />
      <AlternativesPageContent
        namespace="alternativesSemrush"
        path="/alternatives/semrush"
        competitor="Semrush"
      />
    </>
  );
}
