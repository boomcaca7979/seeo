// ===== 邮件发送（基于 Resend） =====
// 服务端专用，RESEND_API_KEY 从环境变量读取

import { Resend } from "resend";

let resendInstance: Resend | null = null;

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendInstance) {
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export interface EmailAttachment {
  filename: string;
  content: string; // base64
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

export interface RawEmailInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  /**
   * 可选幂等键（Resend Idempotency-Key）：同一键在 Resend 服务端窗口内只投递一次。
   * 用于「邮件已发出但本地状态写回失败」时避免重试造成重复邮件。
   */
  idempotencyKey?: string;
}

/**
 * 通用发送入口（供统一发送层调用；业务代码请使用 service.ts）
 */
export async function sendRawEmail(input: RawEmailInput): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    return { success: false, error: "RESEND_API_KEY 未配置" };
  }

  try {
    const result = await resend.emails.send(
      {
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
    );

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, messageId: result.data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
