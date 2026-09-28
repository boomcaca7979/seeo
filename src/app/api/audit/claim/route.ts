// ===== POST /api/audit/claim =====
// 注册/登录成功后调用：把同一 IP 近 24h 内以 guest:{ip} 创建的审计记录
// 转移到当前账号（Free SEO Audit 漏斗的「先审计 → 后注册」衔接步骤）。
// 仅转移本人 IP 产生的记录，支持可选 domain 精确过滤。

import { NextResponse } from "next/server";
import { claimGuestAudits } from "@/lib/db";
import { requireAuthOrDemo, guestUserId } from "@/lib/auth";
import { isAuthEnabled } from "@/lib/auth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  // 演示模式无账号体系，无需认领
  if (!isAuthEnabled || !auth.user) {
    return NextResponse.json({ data: { moved: 0 } });
  }

  let domain: string | undefined;
  try {
    const body = (await req.json()) as { domain?: unknown };
    if (typeof body?.domain === "string" && body.domain.trim()) {
      domain = body.domain.trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    }
  } catch {
    // 无 body 时按全量认领处理
  }

  try {
    const moved = await claimGuestAudits(guestUserId(req), auth.user.id, domain);
    // 激活判定：认领后即拥有已完成的审计（激活定义：注册用户第一次拥有已完成的审计）
    if (moved > 0) {
      try {
        const { trackActivationIfFirst } = await import("@/lib/analytics/server");
        await trackActivationIfFirst(auth.user.id);
      } catch {
        // analytics 失败不影响认领
      }
    }
    return NextResponse.json({ data: { moved } });
  } catch {
    return NextResponse.json({ error: "认领审计记录失败", code: "AUDIT_CLAIM_FAILED" }, { status: 500 });
  }
}
