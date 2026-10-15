// ===== /api/actions/queue =====
// GET：Action Center 的统一工作队列（审计技术问题 + 成长机会，同一状态词表）
//   params: domain（必填）、project_id（可选，项目引用）
// 授权：登录用户；demo 模式回退 demo-user（与其他 dashboard API 一致）
//
// 诚实边界：缺少审计/排名/GSC 数据时，返回 coverage.gaps 说明缺口，
// **绝不**用占位数字填充队列。

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";
import { buildWorkQueue } from "@/lib/seo/work-queue";
import { normalizeDomain } from "@/lib/seo/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);

  const domainRaw = searchParams.get("domain") ?? "";
  const domain = normalizeDomain(domainRaw);
  if (!domain) {
    return NextResponse.json(
      { error: "domain 参数无效，如 example.com", code: "INVALID_DOMAIN" },
      { status: 400 }
    );
  }

  const projectRef = (searchParams.get("project_id") ?? "").trim();
  let projectId: number | null = null;
  if (projectRef) {
    projectId = await resolveSqliteProjectId(userId, projectRef);
    if (projectId === null) {
      return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
    }
  }

  const queue = await buildWorkQueue({ userId, domain, projectId });
  return NextResponse.json({ data: queue });
}
