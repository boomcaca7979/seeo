import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/auth-config";

export async function updateSession(request: NextRequest) {
  // 演示模式：完全放行，不做任何 Supabase 会话处理 / 重定向
  if (!isAuthEnabled) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
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
  const isProtected = pathname.startsWith("/app");

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
    const redirect = request.nextUrl.searchParams.get("redirect");
    const safeRedirect = redirect && redirect.startsWith("/app") ? redirect : "/app";
    const url = request.nextUrl.clone();
    url.pathname = safeRedirect.split("?")[0];
    url.search = safeRedirect.includes("?") ? "?" + safeRedirect.split("?")[1] : "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
