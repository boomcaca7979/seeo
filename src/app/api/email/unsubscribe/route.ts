// ===== GET /api/email/unsubscribe?token=xxx =====
// 营销邮件一键退订（邮件底部链接指向这里）。
// 只退订营销类 lifecycle 邮件；账号安全类事务邮件不受影响。
// 成功后 302 到确认页。

import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/email/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = (searchParams.get("token") ?? "").trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.seeo.asia";

  if (!token) {
    return NextResponse.redirect(`${appUrl}/unsubscribe?status=invalid`, 302);
  }

  const ok = await unsubscribeByToken(token);
  return NextResponse.redirect(`${appUrl}/unsubscribe?status=${ok ? "done" : "already"}`, 302);
}
