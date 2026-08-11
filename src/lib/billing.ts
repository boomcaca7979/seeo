// ===== Billing 中间层（P1 商业化基础设施） =====
// 统一管理：套餐查询、套餐限制、Feature 权限
// cache.ts 不再持有 PLAN_LIMITS，仅负责 quota 消耗
//
// 数据来源：
//   - 套餐限制：优先查 Supabase plan_limits 表（0004_plan_limits.sql）
//   - 不可用时 fallback 到 DEFAULT_PLAN_LIMITS（与迁移 SQL 保持一致）
//   - 用户套餐：profiles.plan / subscription_status

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
  subscriptionStatus: SubscriptionStatus;
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
  /** 走 /api/checkout 的 plan key；undefined 表示不走 checkout */
  checkoutPlan?: "lite" | "pro";
  /** 非 checkout 的跳转地址（如 free → /app） */
  ctaHref?: string;
  highlighted?: boolean;
}

export const PLAN_DISPLAY_INFO: Record<PlanTier, PlanDisplayInfo> = {
  free: {
    name: "免费版",
    tagline: "适合个人站长和初学者",
    price: "$0",
    priceUnit: "/月",
    ctaLabel: "开始使用",
    ctaHref: "/app",
  },
  lite: {
    name: "Lite 版",
    tagline: "适合个人 SEO 入门",
    price: "$9.9",
    priceUnit: "/月",
    ctaLabel: "升级到 Lite",
    checkoutPlan: "lite",
  },
  pro: {
    name: "专业版",
    tagline: "适合专业 SEO 从业者",
    price: "$29.9",
    priceUnit: "/月",
    ctaLabel: "升级到 Pro",
    checkoutPlan: "pro",
    highlighted: true,
  },
};

/** 套餐展示顺序 */
export const PLAN_ORDER: PlanTier[] = ["free", "lite", "pro"];

// ---------- 默认套餐限制（与 0004_plan_limits.sql 保持一致） ----------
// 当 Supabase 不可用、未配置、或查询失败时 fallback 使用
// 用 Number.MAX_SAFE_INTEGER 表示"无限"

export const DEFAULT_PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    plan: "free",
    max_projects: 1,
    max_tracked_keywords: 5,
    max_competitors: 3,
    max_keyword_groups: 3,
    serpapi_monthly_limit: 50,
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

const PLAN_RANK: Record<PlanTier, number> = {
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
 * 获取某用户的套餐与订阅状态
 * - 鉴权模式：查 profiles 表
 * - 演示模式 / 查询失败：返回 free + inactive
 */
export async function getUserPlan(userId: string): Promise<UserPlanResult> {
  // 演示模式：直接返回默认值
  if (!isAuthEnabled) {
    return { plan: "free", subscriptionStatus: "inactive" };
  }

  // 优先用 admin client（绕过 RLS，cron 等无 session 场景可用）
  const admin = getAdminClient();
  if (admin) {
    try {
      const { data } = await admin
        .from("profiles")
        .select("plan, subscription_status")
        .eq("id", userId)
        .single();
      if (data) {
        return {
          plan: (data.plan as PlanTier) ?? "free",
          subscriptionStatus: (data.subscription_status as SubscriptionStatus) ?? "inactive",
        };
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
      .select("plan, subscription_status")
      .eq("id", userId)
      .single();
    if (data) {
      return {
        plan: (data.plan as PlanTier) ?? "free",
        subscriptionStatus: (data.subscription_status as SubscriptionStatus) ?? "inactive",
      };
    }
  } catch {
    // 查询失败，返回默认值
  }
  return { plan: "free", subscriptionStatus: "inactive" };
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
}

/**
 * 获取所有套餐的完整信息（limits + display），按 PLAN_ORDER 排序
 * Pricing / Settings 页面统一数据源
 */
export async function getAllPlanInfo(): Promise<PlanInfo[]> {
  const limits = await getAllPlanLimits();
  const limitsByPlan = new Map(limits.map((l) => [l.plan, l]));
  return PLAN_ORDER.map((plan) => {
    const l = limitsByPlan.get(plan) ?? DEFAULT_PLAN_LIMITS[plan];
    return { ...l, display: PLAN_DISPLAY_INFO[plan] };
  });
}

/**
 * 检查用户是否拥有某 Feature 权限
 * 规则：
 *   - 用户套餐等级 >= Feature 所需最低套餐
 *   - 且对应 boolean flag 为 true（或数值字段 > 0）
 */
export async function checkFeature(
  userId: string,
  feature: Feature
): Promise<FeatureCheckResult> {
  const { plan } = await getUserPlan(userId);
  const limits = await getPlanLimits(plan);
  const gate = FEATURE_PLAN_GATE[feature];

  // 1. 套餐等级检查
  if (PLAN_RANK[plan] < PLAN_RANK[gate.minPlan]) {
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
  return {
    pdf_export: limits.can_export_pdf,
    excel_export: limits.can_export_excel,
    full_audit: limits.audit_max_depth >= 3,
    backlinks: limits.dataforseo_monthly_limit > 0,
    email_report: limits.can_email_report,
  };
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
