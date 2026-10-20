// ===== 工作台渲染期的会话 + profile（一次请求内只取一次，且有硬上限）=====
//
// 为什么要它（2026-10-20 登录延迟）：
//   一次 /app 加载里 `/auth/v1/user` 被打了 3 次、`profiles` 被打了 2 次：
//   proxy 一次（无法与渲染共享，运行在不同环境），app/layout.tsx 与 app/page.tsx
//   各自再取一次。上游认证一旦变慢，这些串行往返就是点击登录后要等的时长本身，
//   也让每一次加载多暴露一份同一故障的概率。
//
// 两层机制（都只作用于「身份 + profile」这两个请求，不碰业务数据查询）：
//   1. createBoundedFetch 注入本客户端的 transport：给「等待响应头」设上限；
//   2. withRequestDeadline 给整趟身份读取设上限，补上响应头之后仍缓慢吐 body
//      的那一段（Node 侧 fetch 没有浏览器那种全局时长上限）。
//
// 判定边界：
//   - 上游故障 ≠ 未登录：返回 authUnavailable，调用方按「故障即登出」跳登录并
//     带可重试标记，绝不放行受保护页面，也不产出虚假 profile；
//   - 绝不跨请求缓存：cache() 的作用域就是单次请求（无 dispatcher 时退化为直通，
//     最坏是「不去重」，结构上不可能跨用户复用身份）；
//   - proxy 仍照旧独立校验会话；只合并身份与展示字段，项目列表等业务数据仍由
//     各页面自己按 RLS 取，不加超时。

import { cache } from "react";
import { createServer } from "@/lib/supabase/server";
import {
  createBoundedFetch,
  isAuthUnavailable,
  logAuthUpstreamFailure,
  withRequestDeadline,
} from "@/lib/supabase/bounded-fetch";
import type { DatabaseProfile } from "@/lib/types";

export interface DashboardSession {
  /** 未登录（或身份校验未能完成）时为 null，调用方据此走重定向分支 */
  userId: string | null;
  displayName: string;
  email: string;
  /** true = 上游没能给出答案，而不是「这个用户没登录」 */
  authUnavailable: boolean;
}

const SIGNED_OUT: DashboardSession = {
  userId: null,
  displayName: "",
  email: "",
  authUnavailable: false,
};

const UNAVAILABLE: DashboardSession = {
  ...SIGNED_OUT,
  authUnavailable: true,
};

async function readIdentity(): Promise<DashboardSession> {
  const supabase = await createServer(createBoundedFetch());
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (!user) {
    // 没有会话 cookie 时 auth-js 直接返回 AuthSessionMissingError，不打网络：
    // 那是「确实未登录」；只有可重试类故障才算上游不可用。
    if (isAuthUnavailable(error)) {
      logAuthUpstreamFailure({
        stage: "dashboard_session",
        pathCategory: "dashboard_render",
        error,
      });
      return UNAVAILABLE;
    }
    return SIGNED_OUT;
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const profile = profileData as DatabaseProfile | null;
  return {
    userId: user.id,
    displayName: profile?.display_name || user.email?.split("@")[0] || "SeeO",
    email: user.email ?? "",
    authUnavailable: false,
  };
}

export const getDashboardSession = cache(async (): Promise<DashboardSession> => {
  const outcome = await withRequestDeadline(readIdentity());
  if (outcome.ok) return outcome.value;

  // 整趟超时（或身份读取抛错）：按上游不可用处理，判定仍然是「故障即登出」。
  logAuthUpstreamFailure({
    stage: "dashboard_session",
    pathCategory: "dashboard_render",
    error: outcome.error,
  });
  return UNAVAILABLE;
});
