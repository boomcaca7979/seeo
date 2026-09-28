// ===== 报告邮件正文模板 =====
// 用户主动请求发送的报告邮件 —— 归为事务性（transactional）：
// 营销退订不影响此类邮件；每次请求都允许再次发送（不做生命周期幂等拦截）。
// 正文由本模块渲染，发送一律走 service.ts 的 sendTransactionalEmail。

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 报告摘要邮件 HTML。
 * 注意：summary 可含来自报告数据的 <strong>，故不整体转义；
 * 标题/类型/时间一律转义后再插入。
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
          <div style="font-family: monospace; font-size: 11px; color: #8E8898; letter-spacing: 0.5px;">SEEO · ${escapeHtml(reportType.toUpperCase())} REPORT</div>
          <h1 style="margin: 8px 0 0; color: #FFFFFF; font-size: 22px; font-weight: 700;">${escapeHtml(reportTitle)}</h1>
        </div>
        <div style="padding: 24px 32px;">
          <div style="font-family: monospace; font-size: 11px; color: #8E8898;">生成时间：${escapeHtml(generatedAt)}</div>
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
