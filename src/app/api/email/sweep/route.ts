// ===== GET /api/email/sweep =====
// Lifecycle 邮件每日巡检：按资格规则为各用户发送/跳过 lifecycle 邮件。
// 安全：Bearer CRON_SECRET（fail-closed，与 cron 路由同一防线）。
// 本地/未配置 RESEND_API_KEY 时按 dry-run 记录（status=skipped_no_provider）。

import { NextResponse } from "next/server";
import { runLifecycleEmailSweep } from "@/lib/email/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runLifecycleEmailSweep();
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sweep failed" },
      { status: 500 }
    );
  }
}
