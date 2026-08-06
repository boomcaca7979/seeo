// ===== /api/health =====
// 健康检查（公开路由，无需鉴权）

import { NextResponse } from "next/server";
import { countTrackedKeywords, getApiUsage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  let dbStatus = "unknown";
  let serpapiUsage = "unknown";
  const userId = "demo-user";

  // DB 连通性检查（只读查询）
  try {
    await countTrackedKeywords(userId);
    dbStatus = "connected";
  } catch {
    dbStatus = "error";
  }

  // SerpApi 用量查询
  try {
    const month = new Date().toISOString().slice(0, 7);
    const usage = await getApiUsage(month);
    if (usage) {
      serpapiUsage = `${usage.used}/${usage.limit}`;
    } else {
      serpapiUsage = "0/100";
    }
  } catch {
    serpapiUsage = "unknown";
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    db: dbStatus,
    serpapi_usage: serpapiUsage,
    version: "1.0.0",
    response_time_ms: Date.now() - start,
  });
}
