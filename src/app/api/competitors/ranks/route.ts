// ===== /api/competitors/ranks =====
// GET：返回某关键词下所有竞品的最新排名
//   - query: keyword_id
//   - 如果数据库中无记录或记录超过 24h，自动触发 SerpApi 查询并缓存
//   - POST：手动触发刷新（body: { keyword_id }）

import { NextResponse } from "next/server";
import {
  getTrackedKeywordById,
  getLatestCompetitorRanks,
  addCompetitorRank,
  listCompetitors,
  getProjectByDomain,
} from "@/lib/db";
import { checkCompetitorRanks } from "@/lib/seo/competitor";
import { SeoProviderError } from "@/lib/seo/provider";
import { peekUsage, QuotaExceededError } from "@/lib/seo/cache";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo, type PlanTier } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function mapError(e: unknown) {
  if (e instanceof SeoProviderError) {
    const status =
      e.code === "INVALID_KEY" ? 401 :
      e.code === "QUOTA_EXCEEDED" ? 429 :
      e.code === "TIMEOUT" ? 504 :
      e.code === "BAD_REQUEST" ? 400 : 502;
    return NextResponse.json<SeoApiError>({ error: e.message, code: e.code }, { status });
  }
  if (e instanceof QuotaExceededError) {
    return NextResponse.json<SeoApiError>(
      { error: e.message, code: "QUOTA_EXCEEDED" },
      { status: 429 }
    );
  }
  if (e instanceof Error && e.message === "QUOTA_EXCEEDED") {
    return NextResponse.json<SeoApiError>(
      { error: "本月额度已用尽，下月 1 日自动重置", code: "QUOTA_EXCEEDED" },
      { status: 429 }
    );
  }
  return NextResponse.json<SeoApiError>(
    { error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" },
    { status: 500 }
  );
}

/**
 * 执行一次竞品排名查询并写入数据库
 * 返回最新结果 + fromCache + usage
 */
async function refreshRanks(userId: string, keywordId: number, plan: PlanTier = "free") {
  const kw = await getTrackedKeywordById(userId, keywordId);
  if (!kw) {
    return NextResponse.json({ error: "未找到该关键词" }, { status: 404 });
  }

  // 通过 keyword.domain 找到所属 project
  const project = (await getProjectByDomain(userId, kw.domain)) ?? null;
  let competitors: Array<{ id: number; domain: string }> = [];
  if (project) {
    competitors = (await listCompetitors(userId, project.id)).map((c) => ({ id: c.id, domain: c.domain }));
  }

  // 把「我自己」也作为竞争者纳入对比（domain = kw.domain）
  // 用 competitorId = 0 表示「我自己」，不写入 competitor_ranks 表
  const allCompetitors = [
    { id: 0, domain: kw.domain },
    ...competitors,
  ];

  try {
    const { results, fromCache, usage } = await checkCompetitorRanks({
      keyword: kw.keyword,
      location: kw.location,
      device: kw.device,
      competitors: allCompetitors,
      userId,
      plan,
    });

    // 把竞品结果写入数据库（不写 id=0 的「我自己」）
    for (const r of results) {
      if (r.competitorId === 0) continue;
      await addCompetitorRank(userId, {
        competitor_id: r.competitorId,
        keyword_id: keywordId,
        rank: r.rank,
        target_url: r.targetUrl,
      });
    }

    // 返回完整对比（含我自己）
    const latestFromDb = await getLatestCompetitorRanks(userId, keywordId);
    const selfRank = results.find((r) => r.competitorId === 0) ?? null;
    const merged = [
      {
        competitor_id: 0,
        domain: kw.domain,
        rank: selfRank?.rank ?? null,
        target_url: selfRank?.targetUrl ?? null,
        checked_at: new Date().toISOString(),
        is_self: true,
      },
      ...latestFromDb.map((r) => ({ ...r, is_self: false })),
    ];

    return NextResponse.json({
      data: {
        keyword: kw.keyword,
        keyword_id: keywordId,
        domain: kw.domain,
        results: merged,
        fromCache,
      },
      usage,
    });
  } catch (e) {
    return mapError(e);
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
  const keywordId = Number(searchParams.get("keyword_id") ?? "");

  if (!Number.isInteger(keywordId) || keywordId <= 0) {
    return NextResponse.json<SeoApiError>(
      { error: "keyword_id 参数无效", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const kw = await getTrackedKeywordById(userId, keywordId);
  if (!kw) {
    return NextResponse.json({ error: "未找到该关键词" }, { status: 404 });
  }

  // 读已有最新记录
  const latest = await getLatestCompetitorRanks(userId, keywordId);
  const usage = await peekUsage(userId, "serpapi", plan);

  // 如果有记录且未过期 24h，直接返回
  if (latest.length > 0) {
    const newestCheckedAt = latest.reduce((max, r) => {
      return r.checked_at > max ? r.checked_at : max;
    }, latest[0].checked_at);
    const ageMs = Date.now() - new Date(newestCheckedAt.endsWith("Z") ? newestCheckedAt : newestCheckedAt.replace(" ", "T") + "Z").getTime();
    if (ageMs < CACHE_TTL_MS) {
      // 仍然触发一次 SerpApi 查询以补上「我自己」的排名（不消耗额度，命中缓存）
      try {
        const project = await getProjectByDomain(userId, kw.domain);
        const competitors = project
          ? (await listCompetitors(userId, project.id)).map((c) => ({ id: c.id, domain: c.domain }))
          : [];
        const allCompetitors = [{ id: 0, domain: kw.domain }, ...competitors];
        const { results } = await checkCompetitorRanks({
          keyword: kw.keyword,
          location: kw.location,
          device: kw.device,
          competitors: allCompetitors,
          userId,
          plan,
        });
        const selfRank = results.find((r) => r.competitorId === 0) ?? null;
        const merged = [
          {
            competitor_id: 0,
            domain: kw.domain,
            rank: selfRank?.rank ?? null,
            target_url: selfRank?.targetUrl ?? null,
            checked_at: newestCheckedAt,
            is_self: true,
          },
          ...latest.map((r) => ({ ...r, is_self: false })),
        ];
        return NextResponse.json({
          data: {
            keyword: kw.keyword,
            keyword_id: keywordId,
            domain: kw.domain,
            results: merged,
            fromCache: true,
          },
          usage,
        });
      } catch {
        // 缓存查询失败，回退到仅返回数据库结果
      }
    }
  }

  // 无记录或已过期：触发刷新
  return refreshRanks(userId, keywordId, plan);
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  let body: { keyword_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<SeoApiError>(
      { error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  const keywordId = Number(body.keyword_id);
  if (!Number.isInteger(keywordId) || keywordId <= 0) {
    return NextResponse.json<SeoApiError>(
      { error: "keyword_id 参数无效", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  return refreshRanks(userId, keywordId, plan);
}
