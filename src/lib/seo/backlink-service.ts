import { getBacklinkSummary, listBacklinks, saveBacklinks, type BacklinkRow } from "@/lib/db/backlinks";
import { fetchBacklinks, isDataForSeoConfigured } from "./dataforseo";
import { consumeQuota } from "./cache";
import { requireFeature } from "@/lib/guards";
import type { PlanTier } from "@/lib/auth";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 60 * 60 * 1000;

export function normalizeBacklinkDomain(raw: string): string | null {
  const domain = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!domain || !/^[\w.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return domain;
}

function fetchedAtMs(value: string) {
  const parsed = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface BacklinkProfileOptions {
  page: number;
  pageSize: number;
  sort: "sourceRankDesc" | "sourceRankAsc" | "firstSeenDesc" | "firstSeenAsc";
  sourceUrl?: string;
  targetUrl?: string;
  anchor?: string;
  dofollow?: boolean;
  onePerDomain?: boolean;
}

export interface BacklinkProfileResult {
  summary: { totalBacklinks: number | null; referringDomains: number | null; domainRank: number | null; dofollowPct: number | null };
  rows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
  cachedAt: string | null;
  fromCache: boolean;
  limitations: string[];
}

function filterAndSort(rows: BacklinkRow[], options: BacklinkProfileOptions): BacklinkRow[] {
  const filtered = rows.filter((row) =>
    (!options.sourceUrl || (row.source_url ?? "").toLowerCase().includes(options.sourceUrl.toLowerCase())) &&
    (!options.targetUrl || (row.target_url ?? "").toLowerCase().includes(options.targetUrl.toLowerCase())) &&
    (!options.anchor || (row.anchor ?? "").toLowerCase().includes(options.anchor.toLowerCase())) &&
    (options.dofollow === undefined || (row.dofollow === 1) === options.dofollow)
  );
  filtered.sort((a, b) => {
    if (options.sort.startsWith("sourceRank")) {
      const direction = options.sort.endsWith("Desc") ? -1 : 1;
      return ((a.source_rank ?? 0) - (b.source_rank ?? 0)) * direction;
    }
    const aa = a.first_seen ?? "";
    const bb = b.first_seen ?? "";
    return options.sort.endsWith("Desc") ? bb.localeCompare(aa) : aa.localeCompare(bb);
  });
  if (!options.onePerDomain) return filtered;
  const seen = new Set<string>();
  return filtered.filter((row) => {
    try {
      const host = new URL(row.source_url ?? "").hostname.toLowerCase();
      if (seen.has(host)) return false;
      seen.add(host);
      return true;
    } catch { return true; }
  });
}

export async function getBacklinkProfile(userId: string, plan: PlanTier, domain: string, options: BacklinkProfileOptions): Promise<BacklinkProfileResult> {
  await requireFeature(userId, "backlinks");
  const summary = await getBacklinkSummary(userId, domain);
  let fromCache = Boolean(summary && Date.now() - fetchedAtMs(summary.fetched_at) <= CACHE_TTL_MS);
  if (!summary || !fromCache) {
    if (!isDataForSeoConfigured()) throw new Error("NOT_CONFIGURED: DataForSEO is not configured");
    if (summary && Date.now() - fetchedAtMs(summary.fetched_at) <= COOLDOWN_MS) throw new Error("RATE_LIMITED: backlink refresh is cooling down");
    await consumeQuota(userId, "dataforseo", plan);
    const data = await fetchBacklinks(domain, { limit: 100 });
    await saveBacklinks(userId, { domain, summary: { ...data.summary, raw_json: JSON.stringify(data.rawJson) }, rows: data.backlinks });
    fromCache = false;
  }
  const latest = await getBacklinkSummary(userId, domain);
  const allRows = await listBacklinks(userId, domain, 100);
  const rows = filterAndSort(allRows, options);
  const start = (options.page - 1) * options.pageSize;
  const pageRows = rows.slice(start, start + options.pageSize);
  return {
    summary: { totalBacklinks: latest?.total_backlinks ?? null, referringDomains: latest?.referring_domains ?? null, domainRank: latest?.domain_rank ?? null, dofollowPct: latest?.dofollow_pct ?? null },
    rows: pageRows.map((row) => ({ sourceUrl: row.source_url, anchor: row.anchor, targetUrl: row.target_url, dofollow: row.dofollow === null ? null : row.dofollow === 1, sourceRank: row.source_rank, firstSeen: row.first_seen })),
    page: options.page, pageSize: options.pageSize, totalCount: rows.length, hasMore: start + pageRows.length < rows.length,
    cachedAt: latest?.fetched_at ?? null, fromCache,
    limitations: ["The current SeeO provider persists at most 100 backlinks per refresh; pagination is bounded to persisted rows."],
  };
}

export { CACHE_TTL_MS };
