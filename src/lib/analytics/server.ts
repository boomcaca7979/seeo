// ===== Marketing Analytics：服务端事件与归因 =====
// 单一事件模型（唯一入口 insertEvent / recordVisit / recordServerEvent）：
//   page_view / landing_view / audit_started / audit_completed / signup_started /
//   signup_completed / login_completed / activation_completed / returning_user /
//   pricing_viewed / upgrade_started / checkout_started / checkout_completed /
//   subscription_active / subscription_canceled / feature_used / payment_completed / logout
// 隐私约束：不落 token / cookie / 密码 / 支付卡信息；props 仅白名单化短字段。
//
// ⚠️ 事件契约为**追加式**：只允许新增事件名，不得重命名/删除既有事件
//（L 层 doctor 第 9 项从本文件源码解析事件名，历史数据也按旧名读取）。

import { getAdapter } from "@/lib/db/migrations";
import { normalizeTouch, sanitizeShort, type TouchInput } from "./sources";

/** 客户端可上报的事件（服务端事件由系统内部写入） */
export const CLIENT_EVENTS = [
  "page_view",
  "landing_view",
  "audit_started",
  "audit_completed",
  "signup_started",
  "signup_completed",
  "login_completed",
  "pricing_viewed",
  "upgrade_started",
  "feature_used",
  "logout",
] as const;

export const SERVER_EVENTS = [
  "activation_completed",
  "returning_user",
  "checkout_started",
  "checkout_completed",
  "subscription_active",
  "subscription_canceled",
  "payment_completed",
] as const;

export const ALL_EVENTS = [...CLIENT_EVENTS, ...SERVER_EVENTS] as const;
export type AnalyticsEventName = (typeof ALL_EVENTS)[number];

export function isClientEvent(name: string): name is (typeof CLIENT_EVENTS)[number] {
  return (CLIENT_EVENTS as readonly string[]).includes(name);
}

export interface AnalyticsEventInput {
  event: AnalyticsEventName;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  path?: string | null;
  locale?: string | null;
  referrer?: string | null;
  landingPage?: string | null;
  touch?: TouchInput | null;
  /** 关联业务对象（audit id / 订单号），用于漏斗去重 */
  refId?: string | null;
  props?: Record<string, unknown> | null;
}

const MAX_PROPS = 10;
const MAX_PROP_LEN = 200;

/** props 白名单化：值转字符串并截断，超量键丢弃，绝不透传嵌套对象/超长内容 */
function sanitizeProps(props: Record<string, unknown> | null | undefined): string | null {
  if (!props || typeof props !== "object") return null;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n >= MAX_PROPS) break;
    const key = sanitizeShort(k);
    const val = sanitizeShort(typeof v === "object" ? JSON.stringify(v) : String(v));
    if (!key || val === null) continue;
    out[key.slice(0, 40)] = val.slice(0, MAX_PROP_LEN);
    n++;
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/** 写入一条事件（唯一写入入口；字段统一清洗截断） */
export async function insertEvent(input: AnalyticsEventInput): Promise<void> {
  const db = await getAdapter();
  const touch = normalizeTouch(input.touch ?? {});
  await db.run(
    `INSERT INTO analytics_events
       (event_name, user_id, anonymous_id, session_id, path, locale, referrer,
        source, medium, campaign, content, term, landing_page, ref_id, props)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.event,
      input.userId ?? null,
      input.anonymousId ?? null,
      sanitizeShort(input.sessionId),
      sanitizeShort(input.path),
      sanitizeShort(input.locale),
      touch.referrerHost || null,
      touch.source,
      touch.medium,
      touch.campaign,
      touch.content,
      touch.term,
      sanitizeShort(input.landingPage ?? input.path),
      input.refId != null ? String(input.refId).slice(0, 120) : null,
      sanitizeProps(input.props),
    ]
  );
}

export interface VisitInput {
  anonymousId: string;
  sessionId?: string | null;
  path?: string | null;
  locale?: string | null;
  touch: TouchInput;
  /** 已登录时由服务端 session 推导，绝不来自客户端字段 */
  userId?: string | null;
}

/**
 * 记录一次页面访问：
 *   1. page_view 事件（source 为本次标准化来源）
 *   2. 身份归因：first_touch 只在首次写入（永不覆盖），last_touch 在有真实渠道时更新
 */
export async function recordVisit(input: VisitInput): Promise<void> {
  const db = await getAdapter();
  const touch = normalizeTouch(input.touch);
  const anonymousId = String(input.anonymousId).slice(0, 64);
  const userId = input.userId ?? null;
  const landingPage = sanitizeShort(input.path);

  await db.run(
    `INSERT INTO analytics_events
       (event_name, user_id, anonymous_id, session_id, path, locale, referrer,
        source, medium, campaign, content, term, landing_page, props)
     VALUES ('page_view', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      userId,
      anonymousId,
      sanitizeShort(input.sessionId),
      landingPage,
      sanitizeShort(input.locale),
      touch.referrerHost || null,
      touch.source,
      touch.medium,
      touch.campaign,
      touch.content,
      touch.term,
      landingPage,
    ]
  );

  // 归因 upsert：不存在则建档（first_touch = 本次），存在则只在有真实渠道时更新 last_touch
  if (touch.hasTouch) {
    await db.run(
      `INSERT INTO analytics_identities
         (anonymous_id, user_id,
          first_touch_source, first_touch_medium, first_touch_campaign,
          first_touch_content, first_touch_term,
          first_landing_page, first_referrer,
          last_touch_source, last_touch_medium, last_touch_campaign,
          last_landing_page, last_referrer, last_seen_at)
       VALUES (?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, datetime('now'))
       ON CONFLICT(anonymous_id) DO UPDATE SET
          last_touch_source = excluded.last_touch_source,
          last_touch_medium = excluded.last_touch_medium,
          last_touch_campaign = excluded.last_touch_campaign,
          last_landing_page = excluded.last_landing_page,
          last_referrer = excluded.last_referrer,
          last_seen_at = datetime('now')`,
      [
        anonymousId,
        userId,
        touch.source,
        touch.medium,
        touch.campaign,
        touch.content,
        touch.term,
        landingPage,
        touch.referrerHost || null,
        touch.source,
        touch.medium,
        touch.campaign,
        landingPage,
        touch.referrerHost || null,
      ]
    );
  } else {
    // 无渠道信息的访问：仅建档/更新活跃时间，不动 last_touch
    await db.run(
      `INSERT INTO analytics_identities
         (anonymous_id, user_id, first_landing_page, last_landing_page, last_seen_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(anonymous_id) DO UPDATE SET
          last_seen_at = datetime('now')`,
      [anonymousId, userId, landingPage, landingPage]
    );
  }

  // 已登录用户的访问：把身份行挂到账号（不覆盖他人绑定）
  if (userId) {
    await bindIdentity(anonymousId, userId);
  }
}

/**
 * 匿名身份 ↔ 账号绑定（注册/登录成功后由服务端调用）。
 * - 未绑定的行：绑定到当前用户；
 * - 已绑定同一用户：保留（更新绑定时间无意义，跳过）；
 * - 已绑定其他用户：拒绝（cookie/设备共享时不得覆盖他人归因）。
 * @returns 是否发生了新绑定
 */
export async function bindIdentity(anonymousId: string, userId: string): Promise<boolean> {
  const db = await getAdapter();
  // 只绑定未归属的行：已属于同一用户（幂等 no-op）或他人（防串号）均不改动
  const res = await db.run(
    `UPDATE analytics_identities SET user_id = ?, bound_at = datetime('now')
     WHERE anonymous_id = ? AND user_id IS NULL`,
    [userId, String(anonymousId).slice(0, 64)]
  );
  return Number(res.changes ?? 0) > 0;
}

/**
 * 激活判定（服务端唯一写入点）：
 * 定义 —— 注册用户第一次拥有一次「已完成」的 SEO Audit（新跑或认领均可）。
 * guest:{ip} / demo-user 不计入。同一用户只写一条。
 */
export async function trackActivationIfFirst(userId: string): Promise<boolean> {
  if (!userId || userId.startsWith("guest:") || userId === "demo-user") return false;
  const db = await getAdapter();
  const existing = await db.get(
    `SELECT id FROM analytics_events WHERE event_name = 'activation_completed' AND user_id = ? LIMIT 1`,
    [userId]
  );
  if (existing) return false;
  const firstTouch = await getFirstTouchForUser(userId);
  await insertEvent({ event: "activation_completed", userId, touch: firstTouch });
  return true;
}

/**
 * 回访判定：登录时若该用户在 24h 前已有任何事件（曾活跃过），记 returning_user。
 * 24h 内去重（重复登录不重复记）。
 */
export async function trackReturningIfEligible(userId: string): Promise<boolean> {
  const db = await getAdapter();
  // 历史活跃判定：账号名下事件 或 其绑定的匿名身份的历史事件（注册前行为也计入）
  const prior = await db.get(
    `SELECT e.id FROM analytics_events e
     WHERE (e.user_id = ?
        OR e.anonymous_id IN (SELECT anonymous_id FROM analytics_identities WHERE user_id = ?))
       AND e.created_at < datetime('now', '-24 hours') LIMIT 1`,
    [userId, userId]
  );
  if (!prior) return false;
  const recent = await db.get(
    `SELECT id FROM analytics_events
     WHERE event_name = 'returning_user' AND user_id = ?
       AND created_at >= datetime('now', '-24 hours') LIMIT 1`,
    [userId]
  );
  if (recent) return false;
  const firstTouch = await getFirstTouchForUser(userId);
  await insertEvent({ event: "returning_user", userId, touch: firstTouch });
  return true;
}

/** 支付成功（仅 webhook 确认真实付款后调用；opened=true 表示首次开通） */
export async function recordPaymentCompleted(args: {
  userId: string;
  outTradeNo: string;
  plan: string;
}): Promise<void> {
  const firstTouch = await getFirstTouchForUser(args.userId);
  await insertEvent({
    event: "payment_completed",
    userId: args.userId,
    refId: args.outTradeNo,
    touch: firstTouch,
    props: { plan: args.plan },
  });
}

// ---------- 经营漏斗：服务端事件（Owner Console） ----------
// 全部为**新增**事件，不与既有事件重复；归因统一取账号 first touch。

/** Checkout 已创建（服务端权威：Creem 返回 checkout_url 之后写入） */
export async function recordCheckoutStarted(args: {
  userId: string;
  outTradeNo: string;
  plan: string;
}): Promise<void> {
  const firstTouch = await getFirstTouchForUser(args.userId);
  await insertEvent({
    event: "checkout_started",
    userId: args.userId,
    refId: args.outTradeNo,
    touch: firstTouch,
    props: { plan: args.plan },
  });
}

/** Checkout 已完成（webhook 确认该笔 checkout 支付成功，与 orders 状态迁移同步） */
export async function recordCheckoutCompleted(args: {
  userId: string;
  outTradeNo: string;
  plan: string;
}): Promise<void> {
  const firstTouch = await getFirstTouchForUser(args.userId);
  await insertEvent({
    event: "checkout_completed",
    userId: args.userId,
    refId: args.outTradeNo,
    touch: firstTouch,
    props: { plan: args.plan },
  });
}

/** 订阅生效（首付成功或续费激活；subscriptionId 同时写 ref_id 便于排查） */
export async function recordSubscriptionActive(args: {
  userId: string;
  subscriptionId: string;
  plan?: string | null;
}): Promise<void> {
  const firstTouch = await getFirstTouchForUser(args.userId);
  await insertEvent({
    event: "subscription_active",
    userId: args.userId,
    refId: args.subscriptionId,
    touch: firstTouch,
    props: args.plan ? { plan: args.plan } : null,
  });
}

/** 订阅取消（仅记录事实，不改变会员权益 —— 权益仍由 orders + cron 自然降级） */
export async function recordSubscriptionCanceled(args: {
  userId: string;
  subscriptionId: string;
  plan?: string | null;
}): Promise<void> {
  const firstTouch = await getFirstTouchForUser(args.userId);
  await insertEvent({
    event: "subscription_canceled",
    userId: args.userId,
    refId: args.subscriptionId,
    touch: firstTouch,
    props: args.plan ? { plan: args.plan } : null,
  });
}

/**
 * 付费功能被实际使用（服务端；与客户端 trackFeatureUsed 写同名事件）。
 * 只记录「功能名」，不记录任何业务内容。失败静默 —— 埋点不得影响功能本身。
 */
export async function recordFeatureUsed(
  userId: string,
  feature: string,
  props?: Record<string, unknown> | null
): Promise<void> {
  if (!userId || userId.startsWith("guest:")) return;
  try {
    const firstTouch = await getFirstTouchForUser(userId);
    await insertEvent({
      event: "feature_used",
      userId,
      touch: firstTouch,
      props: { feature, ...(props ?? {}) },
    });
  } catch {
    // 埋点失败不影响业务
  }
}

/** 读取某匿名身份的归因（浏览器验证 / 调试用） */
export async function getIdentity(anonymousId: string): Promise<Record<string, unknown> | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT * FROM analytics_identities WHERE anonymous_id = ?`,
    [String(anonymousId).slice(0, 64)]
  );
  return (row as Record<string, unknown>) ?? null;
}

/** 按匿名身份取 first touch（注册/登录事件的归因来源） */
export async function getFirstTouchByAnonymousId(anonymousId: string): Promise<TouchInput | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT first_touch_source, first_touch_medium, first_touch_campaign
     FROM analytics_identities WHERE anonymous_id = ? AND first_touch_source IS NOT NULL`,
    [String(anonymousId).slice(0, 64)]
  ) as { first_touch_source: string; first_touch_medium: string | null; first_touch_campaign: string | null } | undefined;
  if (!row) return null;
  return {
    utmSource: row.first_touch_source,
    utmMedium: row.first_touch_medium,
    utmCampaign: row.first_touch_campaign,
  };
}

/**
 * 用户级 first touch：取该账号最早绑定的匿名身份的 first_touch。
 * 身份级事件（signup/activation/payment/returning）按此归因，
 * 使「Reddit 来的匿名访客 → 注册 → 付费」在来源分析中保持 Reddit。
 */
export async function getFirstTouchForUser(userId: string): Promise<TouchInput | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT first_touch_source, first_touch_medium, first_touch_campaign
     FROM analytics_identities
     WHERE user_id = ? AND first_touch_source IS NOT NULL
     ORDER BY first_seen_at ASC LIMIT 1`,
    [userId]
  ) as { first_touch_source: string; first_touch_medium: string | null; first_touch_campaign: string | null } | undefined;
  if (!row) return null;
  return {
    utmSource: row.first_touch_source,
    utmMedium: row.first_touch_medium,
    utmCampaign: row.first_touch_campaign,
  };
}
