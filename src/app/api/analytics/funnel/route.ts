// ===== GET /api/analytics/funnel?days=1|7|30 =====
// 每日推广复盘查询：核心漏斗 + 转化率 + 来源分组 + 按日明细。
// 安全：Bearer CRON_SECRET（fail-closed，与 cron 路由同一防线）；不对外开放。

import { NextResponse } from "next/server";
import {
  getFunnelWindow,
  computeConversions,
  getSourceBreakdown,
  getDailyFunnel,
} from "@/lib/analytics/funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // fail-closed：secret 未配置时拒绝
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get("days") ?? "30");

  try {
    const windows = await Promise.all([getFunnelWindow(1), getFunnelWindow(7), getFunnelWindow(30)]);
    const payload = {
      windows: windows.map((w) => ({ ...w, conversions: computeConversions(w) })),
      requestedDays: Number.isInteger(days) && days > 0 && days <= 365 ? days : 30,
      sourceBreakdown: await getSourceBreakdown(
        Number.isInteger(days) && days > 0 && days <= 365 ? days : 30
      ),
      daily: await getDailyFunnel(
        Number.isInteger(days) && days > 0 && days <= 365 ? days : 30
      ),
    };
    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 500 }
    );
  }
}
