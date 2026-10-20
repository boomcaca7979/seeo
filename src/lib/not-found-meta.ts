// ===== 404 页 head 字段组包 =====
// 所有 404 入口（global-not-found 与各营销页的「无效 locale 段」分支）共用同一份结构：
// 两处各写一份会让 canonical/og:locale 在不同 404 入口之间漂移。
// canonical 必须显式置 null：404 若继承营销 layout 的 canonical，等于把错误页
// 声明成首页的规范地址。
//
// 不输出 robots：HTTP 404 的索引控制由 Next 注入唯一的
// <meta name="robots" content="noindex"/>（app-render.js 的 NonIndex，
// 条件为 pagePath === '/404' 或 statusCode > 400，dev/prod 一致）。
// 这里再写一份就是同一份 HTML 里的第二个 robots 标签（两处内容还不同：
// noindex,nofollow vs noindex），搜索引擎取后者即不确定。

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { localeToOgLocale, type Locale } from "@/i18n/config";

export interface NotFoundMetaText {
  title: string;
  desc: string;
}

export function notFoundPageMeta(locale: Locale, text: NotFoundMetaText): Metadata {
  return {
    title: text.title,
    description: text.desc,
    alternates: { canonical: null },
    openGraph: { locale: localeToOgLocale[locale] },
  };
}

/**
 * 404 的 metadata（带文案解析）。
 *
 * 未匹配路由由 global-not-found 直接输出完整文档（metadata 与正文同一棵渲染树），
 * 不再依赖「页面 + not-found 边界各导出一份 metadata」那套补丁：错误壳下的
 * hydration metadata 走路由树，SSR 标题会在客户端被营销标题覆盖，那是
 * notFound() 渲染路径的缺陷，现在的路由设计不再进入该路径。
 * 保留本函数的意义是让仍带「无效 locale 段」守卫的营销页（[locale]/* 里的
 * !isLocale(locale) 分支）与 global-not-found 输出同一份 404 文案。
 *
 * 显式传 locale：getTranslations() 不传 locale 会回退 cookie/header 协商，
 * 在静态渲染上下文污染渲染 store（BUG-004）。
 */
export async function notFoundPageMetadata(locale: Locale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "notFoundPage" });
  return notFoundPageMeta(locale, { title: t("title"), desc: t("desc") });
}
