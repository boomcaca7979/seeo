// ===== Supabase 服务端 Admin 客户端（仅服务端使用，绕过 RLS） =====
// 用于 Cron 等无用户 session 的服务端场景，查询 profiles 等表
// 需要 SUPABASE_SERVICE_ROLE_KEY 环境变量；未配置时返回 null，调用方需 fallback

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * 获取 admin 客户端。
 * 未配置 SUPABASE_SERVICE_ROLE_KEY 时返回 null（调用方应 fallback 到保守默认值）。
 */
export function getAdminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    cached = null;
    return null;
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * 查询某用户的套餐等级。
 * Admin 客户端可用时返回真实 plan；不可用或查询失败时返回 fallback（默认 free）。
 */
export async function getUserPlan(
  userId: string,
  fallback: "free" | "lite" | "pro" = "free"
): Promise<"free" | "lite" | "pro"> {
  const admin = getAdminClient();
  if (!admin) return fallback;
  try {
    const { data } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .single();
    if (data?.plan && ["free", "lite", "pro"].includes(data.plan)) {
      return data.plan as "free" | "lite" | "pro";
    }
    return fallback;
  } catch {
    return fallback;
  }
}
