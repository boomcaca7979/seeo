import { type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

// ===== proxy（Next 16 的 middleware）=====
// 职责合并：
//   1. 营销页 locale 路由（next-intl，白名单路径）
//   2. Supabase session 刷新 + /app 保护（原有逻辑不变）
//
// 排除规则：/api、/app、/payment、静态资源、sitemap/robots/llms.txt
// 不做 locale 路由（由白名单 + 原 matcher 共同保证）。

const intlMiddleware = createMiddleware(routing);

// Phase 0：仅这些营销路径参与 locale 路由（/zh 版本骨架已就绪）。
// 其余营销路径（login/signup/about/privacy/terms/refund/features 其他页）
// 在 Phase 1/2 建好 /zh 版本后逐步加入。
const LOCALE_ROUTED_PATHS = new Set([
  "/",
  "/pricing",
  "/docs",
  "/features/seo-audit",
]);

function isLocaleRouted(pathname: string): boolean {
  // /zh 或 /zh/ 前缀：剥离后按白名单匹配
  if (pathname === "/zh" || pathname === "/zh/") return true;
  if (pathname.startsWith("/zh/")) {
    const rest = pathname.slice(3);
    return LOCALE_ROUTED_PATHS.has(rest);
  }
  return LOCALE_ROUTED_PATHS.has(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isLocaleRouted(pathname)) {
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
