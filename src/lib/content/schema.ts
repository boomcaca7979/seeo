// ===== F｜Content Bank 数据模型 =====
// 定位：内部营销内容资产库（不是博客工程、不是 CMS、不做自动发布）。
// 单一事实来源：seo-growth/content-bank.csv
//
// 事实纪律（§14）：
//   - 内容里出现 SEO score / 排名变化 / 流量变化时，必须来自真实数据
//   - 没有真实数据就不写具体数字。本 schema 不提供任何"演示数字"字段。
// 隐私（§13/§17）：
//   - 来自用户问题的主题只允许记录匿名化的问题描述，禁止邮箱 / 网址 / 姓名

import { CTA_IDS } from "./ctas.ts";

/** 内容类型（14 类） */
export const CONTENT_TYPES = [
  "SEO Problem",
  "SEO Education",
  "Audit Insight",
  "Keyword Research",
  "Technical SEO",
  "Content Optimization",
  "Rank Tracking",
  "Competitor SEO",
  "SaaS SEO",
  "Affiliate SEO",
  "Website Growth",
  "Product Education",
  "Founder Insight",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** 内容状态 */
export const CONTENT_STATUSES = [
  "Idea",
  "Draft",
  "Ready",
  "Published",
  "Repurpose",
  "Retired",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** 可分发渠道 */
export const CONTENT_CHANNELS = ["reddit", "indie_hackers", "linkedin", "x", "email"] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

/** 来源（§13，必须填写，且不得只写 "AI generated"） */
export const CONTENT_SOURCES = [
  "Product",
  "User Question",
  "Audit Pattern",
  "SEO Knowledge",
  "Community Discussion",
  "Founder Experience",
  "Public Data",
  "Search Intent",
] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

/** 复用间隔（天）：避免每天重复同一个主题 */
export const REUSE_GAPS = [14, 21, 30] as const;

/** CSV 列顺序 = Content Master 唯一 schema */
export const CONTENT_FIELDS = [
  "content_id",
  "title",
  "content_type",
  "audience",
  "problem",
  "core_point",
  "supporting_points",
  "example",
  "cta",
  "source",
  "source_detail",
  "channel_fit",
  "recommended_reuse_gap",
  "status",
  "email_compatible",
  "created_at",
  "last_used_at",
  "times_used",
  "notes",
] as const;
export type ContentField = (typeof CONTENT_FIELDS)[number];

export type ContentTopic = Record<ContentField, string>;

/** 多值字段（CSV 内用 " | " 分隔） */
export const LIST_SEPARATOR = " | ";

/**
 * 解析多值字段。分隔符为 "|"，两侧空格可选 ——
 * 因为主库可能被人工用表格软件编辑，不该因为 "a | b" 与 "a|b" 的差别而解析失败。
 */
export function splitList(v: string): string[] {
  return (v ?? "")
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function joinList(items: readonly string[]): string {
  return items.map((s) => s.trim()).join(LIST_SEPARATOR);
}

export function emptyTopic(): ContentTopic {
  const out = {} as ContentTopic;
  for (const f of CONTENT_FIELDS) out[f] = "";
  return out;
}

export function isContentType(v: string): v is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(v);
}

export function isContentStatus(v: string): v is ContentStatus {
  return (CONTENT_STATUSES as readonly string[]).includes(v);
}

export function isContentChannel(v: string): v is ContentChannel {
  return (CONTENT_CHANNELS as readonly string[]).includes(v);
}

export function isContentSource(v: string): v is ContentSource {
  return (CONTENT_SOURCES as readonly string[]).includes(v);
}

export function isCtaId(v: string): boolean {
  return CTA_IDS.includes(v);
}

export function isReuseGap(v: string): boolean {
  return (REUSE_GAPS as readonly number[]).map(String).includes(v);
}

/** 日期字段：created_at / last_used_at 用 YYYY-MM-DD（last_used_at 允许为空） */
export function isDateOrEmpty(v: string): boolean {
  if (v === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

export function isNonNegInt(v: string): boolean {
  return /^\d+$/.test(v);
}

/**
 * 主题质量下限（§20）。
 * 长度只是一个粗筛：低于这个字数基本只能是「SEO 很重要」这类一句话套话。
 * 真正的质量门槛是 BANNED_PHRASES + 必须给出 3–5 条支撑点 + 必须给出具体例子。
 */
export const MIN_PROBLEM_LEN = 25;
export const MIN_CORE_POINT_LEN = 25;
export const MIN_SUPPORTING_POINTS = 3;
export const MAX_SUPPORTING_POINTS = 5;

/**
 * 禁止出现在正文里的空泛套话（§7）。
 * 注意：这里刻意**不含** "best SEO tool" 等词 —— 内容里引用「目标关键词」是合法的
 * （例如解释 vanity keyword 时举例），那不属于我们自己的宣传话术。
 * 宣传话术的红线放在 CTA 库上，见 BANNED_CTA_PHRASES。
 */
export const BANNED_PHRASES: readonly string[] = [
  "SEO is important",
  "10 tips for SEO",
  "SEO will help your business",
  "top 10 SEO",
];

/** CTA 库不得出现的硬推销话术（§11） */
export const BANNED_CTA_PHRASES: readonly string[] = [
  "start now",
  "buy now",
  "best seo tool",
  "limited time",
  "act fast",
];
