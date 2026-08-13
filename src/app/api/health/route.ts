// ===== /api/health =====
// 健康检查（公开路由，无需鉴权）
// 只暴露必要的健康状态，不暴露内部第三方 API 用量、quota 等敏感信息

import { NextResponse } from "next/server";
import { countTrackedKeywords } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  let dbStatus = "unknown";
  const userId = "demo-user";

  // DB 连通性检查（只读查询）
  try {
    await countTrackedKeywords(userId);
    dbStatus = "connected";
  } catch {
    dbStatus = "error";
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    db: dbStatus,
    version: "1.0.0",
    response_time_ms: Date.now() - start,
  });
}
