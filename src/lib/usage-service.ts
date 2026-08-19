// ===== Usage 查询服务（P1 商业化基础设施） =====
// 统一查询用户当前用量，供 Settings 页面、/api/account/usage 等调用
// 不消耗额度，只读

import { getUserApiUsage, getAuditDailyUsage, getApiDailyUsage, type ApiType } from "@/lib/db";
import { getUserPlan } from "@/lib/billing";
import { getPlanLimits } from "@/lib/billing";

/** 单个 API 类型的用量 */
export interface ApiUsageInfo {
  used: number;
  limit: number;
  /** 剩余可用次数（limit - used，不为负） */
  remaining: number;
  /** 已用百分比（0-100，limit 为无限时固定返回 0） */
  usedPct: number;
  /** 当前月份 YYYY-MM */
  month: string;
}

/** 审计每日用量 */
export interface AuditUsageInfo {
  used: number;
  limit: number;
  remaining: number;
  usedPct: number;
  /** 当天日期 YYYY-MM-DD */
  date: string;
}

/** 用户完整用量信息 */
export interface UserUsageResult {
  serpapi: ApiUsageInfo;
  /** SerpApi 每日用量（Free 套餐 3 次/天；limit=0 表示无日度限制） */
  serpapiDaily: ApiUsageInfo;
  dataforseo: ApiUsageInfo;
  content_check: ApiUsageInfo;
  audit: AuditUsageInfo;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * 获取用户当前月份的完整用量
 * - 自动查询用户套餐
 * - 自动查询对应套餐的限额
 * - 不消耗额度
 */
export async function getCurrentUsage(userId: string): Promise<UserUsageResult> {
  const { plan } = await getUserPlan(userId);
  const limits = await getPlanLimits(plan);
  const month = currentMonth();
  const today = todayStr();

  const [serpapiUsage, serpapiDailyUsage, dataforseoUsage, contentCheckUsage, auditDaily] = await Promise.all([
    safeGetUserApiUsage(userId, "serpapi", month),
    safeGetApiDailyUsage(userId, "serpapi", today),
    safeGetUserApiUsage(userId, "dataforseo", month),
    safeGetUserApiUsage(userId, "content_check", month),
    safeGetAuditDailyUsage(userId, today),
  ]);

  return {
    serpapi: buildApiUsageInfo(
      serpapiUsage?.used ?? 0,
      limits.serpapi_monthly_limit,
      month
    ),
    serpapiDaily: buildApiUsageInfo(
      serpapiDailyUsage?.used ?? 0,
      limits.serpapi_daily_limit,
      month
    ),
    dataforseo: buildApiUsageInfo(
      dataforseoUsage?.used ?? 0,
      limits.dataforseo_monthly_limit,
      month
    ),
    content_check: buildApiUsageInfo(
      contentCheckUsage?.used ?? 0,
      limits.content_check_monthly_limit,
      month
    ),
    audit: buildAuditUsageInfo(
      auditDaily?.used ?? 0,
      limits.audit_daily_limit,
      today
    ),
  };
}

/** 安全查询用户 API 用量，DB 不可用时返回 null */
async function safeGetUserApiUsage(
  userId: string,
  apiType: ApiType,
  month: string
): Promise<{ used: number; limit: number } | null> {
  try {
    return await getUserApiUsage(userId, apiType, month);
  } catch {
    return null;
  }
}

/** 安全查询用户审计日用量，DB 不可用时返回 null */
async function safeGetAuditDailyUsage(
  userId: string,
  date: string
): Promise<{ used: number; limit: number } | null> {
  try {
    return await getAuditDailyUsage(userId, date);
  } catch {
    return null;
  }
}

/** 安全查询用户 API 日用量，DB 不可用时返回 null */
async function safeGetApiDailyUsage(
  userId: string,
  apiType: ApiType,
  date: string
): Promise<{ used: number; limit: number } | null> {
  try {
    return await getApiDailyUsage(userId, apiType, date);
  } catch {
    return null;
  }
}

/** 构造 ApiUsageInfo */
function buildApiUsageInfo(
  used: number,
  limit: number,
  month: string
): ApiUsageInfo {
  // limit 为无限（int32 max 或 MAX_SAFE_INTEGER）时不计算百分比；
  // limit <= 0（如 serpapi_daily_limit=0 表示无日度限制）同样不计
  const isUnlimited = limit >= 2147483647 || limit <= 0;
  return {
    used,
    limit,
    remaining: isUnlimited ? 0 : Math.max(0, limit - used),
    usedPct: isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100)),
    month,
  };
}

/** 构造 AuditUsageInfo */
function buildAuditUsageInfo(
  used: number,
  limit: number,
  date: string
): AuditUsageInfo {
  const isUnlimited = limit >= 2147483647;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    usedPct: isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100)),
    date,
  };
}
