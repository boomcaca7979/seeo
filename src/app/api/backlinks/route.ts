// ===== /api/backlinks =====
// GET  ?domain=xxx：查 7 天缓存，命中返回数据，未命中返回 null
// POST { domain }：校验 → 查 7 天缓存命中直返 → 1 小时冷却判断 → 调 DataForSEO → 写库 → 返回
// 防滥用：同域名 1 小时内只允许一次真实拉取（拉取失败不写库，自然不触发冷却，可重试）

import { NextResponse } from "next/server";
import { getBacklinkSummary, listBacklinks, saveBacklinks } from "@/lib/db";
import { fetchBacklinks, isDataForSeoConfigured, DataForSeoNotConfiguredError } from "@/lib/seo/dataforseo";
import { requireAuthOrDemo } from "@/lib/auth";
import { consumeQuota, peekUsage, QuotaExceededError } from "@/lib/seo/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const COOLDOWN_MS = 60 * 60 * 1000; // 1 小时

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
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const { searchParams } = new URL(req.url);
  const domain = normalizeDomain(searchParams.get("domain") ?? "");
  if (!domain) {
    return NextResponse.json({ error: "域名格式无效，如 example.com" }, { status: 400 });
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
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const domain = normalizeDomain(String(body.domain ?? ""));
  if (!domain) {
    return NextResponse.json({ error: "域名格式无效，如 example.com" }, { status: 400 });
  }

  // 未配置凭证
  if (!isDataForSeoConfigured()) {
    return NextResponse.json(
      { error: "未配置 DataForSEO 凭证（DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD）" },
      { status: 503 }
    );
  }

  // 查 7 天缓存，命中直接返回（不扣额度）
  const cached = await getBacklinkSummary(userId, domain);
  if (cached) {
    const fetchedAtMs = parseFetchedAt(cached.fetched_at);
    const age = Date.now() - fetchedAtMs;
    if (age <= CACHE_TTL_MS) {
      const rows = await listBacklinks(userId, domain, 100);
      const usage = await peekUsage(userId, "dataforseo", plan);
      return NextResponse.json({
        data: toResponse(cached, rows, cached.fetched_at, true),
        usage,
      });
    }
    // 缓存过期但 1 小时内不重复拉取
    if (age <= COOLDOWN_MS) {
      const remainingMin = Math.max(1, Math.round((COOLDOWN_MS - age) / 60_000));
      const usage = await peekUsage(userId, "dataforseo", plan);
      return NextResponse.json({
        error: `该域名外链数据冷却中，请约 ${remainingMin} 分钟后再试（1 小时内仅允许拉取一次）`,
        usage,
      }, { status: 429 });
    }
  }

  // 真实调用 DataForSEO 前：用户级额度检查 + 计数
  // free: 0/月，pro: 10/月，team: 50/月，enterprise: 无限
  // 超限时返回 DATAFORSEO_QUOTA_EXCEEDED，不继续调用第三方 API
  let usage;
  try {
    usage = await consumeQuota(userId, "dataforseo", plan);
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      // P3：统一为 billingErrorToResponse 格式
      const planTier = plan;
      const billingErr = {
        code: "QUOTA_EXCEEDED" as const,
        message: e.message,
        plan: planTier,
        limit: e.limit,
        used: e.used,
      };
      return NextResponse.json(billingErr, { status: 429 });
    }
    const msg = (e as Error)?.message ?? String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // 调 DataForSEO 拉取（失败不写库，可重试）
  try {
    const data = await fetchBacklinks(domain, { limit: 100 });
    await saveBacklinks(userId, {
      domain,
      summary: {
        total_backlinks: data.summary.total_backlinks,
        referring_domains: data.summary.referring_domains,
        domain_rank: data.summary.domain_rank,
        dofollow_pct: data.summary.dofollow_pct,
        raw_json: JSON.stringify(data.rawJson),
      },
      rows: data.backlinks,
    });

    // 读回刚写入的记录（拿 fetched_at）
    const fresh = await getBacklinkSummary(userId, domain);
    const fetchedAt = fresh?.fetched_at ?? new Date().toISOString();
    return NextResponse.json({
      data: toResponse(
        {
          total_backlinks: data.summary.total_backlinks,
          referring_domains: data.summary.referring_domains,
          domain_rank: data.summary.domain_rank,
          dofollow_pct: data.summary.dofollow_pct,
        },
        data.backlinks,
        fetchedAt,
        false
      ),
      usage,
    });
  } catch (err) {
    if (err instanceof DataForSeoNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const msg = (err as Error)?.message ?? String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
