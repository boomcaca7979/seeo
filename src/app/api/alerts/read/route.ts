// ===== POST /api/alerts/read =====
// 标记单条或全部预警为已读
// body: { id?: number } —— 不传 id 则标记全部

import { NextResponse } from "next/server";
import { markAlertRead, markAllAlertsRead, countUnreadAlerts } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // body 可以为空，表示全部已读
  }

  const id = body.id;
  if (id !== undefined && id !== null) {
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId <= 0) {
      return NextResponse.json({ error: "id 参数无效" }, { status: 400 });
    }
    await markAlertRead(userId, numId);
  } else {
    await markAllAlertsRead(userId);
  }

  const unread = await countUnreadAlerts(userId);
  return NextResponse.json({ data: { ok: true }, unread });
}
