// ===== html lang 同步（404 错误壳专用）=====
// notFound() 在动态渲染下 Next.js 输出最小错误壳（<html id="__next_error__">），
// 客户端 hydration 只创建 hoisted <title>，不会 diff documentElement 的属性，
// 导致 404 页 html 缺 lang。此组件在客户端渲染路径上强制同步 lang
// （documentElement 属性不属于 React hydration 管辖，直接赋值安全且幂等）。
// 常规页面走 SSR layout 的 <html lang>，无需本组件。
"use client";

export default function HtmlLang({ locale }: { locale: "en" | "zh" }) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }
  return null;
}
