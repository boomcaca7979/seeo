// ===== G｜社区规则与契合度矩阵 =====
// 这里只放「社区维度」的事实：自我推广是否允许、链接政策、频率、以及
// 内容类型 × 平台的契合度。
//
// 重要（§14）：**没有实际核对过的规则一律标 needs_manual_check，不写 allowed。**
// 本文件是平台级规则的单一来源；community-master.csv 里的
// rules_checked_at / self_promo_notes 必须与之保持一致（有测试把关）。
//
// 写作格式不在本文件重复定义 —— 格式的单一来源是 F 的
// seo-growth/content/CHANNEL_PLAYBOOK.md，G 只做社区适配。

import { CONTENT_TYPES } from "../content/schema.ts";
import type { CtaLevel, FitLevel, Platform, SelfPromoLevel } from "./schema.ts";

export interface PlatformRule {
  platform: Platform;
  /** 是否实际核对过该平台的规则（空 = 未核对） */
  rulesCheckedAt: string;
  /** 自我推广许可；未核对时为 needs_manual_check */
  selfPromoAllowed: SelfPromoLevel;
  /** 链接政策说明；未核对时明确写 Needs Manual Check */
  linkPolicy: string;
  /** 频率建议（内部节流策略，不是平台规则） */
  frequencyNote: string;
  /** 该平台最看重什么（用于选主题） */
  audienceFocus: string;
}

export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  reddit: {
    platform: "reddit",
    rulesCheckedAt: "",
    selfPromoAllowed: "needs_manual_check",
    linkPolicy: "Needs Manual Check — 每个 subreddit 规则不同，发帖前必须逐个看侧栏规则",
    frequencyNote: "同一 subreddit 短期内不要重复发同一主题；优先参与已有讨论而不是新开帖",
    audienceFocus: "具体问题的排障讨论；最反感明显的推广口吻",
  },
  indie_hackers: {
    platform: "indie_hackers",
    rulesCheckedAt: "",
    selfPromoAllowed: "needs_manual_check",
    linkPolicy: "Needs Manual Check — 以 build/learn 叙述为主，链接放在语境里",
    frequencyNote: "以里程碑或真实学习为节奏，不要按日历硬发",
    audienceFocus: "独立开发者与早期 SaaS 创始人；关心做法与取舍",
  },
  linkedin: {
    platform: "linkedin",
    rulesCheckedAt: "",
    selfPromoAllowed: "needs_manual_check",
    linkPolicy: "Needs Manual Check — 外链通常压低触达，优先把洞察写在正文",
    frequencyNote: "保持稳定节奏即可，避免同日连发多条同主题",
    audienceFocus: "从业者与决策者；关心可复用的方法与判断依据",
  },
  x: {
    platform: "x",
    rulesCheckedAt: "",
    selfPromoAllowed: "needs_manual_check",
    linkPolicy: "Needs Manual Check — 外链影响触达，CTA 尽量放在最后一条",
    frequencyNote: "同主题短帖与 thread 不要在同一天重复",
    audienceFocus: "SEO 与独立开发者圈子；短、具体、可验证",
  },
  product_hunt: {
    platform: "product_hunt",
    rulesCheckedAt: "",
    selfPromoAllowed: "needs_manual_check",
    linkPolicy: "Needs Manual Check — launch 当天规则与展示位要求需现场核对",
    frequencyNote: "一次性 launch，不重复 submission（本轮不 launch）",
    audienceFocus: "早期采用者；关心产品到底解决什么问题",
  },
};

/**
 * 内容类型 × 平台契合度矩阵。
 * `cta` 为建议的 CTA 强度：社区第一目标是访问 / 审计 / 注册，而非即时付费（§12）。
 */
export interface FitCell {
  fit: FitLevel;
  cta: CtaLevel;
  /** 自我推广许可继承平台规则；此处显式冗余，便于逐条核对 */
  selfPromoAllowed: SelfPromoLevel;
}

const STRONG = (cta: CtaLevel): FitCell => ({ fit: "strong", cta, selfPromoAllowed: "needs_manual_check" });
const OK = (cta: CtaLevel): FitCell => ({ fit: "ok", cta, selfPromoAllowed: "needs_manual_check" });
const WEAK = (cta: CtaLevel): FitCell => ({ fit: "weak", cta, selfPromoAllowed: "needs_manual_check" });

/** 每个平台对 13 种内容类型的契合度 */
export const PLATFORM_FIT: Record<Platform, Record<string, FitCell>> = {
  reddit: {
    "SEO Problem": STRONG("soft"),
    "SEO Education": STRONG("none"),
    "Audit Insight": STRONG("soft"),
    "Keyword Research": OK("soft"),
    "Technical SEO": STRONG("soft"),
    "Content Optimization": OK("soft"),
    "Rank Tracking": OK("none"),
    "Competitor SEO": OK("none"),
    "SaaS SEO": OK("soft"),
    "Affiliate SEO": STRONG("none"),
    "Website Growth": STRONG("soft"),
    "Product Education": WEAK("soft"),
    "Founder Insight": WEAK("none"),
  },
  indie_hackers: {
    "SEO Problem": OK("soft"),
    "SEO Education": OK("none"),
    "Audit Insight": OK("soft"),
    "Keyword Research": OK("none"),
    "Technical SEO": OK("none"),
    "Content Optimization": OK("none"),
    "Rank Tracking": WEAK("none"),
    "Competitor SEO": OK("none"),
    "SaaS SEO": STRONG("soft"),
    "Affiliate SEO": OK("none"),
    "Website Growth": STRONG("soft"),
    "Product Education": OK("soft"),
    "Founder Insight": STRONG("soft"),
  },
  linkedin: {
    "SEO Problem": STRONG("soft"),
    "SEO Education": STRONG("soft"),
    "Audit Insight": STRONG("soft"),
    "Keyword Research": OK("soft"),
    "Technical SEO": OK("soft"),
    "Content Optimization": OK("soft"),
    "Rank Tracking": OK("soft"),
    "Competitor SEO": STRONG("soft"),
    "SaaS SEO": STRONG("soft"),
    "Affiliate SEO": OK("none"),
    "Website Growth": STRONG("soft"),
    "Product Education": WEAK("soft"),
    "Founder Insight": STRONG("soft"),
  },
  x: {
    "SEO Problem": STRONG("soft"),
    "SEO Education": OK("none"),
    "Audit Insight": STRONG("soft"),
    "Keyword Research": OK("none"),
    "Technical SEO": OK("none"),
    "Content Optimization": OK("none"),
    "Rank Tracking": OK("none"),
    "Competitor SEO": OK("none"),
    "SaaS SEO": OK("soft"),
    "Affiliate SEO": OK("none"),
    "Website Growth": OK("soft"),
    "Product Education": WEAK("soft"),
    "Founder Insight": STRONG("soft"),
  },
  product_hunt: {
    "SEO Problem": OK("none"),
    "SEO Education": WEAK("none"),
    "Audit Insight": OK("none"),
    "Keyword Research": WEAK("none"),
    "Technical SEO": OK("none"),
    "Content Optimization": WEAK("none"),
    "Rank Tracking": WEAK("none"),
    "Competitor SEO": WEAK("none"),
    "SaaS SEO": OK("soft"),
    "Affiliate SEO": WEAK("none"),
    "Website Growth": OK("soft"),
    "Product Education": STRONG("soft"),
    "Founder Insight": OK("soft"),
  },
};

/** 该平台上最值得先做的一批内容类型（供每天选主题） */
export function strongTypesFor(platform: Platform): string[] {
  const map = PLATFORM_FIT[platform];
  return CONTENT_TYPES.filter((t) => map[t]?.fit === "strong");
}

/** 内容类型 × 平台矩阵是否覆盖全部类型 */
export function matrixCoversAllTypes(platform: Platform): boolean {
  const map = PLATFORM_FIT[platform];
  return CONTENT_TYPES.every((t) => Boolean(map[t]));
}
