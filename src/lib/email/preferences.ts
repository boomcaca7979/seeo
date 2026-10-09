// ===== 用户邮件偏好 =====
// 营销**同意（opt-in）**与**退订（opt-out）**状态；事务性邮件不受影响。
//
// 2026-10-09：新增 `marketing_opt_in_at`（可核验的显式同意）。
// **注册 / 登录 / 试用 / 付费 / 尚未退订都不等于营销同意** —— 只有显式写入
// `marketing_opt_in_at` 才视为同意（见 `consent.ts` 的 `MARKETING_CONSENT_POLICY`）。

import { getAdapter } from "@/lib/db/migrations";
import crypto from "node:crypto";

/** 获取或创建退订 token */
export async function ensureUnsubscribeToken(userId: string, email: string): Promise<string> {
  const db = await getAdapter();
  const existing = await db.get(
    `SELECT unsubscribe_token FROM email_preferences WHERE user_id = ?`,
    [userId]
  ) as { unsubscribe_token: string | null } | undefined;
  if (existing?.unsubscribe_token) return existing.unsubscribe_token;

  const token = crypto.randomUUID().replace(/-/g, "");
  await db.run(
    `INSERT INTO email_preferences (user_id, email, unsubscribe_token)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email = excluded.email,
       unsubscribe_token = COALESCE(email_preferences.unsubscribe_token, excluded.unsubscribe_token),
       updated_at = datetime('now')`,
    [userId, email, token]
  );
  return token;
}

/** 退订营销邮件（按 token）；返回是否成功 */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const db = await getAdapter();
  const res = await db.run(
    `UPDATE email_preferences SET marketing_unsubscribed_at = datetime('now'), updated_at = datetime('now')
     WHERE unsubscribe_token = ? AND marketing_unsubscribed_at IS NULL`,
    [token]
  );
  return Number(res.changes ?? 0) > 0;
}

export async function isMarketingUnsubscribed(userId: string): Promise<boolean> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT marketing_unsubscribed_at FROM email_preferences WHERE user_id = ?`,
    [userId]
  ) as { marketing_unsubscribed_at: string | null } | undefined;
  return !!row?.marketing_unsubscribed_at;
}

/** 单次读取营销同意状态（一次查询同时取 opt-in 与 opt-out，避免两次往返） */
export interface MarketingConsent {
  /** 是否存在可核验的显式同意记录 */
  optedIn: boolean;
  /** 是否已退订营销 */
  unsubscribed: boolean;
}

export async function getMarketingConsent(userId: string): Promise<MarketingConsent> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT marketing_opt_in_at, marketing_unsubscribed_at FROM email_preferences WHERE user_id = ?`,
    [userId]
  ) as { marketing_opt_in_at: string | null; marketing_unsubscribed_at: string | null } | undefined;
  return {
    optedIn: !!row?.marketing_opt_in_at,
    unsubscribed: !!row?.marketing_unsubscribed_at,
  };
}

/**
 * 记录一次**可核验的显式营销同意**（唯一写入点）。
 * 幂等：已有同意时间则不覆盖（保留首次同意时间）。
 * 只有真实收集到用户主动同意时才可调用 —— 注册 / 登录 / 试用 / 付费流程**一律不得**调用。
 */
export async function grantMarketingConsent(userId: string, email: string): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `INSERT INTO email_preferences (user_id, email, marketing_opt_in_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       email = excluded.email,
       marketing_opt_in_at = COALESCE(email_preferences.marketing_opt_in_at, excluded.marketing_opt_in_at),
       updated_at = datetime('now')`,
    [userId, email]
  );
}
