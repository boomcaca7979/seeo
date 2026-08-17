// ===== /zh/（及内部 rewrite 的 /）首页骨架 =====
// Phase 0：复用现有中文首页组件，不做翻译。
// （/ 请求经 next-intl middleware 内部 rewrite 为 /en 命中本文件；
//   现有 app/page.tsx 在 Phase 1 迁移英文内容后移除。）

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import Home from "../page";

interface LocaleHomePageProps {
  params: Promise<{ locale: string }>;
}

// canonical/hreflang 按 locale 输出（en: / · zh: /zh + 双向 hreflang）
export async function generateMetadata({
  params,
}: LocaleHomePageProps): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return alternatesFor(loc, "/");
}

export default async function LocaleHomePage({ params }: LocaleHomePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Home />;
}
