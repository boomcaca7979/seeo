// ===== 邮件渲染共用件 =====
// 与产品视觉一致（纸色背景 / 墨色文字 / 等宽标签），不引入 React Email 运行时。
// 统一 CTA 链接的 UTM 规则在此收口，业务模板只给路径。

import { APP_URL_FALLBACK } from "./config";

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || APP_URL_FALLBACK;
}

export interface CtaOptions {
  /** 站内路径（/app/audit）或完整 URL */
  path: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign: string;
  utmContent?: string;
}

/** 构建带 UTM 的 CTA 链接（B 阶段归因兼容：不破坏 first_touch / last_touch 逻辑） */
export function buildCtaUrl(opts: CtaOptions): string {
  const base = opts.path.startsWith("http") ? opts.path : `${getAppUrl()}${opts.path}`;
  try {
    const url = new URL(base);
    url.searchParams.set("utm_source", opts.utmSource ?? "email");
    url.searchParams.set("utm_medium", opts.utmMedium ?? "lifecycle");
    url.searchParams.set("utm_campaign", opts.utmCampaign);
    if (opts.utmContent) url.searchParams.set("utm_content", opts.utmContent);
    return url.toString();
  } catch {
    return base;
  }
}

export interface ShellVars {
  eyebrow: string;
  title: string;
  body: string[];
  cta: { label: string; url: string };
  footerNote: string;
  unsubscribeUrl: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBodyLines(lines: string[]): string {
  return lines
    .map((line) => {
      const escaped = escapeHtml(line);
      // 以 · 开头的行渲染为列表项组（保留换行的多行块用 pre-wrap）
      return `<p style="margin: 0 0 12px; font-size: 14px; line-height: 1.7; color: #5A5563; white-space: pre-wrap;">${escaped}</p>`;
    })
    .join("");
}

/** 统一邮件外壳：每封营销邮件必须带 unsubscribe（Shell 强制要求 unsubscribeUrl） */
export function renderEmailShell(v: ShellVars): string {
  return `
  <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: #F6F4EC; padding: 32px;">
    <div style="background: #FFFFFF; border-radius: 8px; border: 1px solid #E6E2D6; overflow: hidden;">
      <div style="background: #14121A; padding: 24px 32px;">
        <div style="font-family: monospace; font-size: 11px; color: #8E8898; letter-spacing: 0.5px;">${escapeHtml(v.eyebrow)}</div>
        <div style="margin-top: 8px; font-size: 13px; font-weight: 700; color: #FFFFFF;">See<span style="color: #E8B64C;">O</span></div>
        <h1 style="margin: 12px 0 0; color: #FFFFFF; font-size: 20px; font-weight: 700; line-height: 1.4;">${escapeHtml(v.title)}</h1>
      </div>
      <div style="padding: 24px 32px;">
        ${renderBodyLines(v.body)}
        <div style="margin-top: 20px;">
          <a href="${escapeHtml(v.cta.url)}" style="display: inline-block; background: #14121A; color: #FFFFFF; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 8px;">${escapeHtml(v.cta.label)}</a>
        </div>
      </div>
      <div style="padding: 16px 32px; border-top: 1px solid #E6E2D6;">
        <div style="font-size: 11px; color: #8E8898; text-align: center;">
          ${escapeHtml(v.footerNote)} ·
          <a href="${escapeHtml(v.unsubscribeUrl)}" style="color: #8E8898; text-decoration: underline;">Unsubscribe</a>
        </div>
      </div>
    </div>
  </div>`;
}
