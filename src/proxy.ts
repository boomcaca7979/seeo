import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { isLocaleRoutedPath } from "@/i18n/locale-routed-paths";
import { updateSession } from "@/lib/supabase/middleware";

// ===== proxy（Next 16 的 middleware）=====
// 职责合并：
//   1. 营销页 locale 路由（next-intl，白名单路径）
//   2. /en 前缀 301 到无前缀英文 URL（en 为默认 locale，as-needed 不应有 /en 前缀）
//   3. Supabase session 刷新 + /app 保护（原有逻辑不变）
//
// 排除规则：/api、/app、/payment、静态资源、sitemap/robots/llms.txt
// 不做 locale 路由（由白名单 + 原 matcher 共同保证）。

const intlMiddleware = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /en、/en/<白名单路径> → 301 到无前缀英文 URL。
  // 仅处理明确存在的 locale 路径（白名单校验），不碰 /zh、/app、/payment、/api，
  // 目标路径永不带 /en 前缀，不会形成 redirect loop。
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    const target = pathname.slice("/en".length) || "/";
    if (isLocaleRoutedPath(target)) {
      const url = request.nextUrl.clone();
      url.pathname = target;
      return NextResponse.redirect(url, 301);
    }
  }

  if (isLocaleRoutedPath(pathname)) {
    // locale redirect（如 cookie=zh 访问 / → /zh）直接返回；
    // 放行场景由 next-intl 内部 rewrite 命中 [locale] segment。
    // 营销页不做 Supabase session 刷新（dashboard 路径始终走 updateSession）。
    return intlMiddleware(request);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    // 排除静态资源与爬虫文件（sitemap/robots/llms），只处理页面路由。
    // 爬虫文件必须完全绕过 middleware（含 locale 路由与 auth session），
    // 保证搜索引擎在任何配置下都能拿到 deterministic 响应。
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|llms\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
