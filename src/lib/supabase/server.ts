import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 默认：完全保持既有行为（不带任何应用层超时），所有业务数据查询照旧。
 *
 * 只有认证/身份链路会传入 transport（@/lib/supabase/bounded-fetch 的
 * createBoundedFetch）：给上游一个硬上限，避免半开连接把整趟渲染挂到
 * undici 的默认超时。共享客户端的普通数据读取不加限制，防止把一次
 * 只是慢的查询变成错误。
 */
export async function createServer(fetch?: typeof globalThis.fetch) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // 在 Server Component 中调用 setAll 会抛错，由 middleware 负责刷新
          }
        },
      },
      ...(fetch ? { global: { fetch } } : null),
    }
  );
}
