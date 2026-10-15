// ===== /features/backlink-analysis（en）· /zh/features/backlink-analysis（zh）=====
// 复用 (default)/features/backlink-analysis/page 内容组件（文案已走 messages 按 locale 输出）；
// 本文件负责 locale 接线与双语 metadata（title/description/og/canonical/hreflang）。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import { BACKLINK_CHECKER_ENABLED } from "@/lib/seo/public-tools";
import BacklinkAnalysisFeaturePage from "../../../(default)/features/backlink-analysis/page";

interface LocaleBacklinksPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleBacklinksPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = await getTranslations({ locale: loc, namespace: "backlinks.meta" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    ...seoMetadata(loc, "/features/backlink-analysis", title, description),
    // 与 /tools/backlink-checker 同一「暂缓上线」策略（见 src/lib/seo/public-tools.ts）：
    // DataForSEO 未配置期间本页不作为正式 SEO 落地页收录——noindex 移出索引，
    // follow 保留；sitemap 排除由 DISABLED_PUBLIC_PATHS 统一处理。
    // 必须置于 seoMetadata 之后：seoMetadata 对 marketing 页写入 index: true。
    ...(BACKLINK_CHECKER_ENABLED ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function LocaleBacklinksPage({
  params,
}: LocaleBacklinksPageProps) {
  const { locale } = await params;
  // 无效 locale 段（如 /foobar 命中 [locale]）→ 404（[locale]/not-found.tsx）
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      {/* 标准小写 hreflang（React hoist 到 <head>） */}
      <HreflangAlternates path="/features/backlink-analysis" />
      <BacklinkAnalysisFeaturePage />
    </>
  );
}
