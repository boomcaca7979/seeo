// ===== i18n SEO 工具（canonical / hreflang / 本地化路径）=====
// Phase 0 骨架：为 Phase 5（SEO 全面验证）提供统一工具函数。
// 规则：
//   EN  canonical = /<path>            （无前缀）
//   ZH  canonical = /zh/<path>
//   hreflang: en + zh-CN + x-default（指向 en 版本）
// Dashboard（/app）为私有页面，不进入该体系。

import type { Metadata } from "next";
import { defaultLocale, type Locale } from "./config";

export const SITE_URL = "https://www.seeo.asia";

/** 生成某个 locale 下某条营销路径的站内路径（不带域名） */
export function localePath(locale: Locale, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const trimmed = p.replace(/\/+$/, "") || "/";
  if (locale === defaultLocale) return trimmed === "/" ? "/" : trimmed;
  return trimmed === "/" ? "/zh" : `/zh${trimmed}`;
}

/** 生成某条营销路径的绝对 URL（canonical / hreflang 用） */
export function localeUrl(locale: Locale, path: string): string {
  return `${SITE_URL}${localePath(locale, path)}`;
}

/**
 * 生成 alternates metadata（canonical）。
 * 仅营销页面使用；传入当前页面 locale 与规范化后的站内路径。
 *
 * hreflang 不走 metadata API：Next 16 的 alternates.languages 经 React 序列化
 * 会输出 camelCase `hrefLang` 属性（HTML 属性虽大小写不敏感，但 SEO 工具链
 * 普遍按小写 hreflang 匹配）。改由 <HreflangAlternates /> 组件在页面内
 * 渲染标准小写 <link rel="alternate" hreflang=...>（React 自动 hoist 到 <head>）。
 */
export function alternatesFor(
  locale: Locale,
  path: string
): Pick<Metadata, "alternates"> {
  return {
    alternates: {
      canonical: localePath(locale, path),
    },
  };
}

/** 某条营销路径的三向 hreflang 数据（en / zh-CN / x-default → en） */
export function hreflangAlternates(path: string): Array<{
  hreflang: string;
  href: string;
}> {
  return [
    { hreflang: "en", href: localeUrl("en", path) },
    { hreflang: "zh-CN", href: localeUrl("zh", path) },
    { hreflang: "x-default", href: localeUrl("en", path) },
  ];
}
