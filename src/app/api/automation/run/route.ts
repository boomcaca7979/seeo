// ===== /api/automation/run =====
// POST：手动触发一次自动化任务（需登录鉴权）
// GET：Vercel Cron 触发（需 CRON_SECRET 验证）

import { NextResponse } from "next/server";
import { runDailyRefresh, runWeeklyReport } from "@/lib/automation/cron";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 用户鉴权（演示模式跳过）
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: { type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const { type } = body;
  if (!type || (type !== "daily_refresh" && type !== "weekly_report")) {
    return NextResponse.json(
      { error: "type 必须是 daily_refresh 或 weekly_report" },
      { status: 400 }
    );
  }

  try {
    if (type === "daily_refresh") {
      await runDailyRefresh();
    } else {
      await runWeeklyReport();
    }
    return NextResponse.json({ data: { type, status: "done" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败" },
      { status: 500 }
    );
  }
}

// Vercel Cron 调用入口（每日 09:00 UTC）
export async function GET(request: Request) {
  // 验证请求来自 Vercel Cron（fail-closed：secret 为空时拒绝）
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runDailyRefresh();
    return NextResponse.json({ data: { type: "daily_refresh", status: "done" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败" },
      { status: 500 }
    );
  }
}
