// ===== Billing 中间层（P1 商业化基础设施） =====
// 统一管理：套餐查询、套餐限制、Feature 权限
// cache.ts 不再持有 PLAN_LIMITS，仅负责 quota 消耗
//
// 数据来源：
//   - 套餐限制：优先查 Supabase plan_limits 表（0004_plan_limits.sql）
//   - 不可用时 fallback 到 DEFAULT_PLAN_LIMITS（与迁移 SQL 保持一致）
//   - 用户套餐：profiles.plan / subscription_status / current_period_end
//
// 支付模式：Creem（USD）
//   - Lite / Pro：Creem Monthly 订阅（$1.49 / $4.49 每月），会员周期以 Creem webhook
//     返回的订阅周期（current_period_end_date）为准，不自建续费扣款
//   - Custom：一次性支付 $89.99，不开通会员周期
//   - 历史订单：Yaolipay 时代为 CNY 一次性购买 30 天会员，数据保留不动
//   - 到期由 cron /api/cron/membership-expire 自动降级 plan=free、subscription_status=expired

import { createServer } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { isAuthEnabled } from "@/lib/auth-config";
import type { PlanTier, SubscriptionStatus } from "@/lib/auth";

// ---------- 类型 ----------

/** 商业化 Feature 标识 */
export type Feature =
  | "pdf_export"
  | "excel_export"
  | "full_audit"
  | "backlinks"
  | "email_report";

/** 套餐限制（与 plan_limits 表字段一一对应） */
export interface PlanLimits {
  plan: PlanTier;
  max_projects: number;
  max_tracked_keywords: number;
  max_competitors: number;
  max_keyword_groups: number;
  serpapi_monthly_limit: number;
  /** SerpApi 每日限额（0 = 无日度限制，仅月度限制；0011 迁移新增列） */
  serpapi_daily_limit: number;
  dataforseo_monthly_limit: number;
  content_check_monthly_limit: number;
  audit_daily_limit: number;
  audit_max_depth: number;
  can_export_pdf: boolean;
  can_export_excel: boolean;
  can_white_label: boolean;
  can_email_report: boolean;
  can_team_collaboration: boolean;
  max_seats: number;
}

// 注：can_white_label / can_team_collaboration / max_seats 字段保留以兼容已有数据库 schema，
// 新 pricing 模型下不再作为 Feature 门控条件

/** getUserPlan 返回结构 */
export interface UserPlanResult {
  plan: PlanTier;
  /** 逻辑上有效的 plan：若订阅已过期，则为 "free" */
  effectivePlan: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
}

/** checkFeature 返回结构 */
export interface FeatureCheckResult {
  allowed: boolean;
  reason?: string;
}

// ---------- 套餐展示元数据（非 DB 字段，统一来源） ----------
// 价格、名称、tagline 等展示信息在此统一定义，Pricing/Settings 共用
// 修改价格只需改此处，前端不再硬编码
export interface PlanDisplayInfo {
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  ctaLabel: string;
  /** 可购买的 plan key（支付链路标识）；undefined 表示不走支付 */
  checkoutPlan?: CheckoutPlan;
  /** 非支付的跳转地址（如 free → /app） */
  ctaHref?: string;
  highlighted?: boolean;
}

// ---------- Creem（USD）服务端权威价格表 ----------
// 客户端不可传金额 / Product ID；订单服务 / create API 从此表读取
// 金额以美分（USD cents）为单位，避免浮点误差
export interface PlanPricing {
  /** 美分（如 149 = $1.49） */
  amountCents: number;
  /** 币种，固定 USD（历史 Yaolipay 订单为 CNY，数据保留） */
  currency: "USD";
  /**
   * 兜底周期天数（Creem 订阅订单实际周期以 webhook 返回的
   * current_period_end_date 为准；此值仅在缺失渠道周期时防御性使用）
   */
  periodDays: number;
}

/** 可购买套餐 plan key（走支付链路的标识） */
export type CheckoutPlan = "lite" | "pro" | "custom";

/** 定制服务套餐标识（一次性服务购买，非会员周期） */
export const CUSTOM_SERVICE_PLAN = "custom" as const;

export const PLAN_PRICING: Record<CheckoutPlan, PlanPricing> = {
  lite: { amountCents: 149, currency: "USD", periodDays: 30 },
  pro: { amountCents: 449, currency: "USD", periodDays: 30 },
  custom: { amountCents: 8999, currency: "USD", periodDays: 0 },
};

// 说明：旧 PAYMENT_TEST_MODE / PAYMENT_TEST_AMOUNT_CENTS 测试价格机制
// 随 Yaolipay 移除一并废弃 —— Creem 测试通过官方 Test Mode
// （test-api.creem.io + 测试卡）完成，无需价格覆盖。

export const PLAN_DISPLAY_INFO: Record<PlanTier | "custom", PlanDisplayInfo> = {
  free: {
    name: "免费版",
    tagline: "适合个人站长和初学者",
    price: "¥0",
    priceUnit: "",
    ctaLabel: "开始使用",
    ctaHref: "/app",
  },
  lite: {
    name: "Lite 版",
    tagline: "适合个人 SEO 入门",
    price: "$1.49",
    priceUnit: "/mo",
    ctaLabel: "升级到 Lite",
    checkoutPlan: "lite",
  },
  pro: {
    name: "专业版",
    tagline: "适合专业 SEO 从业者",
    price: "$4.49",
    priceUnit: "/mo",
    ctaLabel: "升级到 Pro",
    checkoutPlan: "pro",
    highlighted: true,
  },
  custom: {
    name: "定制服务",
    tagline: "一对一 SEO 定制服务，按需求交付",
    price: "$89.99",
    priceUnit: " one-time",
    ctaLabel: "购买定制服务",
    checkoutPlan: "custom",
  },
};

/** 套餐展示顺序 */
export const PLAN_ORDER: PlanTier[] = ["free", "lite", "pro"];

// ---------- 默认套餐限制（与 0004 + 0011_free_quota_update.sql 保持一致） ----------
// 当 Supabase 不可用、未配置、或查询失败时 fallback 使用
// 用 Number.MAX_SAFE_INTEGER 表示"无限"

export const DEFAULT_PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    plan: "free",
    max_projects: 2,
    max_tracked_keywords: 3,
    max_competitors: 3,
    max_keyword_groups: 3,
    serpapi_monthly_limit: 30,
    serpapi_daily_limit: 3,
    dataforseo_monthly_limit: 0,
    content_check_monthly_limit: 10,
    audit_daily_limit: 3,
    audit_max_depth: 1,
    can_export_pdf: false,
    can_export_excel: false,
    can_white_label: false,
    can_email_report: false,
    can_team_collaboration: false,
    max_seats: 1,
  },
  lite: {
    plan: "lite",
    max_projects: 3,
    max_tracked_keywords: 30,
    max_competitors: 10,
    max_keyword_groups: 10,
    serpapi_monthly_limit: 300,
    serpapi_daily_limit: 0,
    dataforseo_monthly_limit: 5,
    content_check_monthly_limit: 50,
    audit_daily_limit: 10,
    audit_max_depth: 2,
    can_export_pdf: false,
    can_export_excel: false,
    can_white_label: false,
    can_email_report: false,
    can_team_collaboration: false,
    max_seats: 1,
  },
  pro: {
    plan: "pro",
    max_projects: 10,
    max_tracked_keywords: 200,
    max_competitors: 50,
    max_keyword_groups: 50,
    serpapi_monthly_limit: 2000,
    serpapi_daily_limit: 0,
    dataforseo_monthly_limit: 30,
    content_check_monthly_limit: 300,
    audit_daily_limit: 50,
    audit_max_depth: 5,
    can_export_pdf: true,
    can_export_excel: true,
    can_white_label: false,
    can_email_report: true,
    can_team_collaboration: false,
    max_seats: 1,
  },
};

// ---------- Feature → 套餐权限映射 ----------

/**
 * 各 Feature 所需的最低套餐或对应权限字段
 * free: 全部禁止
 * lite: 解锁基础额度（无 PDF/Excel 导出、无邮件报告）
 * pro: 允许 pdf_export / excel_export / email_report / full_audit / backlinks
 */
const FEATURE_PLAN_GATE: Record<Feature, {
  minPlan: PlanTier;
  flagField?: keyof PlanLimits;
  reason: string;
}> = {
  pdf_export: { minPlan: "pro", flagField: "can_export_pdf", reason: "PDF 导出为 Pro 套餐功能" },
  excel_export: { minPlan: "pro", flagField: "can_export_excel", reason: "Excel 导出为 Pro 套餐功能" },
  email_report: { minPlan: "pro", flagField: "can_email_report", reason: "邮件报告为 Pro 套餐功能" },
  full_audit: { minPlan: "pro", flagField: "audit_max_depth", reason: "完整深度审计为 Pro 套餐功能" },
  backlinks: { minPlan: "pro", flagField: "dataforseo_monthly_limit", reason: "外链查询为 Pro 套餐功能" },
};

export const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  lite: 1,
  pro: 2,
};

// ---------- 内存缓存 ----------
// plan_limits 表查询结果按 plan 缓存 5 分钟，减少 Supabase 查询
const PLAN_LIMITS_CACHE_TTL_MS = 5 * 60 * 1000;
const planLimitsCache = new Map<PlanTier, { value: PlanLimits; expiresAt: number }>();
let planLimitsAllCache: { value: PlanLimits[]; expiresAt: number } | null = null;

function isCacheValid(entry: { expiresAt: number } | null): boolean {
  return entry !== null && Date.now() < entry.expiresAt;
}

// ---------- 公共 API ----------

/**
 * 判断用户当前订阅是否仍然有效
 * 规则：subscription_status=active/trialing 且 current_period_end 未过期
 */
export function isSubscriptionActive(
  status: SubscriptionStatus,
  currentPeriodEnd: string | null
): boolean {
  if (status !== "active" && status !== "trialing") return false;
  if (!currentPeriodEnd) return true; // 无到期时间视为有效（兼容老数据）
  try {
    return new Date(currentPeriodEnd).getTime() > Date.now();
  } catch {
    return false;
  }
}

/**
 * 购买类型：新购买 / 升级 / 续费（30 天会员模式下同档再买为续费）
 */
export type PurchaseType = "PURCHASE" | "UPGRADE" | "RENEWAL";

/** canPurchasePlan 返回结构 */
export interface PurchaseCheckResult {
  allowed: boolean;
  /** allowed 时的购买类型（PURCHASE / UPGRADE / RENEWAL） */
  purchaseType?: PurchaseType;
  /** 拒绝时的稳定错误码（PLAN_DOWNGRADE_NOT_ALLOWED） */
  errorCode?: string;
}

/**
 * 套餐购买规则（购买 30 天会员模式）：
 *   free → lite / pro  PURCHASE 允许
 *   lite → lite        RENEWAL  允许（续费 30 天）
 *   lite → pro         UPGRADE  允许
 *   pro  → pro         RENEWAL  允许（续费 30 天）
 *   pro  → lite        拒绝（PLAN_DOWNGRADE_NOT_ALLOWED）
 *   任意 → custom      PURCHASE 允许（定制服务为一次性服务，不影响会员周期）
 *
 * 注意：currentPlan 必须由服务端查询（profiles.effectivePlan）得出，
 * 不可信任前端传入。过期订阅 effectivePlan=free，允许重新购买。
 */
export function canPurchasePlan(
  currentPlan: PlanTier,
  targetPlan: CheckoutPlan
): PurchaseCheckResult {
  // 定制服务：任何用户（含 Pro）都可购买，与会员等级无关
  if (targetPlan === CUSTOM_SERVICE_PLAN) {
    return { allowed: true, purchaseType: "PURCHASE" };
  }
  const currentRank = PLAN_RANK[currentPlan] ?? 0;
  const targetRank = PLAN_RANK[targetPlan as PlanTier] ?? 0;
  if (targetRank < currentRank) {
    return {
      allowed: false,
      errorCode: "PLAN_DOWNGRADE_NOT_ALLOWED",
    };
  }
  return {
    allowed: true,
    // free 起步为新购买；付费档升档为升级；同档为续费
    purchaseType:
      currentRank === 0 ? "PURCHASE" : targetRank > currentRank ? "UPGRADE" : "RENEWAL",
  };
}

/**
 * 获取某用户的套餐与订阅状态
 * - 鉴权模式：查 profiles 表
 * - 演示模式 / 查询失败：返回 free + inactive
 *
 * 重要：effectivePlan 字段反映"当前实际可用套餐"
 *   - plan：数据库存储的套餐（可能已过期但仍保留）
 *   - effectivePlan：若订阅已过期则降为 "free"
 * Feature/Quota/PlanLimit 校验应使用 effectivePlan
 */
export async function getUserPlan(userId: string): Promise<UserPlanResult> {
  // 演示模式：直接返回默认值
  if (!isAuthEnabled) {
    return {
      plan: "free",
      effectivePlan: "free",
      subscriptionStatus: "inactive",
      currentPeriodEnd: null,
    };
  }

  // 优先用 admin client（绕过 RLS，cron 等无 session 场景可用）
  const admin = getAdminClient();
  if (admin) {
    try {
      const { data } = await admin
        .from("profiles")
        .select("plan, subscription_status, current_period_end")
        .eq("id", userId)
        .single();
      if (data) {
        const plan = (data.plan as PlanTier) ?? "free";
        const subscriptionStatus = (data.subscription_status as SubscriptionStatus) ?? "inactive";
        const currentPeriodEnd = (data.current_period_end as string | null) ?? null;
        const effectivePlan = isSubscriptionActive(subscriptionStatus, currentPeriodEnd)
          ? plan
          : "free";
        return { plan, effectivePlan, subscriptionStatus, currentPeriodEnd };
      }
    } catch {
      // admin 查询失败，fallback 到 user client
    }
  }

  // fallback：用户 session client
  try {
    const supabase = await createServer();
    const { data } = await supabase
      .from("profiles")
      .select("plan, subscription_status, current_period_end")
      .eq("id", userId)
      .single();
    if (data) {
      const plan = (data.plan as PlanTier) ?? "free";
      const subscriptionStatus = (data.subscription_status as SubscriptionStatus) ?? "inactive";
      const currentPeriodEnd = (data.current_period_end as string | null) ?? null;
      const effectivePlan = isSubscriptionActive(subscriptionStatus, currentPeriodEnd)
        ? plan
        : "free";
      return { plan, effectivePlan, subscriptionStatus, currentPeriodEnd };
    }
  } catch {
    // 查询失败，返回默认值
  }
  return {
    plan: "free",
    effectivePlan: "free",
    subscriptionStatus: "inactive",
    currentPeriodEnd: null,
  };
}

/**
 * 获取某套餐的限制配置
 * 优先查 plan_limits 表（Supabase），失败时 fallback 到 DEFAULT_PLAN_LIMITS
 * 结果按 plan 缓存 5 分钟
 */
export async function getPlanLimits(plan: PlanTier): Promise<PlanLimits> {
  // 1. 内存缓存命中
  const cached = planLimitsCache.get(plan);
  if (cached && isCacheValid(cached)) {
    return cached.value;
  }

  // 2. 查 Supabase plan_limits 表
  if (isAuthEnabled) {
    try {
      const supabase = await createServer();
      const { data } = await supabase
        .from("plan_limits")
        .select("*")
        .eq("plan", plan)
        .single();
      if (data) {
        const limits = rowToPlanLimits(data, plan);
        planLimitsCache.set(plan, { value: limits, expiresAt: Date.now() + PLAN_LIMITS_CACHE_TTL_MS });
        return limits;
      }
    } catch {
      // 查询失败，fallback
    }
  }

  // 3. Fallback 到默认值
  const fallback = DEFAULT_PLAN_LIMITS[plan] ?? DEFAULT_PLAN_LIMITS.free;
  planLimitsCache.set(plan, { value: fallback, expiresAt: Date.now() + PLAN_LIMITS_CACHE_TTL_MS });
  return fallback;
}

/**
 * 获取所有套餐的限制配置（供 Settings 页面等展示用）
 */
export async function getAllPlanLimits(): Promise<PlanLimits[]> {
  // 1. 内存缓存命中
  if (planLimitsAllCache && isCacheValid(planLimitsAllCache)) {
    return planLimitsAllCache.value;
  }

  // 2. 查 Supabase plan_limits 表
  if (isAuthEnabled) {
    try {
      const supabase = await createServer();
      const { data } = await supabase
        .from("plan_limits")
        .select("*")
        .order("plan", { ascending: true });
      if (data && data.length > 0) {
        const all = data.map((row) => rowToPlanLimits(row, row.plan as PlanTier));
        planLimitsAllCache = { value: all, expiresAt: Date.now() + PLAN_LIMITS_CACHE_TTL_MS };
        return all;
      }
    } catch {
      // 查询失败，fallback
    }
  }

  // 3. Fallback 到默认值
  const fallback = ["free", "lite", "pro"].map(
    (p) => DEFAULT_PLAN_LIMITS[p as PlanTier]
  );
  planLimitsAllCache = { value: fallback, expiresAt: Date.now() + PLAN_LIMITS_CACHE_TTL_MS };
  return fallback;
}

/** 合并后的套餐信息（limits + display），供前端展示用 */
export interface PlanInfo extends PlanLimits {
  display: PlanDisplayInfo;
  /** 定制服务卡标记：非会员套餐，前端渲染服务说明而非额度列表 */
  isCustomService?: boolean;
}

/**
 * 获取所有套餐的完整信息（limits + display），按 PLAN_ORDER 排序
 * Pricing / Settings 页面统一数据源
 * 末尾附加「定制服务」条目（非会员套餐，limits 字段无意义，前端按 isCustomService 渲染）
 */
export async function getAllPlanInfo(): Promise<PlanInfo[]> {
  const limits = await getAllPlanLimits();
  const limitsByPlan = new Map(limits.map((l) => [l.plan, l]));
  const plans = PLAN_ORDER.map((plan) => {
    const l = limitsByPlan.get(plan) ?? DEFAULT_PLAN_LIMITS[plan];
    return { ...l, display: PLAN_DISPLAY_INFO[plan] };
  });
  // 定制服务：limits 以 free 兜底填充（前端不渲染额度），价格/名称走 display
  const customEntry: PlanInfo = {
    ...DEFAULT_PLAN_LIMITS.free,
    plan: CUSTOM_SERVICE_PLAN as unknown as PlanTier,
    display: PLAN_DISPLAY_INFO.custom,
    isCustomService: true,
  };
  return [...plans, customEntry];
}

/**
 * 检查用户是否拥有某 Feature 权限
 * 规则：
 *   - 用户套餐等级（effectivePlan，过期会降为 free） >= Feature 所需最低套餐
 *   - 且对应 boolean flag 为 true（或数值字段 > 0）
 */
export async function checkFeature(
  userId: string,
  feature: Feature
): Promise<FeatureCheckResult> {
  const { effectivePlan } = await getUserPlan(userId);
  const limits = await getPlanLimits(effectivePlan);
  const gate = FEATURE_PLAN_GATE[feature];

  // 1. 套餐等级检查
  if (PLAN_RANK[effectivePlan] < PLAN_RANK[gate.minPlan]) {
    return { allowed: false, reason: gate.reason };
  }

  // 2. Boolean flag 检查（如果该 Feature 对应一个 flag 字段）
  if (gate.flagField) {
    const flagValue = limits[gate.flagField];
    if (typeof flagValue === "boolean" && !flagValue) {
      return { allowed: false, reason: gate.reason };
    }
    if (typeof flagValue === "number" && flagValue <= 0) {
      return { allowed: false, reason: gate.reason };
    }
  }

  return { allowed: true };
}

// ---------- 辅助函数 ----------

/**
 * 获取某套餐所有 Feature 的开关状态
 * 供 /api/account/usage 返回给前端展示
 */
export async function getFeaturesForPlan(plan: PlanTier): Promise<Record<Feature, boolean>> {
  const limits = await getPlanLimits(plan);
  const result = {} as Record<Feature, boolean>;
  for (const feature of Object.keys(FEATURE_PLAN_GATE) as Feature[]) {
    const gate = FEATURE_PLAN_GATE[feature];
    // 1. 套餐等级检查（与 checkFeature 保持一致）
    if (PLAN_RANK[plan] < PLAN_RANK[gate.minPlan]) {
      result[feature] = false;
      continue;
    }
    // 2. Boolean/数值 flag 检查
    if (gate.flagField) {
      const flagValue = limits[gate.flagField];
      if (typeof flagValue === "boolean") {
        result[feature] = flagValue;
      } else if (typeof flagValue === "number") {
        result[feature] = flagValue > 0;
      } else {
        result[feature] = false;
      }
    } else {
      result[feature] = true;
    }
  }
  return result;
}

/** 数据库行 → PlanLimits 对象 */
function rowToPlanLimits(row: Record<string, unknown>, plan: PlanTier): PlanLimits {
  const num = (v: unknown): number => {
    if (v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const bool = (v: unknown): boolean => v === true || v === 1 || v === "true" || v === "t";

  return {
    plan,
    max_projects: num(row.max_projects),
    max_tracked_keywords: num(row.max_tracked_keywords),
    max_competitors: num(row.max_competitors),
    max_keyword_groups: num(row.max_keyword_groups),
    serpapi_monthly_limit: num(row.serpapi_monthly_limit),
    // 0011 迁移新增列：DB 列缺失 / null 时回退 DEFAULT_PLAN_LIMITS（保证代码默认值生效）
    serpapi_daily_limit:
      row.serpapi_daily_limit === null || row.serpapi_daily_limit === undefined
        ? DEFAULT_PLAN_LIMITS[plan].serpapi_daily_limit
        : num(row.serpapi_daily_limit),
    dataforseo_monthly_limit: num(row.dataforseo_monthly_limit),
    content_check_monthly_limit: num(row.content_check_monthly_limit),
    audit_daily_limit: num(row.audit_daily_limit),
    audit_max_depth: num(row.audit_max_depth),
    can_export_pdf: bool(row.can_export_pdf),
    can_export_excel: bool(row.can_export_excel),
    can_white_label: bool(row.can_white_label),
    can_email_report: bool(row.can_email_report),
    can_team_collaboration: bool(row.can_team_collaboration),
    max_seats: num(row.max_seats),
  };
}
