// ===== /api/backlinks =====
// GET  ?domain=xxx：查 7 天缓存，命中返回数据，未命中返回 null
// POST { domain }：校验 → 查 7 天缓存命中直返 → 1 小时冷却判断 → 调 DataForSEO → 写库 → 返回
// 防滥用：同域名 1 小时内只允许一次真实拉取（拉取失败不写库，自然不触发冷却，可重试）

import { NextResponse } from "next/server";
import { getBacklinkSummary, listBacklinks } from "@/lib/db";
import { getBacklinkProfile, normalizeBacklinkDomain } from "@/lib/seo/backlink-service";
import { requireAuthOrDemo } from "@/lib/auth";
import { peekUsage } from "@/lib/seo/cache";
import { requireFeature, FeatureNotAllowedError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

interface BacklinkApiResponse {
  summary: {
    totalBacklinks: number | null;
    referringDomains: number | null;
    domainRank: number | null;
    dofollowPct: number | null;
  };
  backlinks: Array<{
    sourceUrl: string | null;
    anchor: string | null;
    targetUrl: string | null;
    dofollow: boolean | null;
    sourceRank: number | null;
    firstSeen: string | null;
  }>;
  cachedAt: string;
  fromCache: boolean;
}

function toResponse(s: {
  total_backlinks: number | null;
  referring_domains: number | null;
  domain_rank: number | null;
  dofollow_pct: number | null;
}, rows: Array<{
  source_url: string | null;
  anchor: string | null;
  target_url: string | null;
  dofollow: number | null;
  source_rank: number | null;
  first_seen: string | null;
}>, fetchedAt: string, fromCache: boolean): BacklinkApiResponse {
  return {
    summary: {
      totalBacklinks: s.total_backlinks,
      referringDomains: s.referring_domains,
      domainRank: s.domain_rank,
      dofollowPct: s.dofollow_pct,
    },
    backlinks: rows.map((r) => ({
      sourceUrl: r.source_url,
      anchor: r.anchor,
      targetUrl: r.target_url,
      dofollow: r.dofollow === null ? null : r.dofollow === 1,
      sourceRank: r.source_rank,
      firstSeen: r.first_seen,
    })),
    cachedAt: fetchedAt,
    fromCache,
  };
}

function normalizeDomain(raw: string): string | null {
  let d = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  d = d.toLowerCase().trim();
  if (!d || !/^[\w.-]+\.[a-z]{2,}$/i.test(d)) return null;
  return d;
}

function parseFetchedAt(iso: string): number {
  // SQLite datetime（UTC，可能带 'Z' 或不带）
  try {
    const s = iso.endsWith("Z") ? iso : iso + "Z";
    return new Date(s).getTime();
  } catch {
    return 0;
  }
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;

  // P5：backlinks Feature 权限校验（Pro 专属，free/lite 拒绝）
  try {
    await requireFeature(userId, "backlinks");
  } catch (e) {
    if (e instanceof FeatureNotAllowedError) {
      const { status, body } = billingErrorToResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const domain = normalizeDomain(searchParams.get("domain") ?? "");
  if (!domain) {
    return NextResponse.json({ error: "域名格式无效，如 example.com", code: "INVALID_DOMAIN" }, { status: 400 });
  }

  const summary = await getBacklinkSummary(userId, domain);
  if (!summary) {
    const usage = await peekUsage(userId, "dataforseo", plan);
    return NextResponse.json({ data: null, usage });
  }

  const fetchedAtMs = parseFetchedAt(summary.fetched_at);
  const age = Date.now() - fetchedAtMs;
  if (age > CACHE_TTL_MS) {
    // 缓存过期，视为无缓存
    const usage = await peekUsage(userId, "dataforseo", plan);
    return NextResponse.json({ data: null, usage });
  }

  const rows = await listBacklinks(userId, domain, 100);
  const usage = await peekUsage(userId, "dataforseo", plan);
  return NextResponse.json({
    data: toResponse(summary, rows, summary.fetched_at, true),
    usage,
  });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const domain = normalizeBacklinkDomain(String(body.domain ?? ""));
  if (!domain) {
    return NextResponse.json({ error: "域名格式无效，如 example.com", code: "INVALID_DOMAIN" }, { status: 400 });
  }

  try {
    // BacklinkService owns feature checks, cache/cooldown, quota consumption,
    // provider access, persistence, and bounded result shaping.
    const profile = await getBacklinkProfile(userId, plan, domain, {
      page: 1,
      pageSize: 100,
      sort: "sourceRankDesc",
    });
    return NextResponse.json({
      data: {
        summary: profile.summary,
        backlinks: profile.rows.map((row) => ({
          sourceUrl: row.sourceUrl,
          anchor: row.anchor,
          targetUrl: row.targetUrl,
          dofollow: row.dofollow,
          sourceRank: row.sourceRank,
          firstSeen: row.firstSeen,
        })),
        cachedAt: profile.cachedAt ?? new Date().toISOString(),
        fromCache: profile.fromCache,
      },
      usage: await peekUsage(userId, "dataforseo", plan),
    });
  } catch (error) {
    // Preserve the existing route's public response shape while keeping all
    // provider/database/billing orchestration inside the shared service.
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("NOT_CONFIGURED:")) {
      return NextResponse.json({ error: message.slice(14).trim(), code: "DATAFORSEO_NOT_CONFIGURED" }, { status: 503 });
    }
    if (message.startsWith("RATE_LIMITED:")) {
      return NextResponse.json({ error: message.slice(12).trim(), code: "BACKLINK_COOLDOWN", usage: await peekUsage(userId, "dataforseo", plan) }, { status: 429 });
    }
    if (message.includes("QuotaExceeded") || message.includes("QUOTA_EXCEEDED") || error instanceof Error && error.name === "QuotaExceededError") {
      return NextResponse.json({ error: message, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }
    if (error instanceof Error && error.name === "FeatureNotAllowedError") {
      return NextResponse.json({ error: message, code: "FEATURE_NOT_AVAILABLE" }, { status: 403 });
    }
    return NextResponse.json({ error: message, code: "UPSTREAM_ERROR" }, { status: 500 });
  }
}
