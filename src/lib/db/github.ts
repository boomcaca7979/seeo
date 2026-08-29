// ===== GitHub Connection 领域（P3） =====
// project ↔ repository 的显式映射（不靠 domain 猜）。
// PAT 模式：token 经 AES-256-GCM 加密存储（复用 secure-store）；App 模式无长期凭证。

import { getAdapter } from "./migrations";

export interface GitHubConnection {
  id: number;
  user_id: string;
  project_id: number;
  owner: string;
  repository: string;
  default_branch: string;
  /** 'app' | 'pat' */
  auth_mode: string;
  encrypted_credentials: string | null;
  connected_at: string;
  updated_at: string;
}

export async function getGitHubConnectionByProject(userId: string, projectId: number): Promise<GitHubConnection | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT * FROM github_connections WHERE project_id = ? AND user_id = ?`,
    [projectId, userId]
  ) as Record<string, unknown> | undefined;
  return row ? rowToConnection(row) : null;
}

export async function upsertGitHubConnection(userId: string, params: {
  project_id: number;
  owner: string;
  repository: string;
  default_branch: string;
  auth_mode: string;
  encrypted_credentials: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO github_connections (user_id, project_id, owner, repository, default_branch, auth_mode, encrypted_credentials)
    VALUES (@user_id, @project_id, @owner, @repository, @default_branch, @auth_mode, @encrypted_credentials)
    ON CONFLICT(project_id) DO UPDATE SET
      user_id = excluded.user_id,
      owner = excluded.owner,
      repository = excluded.repository,
      default_branch = excluded.default_branch,
      auth_mode = excluded.auth_mode,
      encrypted_credentials = excluded.encrypted_credentials,
      updated_at = datetime('now')
  `, [{
    user_id: userId,
    project_id: params.project_id,
    owner: params.owner,
    repository: params.repository,
    default_branch: params.default_branch,
    auth_mode: params.auth_mode,
    encrypted_credentials: params.encrypted_credentials,
  }]);
}

export async function deleteGitHubConnection(userId: string, projectId: number): Promise<boolean> {
  const db = await getAdapter();
  const existing = await getGitHubConnectionByProject(userId, projectId);
  if (!existing) return false;
  await db.run(`DELETE FROM github_connections WHERE project_id = ? AND user_id = ?`, [projectId, userId]);
  return true;
}

function rowToConnection(row: Record<string, unknown>): GitHubConnection {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    project_id: Number(row.project_id),
    owner: String(row.owner),
    repository: String(row.repository),
    default_branch: String(row.default_branch),
    auth_mode: String(row.auth_mode),
    encrypted_credentials: row.encrypted_credentials ? String(row.encrypted_credentials) : null,
    connected_at: String(row.connected_at),
    updated_at: String(row.updated_at),
  };
}
