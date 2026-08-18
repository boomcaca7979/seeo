// ===== GET /api/alerts =====
// 返回最新 50 条预警 + 未读数

import { NextResponse } from "next/server";
import { listAlerts, countUnreadAlerts } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const alerts = await listAlerts(userId, 50);
  const unread = await countUnreadAlerts(userId);
  return NextResponse.json({
    data: alerts,
    unread,
  });
}
