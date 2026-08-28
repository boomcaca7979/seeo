// ===== GSC Service（P0-02-E GSC Intelligence / First-party SEO Performance Layer） =====
//
//   GSC API routes / MCP search_console_tools
//     ↓
//   本 Service（connection、token 生命周期、searchAnalytics 归一化、cache、summary）
//     ↓
//   gsc-provider（Google REST：sites.list / searchAnalytics.query / urlInspection）
//     ↓
//   gsc_connections（SQLite，凭证 AES-256-GCM 加密）+ api_cache（gsc 命名空间）
//
// 边界（与任务要求一致）：
// - GSC position 是平均位置（浮点，如 8.7），与 Rank Tracking 的 SERP rank（整数，如 #5）是
//   两个不同数据源，禁止互相覆盖或混写 rank_history。
// - CTR 内部统一为 0-1 小数（Google API 原生口径），仅在展示层转百分比。
// - GSC 是第一方免费数据源：不接入 credits 计费，防滥用靠 cache + rowLimit≤1000 + 日期跨度≤16 个月。
// - 凭证仅在 service 内解密，绝不进入日志/API/MCP 输出。

import { createHmac } from "node:crypto";
import {
  getGscConnectionByProject,
  upsertGscConnection,
  updateGscCredentials,
  deleteGscConnection,
} from "@/lib/db/gsc";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secure-store";
import { readCache, writeCache } from "./cache";
import {
  GscNotConfiguredError,
  GscProviderError,
  exchangeGoogleCode,
  getGscUserEmail,
  inspectGscUrl,
  listGscSites,
  queryGscSearchAnalytics,
  refreshGoogleToken,
  type GscAnalyticsRequest,
  type GscAnalyticsRow,
  type GscSite,
  type UrlInspectionResult,
} from "./gsc-provider";
import type { PlanTier } from "@/lib/auth";

// ===== OAuth 凭证（加密存取 + access token 刷新） =====

interface GscTokenSet {
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
  scope: string | null;
}

const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

function encryptTokenSet(tokens: GscTokenSet): string {
  return encryptSecret(JSON.stringify(tokens));
}

function decryptTokenSet(payload: string): GscTokenSet {
  const parsed = JSON.parse(decryptSecret(payload)) as Partial<GscTokenSet>;
  return {
    refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
    expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
    scope: typeof parsed.scope === "string" ? parsed.scope : null,
  };
}

export class GscNotConnectedError extends Error {
  constructor() {
    super("该项目尚未连接 Google Search Console");
    this.name = "GscNotConnectedError";
  }
}

export function isGscOAuthConfigured(): boolean {
  return process.env.GOOGLE_CLIENT_ID !== undefined
    && process.env.GOOGLE_CLIENT_SECRET !== undefined
    && Boolean(process.env.GSC_TOKEN_ENCRYPTION_KEY);
}

/** OAuth state：HMAC 签名 + 10 分钟过期，防 CSRF */
export function signOAuthState(userId: string, now = Date.now()): string {
  const secret = process.env.GSC_TOKEN_ENCRYPTION_KEY ?? "";
  const payload = `${userId}.${now}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyOAuthState(state: string, maxAgeMs = 10 * 60_000): string | null {
  const secret = process.env.GSC_TOKEN_ENCRYPTION_KEY ?? "";
  const [payloadB64, sig] = state.split(".");
  if (!payloadB64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString();
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig !== expected) return null;
  const dot = payload.lastIndexOf(".");
  if (dot < 0) return null;
  const userId = payload.slice(0, dot);
  const ts = Number(payload.slice(dot + 1));
  if (!Number.isFinite(ts) || Date.now() - ts > maxAgeMs) return null;
  return userId || null;
}

/** 取可用的 access token：解密 → 过期则 refresh 并写回（refresh 失败映射 GSC_AUTH_REQUIRED） */
async function getFreshAccessToken(userId: string, projectId: number, encrypted: string): Promise<string> {
  const tokens = decryptTokenSet(encrypted);
  if (tokens.accessToken && tokens.expiresAt && Date.now() < tokens.expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new GscProviderError("GSC_AUTH_REQUIRED", 401, "Google 授权已失效，请重新连接 Search Console");
  }
  const refreshed = await refreshGoogleToken(tokens.refreshToken);
  const updated: GscTokenSet = {
    refreshToken: tokens.refreshToken,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope ?? tokens.scope,
  };
  await updateGscCredentials(userId, projectId, encryptTokenSet(updated));
  return updated.accessToken as string;
}

// ===== 连接管理 =====

export interface GscConnectionStatus {
  connected: boolean;
  propertyUrl: string | null;
  propertyType: string | null;
  googleEmail: string | null;
  connectedAt: string | null;
}

/** 项目连接状态（不含任何凭证信息） */
export async function getConnectionStatus(userId: string, projectId: number): Promise<GscConnectionStatus> {
  const connection = await getGscConnectionByProject(userId, projectId);
  if (!connection) {
    return { connected: false, propertyUrl: null, propertyType: null, googleEmail: null, connectedAt: null };
  }
  return {
    connected: true,
    propertyUrl: connection.property_url,
    propertyType: connection.property_type,
    googleEmail: connection.google_email,
    connectedAt: connection.connected_at,
  };
}

async function requireConnection(userId: string, projectId: number) {
  const connection = await getGscConnectionByProject(userId, projectId);
  if (!connection) throw new GscNotConnectedError();
  if (!isGscOAuthConfigured()) throw new GscNotConfiguredError("Google OAuth 未配置（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GSC_TOKEN_ENCRYPTION_KEY）");
  const accessToken = await getFreshAccessToken(userId, connection.project_id, connection.encrypted_credentials);
  return { connection, accessToken };
}

/** 当前用户 Google grant 下的全部 properties（含验证状态；供显式连接选择） */
export async function listAvailableSites(userId: string): Promise<GscSite[]> {
  if (!isGscOAuthConfigured()) throw new GscNotConfiguredError();
  const encrypted = await readPendingGrant(userId);
  if (!encrypted) throw new GscProviderError("GSC_AUTH_REQUIRED", 401, "请先完成 Google 授权");
  const tokens = decryptTokenSet(encrypted);
  if (!tokens.accessToken) throw new GscProviderError("GSC_AUTH_REQUIRED", 401, "缺少 access token");
  return listGscSites(tokens.accessToken);
}

// OAuth 回调后、显式绑定前的 pending grant：
// 经 AES-256-GCM 加密后写入 api_cache（gsc-pending 命名空间，随 24h TTL 过期），
// serverless 多实例安全；凭证永不明文、永不出后端。
const GSC_PENDING_NAMESPACE = "gsc-pending";

async function readPendingGrant(userId: string): Promise<string | null> {
  return readCache<string>(GSC_PENDING_NAMESPACE, { user: userId });
}

async function writePendingGrant(userId: string, encrypted: string): Promise<void> {
  await writeCache(GSC_PENDING_NAMESPACE, { user: userId }, encrypted);
}

/** OAuth 回调：code → token（含 refresh_token）→ 加密暂存（等待显式绑定 property） */
export async function completeOAuth(params: {
  userId: string;
  code: string;
  redirectUri: string;
}): Promise<{ email: string | null }> {
  const tokenResponse = await exchangeGoogleCode(params.code, params.redirectUri);
  const tokens: GscTokenSet = {
    refreshToken: tokenResponse.refresh_token ?? null,
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    scope: tokenResponse.scope ?? null,
  };
  await writePendingGrant(params.userId, encryptTokenSet(tokens));
  const email = await getGscUserEmail(tokenResponse.access_token);
  return { email };
}

/** 显式绑定 property：必须在用户 grant 上存在且已验证（siteUnverifiedUser 拒绝） */
export async function connectProperty(params: {
  userId: string;
  projectId: number;
  siteUrl: string;
}): Promise<{ propertyUrl: string; propertyType: string; googleEmail: string | null }> {
  if (!isGscOAuthConfigured()) throw new GscNotConfiguredError();
  const encryptedGrant = await readPendingGrant(params.userId);
  if (!encryptedGrant) {
    throw new GscProviderError("GSC_AUTH_REQUIRED", 401, "请先完成 Google 授权");
  }
  const tokens = decryptTokenSet(encryptedGrant);
  if (!tokens.accessToken) throw new GscProviderError("GSC_AUTH_REQUIRED", 401, "缺少 access token");

  const sites = await listGscSites(tokens.accessToken);
  const match = sites.find((site) => site.siteUrl === params.siteUrl);
  if (!match) {
    throw new GscProviderError("GSC_PROPERTY_NOT_FOUND", 404, "该 property 不在此 Google 账号的 Search Console 中");
  }
  if (match.permissionLevel === "siteUnverifiedUser") {
    throw new GscProviderError("GSC_AUTH_REQUIRED", 403, "对该 property 没有已验证的权限");
  }
  const propertyType = match.siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix";
  const googleEmail = await getGscUserEmail(tokens.accessToken);

  // 绑定即持久化 grant 凭证（refresh token 随连接保存，供后续刷新）
  await upsertGscConnection(params.userId, {
    project_id: params.projectId,
    property_url: match.siteUrl,
    property_type: propertyType,
    google_email: googleEmail,
    encryptedCredentials: encryptedGrant,
  });
  return { propertyUrl: match.siteUrl, propertyType, googleEmail };
}

export async function disconnectProperty(userId: string, projectId: number): Promise<boolean> {
  return deleteGscConnection(userId, projectId);
}

// ===== Search Analytics =====

export interface GscPerformanceInput {
  projectId: number;
  userId: string;
  plan?: PlanTier;
  /** 维度组合：query / page / query+page（P0 核心）；country/device/date/searchAppearance 可选 */
  dimensions: string[];
  /** 显式日期（YYYY-MM-DD）或 dateRange 预设 */
  startDate?: string;
  endDate?: string;
  dateRange?: "last_7_days" | "last_28_days" | "last_90_days" | "last_3_months" | "last_12_months";
  /** 维度过滤（GSC 要求包装在 dimensionFilterGroups 内，这里为调用方完成） */
  filters?: Array<{ dimension: string; operator: string; expression: string }>;
  rowLimit?: number;
  startRow?: number;
  searchType?: "web" | "image" | "video" | "news";
  dataState?: "all" | "final";
  languageCode?: string;
}

/** 统一 normalized 行（GscSearchRow）：CTR 为 0-1 小数、position 为平均位置浮点 */
export interface GscSearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscPerformanceSummary {
  clicks: number;
  impressions: number;
  ctr: number | null;
  /** 曝光加权平均位置（公式：Σ position×impressions / Σ impressions；无曝光为 null） */
  position: number | null;
}

export interface GscPerformanceResult {
  propertyUrl: string;
  dateRange: { start: string; end: string };
  dimensions: string[];
  rows: GscSearchRow[];
  summary: GscPerformanceSummary;
  /** GSC API 单次最多 25000 行，SeeO 上限 1000；startRow 翻页获取更多 */
  rowLimit: number;
  startRow: number;
  fromCache: boolean;
}

const GSC_DATA_LAG_DAYS = 3; // GSC 数据滞后 2-3 天
const GSC_MAX_ROW_LIMIT = 1000;
const GSC_MAX_RANGE_DAYS = 16 * 31; // GSC 保留 16 个月数据
const ALLOWED_DIMENSIONS = new Set(["query", "page", "country", "device", "date", "searchAppearance"]);
const GSC_CACHE_NAMESPACE = "gsc"; // TTL 由 cache.ts 统一为 24h——GSC 数据滞后 2-3 天，无实时性要求

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 日期解析：显式 start/end 校验（顺序、跨度、未来日期），或 dateRange 预设（扣除数据滞后） */
export function resolveGscDateRange(input: {
  startDate?: string;
  endDate?: string;
  dateRange?: GscPerformanceInput["dateRange"];
}, today = todayStr()): { startDate: string; endDate: string } {
  const rangeDays: Record<NonNullable<GscPerformanceInput["dateRange"]>, number> = {
    last_7_days: 7, last_28_days: 28, last_90_days: 90, last_3_months: 91, last_12_months: 365,
  };
  if (input.startDate && input.endDate) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(input.startDate) || !datePattern.test(input.endDate)) {
      throw new GscProviderError("GSC_PROVIDER_ERROR", 0, "日期格式必须为 YYYY-MM-DD");
    }
    if (input.startDate > input.endDate) {
      throw new GscProviderError("GSC_PROVIDER_ERROR", 0, "startDate 不能晚于 endDate");
    }
    if (input.endDate > today) {
      throw new GscProviderError("GSC_PROVIDER_ERROR", 0, "endDate 不能是未来日期");
    }
    const span = (new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) / 86_400_000;
    if (span > GSC_MAX_RANGE_DAYS) {
      throw new GscProviderError("GSC_PROVIDER_ERROR", 0, `日期跨度不能超过 16 个月`);
    }
    return { startDate: input.startDate, endDate: input.endDate };
  }
  const range = input.dateRange ?? "last_28_days";
  const end = addDays(today, -GSC_DATA_LAG_DAYS);
  return { startDate: addDays(end, -rangeDays[range]), endDate: end };
}

/** 曝光加权 summary（可解释、可复现；rows 为空时全部 null/0） */
export function summarizeGscRows(rows: GscSearchRow[]): GscPerformanceSummary {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    weightedPosition += row.position * row.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? weightedPosition / impressions : null,
  };
}

function normalizeRows(rows: GscAnalyticsRow[]): GscSearchRow[] {
  return rows.map((row) => ({
    keys: Array.isArray(row.keys) ? row.keys.map((key) => String(key)) : [],
    clicks: typeof row.clicks === "number" ? row.clicks : 0,
    impressions: typeof row.impressions === "number" ? row.impressions : 0,
    // GSC API 原生返回 0-1 小数；保持该口径，展示层再转百分比
    ctr: typeof row.ctr === "number" ? row.ctr : 0,
    // GSC position 是平均位置（浮点），不取整、不转成 #N
    position: typeof row.position === "number" ? row.position : 0,
  }));
}

/**
 * Search Analytics 查询（project-bound：必须先显式连接 property）。
 * cache key 隔离 property/dates/dimensions/filters/type/limit/offset——不同维度不共用缓存。
 */
export async function searchAnalytics(input: GscPerformanceInput): Promise<GscPerformanceResult> {
  const { connection, accessToken } = await requireConnection(input.userId, input.projectId);

  if (!input.dimensions || input.dimensions.length === 0) {
    throw new GscProviderError("GSC_PROVIDER_ERROR", 0, "dimensions 不能为空");
  }
  for (const dimension of input.dimensions) {
    if (!ALLOWED_DIMENSIONS.has(dimension)) {
      throw new GscProviderError("GSC_PROVIDER_ERROR", 0, `不支持的 dimension：${dimension}`);
    }
  }
  const rowLimit = Math.min(GSC_MAX_ROW_LIMIT, Math.max(1, input.rowLimit ?? 1000));
  const startRow = Math.max(0, input.startRow ?? 0);
  const { startDate, endDate } = resolveGscDateRange(input);
  const searchType = input.searchType ?? "web";
  const dataState = input.dataState ?? "all";

  const cacheParams: Record<string, string> = {
    v: "1",
    property: connection.property_url,
    start: startDate,
    end: endDate,
    dimensions: [...input.dimensions].sort().join(","),
    type: searchType,
    dataState,
    rowLimit: String(rowLimit),
    startRow: String(startRow),
    filters: input.filters && input.filters.length > 0
      ? JSON.stringify([...input.filters].sort((a, b) => a.dimension.localeCompare(b.dimension)))
      : "",
  };

  const cached = await readCache<GscSearchRow[]>(GSC_CACHE_NAMESPACE, cacheParams);
  let rows: GscSearchRow[];
  let fromCache = false;
  if (cached) {
    rows = cached;
    fromCache = true;
  } else {
    const request: GscAnalyticsRequest = {
      startDate,
      endDate,
      dimensions: input.dimensions,
      rowLimit,
      type: searchType,
      dataState,
      ...(startRow > 0 ? { startRow } : {}),
      ...(input.filters && input.filters.length > 0
        ? { dimensionFilterGroups: [{ groupType: "and" as const, filters: input.filters }] }
        : {}),
    };
    const rawRows = await queryGscSearchAnalytics(accessToken, connection.property_url, request);
    rows = normalizeRows(rawRows);
    try {
      await writeCache(GSC_CACHE_NAMESPACE, cacheParams, rows);
    } catch {
      // 缓存写失败不影响结果
    }
  }

  return {
    propertyUrl: connection.property_url,
    dateRange: { start: startDate, end: endDate },
    dimensions: input.dimensions,
    rows,
    summary: summarizeGscRows(rows),
    rowLimit,
    startRow,
    fromCache,
  };
}

// ===== URL Inspection（连接后可用；不做任何数据伪造） =====

export async function inspectUrl(params: {
  userId: string;
  projectId: number;
  url: string;
  languageCode?: string;
}): Promise<{ propertyUrl: string; result: UrlInspectionResult | null }> {
  const { connection, accessToken } = await requireConnection(params.userId, params.projectId);
  const result = await inspectGscUrl(accessToken, connection.property_url, params.url, params.languageCode);
  return { propertyUrl: connection.property_url, result };
}
