// ===== G｜社区基地 数据模型 =====
// 定位：社区营销「基础设施」——账号/定位/规则/改稿流程/发布记录。
// **不是** 内容库：所有内容一律来自 F 的 Content Master（seo-growth/content-bank.csv）。
// **不是** 潜客库：潜客数据属于 E，G 不存任何联系方式。
//
// 事实纪律：
//   - 不虚构社区规则；无法确认的一律标 needs_manual_check（§14）
//   - 不使用 "Best" / "#1" / "revolutionary" 等无证据宣传（§5/§10）

/** G 只覆盖这 5 个渠道（§3） */
export const PLATFORMS = ["reddit", "indie_hackers", "linkedin", "x", "product_hunt"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * 平台 → B 的 canonical source。
 * 必须与 src/lib/analytics/sources.ts 的 CANONICAL_SOURCES 完全一致，
 * 由 community.test.ts 强制 —— G 不建立第二套 attribution。
 */
export const PLATFORM_UTM_SOURCE: Record<Platform, string> = {
  reddit: "reddit",
  indie_hackers: "indiehackers",
  linkedin: "linkedin",
  x: "x",
  product_hunt: "producthunt",
};

/** 平台展示名 */
export const PLATFORM_LABEL: Record<Platform, string> = {
  reddit: "Reddit",
  indie_hackers: "Indie Hackers",
  linkedin: "LinkedIn",
  x: "X",
  product_hunt: "Product Hunt",
};

/** 账号是否已建立（未建立就不要假设） */
export const PROFILE_STATUSES = ["not_created", "created", "needs_manual_check"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** 运营状态（§4） */
export const ACCOUNT_STATUSES = ["Planned", "Ready", "Active", "Paused"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** 发布记录状态（§13） */
export const POST_STATUSES = ["Draft", "Ready", "Published", "Removed", "Archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** 自我推广许可：无法确认时必须是 needs_manual_check，不得写 allowed */
export const SELF_PROMO_LEVELS = ["allowed", "restricted", "not_allowed", "needs_manual_check"] as const;
export type SelfPromoLevel = (typeof SELF_PROMO_LEVELS)[number];

/** 帖子里的 CTA 强度（§6）。社区第一目标是访问/审计/注册，不是付费。 */
export const CTA_LEVELS = ["none", "soft", "direct"] as const;
export type CtaLevel = (typeof CTA_LEVELS)[number];

/** 内容与社区的契合度 */
export const FIT_LEVELS = ["strong", "ok", "weak"] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

/** Community Master 列顺序（唯一 schema） */
export const MASTER_FIELDS = [
  "platform",
  "account_name",
  "profile_url",
  "profile_status",
  "status",
  "audience",
  "purpose",
  "positioning",
  "bio",
  "website",
  "primary_cta",
  "content_types",
  "posting_frequency",
  "rules_checked_at",
  "self_promo_notes",
  "link_policy",
  "frequency_notes",
  "notes",
] as const;
export type MasterField = (typeof MASTER_FIELDS)[number];
export type CommunityAccount = Record<MasterField, string>;

/** 发布记录列顺序（唯一 schema，不得出现第二个平行发布库） */
export const POST_FIELDS = [
  "post_id",
  "content_id",
  "platform",
  "community",
  "published_at",
  "url",
  "status",
  "cta",
  "notes",
] as const;
export type PostField = (typeof POST_FIELDS)[number];
export type CommunityPost = Record<PostField, string>;

export const LIST_SEPARATOR = " | ";

export function splitList(v: string): string[] {
  return (v ?? "")
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function joinList(items: readonly string[]): string {
  return items.map((s) => s.trim()).join(LIST_SEPARATOR);
}

export function emptyAccount(): CommunityAccount {
  const out = {} as CommunityAccount;
  for (const f of MASTER_FIELDS) out[f] = "";
  return out;
}

export function emptyPost(): CommunityPost {
  const out = {} as CommunityPost;
  for (const f of POST_FIELDS) out[f] = "";
  return out;
}

export function isPlatform(v: string): v is Platform {
  return (PLATFORMS as readonly string[]).includes(v);
}

export function isProfileStatus(v: string): v is ProfileStatus {
  return (PROFILE_STATUSES as readonly string[]).includes(v);
}

export function isAccountStatus(v: string): v is AccountStatus {
  return (ACCOUNT_STATUSES as readonly string[]).includes(v);
}

export function isPostStatus(v: string): v is PostStatus {
  return (POST_STATUSES as readonly string[]).includes(v);
}

export function isSelfPromoLevel(v: string): v is SelfPromoLevel {
  return (SELF_PROMO_LEVELS as readonly string[]).includes(v);
}

export function isCtaLevel(v: string): v is CtaLevel {
  return (CTA_LEVELS as readonly string[]).includes(v);
}

export function isDateOrEmpty(v: string): boolean {
  if (v === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

/** §5：禁止无证据的排名型/夸大宣传 */
export const BANNED_PROMO_PHRASES: readonly string[] = [
  "best seo",
  "best seo tool",
  "#1",
  "number one",
  "revolutionary",
  "world's best",
  "ai-powered everything",
  "guaranteed",
  "10x your traffic",
];

/** §19：Community Master 不得出现联系方式 / 凭据 */
export const FORBIDDEN_SECRET_PATTERNS: readonly { re: RegExp; why: string }[] = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, why: "不得存放邮箱" },
  { re: /(api[_-]?key|token|secret|password)\s*[:=]/i, why: "不得存放凭据" },
  { re: /^https?:\/\/(www\.)?(x|twitter|reddit|linkedin)\.com\/.*(password|token)/i, why: "不得存放凭据链接" },
];
