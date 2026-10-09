// ===== Google AdSense Provider（Reporting API 适配器）=====
//
// SeeO 的广告位通过 `src/app/[locale]/layout.tsx` 注入的 adsbygoogle 脚本投放，
// 收入侧走 **AdSense Management API v2** 的 `accounts.reports.generate`。
//
// 凭据（全部为服务端 env，缺一不可）：
//   ADSENSE_REFRESH_TOKEN   OAuth refresh token（scope: adsense.readonly）
//   ADSENSE_CLIENT_ID       / ADSENSE_CLIENT_SECRET（可复用 GOOGLE_CLIENT_ID/SECRET，
//                           但需在 Google Cloud 项目里追加 adsense.readonly scope 并重新授权）
//   ADSENSE_ACCOUNT         AdSense 账户名（形如 accounts/pub-xxxxxxxxxxxxxxxx；缺省自动取第一个账户）
//   ADSENSE_PUBLISHER_ID    可选，仅用于展示
//
// 为什么需要 refresh token 而不能复用 GSC 的：GSC 的授权 scope 是 webmasters.readonly，
// AdSense 需要 adsense.readonly，两者不可互换 —— 必须单独授权一次。
//
// 未配置时 `configStatus().configured === false`，`fetchDaily` 抛
// AdProviderNotConfiguredError；Admin 页面据此显示 unavailable（不显示 0）。

import {
  AdProviderNotConfiguredError,
  type AdProviderConfigStatus,
  type AdRevenueDay,
  type AdRevenueProvider,
} from "./provider";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ADSENSE_API_BASE = "https://adsense.googleapis.com/v2";
/** 站点实际投放的 publisher id（与 layout 中的 adsbygoogle 脚本一致，非敏感） */
export const ADSENSE_PUBLISHER_ID_FALLBACK = "pub-4267926791604017";
const REQUEST_TIMEOUT_MS = 20_000;
/** reports.generate 单次返回的行数上限（日粒度 90 天远小于此值） */
const ROW_LIMIT = 1000;

function env(...names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function missingEnvNames(): string[] {
  const missing: string[] = [];
  if (!env("ADSENSE_REFRESH_TOKEN")) missing.push("ADSENSE_REFRESH_TOKEN");
  if (!env("ADSENSE_CLIENT_ID", "GOOGLE_CLIENT_ID")) missing.push("ADSENSE_CLIENT_ID (或 GOOGLE_CLIENT_ID)");
  if (!env("ADSENSE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET")) missing.push("ADSENSE_CLIENT_SECRET (或 GOOGLE_CLIENT_SECRET)");
  return missing;
}

/** 用 refresh token 换 access token（adsense.readonly scope） */
async function getAccessToken(): Promise<string> {
  const missing = missingEnvNames();
  if (missing.length > 0) {
    throw new AdProviderNotConfiguredError(
      `AdSense 未配置，缺少环境变量：${missing.join(", ")}`
    );
  }
  const body = new URLSearchParams({
    client_id: env("ADSENSE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
    client_secret: env("ADSENSE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
    refresh_token: env("ADSENSE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || typeof json.access_token !== "string") {
    throw new Error(
      `AdSense access token 获取失败：${json.error_description ?? res.status}`
    );
  }
  return json.access_token;
}

/** 解析 AdSense 账户名（accounts/pub-…） */
async function resolveAccount(accessToken: string): Promise<string> {
  const configured = env("ADSENSE_ACCOUNT");
  if (configured) return configured;
  const res = await fetch(`${ADSENSE_API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { accounts?: Array<{ name?: string }> };
  const name = json.accounts?.[0]?.name;
  if (!res.ok || !name) {
    throw new Error(`AdSense 账户列表获取失败：${res.status}`);
  }
  return name;
}

interface AdSenseReportResponse {
  headers?: Array<{ name?: string; currencyCode?: string }>;
  rows?: Array<{ cells?: Array<{ value?: string }> }>;
  totals?: { cells?: Array<{ value?: string }> };
}

/**
 * 日粒度收入报告。
 * 指标：ESTIMATED_EARNINGS / IMPRESSIONS / CLICKS；维度：DATE。
 * 金额单位：AdSense 返回的是**货币主单位**（如 12.34 USD）→ 转分存储。
 */
export async function fetchAdsenseDaily(
  startDate: string,
  endDate: string
): Promise<AdRevenueDay[]> {
  const accessToken = await getAccessToken();
  const account = await resolveAccount(accessToken);

  const params = new URLSearchParams({
    "dateRange": "CUSTOM",
    "startDate.year": startDate.slice(0, 4),
    "startDate.month": String(Number(startDate.slice(5, 7))),
    "startDate.day": String(Number(startDate.slice(8, 10))),
    "endDate.year": endDate.slice(0, 4),
    "endDate.month": String(Number(endDate.slice(5, 7))),
    "endDate.day": String(Number(endDate.slice(8, 10))),
    "dimensions": "DATE",
    "limit": String(ROW_LIMIT),
  });
  // 同一 metric 重复出现 → 数组形式，必须 append 而不是 set
  for (const metric of ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS"]) {
    params.append("metrics", metric);
  }

  const res = await fetch(
    `${ADSENSE_API_BASE}/${account}/reports:generate?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  const json = (await res.json().catch(() => ({}))) as AdSenseReportResponse & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`AdSense 报告请求失败：${json.error?.message ?? res.status}`);
  }

  // 列顺序由 headers 决定（DATE 在 dimensions 中位于 metrics 之前）
  const headers = json.headers ?? [];
  const idx = (name: string) => headers.findIndex((h) => (h.name ?? "").toUpperCase() === name);
  const iDate = idx("DATE");
  const iRevenue = idx("ESTIMATED_EARNINGS");
  const iImpr = idx("IMPRESSIONS");
  const iClicks = idx("CLICKS");
  const currency = headers[iRevenue]?.currencyCode ?? "USD";

  const out: AdRevenueDay[] = [];
  for (const row of json.rows ?? []) {
    const cells = row.cells ?? [];
    const rawDate = iDate >= 0 ? cells[iDate]?.value ?? "" : "";
    // DATE 维度返回 { year, month, day } 形式（"2026-10-01" 或对象字符串），统一归一化
    const date = normalizeAdsenseDate(rawDate);
    if (!date) continue;
    const revenue = iRevenue >= 0 ? Number(cells[iRevenue]?.value ?? 0) : 0;
    out.push({
      date,
      revenueCents: Math.round((Number.isFinite(revenue) ? revenue : 0) * 100),
      impressions: iImpr >= 0 ? Math.max(0, Math.round(Number(cells[iImpr]?.value ?? 0))) : 0,
      clicks: iClicks >= 0 ? Math.max(0, Math.round(Number(cells[iClicks]?.value ?? 0))) : 0,
      currency,
    });
  }
  return out;
}

/** AdSense 的 DATE 维度可能返回 "2026-10-01" 或 {year,month,day} 序列化串 */
export function normalizeAdsenseDate(raw: string): string | null {
  const v = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // {year: 2026, month: 10, day: 1} 之类的变体
  const y = /year[^0-9]*(\d{4})/i.exec(v)?.[1];
  const m = /month[^0-9]*(\d{1,2})/i.exec(v)?.[1];
  const d = /day[^0-9]*(\d{1,2})/i.exec(v)?.[1];
  if (y && m && d) {
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export const adsenseProvider: AdRevenueProvider = {
  id: "adsense",
  label: "Google AdSense",
  configStatus(): AdProviderConfigStatus {
    const missing = missingEnvNames();
    return {
      configured: missing.length === 0,
      missing,
      hint:
        missing.length === 0
          ? "AdSense Reporting API 已配置，可自动同步日收入。"
          : `需要在 Google Cloud 增加 adsense.readonly scope 并以 owner 账号重新授权，然后配置：${missing.join(", ")}。在此之前请用 CSV / 手工导入。`,
    };
  },
  async fetchDaily(startDate, endDate) {
    return fetchAdsenseDaily(startDate, endDate);
  },
};
