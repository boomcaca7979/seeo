// ===== GET /api/payments/notify/retry =====
// 付款通知重试巡检：投递所有 pending/failed 且未超过重试上限的通知。
// 安全：Bearer CRON_SECRET（fail-closed，与 email/sweep 同一防线）。
// 供 vercel.json cron（小时级）与手动触发使用；单条投递逻辑见
// deliverPaymentNotification（payment_notifications.dedupe_key 保证同一笔支付不重复发）。

import { NextResponse } from "next/server";
import { retryPendingPaymentNotifications } from "@/lib/payments/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await retryPendingPaymentNotifications();
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "retry failed" },
      { status: 500 }
    );
  }
}
