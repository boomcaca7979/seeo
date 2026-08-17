// ===== i18n SEO 工具（canonical / hreflang / 本地化路径）=====
// Phase 0 骨架：为 Phase 5（SEO 全面验证）提供统一工具函数。
// 规则：
//   EN  canonical = /<path>            （无前缀）
//   ZH  canonical = /zh/<path>
//   hreflang: en + zh-CN + x-default（指向 en 版本）
// Dashboard（/app）为私有页面，不进入该体系。

import type { Metadata } from "next";
import { defaultLocale, localeToHreflang, type Locale } from "./config";

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
 * 生成 alternates metadata（canonical + 双向 hreflang + x-default）。
 * 仅营销页面使用；传入当前页面 locale 与规范化后的站内路径。
 */
export function alternatesFor(
  locale: Locale,
  path: string
): Pick<Metadata, "alternates"> {
  return {
    alternates: {
      canonical: localePath(locale, path),
      languages: {
        [localeToHreflang.en]: localeUrl("en", path),
        [localeToHreflang.zh]: localeUrl("zh", path),
        "x-default": localeUrl("en", path),
      },
    },
  };
}
