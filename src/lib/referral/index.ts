// ===== K｜Referral / Share Base：唯一 canonical source =====
//
// ## 设计立场
// B 阶段已经建立了完整的归因基础设施，K **不重复建一套**：
//   - 表 `analytics_identities`（anonymous_id / user_id / first_touch_* / last_touch / landing pages）
//   - `recordVisit()`：first_touch **永不覆盖**，last_touch 只在有真实渠道时更新
//   - `bindIdentity(anonymousId, userId)`：匿名 → 登录身份的承接
//   - 事件契约 `CLIENT_EVENTS` / `SERVER_EVENTS`（props 白名单化）
// 因此 K 的实现是**纯逻辑层 + 最小客户端持久化**，**零数据库迁移、零新事件名**。
//
// ## 三个派生视图，而不是三个新事件
// 用户要求区分 referral_visit / referral_signup / referral_activation。K 不新造事件，
// 而是从 B 的既有数据**派生**：
//   referral_visit      = 某 anonymous_id 的 first_touch_content 是一个合法 referral code
//   referral_signup     = 该 anonymous_id 已被 bindIdentity 到某个 user_id
//   referral_activation = 该 user 存在 B 的 activation_completed（沿用 B 的 activation 定义）
//
// ## 已确认的 B 行为（实测，不是假设）
//   normalizeTouch({ utmSource: "referral" }) → { source: "other", medium: "referral", hasTouch: true }
//   原因：B 的 CANONICAL_SOURCES 是冻结的，不含 "referral"。
//   因此 code 必须走 utm_content（落到 first_touch_content）才能无损保存。
//   → 「把 referral 加进 CANONICAL_SOURCES」是一个**未决项**，见 OPEN_ITEMS，K1 不做（B 已封板）。

import type { Locale } from "@/i18n/config";

// ================= 1. 数据模型（最小化） =================

/** referral code 的形状：R + 10 位随机 + 1 位校验 = 12 字符 */
export const CODE_PREFIX = "R";
export const CODE_BODY_LENGTH = 10;
export const CODE_LENGTH = CODE_PREFIX.length + CODE_BODY_LENGTH + 1;

/**
 * 去歧义字母表（去掉 0 O 1 I L U），避免人工抄写/口述出错。
 * 32 个字符 → 10 位 ≈ 50 bit 熵：不可通过递增推测用户。
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 公开的查询参数名（唯一入口，不要出现第二个别名） */
export const REFERRAL_QUERY_PARAM = "ref";

/** 客户端持久化键（与 B 的 seeo:aid / seeo:sid 同风格） */
export const REFERRAL_STORAGE_KEY = "seeo:ref";

/** 归因有效期（天）。超过即视为过期，正常降级、不报错、不阻塞 */
export const REFERRAL_TTL_DAYS = 90;

/** 归属关系：谁分享的（不暴露身份，只记录「本次来源是某个 referral code」） */
export interface ReferralAttribution {
  code: string;
  /** 首次记录时间（ISO） */
  firstSeenAt: string;
  /** 最近一次见到该 code 的时间（ISO） */
  lastSeenAt: string;
  /** 见到次数（同一浏览器内；用于去重与「刷新不重复计数」） */
  seenCount: number;
  /** 归因来源标识，固定为 referral（供 B 的 medium/content 维度使用） */
  source: "referral";
}

export type ReferralEventView = "referral_visit" | "referral_signup" | "referral_activation";

// ================= 2. code：生成 / 校验 / 解析 =================

/** 由注入的随机源生成一个不透明的 referral code（默认可传 crypto） */
export function generateReferralCode(random: (n: number) => Uint8Array): string {
  const bytes = random(CODE_BODY_LENGTH);
  let body = "";
  for (let i = 0; i < CODE_BODY_LENGTH; i++) {
    body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return CODE_PREFIX + body + checksumChar(body);
}

function checksumChar(body: string): string {
  let sum = 0;
  for (const ch of body) {
    const idx = CODE_ALPHABET.indexOf(ch);
    if (idx < 0) return "";
    sum += idx;
  }
  return CODE_ALPHABET[sum % CODE_ALPHABET.length];
}

/** 规范化：去空格、转大写（用户手抄时常见） */
export function normalizeReferralCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * 校验 code。非法一律返回 false，调用方必须**安全忽略**（不得报错、不得阻塞）。
 * 校验包含：前缀、长度、字母表、校验位。
 */
export function isValidReferralCode(raw: string): boolean {
  const code = normalizeReferralCode(raw);
  if (code.length !== CODE_LENGTH) return false;
  if (!code.startsWith(CODE_PREFIX)) return false;
  const body = code.slice(1, 1 + CODE_BODY_LENGTH);
  const check = code.slice(-1);
  for (const ch of body) if (!CODE_ALPHABET.includes(ch)) return false;
  return checksumChar(body) === check;
}

/** 不暴露身份：code 里不得含有任何可反推用户的字符形态（纯字母数字、无分隔符） */
export function isOpaqueCode(raw: string): boolean {
  const code = normalizeReferralCode(raw);
  return /^[A-Z0-9]+$/.test(code) && !/[0O1ILU]/.test(code.slice(1));
}

// ================= 3. share link：构造 / 解析 =================

export interface ShareLinkInput {
  code: string;
  /** 落点路径（默认首页；不做 referral landing page） */
  path?: string;
  locale?: Locale;
  origin?: string;
}

/**
 * 生成分享链接。
 * **刻意不带任何 utm_* 参数** —— 避免污染真实 UTM 归因；code 由客户端在 track 时
 * 注入 utm_content（见 buildTouchFromReferral）。
 */
export function buildShareUrl(input: ShareLinkInput): string {
  const origin = input.origin ?? "https://www.seeo.asia";
  const path = input.path ?? "/";
  const withLocale = input.locale === "zh" ? (path === "/" ? "/zh" : `/zh${path}`) : path;
  const url = new URL(withLocale === "/" ? `${origin}/` : `${origin}${withLocale}`);
  url.searchParams.set(REFERRAL_QUERY_PARAM, normalizeReferralCode(input.code));
  return url.toString();
}

export interface ParsedShareUrl {
  code: string | null;
  /** 解析失败的原因（用于诊断，不用于向用户报错） */
  reason: "ok" | "missing" | "invalid";
}

/** 从 URL 解析 referral code。任何异常都安全降级为 missing/invalid。 */
export function parseReferralFromUrl(rawUrl: string): ParsedShareUrl {
  try {
    const url = new URL(rawUrl, "https://www.seeo.asia");
    const value = url.searchParams.get(REFERRAL_QUERY_PARAM);
    if (!value) return { code: null, reason: "missing" };
    const code = normalizeReferralCode(value);
    if (!isValidReferralCode(code)) return { code: null, reason: "invalid" };
    return { code, reason: "ok" };
  } catch {
    return { code: null, reason: "missing" };
  }
}

// ================= 4. 归因策略 =================

/**
 * 记录一次 referral 到访（纯函数，便于测试真实行为）。
 * 规则：
 *   - 首次：建档（firstSeenAt = lastSeenAt = now，seenCount = 1）
 *   - 再次：**不覆盖 firstSeenAt**（first-touch 语义），只更新 lastSeenAt 并 seenCount+1
 *   - 已有**另一个**有效 code：不覆盖（first-touch wins），返回原值
 *   - code 非法 / 过期：返回原值（安全降级，不报错）
 */
export function recordReferralSeen(
  current: ReferralAttribution | null,
  code: string,
  now: Date
): ReferralAttribution | null {
  if (!isValidReferralCode(code)) return current;
  const normalized = normalizeReferralCode(code);
  const nowIso = now.toISOString();

  if (current && isAttributionFresh(current, now)) {
    if (current.code === normalized) {
      return { ...current, lastSeenAt: nowIso, seenCount: current.seenCount + 1 };
    }
    return current; // first-touch wins：不覆盖已有有效归因
  }

  return {
    code: normalized,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    seenCount: 1,
    source: "referral",
  };
}

/** 归因是否仍在有效期内 */
export function isAttributionFresh(attr: ReferralAttribution | null, now: Date): boolean {
  if (!attr) return false;
  const first = Date.parse(attr.firstSeenAt);
  if (Number.isNaN(first)) return false;
  const days = (now.getTime() - first) / 86_400_000;
  return days >= 0 && days <= REFERRAL_TTL_DAYS;
}

/**
 * 自助分享防护：分享者不能给自己算转化。
 * K1 只做可判定的明显情况：当前已登录身份与该 code 的**归属者**相同 → 拒绝。
 * 归属者由调用方提供（K1 没有数据库，故以参数注入，保持零迁移）。
 */
export function isSelfReferral(args: {
  viewerUserId: string | null;
  /** code 归属者的用户标识（由你的查询提供；没有则为 null/未知） */
  ownerUserId: string | null;
}): boolean {
  if (!args.viewerUserId || !args.ownerUserId) return false; // 未知不算自助，但也不会据此计转化
  return args.viewerUserId === args.ownerUserId;
}

/**
 * 去重：同一 (identity, code, event view) 只能计一次。
 * 用于「刷新不重复计数 / 同一注册身份不重复累计」。
 */
export function shouldCountConversion(args: {
  /** 已记录过的键（由调用方从自身存储/B 的表中给出） */
  seenKeys: readonly string[];
  eventView: ReferralEventView;
  userId: string | null;
  code: string;
}): boolean {
  if (!args.userId) return false; // 没有身份就不算转化（只算 visit）
  const key = conversionKey(args.eventView, args.userId, args.code);
  return !args.seenKeys.includes(key);
}

export function conversionKey(eventView: ReferralEventView, userId: string, code: string): string {
  return `${eventView}:${userId}:${normalizeReferralCode(code)}`;
}

// ================= 5. 与 B 的映射（不新增事件、不新增 source） =================

/** referral 在 B 的维度上的落点（实测行为，不是猜测） */
export const B_MAPPING = {
  /**
   * 实测：utm_source=referral → normalizeTouch 返回 source="other"（B 的 CANONICAL_SOURCES
   * 不含 referral），medium="referral"，hasTouch=true。
   */
  utmSourceValue: "referral",
  normalizedSource: "other" as const,
  /** code 走 utm_content → 落到 analytics_identities.first_touch_content（无损） */
  codeCarrier: "utm_content" as const,
  persistedColumn: "first_touch_content" as const,
  /** 复用 B 的哪张表 / 哪个函数 */
  reusedTable: "analytics_identities" as const,
  reusedFunctions: ["recordVisit", "bindIdentity", "getFirstTouchByAnonymousId", "trackActivationIfFirst"] as const,
  /** K 不新增任何事件名 */
  newEventNames: [] as const,
  /** K 不新增任何 canonical source */
  newCanonicalSources: [] as const,
} as const;

export interface ReferralTouch {
  utmSource: string;
  utmContent: string;
}

/**
 * 构造要交给 B 的 touch 片段。
 * 规则：**只有当本次请求没有真实 UTM 参数时才注入**，绝不覆盖真实渠道归因。
 */
export function buildTouchFromReferral(
  code: string | null,
  existing: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; utmContent?: string | null }
): ReferralTouch | null {
  if (!code || !isValidReferralCode(code)) return null;
  const hasRealUtm = Boolean(existing.utmSource || existing.utmMedium || existing.utmCampaign || existing.utmContent);
  if (hasRealUtm) return null; // 不污染真实 UTM 归因
  return { utmSource: B_MAPPING.utmSourceValue, utmContent: normalizeReferralCode(code) };
}

/** 从 B 的 first_touch_content 反解 referral code（复用 B 的数据，不另存一份） */
export function referralCodeFromTouchContent(content: string | null | undefined): string | null {
  if (!content) return null;
  const code = normalizeReferralCode(content);
  return isValidReferralCode(code) ? code : null;
}

/**
 * 派生三个视图（不新造事件）。
 * 输入全部来自 B 已管理的数据，K 不重复存储。
 */
export function deriveReferralViews(input: {
  anonymousId: string | null;
  userId: string | null;
  firstTouchContent: string | null;
  hasActivationEvent: boolean;
}): { visit: boolean; signup: boolean; activation: boolean; code: string | null } {
  const code = referralCodeFromTouchContent(input.firstTouchContent);
  const visit = Boolean(code && input.anonymousId);
  const signup = Boolean(code && input.userId);
  // activation 沿用 B 的定义：B 侧存在 activation_completed
  const activation = Boolean(signup && input.hasActivationEvent);
  return { visit, signup, activation, code };
}

// ================= 6. 隐私 =================

/** 绝不允许出现在 referral URL / 归因记录里的东西 */
export const FORBIDDEN_IN_URL: readonly { re: RegExp; why: string }[] = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, why: "邮箱" },
  { re: /(?:\+?86[-\s]?)?1[3-9]\d{9}/, why: "手机号" },
  { re: /\b(?:eyJ[A-Za-z0-9_-]{10,}|sb_[a-z]+_[A-Za-z0-9_-]{10,}|re_[A-Za-z0-9]{16,})\b/, why: "token / key" },
  { re: /\b(?:password|passwd|secret|token|session|auth)\b/i, why: "凭据类参数名" },
  { re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, why: "UUID（可能是内部 user id）" },
];

/** 校验一个 referral URL 是否满足隐私要求（测试与 CLI 共用） */
export function urlPrivacyIssues(url: string): string[] {
  const issues: string[] = [];
  for (const { re, why } of FORBIDDEN_IN_URL) {
    if (re.test(url)) issues.push(`URL 含${why}`);
  }
  const u = new URL(url);
  const allowed = new Set([REFERRAL_QUERY_PARAM, "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);
  for (const key of u.searchParams.keys()) {
    if (!allowed.has(key)) issues.push(`URL 含未许可的参数 ?${key}`);
  }
  if (u.searchParams.has(REFERRAL_QUERY_PARAM)) {
    const v = u.searchParams.get(REFERRAL_QUERY_PARAM)!;
    if (v.includes("@") || v.includes("_") || v.length > 24) issues.push("ref 参数形态可疑");
  }
  return issues;
}

// ================= 7. 规则 / 未决项 / 人工项（文档化，供 CLI 输出） =================

export const REFERRAL_RULES = {
  queryParam: REFERRAL_QUERY_PARAM,
  codeFormat: `${CODE_PREFIX} + ${CODE_BODY_LENGTH} 位（去歧义字母表）+ 1 位校验 = ${CODE_LENGTH} 字符`,
  codeEntropyBits: 50,
  ttlDays: REFERRAL_TTL_DAYS,
  firstTouch: "首次记录即固定，后续同 code 只更新时间与次数；出现另一个有效 code 时不覆盖（first-touch wins）",
  lastTouch: "last_touch 由 B 的 recordVisit 负责，且有真实渠道时才更新；K 不参与、不覆盖",
  selfReferral: "分享者本人访问自己的 code 不计转化（K1 只处理可判定的明确情况）",
  dedupe: "同一 (identity, code, 视图) 只计一次；没有 userId 时只算 visit，不算 signup/activation",
  anonymousToSignedIn: "沿用 B：匿名期 first_touch 已写入 analytics_identities；bindIdentity 负责承接，K 不需要用户重填 code",
  invalidCode: "安全忽略：不报错、不阻塞页面、不写入任何归因",
  expired: `超过 ${REFERRAL_TTL_DAYS} 天的归因视为过期，重新访问会按新归因处理`,
  seo: "referral URL 不进 sitemap、不建 landing page、canonical 仍指向正常页面；参数化 URL 不产生可索引页面",
  ui: "只允许一个极轻量分享入口（copy / Web Share / fallback），不做积分、奖励、排行榜、联盟",
} as const;

export const OPEN_ITEMS: readonly { id: string; status: "NEEDS DECISION" | "BLOCKED" | "NEED MANUAL"; detail: string }[] = [
  {
    id: "K-OPEN-1",
    status: "NEEDS DECISION",
    detail:
      "B 的 CANONICAL_SOURCES 不含 referral，因此 utm_source=referral 会被归一化成 source=\"other\"（实测）。是否把 referral 加进 B 的白名单需要你决定 —— B 已封板，K1 未改。当前 code 走 utm_content，归因无损可反解。",
  },
  {
    id: "K-OPEN-2",
    status: "NEEDS DECISION",
    detail: "referral code 的归属者（owner）当前没有存储（零迁移）。若要做「自助分享防护」的严格版本，需要一处能反查 code→owner 的存储。",
  },
  {
    id: "K-OPEN-3",
    status: "NEED MANUAL",
    detail: "分享入口组件已实现但**未挂载**到任何页面，因此真实浏览器端到端流程尚未人工验证（挂载点建议 /app）。",
  },
  {
    id: "K-OPEN-4",
    status: "NEED MANUAL",
    detail: "code 失效 / 撤销只做了格式与时效校验，没有服务端撤销名单；真实撤销行为未验证。",
  },
];

export const MANUAL_CHECKS: readonly string[] = [
  "在真实浏览器里从 /app 复制分享链接，确认剪贴板内容正确",
  "用无痕窗口打开该链接，确认归因被记录且页面正常（不要求登录）",
  "在无痕窗口完成注册，确认归因被承接（不要求用户重新输入 code）",
  "确认完成一次真实 activation 后，派生视图 activation 变为 true 且不重复计数",
  "确认分享者本人打开自己的链接不会计转化",
  "确认刷新页面不会重复累计 visit/seenCount 之外的转化计数",
  "确认 referral URL 未进入 sitemap，且 canonical 仍指向正常页面",
];
