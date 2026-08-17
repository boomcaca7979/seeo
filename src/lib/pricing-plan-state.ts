// ===== Pricing 页卡片状态机 =====
// 根据当前用户套餐（effectivePlan）决定每张套餐卡的徽章与 CTA 状态。
// 纯函数，供 pricing/page.tsx 与单元测试共用，保证 UI 规则与后端
// canPurchasePlan（src/lib/billing.ts）一致：
//   匿名 / free：lite/pro 均可购买（升级到 Lite / 升级到 Pro）
//   lite：lite 卡 = 当前套餐 + 续费 30 天；pro 卡 = 升级到 Pro
//   pro：lite 卡 = 不可降级（disabled）；pro 卡 = 当前套餐 + 续费 30 天
//
// currentPlan 语义：
//   undefined → 用户状态加载中（按钮 disabled，避免闪烁误导）
//   null       → 未登录（anonymous，按 free 规则展示）

import type { PlanTier } from "@/lib/auth";

export interface PlanCardBase {
  ctaLabel: string;
  ctaHref?: string;
  checkoutPlan?: "lite" | "pro";
  highlighted?: boolean;
}

export interface PlanCardLabels {
  /** 当前套餐续费 CTA 文案（按 locale 由调用方传入） */
  renew: string;
  /** 不可降级 CTA 文案（按 locale 由调用方传入） */
  noDowngrade: string;
}

export interface PlanCardState {
  /** 卡片徽章：当前套餐优先于推荐 */
  badge: "current" | "recommended" | null;
  /** CTA 按钮文案 */
  ctaLabel: string;
  /** 按钮禁用（加载中 / 不可降级） */
  disabled: boolean;
  /** 行为类型：checkout = 发起支付；link = 跳转；none = 无动作（禁用按钮） */
  kind: "checkout" | "link" | "none";
  checkoutPlan?: "lite" | "pro";
  ctaHref?: string;
}

// 默认文案（中文）：保持既有调用与测试兼容；双语页面按 locale 覆盖
const DEFAULT_LABELS: PlanCardLabels = {
  renew: "续费 30 天",
  noDowngrade: "不可降级",
};

export function getPlanCardState(
  currentPlan: PlanTier | null | undefined,
  cardPlan: PlanTier,
  base: PlanCardBase,
  labels: PlanCardLabels = DEFAULT_LABELS
): PlanCardState {
  // 加载中：保持原文案但禁用，避免先显示「升级到 Lite」再闪变为「当前套餐」
  if (currentPlan === undefined) {
    return {
      badge: base.highlighted ? "recommended" : null,
      ctaLabel: base.ctaLabel,
      disabled: true,
      kind: base.checkoutPlan ? "checkout" : "link",
      checkoutPlan: base.checkoutPlan,
      ctaHref: base.ctaHref,
    };
  }

  // 免费卡 / 匿名与 free 用户：保持后端下发的默认展示
  if (cardPlan === "free" || currentPlan === null || currentPlan === "free") {
    return {
      badge: base.highlighted ? "recommended" : null,
      ctaLabel: base.ctaLabel,
      disabled: false,
      kind: base.checkoutPlan ? "checkout" : "link",
      checkoutPlan: base.checkoutPlan,
      ctaHref: base.ctaHref,
    };
  }

  // 已登录付费用户看付费卡
  if (cardPlan === currentPlan) {
    // 当前套餐：同档允许续费 30 天
    return {
      badge: "current",
      ctaLabel: labels.renew,
      disabled: false,
      kind: "checkout",
      checkoutPlan: base.checkoutPlan,
    };
  }

  if (cardPlan === "lite" && currentPlan === "pro") {
    // Pro 用户看 Lite 卡：不可降级
    return {
      badge: null,
      ctaLabel: labels.noDowngrade,
      disabled: true,
      kind: "none",
    };
  }

  // lite 用户看 pro 卡：升级
  return {
    badge: base.highlighted ? "recommended" : null,
    ctaLabel: base.ctaLabel,
    disabled: false,
    kind: "checkout",
    checkoutPlan: base.checkoutPlan,
  };
}
