// ===== /seo-issues/thin-content 的 locale 接线：metadata（canonical / OG / Twitter）+ 小写 hreflang =====
// 文案来自 src/lib/seo/landing-pages.ts（单一来源），不额外走 messages 命名空间。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { defaultLocale, isLocale } from "@/i18n/config";
import { notFoundPageMetadata } from "@/lib/not-found-meta";
import { seoMetadata } from "@/i18n/seo";
import HreflangAlternates from "@/components/HreflangAlternates";
import IssueLandingPage from "@/components/seo-issues/IssueLandingPage";
import { landingCopy, landingPageById } from "@/lib/seo/landing-pages";

const PAGE_ID = "seo_issues_thin_content";
const PATH = "/seo-issues/thin-content";

interface LocalePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: LocalePageProps): Promise<Metadata> {
  const { locale } = await params;
  // 无效 locale 段 → 组件里 notFound()。metadata 必须与 not-found 边界同源，否则 hydration 后
  // 404 会顶着本页营销标题（客户端 metadata 只认 layout + page，不看 not-found 边界）。
  if (!isLocale(locale)) return notFoundPageMetadata(defaultLocale);
  const loc = isLocale(locale) ? locale : "en";
  const page = landingPageById(PAGE_ID);
  if (!page) return {};
  const copy = landingCopy(page, loc);
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    ...seoMetadata(loc, PATH, copy.metaTitle, copy.metaDescription),
  };
}

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <HreflangAlternates path={PATH} />
      <IssueLandingPage pageId={PAGE_ID} />
    </>
  );
}
