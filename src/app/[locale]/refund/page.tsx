// ===== /refund（en）· /zh/refund（zh）=====
// 复用 (default)/refund/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale, localeToOgLocale } from "@/i18n/config";
import { alternatesFor, localeUrl } from "@/i18n/seo";
import RefundPage from "../../(default)/refund/page";

interface LocaleRefundPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleRefundPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "refundPage.meta" });
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      url: localeUrl(loc, "/refund"),
      title: t("title"),
      description: t("description"),
      locale: localeToOgLocale[loc],
    },
    ...alternatesFor(loc, "/refund"),
  };
}

export default async function LocaleRefundPage({
  params,
}: LocaleRefundPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RefundPage />;
}
