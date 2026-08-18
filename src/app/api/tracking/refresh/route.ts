// ===== /api/tracking/refresh =====
// 刷新追踪词排名（P0 稳定性修复：批次 + 并发 + maxDuration）
//
// 单次请求最多处理 MAX_KEYWORDS_PER_REQUEST 个关键词（默认 20），
// 并发度 CONCURRENCY（默认 3），最坏 runtime ≈ ceil(20/3) × 10s ≈ 70s。
// 前端可通过 hasMore 字段判断是否需要继续请求下一批（传 offset 参数）。

import { NextResponse } from "next/server";
import { listTrackedKeywords } from "@/lib/db";
import { peekUsage } from "@/lib/seo/cache";
import {
  refreshRanksBatch,
  MAX_KEYWORDS_PER_REQUEST,
  type RefreshItem,
} from "@/lib/seo/refresh";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// P0 保险丝：单次请求最长 90s（最坏 70s + buffer）
export const maxDuration = 90;

export async function POST(request: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const list = await listTrackedKeywords(userId);

  if (list.length === 0) {
    const usage = await peekUsage(userId, "serpapi", plan);
    return NextResponse.json({
      data: { items: [], summary: "暂无追踪词", remaining: 0, hasMore: false },
      usage,
    });
  }

  // P0：支持 offset 参数，前端续批时传 offset 跳过已处理词
  const url = new URL(request.url);
  const offsetRaw = Number(url.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0
    ? Math.min(Math.floor(offsetRaw), list.length)
    : 0;

  // P0：单次请求只处理 MAX_KEYWORDS_PER_REQUEST 个关键词
  const batch = list.slice(offset, offset + MAX_KEYWORDS_PER_REQUEST);
  const remaining = list.length - (offset + batch.length);

  const items: RefreshItem[] = await refreshRanksBatch(userId, plan, batch);

  const usage = await peekUsage(userId, "serpapi", plan);
  const successCount = items.filter((i) => !i.error).length;
  const hasMore = remaining > 0;
  const nextOffset = offset + batch.length;
  const summary = `已刷新 ${successCount}/${items.length} 个词`
    + (items.some((i) => i.fromCache) ? "（部分命中缓存未扣额度）" : "")
    + (hasMore ? `，剩余 ${remaining} 个词可继续刷新` : "");

  return NextResponse.json({
    data: { items, summary, remaining, hasMore, nextOffset },
    usage,
  });
}
