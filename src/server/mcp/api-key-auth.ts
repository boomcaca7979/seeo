import { createHash, randomBytes } from "node:crypto";
import { getAdapter } from "@/lib/db/migrations";

export interface ApiKeyRecord { userId: string; scopes: string[]; keyPrefix: string; }
function hashKey(key: string) { return createHash("sha256").update(key).digest("hex"); }

export async function authenticateApiKey(key: string): Promise<ApiKeyRecord | null> {
  if (!/^seeo_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  const db = await getAdapter();
  const row = await db.get("SELECT user_id, scopes_json, key_prefix FROM mcp_api_keys WHERE key_hash = ? AND revoked_at IS NULL", [hashKey(key)]) as Record<string, unknown> | undefined;
  if (!row) return null;
  await db.run("UPDATE mcp_api_keys SET last_used_at = datetime('now') WHERE key_hash = ?", [hashKey(key)]);
  let scopes: string[] = ["mcp:read"];
  try { scopes = JSON.parse(String(row.scopes_json)) as string[]; } catch { /* use conservative default */ }
  return { userId: String(row.user_id), scopes, keyPrefix: String(row.key_prefix) };
}

/** Key material is returned only once by the caller that creates it. The database stores only its hash. */
export async function createApiKey(userId: string, name: string, scopes = ["mcp:read"]) {
  const key = `seeo_${randomBytes(24).toString("base64url")}`;
  const db = await getAdapter();
  await db.run("INSERT INTO mcp_api_keys (user_id, name, key_hash, key_prefix, scopes_json) VALUES (?, ?, ?, ?, ?)", [userId, name, hashKey(key), key.slice(0, 13), JSON.stringify(scopes)]);
  return { key, keyPrefix: key.slice(0, 13) };
}
