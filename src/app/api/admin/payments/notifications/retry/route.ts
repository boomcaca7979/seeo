// ===== POST /api/admin/payments/notifications/retry =====
// 老板后台手动重试单条付款通知（失败/待发送的通知重新投递）。
// 鉴权：checkAdmin（fail-closed，与 /admin 全部 API 一致）。
// 已发送（sent）的通知重试直接返回 already_sent —— 不会重复发邮件。

import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin/auth";
import { deliverPaymentNotification } from "@/lib/payments/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await checkAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error, code: guard.code },
      { status: guard.status }
    );
  }

  let body: { id?: unknown };
  try {
    body = (await req.json()) as { id?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid notification id" }, { status: 400 });
  }

  try {
    const result = await deliverPaymentNotification(id);
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "retry failed" },
      { status: 500 }
    );
  }
}
