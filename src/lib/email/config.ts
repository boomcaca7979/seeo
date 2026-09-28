// ===== Email 模块配置 =====
// server-side only：任何 email 模块不得进入 client bundle（API key 只读 env）。

export const APP_URL_FALLBACK = "https://www.seeo.asia";

/** 发件地址：生产需在 Resend 后台完成 seeo.asia 域名验证（SPF/DKIM/DMARC 人工配置项） */
export const EMAIL_FROM_DEFAULT = "SeeO <hello@seeo.asia>";

export function getEmailFrom(): string {
  return process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT;
}
