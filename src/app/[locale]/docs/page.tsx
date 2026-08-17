// ===== /docs（en）· /zh/docs（zh）=====
// 复用 (default)/docs/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale, localeToOgLocale } from "@/i18n/config";
import { alternatesFor, localeUrl } from "@/i18n/seo";
import DocsPage from "../../(default)/docs/page";

interface LocaleDocsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleDocsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "docsPage.meta" });
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      url: localeUrl(loc, "/docs"),
      title: t("title"),
      description: t("description"),
      locale: localeToOgLocale[loc],
    },
    ...alternatesFor(loc, "/docs"),
  };
}

export default async function LocaleDocsPage({
  params,
}: LocaleDocsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DocsPage />;
}
