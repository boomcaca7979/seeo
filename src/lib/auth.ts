// ===== 共享鉴权函数 =====
// 所有 /api/* 路由通过 requireAuthOrDemo 统一鉴权
// 演示模式（isAuthEnabled=false）跳过鉴权，方便本地预览
// P1 改造：返回结果包含 limits，避免 API 重复查询

import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";
import { getPlanLimits, getUserPlan, type PlanLimits } from "@/lib/billing";

/** 套餐等级 */
export type PlanTier = "free" | "lite" | "pro";

/** 订阅状态 */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "expired"
  | "inactive";

export interface AuthResult {
  user: { id: string } | null;
  plan: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  /** P1：套餐限制，避免 API 重复查询 */
  limits: PlanLimits;
  allowed: boolean;
  error?: string;
  skip: boolean;
}

/**
 * 严格鉴权：必须登录，演示模式下跳过
 * 返回用户套餐信息（plan / subscriptionStatus / limits）
 */
export async function requireAuth(): Promise<AuthResult> {
  // 演示模式：跳过鉴权，默认 free
  if (!isAuthEnabled) {
    return {
      user: null,
      plan: "free",
      subscriptionStatus: "inactive",
      limits: await getPlanLimits("free"),
      allowed: true,
      skip: true,
    };
  }

  try {
    const supabase = await createServer();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        user: null,
        plan: "free",
        subscriptionStatus: "inactive",
        limits: await getPlanLimits("free"),
        allowed: false,
        skip: false,
        error: "Unauthorized",
      };
    }

    // 查询 profiles 表获取套餐信息（使用 billing.ts 的 effectivePlan 逻辑）
    const userPlan = await getUserPlan(user.id);
    const plan = userPlan.effectivePlan;
    const subscriptionStatus = userPlan.subscriptionStatus;

    // P1：一次性查询套餐限制，使用 effectivePlan（已过期会降为 free）
    const limits = await getPlanLimits(plan);

    return {
      user: { id: user.id },
      plan,
      subscriptionStatus,
      limits,
      allowed: true,
      skip: false,
    };
  } catch {
    return {
      user: null,
      plan: "free",
      subscriptionStatus: "inactive",
      limits: await getPlanLimits("free"),
      allowed: false,
      skip: false,
      error: "Unauthorized",
    };
  }
}

/**
 * 鉴权或演示：演示模式直接放行，否则必须登录
 */
export async function requireAuthOrDemo(): Promise<AuthResult> {
  return requireAuth();
}
