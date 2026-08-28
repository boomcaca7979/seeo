// ===== /api/gsc/connection =====
// GET    ：项目连接状态（不含任何凭证字段）
// POST   ：显式绑定 property（body: { project_id, site_url }；必须先完成 OAuth 授权）
// DELETE ：解除绑定（query: project_id）
// 授权链路：user → project（resolveSqliteProjectId + getProjectById）→ gsc connection

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import {
  connectProperty,
  disconnectProperty,
  getConnectionStatus,
  listAvailableSites,
} from "@/lib/seo/gsc-service";
import { mapGscError } from "@/lib/seo/gsc-api-helpers";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveProject(req: Request): Promise<{ userId: string; projectId: number } | NextResponse> {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "连接 Search Console 需要登录 SeeO 账号", code: "GSC_NOT_CONFIGURED" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const projectRef = (searchParams.get("project_id") ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效", code: "INVALID_PROJECT_ID" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(auth.user.id, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const project = await getProjectById(auth.user.id, projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  return { userId: auth.user.id, projectId };
}

export async function GET(req: Request) {
  const resolved = await resolveProject(req);
  if (resolved instanceof NextResponse) return resolved;
  const status = await getConnectionStatus(resolved.userId, resolved.projectId);
  return NextResponse.json({ data: status });
}

export async function POST(req: Request) {
  const resolved = await resolveProject(req);
  if (resolved instanceof NextResponse) return resolved;

  let body: { site_url?: string; list?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    // list=true：返回当前 grant 可选的 properties（不绑定）
    if (body.list) {
      const sites = await listAvailableSites(resolved.userId);
      return NextResponse.json({ data: { sites } });
    }
    const siteUrl = (body.site_url ?? "").trim();
    if (!siteUrl) {
      return NextResponse.json({ error: "site_url 不能为空", code: "BAD_REQUEST" }, { status: 400 });
    }
    const result = await connectProperty({
      userId: resolved.userId,
      projectId: resolved.projectId,
      siteUrl,
    });
    return NextResponse.json({ data: { connected: true, ...result } });
  } catch (e) {
    return mapGscError(e);
  }
}

export async function DELETE(req: Request) {
  const resolved = await resolveProject(req);
  if (resolved instanceof NextResponse) return resolved;
  const ok = await disconnectProperty(resolved.userId, resolved.projectId);
  if (!ok) {
    return NextResponse.json({ error: "该项目尚未连接 Search Console", code: "GSC_NOT_CONNECTED" }, { status: 404 });
  }
  return NextResponse.json({ data: { connected: false } });
}
