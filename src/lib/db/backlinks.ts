// ===== 外链领域：backlinks + backlink_summaries（DataForSEO） =====

import { getAdapter } from "./migrations";

export interface BacklinkSummaryRow {
  id: number;
  domain: string;
  total_backlinks: number | null;
  referring_domains: number | null;
  domain_rank: number | null;
  dofollow_pct: number | null;
  raw_json: string | null;
  fetched_at: string;
}

export interface BacklinkRow {
  id: number;
  domain: string;
  source_url: string | null;
  anchor: string | null;
  target_url: string | null;
  dofollow: number | null;
  source_rank: number | null;
  first_seen: string | null;
  fetched_at: string;
}

/** 读取某域名的缓存 summary（7 天有效性由调用方判断 fetched_at） */
export async function getBacklinkSummary(userId: string, domain: string): Promise<BacklinkSummaryRow | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT * FROM backlink_summaries WHERE domain = ? AND user_id = ? LIMIT 1`,
    [domain, userId]
  ) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    domain: String(row.domain),
    total_backlinks: row.total_backlinks === null ? null : Number(row.total_backlinks),
    referring_domains: row.referring_domains === null ? null : Number(row.referring_domains),
    domain_rank: row.domain_rank === null ? null : Number(row.domain_rank),
    dofollow_pct: row.dofollow_pct === null ? null : Number(row.dofollow_pct),
    raw_json: row.raw_json ? String(row.raw_json) : null,
    fetched_at: String(row.fetched_at),
  };
}

/** 读取某域名的缓存外链列表（按 source_rank 降序） */
export async function listBacklinks(userId: string, domain: string, limit = 100): Promise<BacklinkRow[]> {
  const db = await getAdapter();
  const rows = await db.query(
    `SELECT * FROM backlinks WHERE domain = ? AND user_id = ? ORDER BY COALESCE(source_rank, 0) DESC, id ASC LIMIT ?`,
    [domain, userId, limit]
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    domain: String(r.domain),
    source_url: r.source_url === null || r.source_url === undefined ? null : String(r.source_url),
    anchor: r.anchor === null || r.anchor === undefined ? null : String(r.anchor),
    target_url: r.target_url === null || r.target_url === undefined ? null : String(r.target_url),
    dofollow: r.dofollow === null || r.dofollow === undefined ? null : Number(r.dofollow),
    source_rank: r.source_rank === null || r.source_rank === undefined ? null : Number(r.source_rank),
    first_seen: r.first_seen === null || r.first_seen === undefined ? null : String(r.first_seen),
    fetched_at: String(r.fetched_at),
  }));
}

export interface SaveBacklinksInput {
  domain: string;
  summary: {
    total_backlinks: number | null;
    referring_domains: number | null;
    domain_rank: number | null;
    dofollow_pct: number | null;
    raw_json: string | null;
  };
  rows: Array<{
    source_url: string | null;
    anchor: string | null;
    target_url: string | null;
    dofollow: number | null;
    source_rank: number | null;
    first_seen: string | null;
  }>;
}

/**
 * 写入外链数据：summary 用 UPSERT，backlinks 先删该域名旧行再批量插入。
 * 命名参数约定与 addAuditIssue 一致（db.run(sql, [{...}])）。
 */
export async function saveBacklinks(userId: string, input: SaveBacklinksInput): Promise<void> {
  const db = await getAdapter();
  // summary UPSERT
  await db.run(
    `INSERT INTO backlink_summaries (domain, total_backlinks, referring_domains, domain_rank, dofollow_pct, raw_json, fetched_at, user_id)
     VALUES (@domain, @total_backlinks, @referring_domains, @domain_rank, @dofollow_pct, @raw_json, datetime('now'), @user_id)
     ON CONFLICT(user_id, domain) DO UPDATE SET
       total_backlinks = @total_backlinks,
       referring_domains = @referring_domains,
       domain_rank = @domain_rank,
       dofollow_pct = @dofollow_pct,
       raw_json = @raw_json,
       fetched_at = datetime('now')`,
    [{
      domain: input.domain,
      total_backlinks: input.summary.total_backlinks,
      referring_domains: input.summary.referring_domains,
      domain_rank: input.summary.domain_rank,
      dofollow_pct: input.summary.dofollow_pct,
      raw_json: input.summary.raw_json,
      user_id: userId,
    }]
  );
  // 删旧行
  await db.run(`DELETE FROM backlinks WHERE domain = ? AND user_id = ?`, [input.domain, userId]);
  // 批量插入（每行一条 INSERT，命名参数）
  for (const r of input.rows) {
    await db.run(
      `INSERT INTO backlinks (domain, source_url, anchor, target_url, dofollow, source_rank, first_seen, fetched_at, user_id)
       VALUES (@domain, @source_url, @anchor, @target_url, @dofollow, @source_rank, @first_seen, datetime('now'), @user_id)`,
      [{
        domain: input.domain,
        source_url: r.source_url,
        anchor: r.anchor,
        target_url: r.target_url,
        dofollow: r.dofollow,
        source_rank: r.source_rank,
        first_seen: r.first_seen,
        user_id: userId,
      }]
    );
  }
}
