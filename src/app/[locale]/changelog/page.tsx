// ===== /changelog（en）· /zh/changelog（zh）=====
// 复用 (default)/changelog/page 内容组件；本文件负责 locale 接线与双语 metadata。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import ChangelogPage from "../../(default)/changelog/page";

interface LocaleChangelogPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleChangelogPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "changelogPage.meta" });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(loc, "/changelog", t("title"), t("description")),
  };
}

export default async function LocaleChangelogPage({
  params,
}: LocaleChangelogPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/changelog" />
      <ChangelogPage />
    </>
  );
}
