// ===== [locale] 404 页 =====
// 承接 [locale] 路由树内 notFound()：
//   - 无效 locale 段（/foobar）→ requestLocale 无效 → defaultLocale(en) 英文 404
//   - /zh/未知路径（经 [locale]/[...rest] catch-all）→ requestLocale=zh → 中文 404
// 渲染于 [locale]/layout 之内（params 驱动；request config 已短路无效 locale，
// 不触碰 cookies，不会重现 BUG-004 的静态渲染 500）。
//
// 注意：本页禁止使用 generateMetadata —— not-found 的 metadata 解析运行在
// 无 [locale] params 的隔离上下文，requestLocale=undefined → cookie/header
// 解析 → 污染静态渲染 store → 运行时 500（BUG-004 同类）。
// title / robots 改由组件内 React hoist 渲染（与 HreflangAlternates 同机制）。

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import HtmlLang from "@/components/HtmlLang";

// 动态渲染：not-found 边界若被静态预渲染，构建期 request config 会以
// requestLocale=undefined 走 cookie/header 解析（即使被 catch 也污染
// staticBailoutInfo），运行时命中该静态壳即 "Page changed from static to
// dynamic" → 500（BUG-004 同类）。动态渲染下 cookies 合法可用，
// /zh/* 由 [locale] params 解析为 zh，无效 locale 回退 en。
export const dynamic = "force-dynamic";

export default async function LocaleNotFound() {
  const t = await getTranslations("notFoundPage");
  const locale = (await getLocale()) as "en" | "zh";

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-6">
      {/* React hoist：404 明确 title（不继承站点默认）+ noindex；不输出规范链接 */}
      <title>{t("title")}</title>
      <meta name="robots" content="noindex, nofollow" />
      {/* 错误壳模式下 hydration 不修补 html 属性，客户端强制同步 lang */}
      <HtmlLang locale={locale} />
      <div className="text-center">
        <div className="font-mono text-5xl font-semibold tracking-widest text-ink">404</div>
        <h1 className="mt-4 font-mono text-lg font-semibold text-ink">{t("heading")}</h1>
        <p className="mt-2 text-sm text-ink/60">{t("desc")}</p>
        <Link
          href={localePath(locale, "/")}
          className="mt-6 inline-block rounded-full border border-ink px-5 py-2 font-mono text-sm text-ink hover:bg-ink hover:text-paper transition-colors"
        >
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
