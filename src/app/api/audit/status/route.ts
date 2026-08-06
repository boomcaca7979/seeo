// ===== GET /api/audit/status?id=xx =====
// 轮询审计进度：返回当前状态、已爬页面数、健康分（完成时）

import { NextResponse } from "next/server";
import { getAuditById } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get("id");
  if (!idParam) {
    return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
  }
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效" }, { status: 400 });
  }

  const audit = await getAuditById(userId, id);
  if (!audit) {
    return NextResponse.json({ error: "审计记录不存在" }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      id: audit.id,
      domain: audit.domain,
      status: audit.status,
      pagesCrawled: audit.pages_crawled,
      healthScore: audit.health_score,
      errors: audit.errors,
      warnings: audit.warnings,
      notices: audit.notices,
      startedAt: audit.started_at,
      finishedAt: audit.finished_at,
    },
  });
}
