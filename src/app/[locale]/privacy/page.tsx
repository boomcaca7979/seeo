// ===== /privacy（en）· /zh/privacy（zh）=====
// 复用 (default)/privacy/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale, localeToOgLocale } from "@/i18n/config";
import { alternatesFor, localeUrl } from "@/i18n/seo";
import PrivacyPage from "../../(default)/privacy/page";

interface LocalePrivacyPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocalePrivacyPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "privacyPage.meta" });
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      url: localeUrl(loc, "/privacy"),
      title: t("title"),
      description: t("description"),
      locale: localeToOgLocale[loc],
    },
    ...alternatesFor(loc, "/privacy"),
  };
}

export default async function LocalePrivacyPage({
  params,
}: LocalePrivacyPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PrivacyPage />;
}
