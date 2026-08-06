// ===== 共享鉴权函数 =====
// 所有 /api/* 路由通过 requireAuthOrDemo 统一鉴权
// 演示模式（isAuthEnabled=false）跳过鉴权，方便本地预览

import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";

export interface AuthResult {
  user: { id: string } | null;
  allowed: boolean;
  error?: string;
  skip: boolean;
}

/**
 * 严格鉴权：必须登录，演示模式下跳过
 */
export async function requireAuth(): Promise<AuthResult> {
  // 演示模式：跳过鉴权
  if (!isAuthEnabled) {
    return { user: null, allowed: true, skip: true };
  }

  try {
    const supabase = await createServer();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return { user: null, allowed: false, skip: false, error: "Unauthorized" };
    }

    return { user: { id: user.id }, allowed: true, skip: false };
  } catch {
    return { user: null, allowed: false, skip: false, error: "Unauthorized" };
  }
}

/**
 * 鉴权或演示：演示模式直接放行，否则必须登录
 */
export async function requireAuthOrDemo(): Promise<AuthResult> {
  return requireAuth();
}
