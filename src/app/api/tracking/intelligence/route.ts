// ===== /api/tracking/intelligence =====
// GET：单关键词 Rank Intelligence（P0-02-D RankTrackingService）
//   - query: id (tracked keyword id), days (1-365, 默认 30)
//   - 返回 current/previous/change/status/rankingUrl 变化/历史/趋势/竞品变动
//   - 纯 DB 读取，零 provider 成本；归属校验经 getTrackedKeywordById(userId, id)

import { NextResponse } from "next/server";
import { getTrackedKeywordById } from "@/lib/db";
import { getKeywordRankIntelligence } from "@/lib/seo/rank-tracking-service";
import { peekUsage } from "@/lib/seo/cache";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id") ?? "");
  const days = Number(searchParams.get("days") ?? "30");

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json<SeoApiError>({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  if (!Number.isInteger(days) || days <= 0 || days > 365) {
    return NextResponse.json<SeoApiError>({ error: "days 参数无效（1-365）", code: "BAD_REQUEST" }, { status: 400 });
  }

  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;

  // 归属校验：tracked keyword 必须属于当前用户
  const tracked = await getTrackedKeywordById(userId, id);
  if (!tracked) {
    return NextResponse.json({ error: "未找到该追踪关键词", code: "KEYWORD_NOT_FOUND" }, { status: 404 });
  }

  const intelligence = await getKeywordRankIntelligence({ userId, keywordId: id, days });
  const usage = await peekUsage(userId, "serpapi", plan);
  return NextResponse.json({
    data: {
      keyword: tracked.keyword,
      domain: tracked.domain,
      location: tracked.location,
      device: tracked.device,
      ...intelligence,
    },
    usage,
  });
}
