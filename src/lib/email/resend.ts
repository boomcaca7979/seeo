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

/**
 * 发送报告邮件
 */
export async function sendReportEmail(
  to: string,
  subject: string,
  htmlBody: string,
  attachments?: EmailAttachment[]
): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    return { success: false, error: "RESEND_API_KEY 未配置" };
  }

  try {
    const result = await resend.emails.send({
      from: "SeeO <reports@seeo.local>",
      to,
      subject,
      html: htmlBody,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    });

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

/**
 * 生成报告摘要邮件 HTML
 */
export function buildReportEmailHtml(
  reportTitle: string,
  reportType: string,
  summary: string,
  generatedAt: string
): string {
  return `
    <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: #F6F4EC; padding: 32px;">
      <div style="background: #FFFFFF; border-radius: 8px; border: 1px solid #E6E2D6; overflow: hidden;">
        <div style="background: #14121A; padding: 24px 32px;">
          <div style="font-family: monospace; font-size: 11px; color: #8E8898; letter-spacing: 0.5px;">SEEO · ${reportType.toUpperCase()} REPORT</div>
          <h1 style="margin: 8px 0 0; color: #FFFFFF; font-size: 22px; font-weight: 700;">${reportTitle}</h1>
        </div>
        <div style="padding: 24px 32px;">
          <div style="font-family: monospace; font-size: 11px; color: #8E8898;">生成时间：${generatedAt}</div>
          <div style="margin-top: 16px; font-size: 14px; line-height: 1.7; color: #5A5563;">
            ${summary}
          </div>
          <div style="margin-top: 24px; padding: 16px; background: #F6F4EC; border-radius: 6px;">
            <div style="font-family: monospace; font-size: 10px; color: #8E8898;">附件</div>
            <div style="margin-top: 4px; font-size: 13px; color: #14121A;">完整 PDF 报告请见附件</div>
          </div>
        </div>
        <div style="padding: 16px 32px; border-top: 1px solid #E6E2D6;">
          <div style="font-family: monospace; font-size: 10px; color: #8E8898; text-align: center;">
            本邮件由 SeeO 自动发送 · 请勿回复
          </div>
        </div>
      </div>
    </div>
  `;
}
