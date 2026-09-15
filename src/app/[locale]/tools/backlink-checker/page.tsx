// ===== /tools/backlink-checker（en）· /zh/tools/backlink-checker（zh）=====
// 注意：本工具当前处于「暂缓上线」状态（见 src/lib/seo/public-tools.ts）。
//   停用时：改用如实的不可用态 metadata，并输出 noindex（不把它当作可索引的正式 SEO 页面）。
//   canonical 仍为自身（基础设施不动）；noindex 已足以阻止其进入索引，
//   且没有任何其它页面把本页声明为 canonical。
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import { BACKLINK_CHECKER_ENABLED, BACKLINK_CHECKER_PATH } from "@/lib/seo/public-tools";
import BacklinkCheckerToolPage from "../../../(default)/tools/backlink-checker/page";

interface LocaleBacklinkCheckerToolPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleBacklinkCheckerToolPageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  // 启用 → 常规营销 metadata；停用 → 如实的「暂未开放」metadata（避免宣称可查真实外链）
  const t = BACKLINK_CHECKER_ENABLED
    ? await getTranslations({ locale: loc, namespace: "backlinkChecker.meta" })
    : await getTranslations({ locale: loc, namespace: "backlinkChecker.metaUnavailable" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    ...seoMetadata(loc, BACKLINK_CHECKER_PATH, title, description),
    // 必须置于 seoMetadata 之后：该工具默认写入 marketingRobots()（index: true）
    // noindex 移出索引；follow 保留，使页面内指向 feature 页的链接仍可被爬取
    ...(BACKLINK_CHECKER_ENABLED ? {} : { robots: { index: false, follow: true } }),
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
      <HreflangAlternates path={BACKLINK_CHECKER_PATH} />
      <BacklinkCheckerToolPage />
    </>
  );
}
