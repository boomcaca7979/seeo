// ===== Owner 级 GSC 连接（站点级，与用户 project 级连接分离）=====
//
// 为什么单独一张表：`gsc_connections` 是「用户 × 项目」维度的绑定（UNIQUE(project_id)），
// 而 Owner Console 需要的是**SeeO 自己站点**的站点级指标。两者语义不同，
// 因此使用独立表 `admin_gsc_connections`，但：
//   - OAuth 授权流程复用 `gsc-provider`（buildGoogleAuthUrl / exchangeGoogleCode / refreshGoogleToken）
//   - CSRF state 复用 `gsc-service` 的 sign/verifyOAuthState（同一把 GSC_TOKEN_ENCRYPTION_KEY）
//   - 凭证加密复用 `crypto/secure-store`（AES-256-GCM）
// 即：**没有第二套 OAuth 实现，也没有第二套加密实现**。
//
// ⚠️ 本机目前没有任何 Google 凭据 → 该链路在配置 GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET / GSC_TOKEN_ENCRYPTION_KEY 之前一律 unavailable（如实展示）。

import { getAdapter } from "@/lib/db/migrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secure-store";
import {
  GscProviderError,
  refreshGoogleToken,
} from "@/lib/seo/gsc-provider";

export interface AdminGscConnection {
  id: number;
  property_url: string;
  property_type: string;
  google_email: string | null;
  encrypted_credentials: string;
  connected_at: string;
  updated_at: string;
}

interface GscTokenSet {
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
  scope: string | null;
}

const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

/** OAuth 是否具备发起条件（与用户级 GSC 同一组 env） */
export function isOwnerGscOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GSC_TOKEN_ENCRYPTION_KEY
  );
}

/**
 * Owner 级 OAuth 回调地址。
 * 必须与 Google Cloud Console 中登记的 redirect URI 完全一致；
 * 可用 GSC_ADMIN_OAUTH_REDIRECT_URI 显式覆盖（多域名/预览环境用）。
 */
export function adminGscRedirectUri(origin: string): string {
  return process.env.GSC_ADMIN_OAUTH_REDIRECT_URI ?? `${origin}/api/admin/gsc/auth/callback`;
}

export function encryptOwnerTokenSet(tokens: GscTokenSet): string {
  return encryptSecret(JSON.stringify(tokens));
}

export function decryptOwnerTokenSet(payload: string): GscTokenSet {
  const parsed = JSON.parse(decryptSecret(payload)) as Partial<GscTokenSet>;
  return {
    refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
    expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
    scope: typeof parsed.scope === "string" ? parsed.scope : null,
  };
}

/** 读取 owner 级 GSC 连接（站点级只保留一条；多条时取最早一条并提示） */
export async function getOwnerGscConnection(): Promise<AdminGscConnection | null> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT * FROM admin_gsc_connections ORDER BY connected_at ASC LIMIT 1`
  )) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    property_url: String(row.property_url),
    property_type: String(row.property_type),
    google_email: row.google_email ? String(row.google_email) : null,
    encrypted_credentials: String(row.encrypted_credentials),
    connected_at: String(row.connected_at),
    updated_at: String(row.updated_at),
  };
}

/** 绑定/更新 owner 级属性（property_url 唯一） */
export async function saveOwnerGscConnection(args: {
  propertyUrl: string;
  propertyType: string;
  googleEmail: string | null;
  encryptedCredentials: string;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `INSERT INTO admin_gsc_connections
       (property_url, property_type, google_email, encrypted_credentials)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(property_url) DO UPDATE SET
       property_type = excluded.property_type,
       google_email = excluded.google_email,
       encrypted_credentials = excluded.encrypted_credentials,
       updated_at = datetime('now')`,
    [args.propertyUrl, args.propertyType, args.googleEmail, args.encryptedCredentials]
  );
}

export async function updateOwnerGscCredentials(
  propertyUrl: string,
  encryptedCredentials: string
): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE admin_gsc_connections
        SET encrypted_credentials = ?, updated_at = datetime('now')
      WHERE property_url = ?`,
    [encryptedCredentials, propertyUrl]
  );
}

export async function deleteOwnerGscConnection(): Promise<void> {
  const db = await getAdapter();
  await db.run(`DELETE FROM admin_gsc_connections`);
}

/**
 * 取可用 access token（过期即刷新并写回）。
 * 与用户级实现的差异只在**存储位置**（admin_gsc_connections vs gsc_connections）。
 */
export async function getOwnerAccessToken(
  connection: AdminGscConnection
): Promise<string> {
  const tokens = decryptOwnerTokenSet(connection.encrypted_credentials);
  if (
    tokens.accessToken &&
    tokens.expiresAt &&
    Date.now() < tokens.expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS
  ) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new GscProviderError(
      "GSC_AUTH_REQUIRED",
      401,
      "Google 授权已失效，请重新连接 Search Console"
    );
  }
  const refreshed = await refreshGoogleToken(tokens.refreshToken);
  const updated: GscTokenSet = {
    refreshToken: tokens.refreshToken,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope ?? tokens.scope,
  };
  await updateOwnerGscCredentials(
    connection.property_url,
    encryptOwnerTokenSet(updated)
  );
  return updated.accessToken as string;
}
