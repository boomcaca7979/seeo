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

// ===== 爬虫专用 locale 路由 =====
// next-intl 会按 cookie / Accept-Language 协商 locale：携带 zh 语言头的抓取器
// 访问 EN canonical URL 会被 307 到 /zh/*（Bing 据此将 /contact 判为
// Indexing allowed: No）。localeDetection: false 下 locale 仅由 URL 前缀决定：
// EN URL 恒 200 EN、/zh/* 恒 200 ZH，对爬虫输出确定性响应。
// 普通用户的语言协商不受影响。
const CRAWLER_UA_PATTERN = /Googlebot|Google-InspectionTool|bingbot|BingPreview/i;
const crawlerIntlMiddleware = createMiddleware({
  ...routing,
  localeDetection: false,
});

/** NextURL 会归一成 localhost、initUrl 却保留原样的 bind 主机名（见上方注释） */
const LOOPBACK_REWRITE_BIND = /^(?:127(?:\.\d{1,3}){3}|\[::1\]|::1)$/;

/**
 * 这趟是不是 Next 自代理内部 locale rewrite 的再入。
 *
 * 两个条件同时成立才判为再入：部署形态确实会发生 rewrite 绝对化（bind 是回环别名），
 * 且这趟请求的 Host 就是 middleware 侧被归一后的内部 origin（changeOrigin 的结果）。
 * 外部请求要么来自不触发的 bind（0.0.0.0 / localhost / 公网域名），要么 Host 不等于
 * 内部 origin，都落到「照常 301」那一侧。
 */
function isSelfProxyReEntry(request: NextRequest): boolean {
  if (!LOOPBACK_REWRITE_BIND.test(process.env.HOSTNAME ?? "")) return false;
  return request.headers.get("host") === request.nextUrl.host;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /en、/en/<白名单路径> → 301 到无前缀英文 URL。
  // 仅处理明确存在的 locale 路径（白名单校验），不碰 /zh、/app、/payment、/api。
  //
  // 「目标路径永不带 /en 前缀」不足以保证不循环：standalone 把 HOSTNAME 绑到
  // 127/8 或 ::1 时，NextURL 会把 middleware 侧 request.url 的主机名归一成 localhost
  // （node_modules/next/dist/server/web/next-url.js 的 REGEX_LOCALHOST_HOSTNAME +
  // parseURL），而 initUrl 仍用原始 bind（next-server.js：
  // `${protocol}://${fetchHostname}:${port}${req.url}`）。两个 origin 不等 ⇒
  // resolve-routes 把 next-intl 的内部 locale rewrite 当成「外部 rewrite」，交给
  // proxy-request.js 用 http-proxy 再请求自己一趟（changeOrigin 让内层 Host 变成
  // rewrite 目标）。于是本 proxy 被第二次调用：pathname 恰是 rewrite 目标 /en，
  // Host 恰是归一后的内部 origin。此时若无条件 301 回 /，就和 next-intl 的
  // / → /en rewrite 互为对向，浏览器拿到自我指向的 301（还会被永久缓存）。
  //
  // 判据只用这两件事，不用 X-Forwarded-Host：本版本 Next 会给首趟请求就补上
  // X-Forwarded-Host（值等于进来的 Host），反代里 Host 与 X-Forwarded-Host 也可能
  // 天然不等，按它们判断既会漏（Host 正好是 localhost:PORT 的再入）会误伤
  // （外部 /en 少掉归一）。HOSTNAME=0.0.0.0（standalone 默认）/localhost/局域网 IP
  // 都不触发归一，next dev、next start 与 Vercel 同样单趟完成 —— 那些形态下
  // 外部 /en/* 继续照常 301。
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    const target = pathname.slice("/en".length) || "/";
    if (isLocaleRoutedPath(target)) {
      if (isSelfProxyReEntry(request)) {
        return NextResponse.next();
      }
      const url = request.nextUrl.clone();
      url.pathname = target;
      return NextResponse.redirect(url, 301);
    }
  }

  if (isLocaleRoutedPath(pathname)) {
    // 爬虫：跳过语言协商，直接按 URL prefix 输出确定性 locale。
    if (CRAWLER_UA_PATTERN.test(request.headers.get("user-agent") ?? "")) {
      return crawlerIntlMiddleware(request);
    }
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
