import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/auth-config";
import { safeRedirectTarget } from "@/lib/auth-redirect";
import {
  projectIdFromPath,
  readOwnedProject,
  type ProjectSource,
} from "@/lib/project-access";

/**
 * 只改写「要 HTML 文档」的请求。
 *
 * 为什么不能用 RSC 标记：Next 在把请求交给 proxy 之前会删掉 FLIGHT_HEADERS
 * （node_modules/next/dist/server/web/adapter.js 里 "Headers should only be
 * stripped for middleware"），`?_rsc=` 也已被 URL 归一化吃掉，所以 proxy 侧
 * `rsc` / `_rsc` 恒为空 —— dev 与真实浏览器实测都确认了这一点。可用的信号是
 * Sec-Fetch-Dest：文档导航为 `document`（Mode: navigate），站内 router.push 的
 * flight 请求为 `empty`（Mode: cors）。
 *
 * 分流结果：
 *   - document → 路由级 404，首个服务器响应就是完整 404 文档（§三 的硬要求）；
 *   - 非 document（flight/API）→ 放行给页面，页面自己渲染 NotFoundPanel
 *     （站内点击保留工作台外壳；不调 notFound()，那会让 Next 再注入一条 robots）；
 *   - 完全没有 Sec-Fetch-Dest（curl、部分爬虫、老 Safari）→ 按文档处理：
 *     这些消费者拿不到 hydration 后的正文，必须是真实 404 而不是错误壳。
 */
function isDocumentRequest(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  const dest = request.headers.get("sec-fetch-dest");
  return dest === null || dest === "document";
}

/**
 * 归属判据与详情页同源（@/lib/project-access）。
 * 只有数据源明确回答「名下没有这条项目」才返回 true；任何读取故障都返回 false，
 * 让请求原样进页面按「数据不可用」呈现——数据库挂了绝不能被伪装成 404。
 */
async function isDefinitivelyMissing(id: string, source: ProjectSource): Promise<boolean> {
  try {
    return (await readOwnedProject(id, source)).status === "missing";
  } catch {
    return false;
  }
}

/** 改写目标是 global-not-found（它自己输出完整文档：lang + 正文 + 唯一 noindex） */
function rewriteToNotFound(request: NextRequest, headers: Headers, carry?: NextResponse) {
  const response = NextResponse.rewrite(new URL("/_not-found", request.url), {
    request: { headers },
  });
  // rewrite 返回的是新响应对象：把本次已刷新下来的会话 cookie 原样搬过来
  carry?.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

export async function updateSession(request: NextRequest) {
  // 下游 server 组件（dashboard layout 访客审计分支、以及 dashboard 的
  // generateMetadata）需要当前 pathname：初始文档加载时 next-url header 不存在，
  // 由 proxy 注入可靠路径。必须在演示模式放行分支之前注入，
  // 否则 demo 预览里读不到路径，标签页标题会退化成分组默认值。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-seeo-pathname", request.nextUrl.pathname);

  // 演示模式：不做任何 Supabase 会话处理 / 重定向，但仍要在路由层定住资源型 404
  if (!isAuthEnabled) {
    const projectId = isDocumentRequest(request) ? projectIdFromPath(request.nextUrl.pathname) : null;
    if (projectId && (await isDefinitivelyMissing(projectId, { mode: "demo" }))) {
      return rewriteToNotFound(request, requestHeaders);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthPage = pathname === "/login" || pathname === "/signup";
  // /app/audit 是公开获客入口（Free SEO Audit 漏斗）：允许未登录访客直接审计，
  // 其余 /app 工作台页面仍要求登录。
  const isPublicAudit = pathname === "/app/audit" || pathname.startsWith("/app/audit/");
  const isProtected = pathname.startsWith("/app") && !isPublicAudit;

  // 未登录访问受保护页面 → 跳登录（保留完整路径 + query string）
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    const redirectTarget = pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirect", redirectTarget);
    return NextResponse.redirect(url);
  }

  // 已登录访问登录/注册 → 若有 redirect 参数则跳回，否则跳工作台
  if (user && isAuthPage) {
    // 白名单见 @/lib/auth-redirect：/app/** 与 /payment/result**，其余回落 /app
    const safeRedirect = safeRedirectTarget(request.nextUrl.searchParams.get("redirect"));
    const url = request.nextUrl.clone();
    url.pathname = safeRedirect.split("?")[0];
    url.search = safeRedirect.includes("?") ? "?" + safeRedirect.split("?")[1] : "";
    return NextResponse.redirect(url);
  }

  // 资源型 404：项目在当前用户名下确实不存在 → 首个服务器响应就是 404 文档。
  // 页面里的 notFound() 只覆盖站内 RSC 导航；动态渲染下它只能产出错误壳，
  // 所以文档请求必须在路由层定住（判据与页面同源，见 @/lib/project-access）。
  const projectId = isDocumentRequest(request) ? projectIdFromPath(pathname) : null;
  if (
    user &&
    projectId &&
    (await isDefinitivelyMissing(projectId, {
      mode: "supabase",
      client: supabase,
      userId: user.id,
    }))
  ) {
    return rewriteToNotFound(request, requestHeaders, supabaseResponse);
  }

  return supabaseResponse;
}
