// ===== 全局 404（未匹配路由的唯一渲染源）=====
// 命中本页的两条路径都不经过任何 layout，因此本页自己输出完整 HTML 文档：
//   1. 路由层未匹配：/app/<未注册>、/login/<未注册>、/zh/<未知>、/nope …
//      （[locale] 布局声明 dynamicParams=false，无效 locale 段不再进入营销路由树）
//   2. Next 内部把 /_not-found 映射为 pagePath=/404 → HTTP 状态恒为 404。
//
// 为什么不用「catch-all 页面里 notFound()」做 fallback（旧实现）：notFound() 在动态
// 渲染下由 Next 输出 __next_error__ 错误壳——<html> 只有 id="__next_error__"、没有
// lang，<body> 为空，404 正文要等 hydration 才出现，首个服务器响应既没有文档语言
// 也没有可读内容；语言此前只能靠客户端补丁（已删除的 HtmlLang）掩盖。
// 路由层 fallback 让首屏 HTML 自带 lang + 正文，爬虫与无 JS 客户端同样可读。
//
// 语言：与界面/营销页同一套三级规则（URL 前缀 > UI 路径空间的 cookie/Accept-Language
// > 默认语言），标题、正文、<html lang> 都取同一次解析结果（notFoundLocale）。
// pathname 取 proxy 注入的 x-seeo-pathname：未匹配路径都不在营销 locale 白名单里，
// 恒走 updateSession 分支，该 header 必然存在。
//
// 索引控制：robots 由 Next 对 404 响应注入唯一的 <meta name="robots" content="noindex"/>，
// 本页 metadata（notFoundPageMeta）不再自带 robots，避免同一文档出现第二个 robots 标签。
//
// 样式：本页绕过 layout（没有 Tailwind 变量与 next/font），用内联样式自包含。
// 动态渲染：语言按 cookie / Accept-Language 逐请求解析，不做构建期静态壳。

import { headers } from "next/headers";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { localeToHtmlLang, type Locale } from "@/i18n/config";
import { notFoundLocale } from "@/lib/not-found-locale";
import { notFoundPageMetadata } from "@/lib/not-found-meta";

export const dynamic = "force-dynamic";

async function requestNotFoundLocale(): Promise<Locale> {
  return notFoundLocale((await headers()).get("x-seeo-pathname"));
}

export async function generateMetadata(): Promise<Metadata> {
  return notFoundPageMetadata(await requestNotFoundLocale());
}

export default async function GlobalNotFound() {
  const locale = await requestNotFoundLocale();
  const t = await getTranslations({ locale, namespace: "notFoundPage" });

  return (
    <html lang={localeToHtmlLang[locale]}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          backgroundColor: "#faf8f3",
          color: "#1a1a1a",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: "3rem", fontWeight: 700, letterSpacing: "0.08em" }}>404</div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0.75rem 0 0.5rem" }}>
            {t("heading")}
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>{t("desc")}</p>
          {/* 普通 <a>：404 页回首页做整页跳转即可，不需要 router 上下文 */}
          <a
            href={locale === "zh" ? "/zh" : "/"}
            style={{
              display: "inline-block",
              marginTop: "1.5rem",
              padding: "0.5rem 1.25rem",
              border: "1px solid #1a1a1a",
              borderRadius: "9999px",
              color: "#1a1a1a",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            {t("back")}
          </a>
        </div>
      </body>
    </html>
  );
}
