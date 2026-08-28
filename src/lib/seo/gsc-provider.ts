// ===== Google Search Console Provider（P0-02-E，服务端专用） =====
// GSC 是第一方免费数据源：不接入 consumeQuota credits 计费（与 DataForSEO/SerpApi 成本模型不同），
// 防滥用靠 cache + 参数上限（rowLimit≤1000、日期跨度≤16 个月）。
// 职责：HTTP 调用 + Google 错误到 GscProviderError 的映射。不做 auth/缓存/业务。

export class GscNotConfiguredError extends Error {
  constructor(message = "Google Search Console 尚未配置") {
    super(message);
    this.name = "GscNotConfiguredError";
  }
}

export class GscProviderError extends Error {
  /** 稳定错误码，供 service/API/MCP 归一化 */
  code:
    | "GSC_AUTH_REQUIRED"        // 401/403：token 无效或 property 无权限
    | "GSC_QUOTA_EXCEEDED"       // 429
    | "GSC_PROPERTY_NOT_FOUND"   // 404
    | "GSC_PROVIDER_ERROR";      // 其他上游错误
  status: number;
  constructor(code: GscProviderError["code"], status: number, message: string) {
    super(message);
    this.name = "GscProviderError";
    this.code = code;
    this.status = status;
  }
}

const WEBMASTERS_API_BASE = "https://www.googleapis.com/webmasters/v3";
const URL_INSPECTION_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REQUEST_TIMEOUT_MS = 20_000;

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  dimensionFilterGroups?: Array<{
    groupType: "and" | "or";
    filters: Array<{ dimension: string; operator: string; expression: string }>;
  }>;
  rowLimit?: number;
  startRow?: number;
  type?: string;
  dataState?: string;
}

/** GSC searchAnalytics 原始行：ctr 为 0-1 小数、position 为平均位置（浮点） */
export interface GscAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface UrlInspectionResult {
  indexStatusResult?: {
    verdict?: string;
    coverageState?: string;
    robotsTxtState?: string;
    indexingState?: string;
    lastCrawlTime?: string;
    googleCanonical?: string;
    userCanonical?: string;
    crawledAs?: string;
    sitemap?: string[];
  };
  mobileUsabilityResult?: { verdict?: string };
  richResultsResult?: { verdict?: string };
  inspectionResultLink?: string;
}

function messageForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return "Search Console 拒绝访问（token 无效、权限不足或连接已被撤销）";
  if (status === 429) return "Search Console API 配额已达上限，请稍后重试";
  if (status === 404) return "Search Console property 不存在或已被移除";
  return `Search Console API 错误（${status}）：${body.slice(0, 200)}`;
}

function codeForStatus(status: number): GscProviderError["code"] {
  if (status === 401 || status === 403) return "GSC_AUTH_REQUIRED";
  if (status === 429) return "GSC_QUOTA_EXCEEDED";
  if (status === 404) return "GSC_PROPERTY_NOT_FOUND";
  return "GSC_PROVIDER_ERROR";
}

async function gscFetch<T>(accessToken: string, url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const hasBody = init?.body !== undefined;
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GscProviderError(codeForStatus(res.status), res.status, messageForStatus(res.status, body));
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof GscProviderError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new GscProviderError("GSC_PROVIDER_ERROR", 0, "Search Console 请求超时（20s）");
    }
    throw new GscProviderError("GSC_PROVIDER_ERROR", 0, `Search Console 请求失败：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Webmasters API sites.list——当前 grant 下的全部 properties（含未验证） */
export async function listGscSites(accessToken: string): Promise<GscSite[]> {
  const data = await gscFetch<{ siteEntry?: GscSite[] }>(accessToken, `${WEBMASTERS_API_BASE}/sites`);
  return data.siteEntry ?? [];
}

/** Webmasters API searchAnalytics.query——siteUrl 原样使用（URL-prefix 或 sc-domain） */
export async function queryGscSearchAnalytics(
  accessToken: string,
  siteUrl: string,
  request: GscAnalyticsRequest
): Promise<GscAnalyticsRow[]> {
  const data = await gscFetch<{ rows?: GscAnalyticsRow[] }>(
    accessToken,
    `${WEBMASTERS_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { method: "POST", body: request }
  );
  return data.rows ?? [];
}

/** URL Inspection API——独立 host，同一 webmasters.readonly scope */
export async function inspectGscUrl(
  accessToken: string,
  siteUrl: string,
  inspectionUrl: string,
  languageCode?: string
): Promise<UrlInspectionResult | null> {
  const data = await gscFetch<{ inspectionResult?: UrlInspectionResult }>(accessToken, URL_INSPECTION_API, {
    method: "POST",
    body: { siteUrl, inspectionUrl, ...(languageCode ? { languageCode } : {}) },
  });
  return data.inspectionResult ?? null;
}

/** 连接者 Google 账号邮箱（展示用；失败不阻塞） */
export async function getGscUserEmail(accessToken: string): Promise<string | null> {
  try {
    const data = await gscFetch<{ email?: unknown }>(accessToken, GOOGLE_USERINFO_URL);
    return typeof data.email === "string" ? data.email : null;
  } catch {
    return null;
  }
}

// ===== OAuth 2.0（Google 授权码流程，离线 access） =====

export const GSC_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "openid",
  "email",
];

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

/** 授权码换 token；refresh_token 仅首次 consent 返回（prompt=consent 保证） */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    throw new GscProviderError("GSC_AUTH_REQUIRED", res.status, `Google 授权码交换失败：${String(json.error_description ?? json.error ?? res.status)}`);
  }
  return json as unknown as GoogleTokenResponse;
}

/** refresh token 换新 access token */
export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    throw new GscProviderError("GSC_AUTH_REQUIRED", res.status, "Google refresh token 已失效，请重新连接 Search Console");
  }
  return json as unknown as GoogleTokenResponse;
}
