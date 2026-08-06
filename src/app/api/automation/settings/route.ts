// ===== /api/automation/settings =====
// GET：返回当前自动化配置
// POST：更新配置，重启定时任务

import { NextResponse } from "next/server";
import {
  getAutomationSettings,
  updateAutomationSettings,
} from "@/lib/db";
import { startAutomation } from "@/lib/automation/cron";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const settings = await getAutomationSettings();
  if (!settings) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }
  return NextResponse.json({ data: settings });
}

export async function POST(request: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const allowed: Array<keyof typeof body> = [
    "daily_refresh_enabled",
    "daily_refresh_time",
    "weekly_report_enabled",
    "weekly_report_day",
    "weekly_report_time",
  ];

  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      update[key] = body[key];
    }
  }

  // 校验
  if (
    update.daily_refresh_enabled !== undefined &&
    typeof update.daily_refresh_enabled !== "number" &&
    typeof update.daily_refresh_enabled !== "boolean"
  ) {
    return NextResponse.json({ error: "daily_refresh_enabled 必须是布尔值" }, { status: 400 });
  }
  if (typeof update.daily_refresh_enabled === "boolean") {
    update.daily_refresh_enabled = update.daily_refresh_enabled ? 1 : 0;
  }
  if (typeof update.weekly_report_enabled === "boolean") {
    update.weekly_report_enabled = update.weekly_report_enabled ? 1 : 0;
  }
  if (
    update.weekly_report_day !== undefined &&
    (typeof update.weekly_report_day !== "number" ||
      update.weekly_report_day < 0 ||
      update.weekly_report_day > 6)
  ) {
    return NextResponse.json({ error: "weekly_report_day 必须是 0-6 的整数" }, { status: 400 });
  }

  try {
    await updateAutomationSettings(update as Parameters<typeof updateAutomationSettings>[0]);
    // 重启定时任务
    startAutomation();
    const settings = await getAutomationSettings();
    return NextResponse.json({ data: settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "更新失败" },
      { status: 500 }
    );
  }
}
