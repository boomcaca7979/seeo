// ===== Billing 统一错误类型（P2 商业化基础设施） =====
// 所有商业化限制错误统一格式：{ code, message, plan, limit }
// API 路由捕获后可直接序列化为 HTTP 响应

import type { PlanTier } from "@/lib/auth";
import type { Feature } from "@/lib/billing";

/** 统一错误响应体格式 */
export interface BillingErrorBody {
  code: string;
  message: string;
  plan: PlanTier;
  limit?: number;
  feature?: Feature;
  used?: number;
  /** QuotaExceededError 超限维度：daily（次日重置）/ monthly（下月 1 日重置，缺省） */
  scope?: "daily" | "monthly";
}

/** Feature 权限不足错误（HTTP 403） */
export class FeatureNotAllowedError extends Error {
  readonly code = "FEATURE_NOT_AVAILABLE" as const;
  readonly feature: Feature;
  readonly plan: PlanTier;
  readonly limit?: number;

  constructor(feature: Feature, plan: PlanTier, reason?: string) {
    super(reason ?? `当前套餐（${plan}）不支持该功能：${feature}`);
    this.name = "FeatureNotAllowedError";
    this.feature = feature;
    this.plan = plan;
  }

  toJSON(): BillingErrorBody {
    return {
      code: this.code,
      message: this.message,
      plan: this.plan,
      feature: this.feature,
    };
  }
}

/** 配额超限错误（HTTP 429） */
export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly used: number;
  readonly limit: number;
  readonly plan: PlanTier;
  readonly apiType: string;
  /** 超限维度：monthly（月度）/ daily（每日） */
  readonly scope: "monthly" | "daily";

  constructor(used: number, limit: number, apiType: string, month: string, plan: PlanTier, scope: "monthly" | "daily" = "monthly") {
    const apiLabel = apiType === "dataforseo" ? "DataForSEO" : "SerpApi";
    super(
      scope === "daily"
        ? `今日${apiLabel}额度已用尽（${used}/${limit}），明日自动重置`
        : `本月${apiLabel}额度已用尽（${used}/${limit}），下月 1 日自动重置`
    );
    this.name = "QuotaExceededError";
    this.used = used;
    this.limit = limit;
    this.plan = plan;
    this.apiType = apiType;
    this.scope = scope;
  }

  toJSON(): BillingErrorBody {
    return {
      code: this.code,
      message: this.message,
      plan: this.plan,
      limit: this.limit,
      used: this.used,
      // 超限维度（daily=次日重置 / monthly=下月 1 日重置）：
      // 前端 apiErrors.QUOTA_EXCEEDED_DAILY 模板依赖此字段区分重置周期
      scope: this.scope,
    };
  }
}

/** 套餐数量上限错误（HTTP 403） */
export class PlanLimitError extends Error {
  readonly code: string;
  readonly plan: PlanTier;
  readonly limit: number;
  readonly resource: string;
  /** 当前已用量（可选）：只有调用方能给出真实计数的资源才传，前端据此分列展示而不是猜数字 */
  readonly used?: number;

  constructor(resource: string, plan: PlanTier, limit: number, code?: string, used?: number) {
    super(`当前套餐（${plan}）${resource}上限为 ${limit}，请升级套餐`);
    this.name = "PlanLimitError";
    this.plan = plan;
    this.limit = limit;
    this.resource = resource;
    this.code = code ?? "PLAN_LIMIT_REACHED";
    this.used = used;
  }

  toJSON(): BillingErrorBody {
    return {
      code: this.code,
      message: this.message,
      plan: this.plan,
      limit: this.limit,
      ...(this.used === undefined ? {} : { used: this.used }),
    };
  }
}

/** 判断是否为商业化错误 */
export function isBillingError(e: unknown): e is FeatureNotAllowedError | QuotaExceededError | PlanLimitError {
  return (
    e instanceof FeatureNotAllowedError ||
    e instanceof QuotaExceededError ||
    e instanceof PlanLimitError
  );
}

/**
 * 将商业化错误转为统一的 NextResponse JSON
 * 供 API 路由 catch 块统一调用
 */
export function billingErrorToResponse(e: FeatureNotAllowedError | QuotaExceededError | PlanLimitError): {
  status: number;
  body: BillingErrorBody;
} {
  if (e instanceof QuotaExceededError) {
    return { status: 429, body: e.toJSON() };
  }
  // FeatureNotAllowedError 和 PlanLimitError 均为 403
  return { status: 403, body: e.toJSON() };
}
