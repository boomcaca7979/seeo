// ===== /api/competitors/ranks =====
// GET：只读已入库的竞品排名，**不请求上游 SerpApi、不消耗额度**
//   - query: keyword_id
//   - 有记录且在 24h 内 → 返回数据库结果（fromCache: true）
//   - 有记录但已超过 24h → 仍返回数据库结果，并标记 stale: true / needsRefresh: true
//   - 无记录 → 返回空结果 + needsRefresh: true（这是正常状态，不是 API 故障）
//     实时排名由用户显式点击「刷新排名并对比」（POST）触发
// POST：手动刷新（body: { keyword_id }），会调用 SerpApi 并按套餐日/月额度计费

import { NextResponse } from "next/server";
import {
  getTrackedKeywordById,
  getLatestCompetitorRanks,
  getRankHistory,
  addCompetitorRank,
  listCompetitors,
  getProjectByDomain,
} from "@/lib/db";
import { checkCompetitorRanks } from "@/lib/seo/competitor";
import { peekUsage } from "@/lib/seo/cache";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo, type PlanTier } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** SQLite datetime 字符串（"YYYY-MM-DD HH:MM:SS"）→ epoch ms，用于 24h 判断 */
function toEpochMs(checkedAt: string): number {
  return new Date(checkedAt.endsWith("Z") ? checkedAt : checkedAt.replace(" ", "T") + "Z").getTime();
}

/**
 * 「本站」基准行：只读该关键词已入库的 rank_history 最新一条。
 * 没有历史快照时返回 null——宁可少一行，不编造排名，也不为此请求上游。
 */
async function buildSelfRow(userId: string, keywordId: number, domain: string) {
  try {
    const history = await getRankHistory(userId, keywordId);
    const newest = history[history.length - 1];
    if (!newest) return null;
    return {
      competitor_id: 0,
      domain,
      rank: newest.position,
      target_url: newest.url,
      checked_at: newest.date,
      is_self: true,
    };
  } catch {
    // 补「本站」基准失败不影响竞品结果本身
    return null;
  }
}



/**
 * 执行一次竞品排名查询并写入数据库
 * 返回最新结果 + fromCache + usage
 */
async function refreshRanks(userId: string, keywordId: number, plan: PlanTier = "free") {
  const kw = await getTrackedKeywordById(userId, keywordId);
  if (!kw) {
    return NextResponse.json({ error: "未找到该关键词", code: "KEYWORD_NOT_FOUND" }, { status: 404 });
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

    // 与 GET 共用同一份响应形状：checkedAt 取本次结果里最新的时间，前端据此显示数据时间
    const checkedAt = merged.reduce<string | null>(
      (max, r) => (max === null || r.checked_at > max ? r.checked_at : max),
      null
    );

    return NextResponse.json({
      data: {
        keyword: kw.keyword,
        keyword_id: keywordId,
        domain: kw.domain,
        results: merged,
        fromCache,
        stale: false,
        needsRefresh: false,
        checkedAt,
      },
      usage,
    });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
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

  // 只读分支：数据库故障（500）与「库里没有数据」（200 + needsRefresh）必须区分
  try {
    const kw = await getTrackedKeywordById(userId, keywordId);
    if (!kw) {
      return NextResponse.json({ error: "未找到该关键词", code: "KEYWORD_NOT_FOUND" }, { status: 404 });
    }

    const latest = await getLatestCompetitorRanks(userId, keywordId);
    const usage = await peekUsage(userId, "serpapi", plan);

    if (latest.length === 0) {
      return NextResponse.json({
        data: {
          keyword: kw.keyword,
          keyword_id: keywordId,
          domain: kw.domain,
          results: [],
          fromCache: false,
          stale: false,
          needsRefresh: true,
          checkedAt: null,
        },
        usage,
      });
    }

    const newestCheckedAt = latest.reduce((max, r) => (r.checked_at > max ? r.checked_at : max), latest[0].checked_at);
    const stale = Date.now() - toEpochMs(newestCheckedAt) >= CACHE_TTL_MS;
    const selfRow = await buildSelfRow(userId, keywordId, kw.domain);

    return NextResponse.json({
      data: {
        keyword: kw.keyword,
        keyword_id: keywordId,
        domain: kw.domain,
        results: [...(selfRow ? [selfRow] : []), ...latest.map((r) => ({ ...r, is_self: false }))],
        fromCache: true,
        stale,
        needsRefresh: stale,
        checkedAt: newestCheckedAt,
      },
      usage,
    });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
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
