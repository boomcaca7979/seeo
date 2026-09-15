// ===== /tools/backlink-checker（en）· /zh/tools/backlink-checker（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import BacklinkCheckerToolPage from "../../../(default)/tools/backlink-checker/page";

interface LocaleBacklinkCheckerToolPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleBacklinkCheckerToolPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({
    locale: loc,
    namespace: "backlinkChecker.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/tools/backlink-checker", t("title"), t("description")),
  };
}

export default async function LocaleBacklinkCheckerToolPage({
  params,
}: LocaleBacklinkCheckerToolPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/tools/backlink-checker" />
      <BacklinkCheckerToolPage />
    </>
  );
}
