// ===== /alternatives/ahrefs（en）· /zh/alternatives/ahrefs（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { defaultLocale, isLocale } from "@/i18n/config";
import { notFoundPageMetadata } from "@/lib/not-found-meta";
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
  // 无效 locale 段 → 组件里 notFound()。metadata 必须与 not-found 边界同源，否则 hydration 后
  // 404 会顶着本页营销标题（客户端 metadata 只认 layout + page，不看 not-found 边界）。
  if (!isLocale(locale)) return notFoundPageMetadata(defaultLocale);
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
