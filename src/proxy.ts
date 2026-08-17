import { type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { isLocaleRoutedPath } from "@/i18n/locale-routed-paths";
import { updateSession } from "@/lib/supabase/middleware";

// ===== proxy（Next 16 的 middleware）=====
// 职责合并：
//   1. 营销页 locale 路由（next-intl，白名单路径）
//   2. Supabase session 刷新 + /app 保护（原有逻辑不变）
//
// 排除规则：/api、/app、/payment、静态资源、sitemap/robots/llms.txt
// 不做 locale 路由（由白名单 + 原 matcher 共同保证）。

const intlMiddleware = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    // 排除静态资源,只处理页面路由
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
