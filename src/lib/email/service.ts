// ===== 统一邮件发送层（唯一出口）=====
// 业务代码不得直接调用 provider SDK —— 一律通过本模块。
// 特性：
//   server-side only（RESEND_API_KEY 只读 env，绝不进 client bundle）
//   幂等：UNIQUE(user_id, automation_key) 抢占式登记，重复触发不再发送
//   退订：营销邮件检查 email_preferences；事务性邮件不受影响
//   可观测：每次发送成功/失败/跳过都落 email_log
//   不阻塞：任何邮件失败都不抛出到业务流程
//
// 两类出口：
//   sendTemplateEmail      —— 生命周期/营销邮件（幂等 + 受营销退订约束）
//   sendTransactionalEmail —— 用户主动触发的事务邮件（不幂等、不受营销退订影响）

import { getAdapter } from "@/lib/db/migrations";
import { isEmailConfigured, sendRawEmail } from "./resend";
import { getEmailFrom } from "./config";
import {
  LIFECYCLE_TEMPLATES,
  type LifecycleTemplate,
} from "./templates/lifecycle";

export type EmailSendStatus =
  | "sent"
  | "failed"
  | "skipped_unsubscribed"
  | "skipped_no_provider"
  | "skipped_render_error"
  /** 幂等命中：同一用户同一 automation_key 已登记过，本次不再发送（非失败） */
  | "skipped_already_sent";

export interface TemplateEmailInput {
  userId: string;
  email: string;
  /** 模板 key（如 welcome_v1） */
  templateKey: string;
  /** 模板变量（缺必需变量 → 记 failed，不发错误内容） */
  variables: Record<string, string>;
  /** 幂等键：默认 templateKey（同一用户同一模板只发一次） */
  automationKey?: string;
}

export interface TemplateEmailResult {
  status: EmailSendStatus;
  /** true = 本轮抢占到发送名额（已登记 email_log） */
  claimed: boolean;
  messageId?: string;
  reason?: string;
}

export interface TransactionalEmailInput {
  userId: string;
  email: string;
  /** 记录用模板标识（如 report_email_v1），不参与生命周期幂等 */
  templateKey: string;
  subject: string;
  html: string;
  /** 可选：显式幂等键。缺省时自动带唯一后缀 —— 事务邮件允许重复发送 */
  automationKey?: string;
  from?: string;
}

/** provider 是否已配置（供路由做 503 前置判断，避免业务侧直连 provider 模块） */
export { isEmailConfigured as isEmailProviderConfigured } from "./resend";

function isMarketingUnsubscribed(userId: string): Promise<boolean> {
  return (async () => {
    const db = await getAdapter();
    const row = await db.get(
      `SELECT marketing_unsubscribed_at FROM email_preferences WHERE user_id = ?`,
      [userId]
    ) as { marketing_unsubscribed_at: string | null } | undefined;
    return !!row?.marketing_unsubscribed_at;
  })();
}

/**
 * 抢占 email_log 名额。返回 logId；null = 已被抢占过（幂等命中）。
 */
async function claimSlot(
  userId: string,
  email: string,
  templateKey: string,
  automationKey: string
): Promise<number | null> {
  const db = await getAdapter();
  try {
    const res = await db.run(
      `INSERT OR IGNORE INTO email_log (user_id, email, template, automation_key, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [userId, email, templateKey, automationKey]
    );
    if (Number(res.changes ?? 0) === 0) return null;
  } catch (err) {
    throw new Error(`email_log write failed: ${(err as Error).message}`);
  }
  const row = await db.get(
    `SELECT id FROM email_log WHERE user_id = ? AND automation_key = ?`,
    [userId, automationKey]
  ) as { id: number } | undefined;
  return row ? row.id : null;
}

/** 收尾写回状态；sent_at 只在真正发出时写入 */
async function finishLog(
  logId: number,
  status: EmailSendStatus,
  extra?: { providerMessageId?: string | null; failureReason?: string | null }
): Promise<void> {
  const db = await getAdapter();
  const sentAt = status === "sent" ? `datetime('now')` : `NULL`;
  await db.run(
    `UPDATE email_log SET status = ?, provider_message_id = COALESCE(?, provider_message_id),
       failure_reason = COALESCE(?, failure_reason), sent_at = ${sentAt}
     WHERE id = ?`,
    [status, extra?.providerMessageId ?? null, extra?.failureReason ?? null, logId]
  );
}

/** 真正投递到 provider（未配置 → dry-run 记录，绝不抛错到业务） */
async function deliver(
  input: { to: string; subject: string; html: string; from?: string }
): Promise<{ status: EmailSendStatus; messageId?: string; reason?: string }> {
  if (!isEmailConfigured()) {
    return { status: "skipped_no_provider", reason: "email provider not configured" };
  }
  const result = await sendRawEmail({
    from: input.from ?? getEmailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  if (result.success) {
    return { status: "sent", messageId: result.messageId };
  }
  return { status: "failed", reason: result.error };
}

/**
 * 按模板发送生命周期/营销邮件（幂等 + 退订 + 日志）。
 * 返回结果而不抛错 —— 调用方（业务流程）无需 try/catch。
 */
export async function sendTemplateEmail(input: TemplateEmailInput): Promise<TemplateEmailResult> {
  const template: LifecycleTemplate | null = LIFECYCLE_TEMPLATES[input.templateKey] ?? null;
  if (!template) {
    return { status: "failed", claimed: false, reason: `unknown template: ${input.templateKey}` };
  }

  const automationKey = input.automationKey ?? input.templateKey;

  // 1. 幂等抢占：INSERT OR IGNORE 命中唯一键说明已发送过 → 不再发送
  let logId: number | null = null;
  try {
    logId = await claimSlot(input.userId, input.email, input.templateKey, automationKey);
  } catch (err) {
    return { status: "failed", claimed: false, reason: (err as Error).message };
  }
  if (logId === null) {
    return { status: "skipped_already_sent", claimed: false, reason: "already_sent" };
  }

  try {
    // 2. 营销退订检查（事务性邮件不受影响）
    if (template.category === "marketing" && (await isMarketingUnsubscribed(input.userId))) {
      await finishLog(logId, "skipped_unsubscribed", {
        failureReason: "user unsubscribed from marketing emails",
      });
      return { status: "skipped_unsubscribed", claimed: true };
    }

    // 3. 渲染（缺变量 → 抛错 → 记 failed，绝不发送错误内容）
    let subject: string;
    let html: string;
    try {
      const built = template.build(input.variables);
      subject = built.subject;
      html = built.html;
    } catch (err) {
      await finishLog(logId, "skipped_render_error", { failureReason: (err as Error).message });
      return { status: "skipped_render_error", claimed: true, reason: (err as Error).message };
    }

    // 4. 发送
    const out = await deliver({ to: input.email, subject, html });
    await finishLog(logId, out.status, {
      providerMessageId: out.messageId ?? null,
      failureReason: out.reason ?? null,
    });
    return { status: out.status, claimed: true, messageId: out.messageId, reason: out.reason };
  } catch (err) {
    // 任何异常都不向上抛 —— 邮件失败不阻塞业务
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await finishLog(logId, "failed", { failureReason: reason });
    } catch {
      // 连日志都写不进去时仅返回结果
    }
    return { status: "failed", claimed: true, reason };
  }
}

/**
 * 发送事务性邮件（用户主动请求的账号/报告类邮件）。
 * 与营销邮件的区别：
 *   - 不检查营销退订状态（退订营销 ≠ 停发事务邮件）
 *   - 不做生命周期幂等拦截（同一报告可再次请求发送），但每次都留 email_log
 *   - 同样：provider 未配置 / 发送失败都不会抛错到业务
 */
export async function sendTransactionalEmail(
  input: TransactionalEmailInput
): Promise<TemplateEmailResult> {
  const automationKey =
    input.automationKey ?? `tx:${input.templateKey}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

  let logId: number | null = null;
  try {
    logId = await claimSlot(input.userId, input.email, input.templateKey, automationKey);
  } catch (err) {
    return { status: "failed", claimed: false, reason: (err as Error).message };
  }
  if (logId === null) {
    // 显式 automationKey 撞键时才发生；不视为失败，但不再重复发送
    return { status: "skipped_already_sent", claimed: false, reason: "already_sent" };
  }

  try {
    // 注意：此处刻意不读取 email_preferences —— 事务邮件独立于营销退订
    const out = await deliver({
      to: input.email,
      subject: input.subject,
      html: input.html,
      from: input.from,
    });
    await finishLog(logId, out.status, {
      providerMessageId: out.messageId ?? null,
      failureReason: out.reason ?? null,
    });
    return { status: out.status, claimed: true, messageId: out.messageId, reason: out.reason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await finishLog(logId, "failed", { failureReason: reason });
    } catch {
      // ignore
    }
    return { status: "failed", claimed: true, reason };
  }
}
