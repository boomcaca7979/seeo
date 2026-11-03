// ===== Website Content Gap 数据层（site_scans / site_content_pages） =====
//
// owner 隔离：全部查询带 user_id；扫描状态驱动 UI（进度/取消/重试）；页面按
// (user_id, project_id, url) UNIQUE upsert，重复扫描不产生重复行。

import { getAdapter } from "./migrations";

export type ScanStatus = "running" | "completed" | "failed" | "cancelled";

export interface SiteScanRow {
  id: number;
  userId: string;
  projectId: number;
  domain: string;
  status: ScanStatus;
  sitemapUrl: string | null;
  requested: number;
  crawled: number;
  failed: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

function rowToScan(row: Record<string, unknown>): SiteScanRow {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    projectId: Number(row.project_id),
    domain: String(row.domain),
    status: String(row.status) as ScanStatus,
    sitemapUrl: row.sitemap_url ? String(row.sitemap_url) : null,
    requested: Number(row.requested ?? 0),
    crawled: Number(row.crawled ?? 0),
    failed: Number(row.failed ?? 0),
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

export async function createSiteScan(
  userId: string,
  projectId: number,
  domain: string
): Promise<SiteScanRow> {
  const db = await getAdapter();
  const info = await db.run(
    `INSERT INTO site_scans (user_id, project_id, domain, status) VALUES (@user_id, @project_id, @domain, 'running')`,
    [{ user_id: userId, project_id: projectId, domain }]
  );
  const row = (await db.get(`SELECT * FROM site_scans WHERE id = ?`, [info.lastInsertRowid])) as Record<string, unknown>;
  return rowToScan(row);
}

export async function getSiteScan(userId: string, id: number): Promise<SiteScanRow | null> {
  const db = await getAdapter();
  const row = (await db.get(`SELECT * FROM site_scans WHERE id = ? AND user_id = ?`, [id, userId])) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToScan(row) : null;
}

export async function latestSiteScan(userId: string, projectId: number): Promise<SiteScanRow | null> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT * FROM site_scans WHERE user_id = ? AND project_id = ? ORDER BY id DESC LIMIT 1`,
    [userId, projectId]
  )) as Record<string, unknown> | undefined;
  return row ? rowToScan(row) : null;
}

/** 扫描进度更新；返回 false 表示扫描已不在 running（取消/失败），执行方应停止 */
export async function updateScanProgress(
  userId: string,
  id: number,
  patch: { requested?: number; crawled?: number; failed?: number; sitemapUrl?: string }
): Promise<boolean> {
  const db = await getAdapter();
  const sets = ["requested = @requested", "crawled = @crawled", "failed = @failed"];
  const args: Record<string, unknown> = {
    id,
    user_id: userId,
    requested: patch.requested ?? 0,
    crawled: patch.crawled ?? 0,
    failed: patch.failed ?? 0,
  };
  if (patch.sitemapUrl !== undefined) {
    sets.push("sitemap_url = @sitemap_url");
    args.sitemap_url = patch.sitemapUrl;
  }
  const info = await db.run(
    `UPDATE site_scans SET ${sets.join(", ")} WHERE id = @id AND user_id = @user_id AND status = 'running'`,
    [args]
  );
  return Number(info.changes) > 0;
}

export async function finishScan(
  userId: string,
  id: number,
  status: Exclude<ScanStatus, "running">,
  patch?: { error?: string }
): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE site_scans SET status = @status, error = @error, finished_at = datetime('now', 'localtime')
     WHERE id = @id AND user_id = @user_id`,
    [{ id, user_id: userId, status, error: patch?.error ?? null }]
  );
}

export interface SitePageUpsert {
  url: string;
  canonicalUrl?: string | null;
  title?: string | null;
  h1?: string | null;
  metaDescription?: string | null;
  httpStatus?: number | null;
  internalLinks?: number | null;
  error?: string | null;
}

export async function upsertSitePage(
  userId: string,
  projectId: number,
  scanId: number,
  page: SitePageUpsert
): Promise<void> {
  const db = await getAdapter();
  // 纵深防御：scanId 必须归属同一 (user_id, project_id)，防止上游传参错误把
  // 页面行挂到异主扫描记录上（正常调用方 runner 传入的是自己创建的 scan）。
  const owned = (await db.get(
    `SELECT 1 AS ok FROM site_scans WHERE id = ? AND user_id = ? AND project_id = ? LIMIT 1`,
    [scanId, userId, projectId]
  )) as { ok?: number } | undefined;
  if (owned?.ok !== 1) {
    throw new Error(`[site-content] scan ${scanId} does not belong to (user=${userId}, project=${projectId}); refusing to attach pages`);
  }
  await db.run(
    `INSERT INTO site_content_pages
       (user_id, project_id, scan_id, url, canonical_url, title, h1, meta_description, http_status, internal_links, fetched_at, error)
     VALUES (@user_id, @project_id, @scan_id, @url, @canonical_url, @title, @h1, @meta_description, @http_status, @internal_links, datetime('now','localtime'), @error)
     ON CONFLICT(user_id, project_id, url) DO UPDATE SET
       scan_id = excluded.scan_id,
       canonical_url = excluded.canonical_url,
       title = excluded.title,
       h1 = excluded.h1,
       meta_description = excluded.meta_description,
       http_status = excluded.http_status,
       internal_links = excluded.internal_links,
       fetched_at = excluded.fetched_at,
       error = excluded.error,
       updated_at = datetime('now', 'localtime')`,
    [
      {
        user_id: userId,
        project_id: projectId,
        scan_id: scanId,
        url: page.url,
        canonical_url: page.canonicalUrl ?? null,
        title: page.title ?? null,
        h1: page.h1 ?? null,
        meta_description: page.metaDescription ?? null,
        http_status: page.httpStatus ?? null,
        internal_links: page.internalLinks ?? null,
        error: page.error ?? null,
      },
    ]
  );
}

export async function listSitePages(userId: string, projectId: number): Promise<
  Array<{ url: string; title: string | null; h1: string | null; httpStatus: number | null; error: string | null; fetchedAt: string | null }>
> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT url, title, h1, http_status, error, fetched_at FROM site_content_pages
     WHERE user_id = ? AND project_id = ? ORDER BY url ASC`,
    [userId, projectId]
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    url: String(r.url),
    title: r.title ? String(r.title) : null,
    h1: r.h1 ? String(r.h1) : null,
    httpStatus: r.http_status == null ? null : Number(r.http_status),
    error: r.error ? String(r.error) : null,
    fetchedAt: r.fetched_at ? String(r.fetched_at) : null,
  }));
}
