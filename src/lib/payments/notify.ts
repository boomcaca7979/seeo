// ===== 老板付款通知（支付成功 → 邮件）=====
//
// 触发时机（唯一权威：Creem webhook 服务器确认）：
//   - checkout.completed 且 completeOrder 真实开通（result.opened=true）→ 首次付款通知
//     （重投时 opened=false，天然不重复触发；事件账本 + opened 双保险）
//   - subscription.paid/active 且 syncSubscriptionPeriod 成功 → 续费通知
//     （dedupe_key = 订阅 + 交易/周期，无法可靠去重时不入队）
// 未付款 / 支付失败 / 未完成结账 / 进入 checkout 页面 —— 一律不产生通知。
//
// 可靠性：
//   - payment_notifications 持久化：dedupe_key 唯一 → 同一笔支付只发一封
//   - 状态区分 pending / sent / failed，保留最近错误与重试次数
//   - 发送失败不阻塞支付（本模块所有对外调用不抛错到 webhook 流程）
//   - 重试：失败后由 cron（/api/payments/notify/retry，Bearer CRON_SECRET）与
//     老板后台手动重试按钮重新投递，MAX_ATTEMPTS 封顶
//   - Resend Idempotency-Key = dedupe_key：即使「邮件已发出但状态写回失败」，
//     重试也不会在 Resend 服务端重复投递（幂等窗口内）
//
// 复用：Resend 配置 / 发件域名 / 统一发送层（sendTransactionalEmail，落 email_log）。

import { getAdapter } from "@/lib/db/migrations";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "@/lib/email/service";

/** 通知接收人（老板邮箱；可用环境变量覆盖） */
export function getOwnerNotifyEmail(): string {
  return process.env.OWNER_NOTIFY_EMAIL ?? "boomcaca666@gmail.com";
}

export const PAYMENT_NOTIFY_MAX_ATTEMPTS = 5;

export type PaymentNotificationKind = "first_payment" | "renewal";

export interface PaymentNotificationPayload {
  /** 服务器确认支付的时间（ISO） */
  paidAt: string;
  /** 客户邮箱：Creem 支付事件真实字段，缺失时回退账号 profiles.email，均无则 null */
  customerEmail: string | null;
  plan: string;
  /** Creem 产品名（真实字段，可空） */
  productName: string | null;
  /** 实付金额（元，来自订单/事件，已通过金额校验） */
  amount: number;
  currency: string;
  outTradeNo: string;
  transactionId: string | null;
  /** Creem 订阅 id（续费通知用于 dedupe；首付为 null） */
  subscriptionId: string | null;
  kind: PaymentNotificationKind;
  /** 续费的新周期结束时间（仅续费时有意义，可空） */
  periodEndIso: string | null;
}

/** 首付 dedupe key：一笔订单只发一封 */
export function firstPaymentDedupeKey(outTradeNo: string): string {
  return `pay:${outTradeNo}`;
}

/** 续费 dedupe key：订阅 + 交易号或周期；两者都缺 → null（无法可靠去重，不入队） */
export function renewalDedupeKey(
  subscriptionId: string | null | undefined,
  transactionId: string | null | undefined,
  periodEndIso: string | null | undefined
): string | null {
  if (!subscriptionId) return null;
  if (transactionId) return `renew:${subscriptionId}:${transactionId}`;
  if (periodEndIso) return `renew:${subscriptionId}:${periodEndIso}`;
  return null;
}

/** 入队（幂等：dedupe_key 已存在则不重复入队）。返回通知 id（供即时投递）；失败不抛错（不影响支付链路）。 */
export async function queuePaymentNotification(
  payload: PaymentNotificationPayload
): Promise<number | null> {
  try {
    const db = await getAdapter();
    const dedupeKey =
      payload.kind === "first_payment"
        ? firstPaymentDedupeKey(payload.outTradeNo)
        : renewalDedupeKeyForPayload(payload);
    await db.run(
      `INSERT OR IGNORE INTO payment_notifications (dedupe_key, kind, status, payload_json)
       VALUES (?, ?, 'pending', ?)`,
      [dedupeKey, payload.kind, JSON.stringify(payload)]
    );
    const row = (await db.get(`SELECT id FROM payment_notifications WHERE dedupe_key = ?`, [
      dedupeKey,
    ])) as { id: number } | undefined;
    return row ? Number(row.id) : null;
  } catch (err) {
    // 通知入队失败绝不影响支付确认
    console.error("[PaymentNotify] 入队失败（不影响支付）:", err);
    return null;
  }
}

function renewalDedupeKeyForPayload(p: PaymentNotificationPayload): string {
  // 续费 key 由 webhook 侧显式传入 subscriptionId；无订阅 id 时用订单号兜底（仍保证同一事件只入队一次）
  return (
    renewalDedupeKey(p.subscriptionId, p.transactionId, p.periodEndIso) ??
    `renew:${p.outTradeNo}:${p.transactionId ?? p.periodEndIso ?? p.paidAt}`
  );
}

/**
 * 续费通知触发判定（纯函数，webhook 侧复用、可单测）。
 * 「续费」必须同时满足（宁可漏一封也不发错一封）：
 *   - 有订阅 id（dedupe 依据）
 *   - 订阅快照可用且非新建（created=false → 非新订阅首付）
 *   - 本事件交易号 ≠ 首付交易号
 *   - 周期真实推进（事件周期晚于订单同步前的 period_end）
 * 任一条件无法确认时不发。
 */
export function shouldNotifyRenewal(args: {
  subscriptionId: string | null | undefined;
  snapshotOk: boolean;
  snapshotCreated: boolean;
  isFirstTransaction: boolean;
  periodAdvanced: boolean;
}): boolean {
  return (
    !!args.subscriptionId &&
    args.snapshotOk &&
    !args.snapshotCreated &&
    !args.isFirstTransaction &&
    args.periodAdvanced
  );
}

/** 通知行（老板后台展示用） */
export interface PaymentNotificationRow {
  id: number;
  dedupeKey: string;
  kind: PaymentNotificationKind;
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  payload: PaymentNotificationPayload | null;
  providerMessageId: string | null;
  createdAt: string;
  sentAt: string | null;
}

export async function getRecentPaymentNotifications(limit = 20): Promise<PaymentNotificationRow[]> {
  try {
    const db = await getAdapter();
    const rows = (await db.query(
      `SELECT id, dedupe_key, kind, status, attempts, last_error, payload_json,
              provider_message_id, created_at, sent_at
         FROM payment_notifications
        ORDER BY created_at DESC
        LIMIT ?`,
      [limit]
    )) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      dedupeKey: String(r.dedupe_key),
      kind: String(r.kind) === "renewal" ? "renewal" : "first_payment",
      status: String(r.status) as "pending" | "sent" | "failed",
      attempts: Number(r.attempts ?? 0),
      lastError: r.last_error ? String(r.last_error) : null,
      payload: safeParsePayload(r.payload_json),
      providerMessageId: r.provider_message_id ? String(r.provider_message_id) : null,
      createdAt: String(r.created_at ?? ""),
      sentAt: r.sent_at ? String(r.sent_at) : null,
    }));
  } catch {
    return [];
  }
}

function safeParsePayload(json: unknown): PaymentNotificationPayload | null {
  try {
    return JSON.parse(String(json)) as PaymentNotificationPayload;
  } catch {
    return null;
  }
}

/** 按订单号查通知（付款明细页 join 用） */
export async function getNotificationsByOutTradeNo(
  outTradeNos: string[]
): Promise<Map<string, PaymentNotificationRow>> {
  const map = new Map<string, PaymentNotificationRow>();
  if (outTradeNos.length === 0) return map;
  try {
    const db = await getAdapter();
    const placeholders = outTradeNos.map(() => "?").join(",");
    // dedupe_key 存储形式为 `pay:<out_trade_no>`，比对时需加前缀
    const keys = outTradeNos.map((o) => `pay:${o}`);
    const rows = (await db.query(
      `SELECT id, dedupe_key, kind, status, attempts, last_error, payload_json,
              provider_message_id, created_at, sent_at
         FROM payment_notifications
        WHERE dedupe_key LIKE 'pay:%' AND dedupe_key IN (${placeholders})
        ORDER BY created_at DESC`,
      keys
    )) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const outTradeNo = String(r.dedupe_key).slice("pay:".length);
      if (!map.has(outTradeNo)) {
        map.set(outTradeNo, {
          id: Number(r.id),
          dedupeKey: String(r.dedupe_key),
          kind: String(r.kind) === "renewal" ? "renewal" : "first_payment",
          status: String(r.status) as "pending" | "sent" | "failed",
          attempts: Number(r.attempts ?? 0),
          lastError: r.last_error ? String(r.last_error) : null,
          payload: safeParsePayload(r.payload_json),
          providerMessageId: r.provider_message_id ? String(r.provider_message_id) : null,
          createdAt: String(r.created_at ?? ""),
          sentAt: r.sent_at ? String(r.sent_at) : null,
        });
      }
    }
  } catch {
    // 表不存在等：返回空 map（UI 显示「无通知记录」）
  }
  return map;
}

export type NotificationDeliveryStatus = "sent" | "failed" | "pending" | "already_sent";

/**
 * 投递单条通知（webhook 侧即时发送 / cron 重试 / 老板手动重试共用）。
 * - status='sent' → 已发送过，跳过（防重复）
 * - 发送成功 → sent；失败 → failed（保留 last_error）；provider 未配置 → 保持 pending（不烧重试次数）
 * - 任何异常不抛出（返回 failed + 原因）
 */
export async function deliverPaymentNotification(
  notificationId: number
): Promise<{ status: NotificationDeliveryStatus; reason?: string }> {
  try {
    const db = await getAdapter();
    const row = (await db.get(
      `SELECT id, dedupe_key, kind, status, attempts, payload_json FROM payment_notifications WHERE id = ?`,
      [notificationId]
    )) as
      | { id: number; dedupe_key: string; kind: string; status: string; attempts: number; payload_json: string }
      | undefined;
    if (!row) return { status: "failed", reason: "通知记录不存在" };
    if (row.status === "sent") return { status: "already_sent" };

    const payload = safeParsePayload(row.payload_json);
    if (!payload) {
      await markNotification(db, notificationId, "failed", "通知内容损坏（payload 解析失败）");
      return { status: "failed", reason: "通知内容损坏" };
    }

    // 抢占：条件更新（未发送过的才继续），防并发双发
    const claimed = await db.run(
      `UPDATE payment_notifications SET attempts = attempts + 1, updated_at = datetime('now')
        WHERE id = ? AND status != 'sent'`,
      [notificationId]
    );
    if (Number(claimed.changes ?? 0) === 0) return { status: "already_sent" };

    const attempts = Number(row.attempts ?? 0) + 1;

    // 统一发送层投递（email_log 可观测 + attempt 级 automationKey 幂等）；
    // Resend 幂等键 = dedupe_key：同一笔支付即使本地状态写回失败，重试也不会在 Resend 侧重复投递。
    // automationKey 需按 attempt 区分（email_log 的 failed 行会永久占键，重试必须换键），
    // 「同一笔支付不重复通知」由 payment_notifications.dedupe_key + status 闸门保证。
    const out = await sendTransactionalEmail({
      userId: "owner",
      email: getOwnerNotifyEmail(),
      templateKey: "owner_payment_notify",
      subject: buildSubject(payload),
      html: buildHtml(payload, attempts),
      automationKey: `${row.dedupe_key}:a${attempts}`,
      idempotencyKey: `seeo-payment-${row.dedupe_key}`,
    });

    if (out.status === "sent") {
      await markNotification(db, notificationId, "sent", null, out.messageId ?? null);
      return { status: "sent" };
    }
    if (out.status === "skipped_no_provider") {
      // provider 未配置：保持 pending（不烧 attempts、不算失败），等配置齐后重试
      await db.run(
        `UPDATE payment_notifications SET status = 'pending', attempts = MAX(attempts - 1, 0), last_error = ?, updated_at = datetime('now') WHERE id = ?`,
        ["RESEND_API_KEY 未配置，通知待发送", notificationId]
      );
      return { status: "pending", reason: "email provider not configured" };
    }
    if (out.status === "skipped_already_sent") {
      return { status: "already_sent", reason: "email_log 已登记该次投递" };
    }

    await markNotification(db, notificationId, "failed", out.reason ?? "发送失败");
    return { status: "failed", reason: out.reason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[PaymentNotify] 投递异常:", reason);
    return { status: "failed", reason };
  }
}

async function markNotification(
  db: Awaited<ReturnType<typeof getAdapter>>,
  id: number,
  status: "sent" | "failed" | "pending",
  lastError: string | null,
  providerMessageId?: string | null
): Promise<void> {
  await db.run(
    `UPDATE payment_notifications
        SET status = ?, last_error = ?,
            provider_message_id = COALESCE(?, provider_message_id),
            sent_at = ${status === "sent" ? "datetime('now')" : "sent_at"},
            updated_at = datetime('now')
      WHERE id = ?`,
    [status, lastError, providerMessageId ?? null, id]
  );
}

/** cron / 手动重试入口：处理所有未发送且未超过重试上限的通知 */
export async function retryPendingPaymentNotifications(
  max = 10
): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  try {
    const db = await getAdapter();
    const rows = (await db.query(
      `SELECT id FROM payment_notifications
        WHERE status IN ('pending', 'failed') AND attempts < ?
        ORDER BY created_at ASC
        LIMIT ?`,
      [PAYMENT_NOTIFY_MAX_ATTEMPTS, max]
    )) as Array<{ id: number }>;
    for (const r of rows) {
      const out = await deliverPaymentNotification(Number(r.id));
      processed++;
      if (out.status === "sent") sent++;
      else if (out.status === "failed") failed++;
      else skipped++;
    }
  } catch (err) {
    console.error("[PaymentNotify] 重试巡检失败:", err);
  }
  return { processed, sent, failed, skipped };
}

// ---------- 邮件内容（纯中文；只用真实字段） ----------

export function buildSubject(p: PaymentNotificationPayload): string {
  const kindText = p.kind === "first_payment" ? "首次付款" : "订阅续费";
  return `SeeO 收款通知：${(p.amount).toFixed(2)} ${p.currency} · ${kindText} · 订单 ${p.outTradeNo}`;
}

export function buildHtml(p: PaymentNotificationPayload, attempts: number): string {
  const kindText = p.kind === "first_payment" ? "首次付款" : "订阅续费";
  const fmtTime = (iso: string | null) => {
    if (!iso || Number.isNaN(Date.parse(iso))) return "—";
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  };
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666;font-size:13px">${label}</td><td style="padding:4px 0;font-size:13px;color:#111">${value}</td></tr>`;
  return `<div style="font-family:-apple-system,Segoe UI,PingFang SC,sans-serif;max-width:520px">
  <h2 style="font-size:17px;margin:0 0 12px">✅ SeeO 收到一笔${kindText}</h2>
  <table style="border-collapse:collapse">
    ${row("付款确认时间", fmtTime(p.paidAt))}
    ${row("客户邮箱", p.customerEmail ? escapeHtml(p.customerEmail) : "—")}
    ${row("套餐 / 产品", escapeHtml(p.productName ? `${p.productName}（${p.plan}）` : p.plan))}
    ${row(
      p.kind === "renewal" ? "订阅金额（套餐价，以 Creem 实际扣款为准）" : "支付金额",
      `${p.amount.toFixed(2)} ${escapeHtml(p.currency)}`
    )}
    ${row("订单编号", escapeHtml(p.outTradeNo))}
    ${p.transactionId ? row("交易编号", escapeHtml(p.transactionId)) : ""}
    ${p.kind === "renewal" && p.periodEndIso ? row("新周期结束", fmtTime(p.periodEndIso)) : ""}
    ${row("类型", kindText)}
  </table>
  <p style="color:#999;font-size:12px;margin-top:14px">本通知由 Creem webhook 服务器确认支付结果后自动发送${
    attempts > 1 ? `（第 ${attempts} 次尝试）` : ""
  }。</p>
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 账号邮箱（profiles，权威账号邮箱）；Creem customer.email 缺失时的回退 */
export async function getAccountEmail(userId: string): Promise<string | null> {
  try {
    const admin = getAdminClient();
    if (!admin) return null;
    const { data } = await admin.from("profiles").select("email").eq("id", userId).limit(1);
    const email = (data ?? []).find(() => true)?.email;
    return typeof email === "string" && email ? email : null;
  } catch {
    return null;
  }
}
