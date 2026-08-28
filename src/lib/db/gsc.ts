// ===== GSC 连接领域（P0-02-E） =====
// gsc_connections：SeeO project ↔ Google Search Console property 的显式绑定。
// OAuth 凭证（refresh/access token）经 AES-256-GCM 加密后存 encrypted_credentials，
// 绝不明文入库、绝不出现在 API/MCP 响应中。每个 project 最多绑定一个 property（UNIQUE）。

import { getAdapter } from "./migrations";

export interface GscConnection {
  id: number;
  user_id: string;
  project_id: number;
  /** GSC siteUrl 原样存储（https://example.com/ 或 sc-domain:example.com） */
  property_url: string;
  /** domain | url_prefix */
  property_type: string;
  google_email: string | null;
  encrypted_credentials: string;
  connected_at: string;
  updated_at: string;
}

export async function getGscConnectionByProject(userId: string, projectId: number): Promise<GscConnection | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT * FROM gsc_connections WHERE project_id = ? AND user_id = ?`,
    [projectId, userId]
  ) as Record<string, unknown> | undefined;
  return row ? rowToConnection(row) : null;
}

/** 连接创建/重绑（property 变更 + 凭证一次性写入） */
export async function upsertGscConnection(userId: string, params: {
  project_id: number;
  property_url: string;
  property_type: string;
  google_email: string | null;
  encryptedCredentials: string;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO gsc_connections (user_id, project_id, property_url, property_type, google_email, encrypted_credentials)
    VALUES (@user_id, @project_id, @property_url, @property_type, @google_email, @encrypted_credentials)
    ON CONFLICT(project_id) DO UPDATE SET
      user_id = excluded.user_id,
      property_url = excluded.property_url,
      property_type = excluded.property_type,
      google_email = excluded.google_email,
      encrypted_credentials = excluded.encrypted_credentials,
      updated_at = datetime('now')
  `, [{
    user_id: userId,
    project_id: params.project_id,
    property_url: params.property_url,
    property_type: params.property_type,
    google_email: params.google_email,
    encrypted_credentials: params.encryptedCredentials,
  }]);
}

/** access token 刷新后写回；仅更新凭证，不动 property 绑定 */
export async function updateGscCredentials(userId: string, projectId: number, encryptedCredentials: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    UPDATE gsc_connections SET encrypted_credentials = ?, updated_at = datetime('now')
    WHERE project_id = ? AND user_id = ?
  `, [encryptedCredentials, projectId, userId]);
}

export async function deleteGscConnection(userId: string, projectId: number): Promise<boolean> {
  const db = await getAdapter();
  const existing = await getGscConnectionByProject(userId, projectId);
  if (!existing) return false;
  await db.run(`DELETE FROM gsc_connections WHERE project_id = ? AND user_id = ?`, [projectId, userId]);
  return true;
}

function rowToConnection(row: Record<string, unknown>): GscConnection {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    project_id: Number(row.project_id),
    property_url: String(row.property_url),
    property_type: String(row.property_type),
    google_email: row.google_email ? String(row.google_email) : null,
    encrypted_credentials: String(row.encrypted_credentials),
    connected_at: String(row.connected_at),
    updated_at: String(row.updated_at),
  };
}
