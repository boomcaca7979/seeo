// ===== 共享鉴权函数 =====
// 所有 /api/* 路由通过 requireAuthOrDemo 统一鉴权
// 演示模式（isAuthEnabled=false）跳过鉴权，方便本地预览
// P1 改造：返回结果包含 limits，避免 API 重复查询

import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";
import { getPlanLimits, getUserPlan, type PlanLimits } from "@/lib/billing";
import { getClientIp } from "@/lib/rate-limit";

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

/**
 * 访客身份：auth 启用且未登录时，审计公开链路以 guest:{ip} 作为数据归属键
 * （与 rate-limit 的匿名维度一致，防滥用按 IP 限流）。
 * 仅限 /api/audit/* 与审计 claim 使用，其余 API 仍要求登录。
 */
export function guestUserId(req: Request): string {
  return `guest:${getClientIp(req)}`;
}

/**
 * 鉴权（允许访客）：供审计公开链路使用 —— 登录用户按账号归属，
 * 未登录访客放行为 free 套餐（user=null，由调用方用 guestUserId 归属数据）。
 * 其余非审计 API 不得使用此函数。
 */
export async function requireAuthAllowGuest(): Promise<AuthResult> {
  // 演示模式：与 requireAuth 一致，直接放行
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
      // 访客：放行为 free（真实限额由调用方的 IP rate limit + 每日用量兜底）
      return {
        user: null,
        plan: "free",
        subscriptionStatus: "inactive",
        limits: await getPlanLimits("free"),
        allowed: true,
        skip: false,
      };
    }

    // P1：一次性查询套餐限制，使用 effectivePlan（已过期会降为 free）
    const userPlan = await getUserPlan(user.id);
    const plan = userPlan.effectivePlan;
    const subscriptionStatus = userPlan.subscriptionStatus;
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
    // Supabase 异常时按访客放行（审计为只读爬取能力，失败影响有限）
    return {
      user: null,
      plan: "free",
      subscriptionStatus: "inactive",
      limits: await getPlanLimits("free"),
      allowed: true,
      skip: false,
    };
  }
}
