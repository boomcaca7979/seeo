// ===== /guides/how-to-do-a-technical-seo-audit（en）· /zh/guides/how-to-do-a-technical-seo-audit（zh）=====
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { defaultLocale, isLocale } from "@/i18n/config";
import { notFoundPageMetadata } from "@/lib/not-found-meta";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import GuideTechnicalSeoAuditPage from "../../../(default)/guides/how-to-do-a-technical-seo-audit/page";

interface LocaleGuideTechnicalSeoAuditPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleGuideTechnicalSeoAuditPageProps): Promise<Metadata> {
  const { locale } = await params;
  // 无效 locale 段 → 组件里 notFound()。metadata 必须与 not-found 边界同源，否则 hydration 后
  // 404 会顶着本页营销标题（客户端 metadata 只认 layout + page，不看 not-found 边界）。
  if (!isLocale(locale)) return notFoundPageMetadata(defaultLocale);
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({
    locale: loc,
    namespace: "guideTechnicalSeoAudit.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    ...seoMetadata(
      loc,
      "/guides/how-to-do-a-technical-seo-audit",
      t("title"),
      t("description")
    ),
  };
}

export default async function LocaleGuideTechnicalSeoAuditPage({
  params,
}: LocaleGuideTechnicalSeoAuditPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path="/guides/how-to-do-a-technical-seo-audit" />
      <GuideTechnicalSeoAuditPage />
    </>
  );
}
