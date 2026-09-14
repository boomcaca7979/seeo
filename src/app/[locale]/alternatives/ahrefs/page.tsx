// ===== /alternatives/ahrefs（en）· /zh/alternatives/ahrefs（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import AlternativesPageContent from "@/components/AlternativesPageContent";

interface LocaleAhrefsAlternativePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleAhrefsAlternativePageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "alternativesAhrefs.meta" });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/alternatives/ahrefs", t("title"), t("description")),
  };
}

export default async function LocaleAhrefsAlternativePage({
  params,
}: LocaleAhrefsAlternativePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/alternatives/ahrefs" />
      <AlternativesPageContent
        namespace="alternativesAhrefs"
        path="/alternatives/ahrefs"
        competitor="Ahrefs"
      />
    </>
  );
}
