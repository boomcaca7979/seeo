// ===== 用户邮件偏好 =====
// unsubscribe token 管理与营销退订状态；事务性邮件不受退订影响。

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
     ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, updated_at = datetime('now')`,
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
