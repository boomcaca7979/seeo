// ===== /api/automation/run =====
// POST：手动触发一次自动化任务（需登录鉴权，执行当前用户的任务）
// GET：Vercel Cron 触发（需 CRON_SECRET 验证，遍历所有用户执行）

import { NextResponse } from "next/server";
import { runDailyRefresh, runWeeklyReport } from "@/lib/automation/cron";
import { requireAuthOrDemo } from "@/lib/auth";
import { listDistinctUserIds } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 用户鉴权（演示模式跳过）
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

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
      await runDailyRefresh(userId);
    } else {
      await runWeeklyReport(userId);
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
// 无用户 session，遍历所有有数据的用户逐个执行
export async function GET(request: Request) {
  // 验证请求来自 Vercel Cron（fail-closed：secret 为空时拒绝）
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userIds = await listDistinctUserIds();
    if (userIds.length === 0) userIds.push("demo-user");
    const errors: Array<{ userId: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        await runDailyRefresh(userId);
      } catch (err) {
        errors.push({ userId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return NextResponse.json({
      data: { type: "daily_refresh", status: "done", processed: userIds.length, errors },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败" },
      { status: 500 }
    );
  }
}
