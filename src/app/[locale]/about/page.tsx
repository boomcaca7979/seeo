// ===== /about（en）· /zh/about（zh）=====
// 复用 (default)/about/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale, localeToOgLocale } from "@/i18n/config";
import { alternatesFor, localeUrl } from "@/i18n/seo";
import AboutPage from "../../(default)/about/page";

interface LocaleAboutPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleAboutPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "aboutPage.meta" });
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      url: localeUrl(loc, "/about"),
      title: t("title"),
      description: t("description"),
      locale: localeToOgLocale[loc],
    },
    ...alternatesFor(loc, "/about"),
  };
}

export default async function LocaleAboutPage({
  params,
}: LocaleAboutPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AboutPage />;
}
