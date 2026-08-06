// ===== /api/competitors/sov =====
// GET：返回项目下所有关键词的 SOV 汇总
//   - query: project_id
//   - 遍历所有追踪关键词，取每个关键词的最新竞品排名 + 我的排名
//   - 调用 calculateSOV 计算

import { NextResponse } from "next/server";
import {
  getProjectById,
  listCompetitors,
  listTrackedKeywords,
  getLatestCompetitorRanks,
} from "@/lib/db";
import { calculateSOV, type SOVInput } from "@/lib/seo/sov";
import { peekUsage } from "@/lib/seo/cache";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const projectId = Number(searchParams.get("project_id") ?? "");

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "project_id 参数无效" }, { status: 400 });
  }

  const project = await getProjectById(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
  }

  // 获取该项目所有追踪关键词（通过 domain 关联）
  const allTracked = await listTrackedKeywords(userId);
  const projectKeywords = allTracked.filter((k) => k.domain === project.domain);
  const totalKeywords = projectKeywords.length;
  const competitors = await listCompetitors(userId, projectId);

  // 收集所有关键词的排名数据
  const allRankings: SOVInput[] = [];
  let analyzedKeywords = 0;

  for (const kw of projectKeywords) {
    const latest = await getLatestCompetitorRanks(userId, kw.id);
    if (latest.length === 0 && kw.todayPosition === null) {
      // 该关键词既没有竞品排名记录，也没有自己的排名记录
      continue;
    }
    analyzedKeywords++;

    // 加入我的排名（来自 rank_history 的 todayPosition）
    allRankings.push({
      domain: project.domain,
      rank: kw.todayPosition,
    });

    // 加入各竞品的最新排名
    for (const r of latest) {
      allRankings.push({
        domain: r.domain,
        rank: r.rank,
      });
    }
  }

  const sov = calculateSOV(allRankings);
  const usage = await peekUsage();

  return NextResponse.json({
    data: {
      projectDomain: project.domain,
      totalKeywords,
      analyzedKeywords,
      competitorCount: competitors.length,
      sov,
    },
    usage,
  });
}
