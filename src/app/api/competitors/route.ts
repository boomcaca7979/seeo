// ===== /api/competitors =====
// GET：返回项目下所有竞品（query: project_id）
// POST：创建竞品（body: { project_id, domain, name? }）
// DELETE：删除竞品（query: id）

import { NextResponse } from "next/server";
import {
  listCompetitors,
  countCompetitors,
  createCompetitor,
  deleteCompetitor,
  getProjectById,
} from "@/lib/db";
import { peekUsage } from "@/lib/seo/cache";
import { requireAuthOrDemo } from "@/lib/auth";
import { PlanLimitError, billingErrorToResponse } from "@/lib/guards";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const { searchParams } = new URL(req.url);
  // project_id 接受前端项目引用：演示模式为整数字符串，鉴权模式为 Supabase UUID
  const projectRef = (searchParams.get("project_id") ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(userId, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
  }

  const list = await listCompetitors(userId, projectId);
  const usage = await peekUsage(userId, "serpapi", plan);
  return NextResponse.json({ data: list, usage });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  let body: { project_id?: string | number; domain?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const domain = String(body.domain ?? "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const name = body.name?.trim() || undefined;

  const projectRef = String(body.project_id ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(userId, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
  }
  if (!domain) {
    return NextResponse.json({ error: "domain 不能为空" }, { status: 400 });
  }

  // 校验项目存在
  const project = await getProjectById(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
  }

  // 不能添加自己为竞品
  if (domain.toLowerCase() === project.domain.toLowerCase()) {
    return NextResponse.json({ error: "不能添加自己为竞品" }, { status: 400 });
  }

  // P3.5：套餐竞品数量限额校验（max_competitors，project-scoped）
  const maxCompetitors = auth.limits.max_competitors;
  const existingCount = await countCompetitors(userId, projectId);
  if (existingCount >= maxCompetitors) {
    const err = new PlanLimitError("竞品", auth.plan, maxCompetitors, "COMPETITOR_LIMIT_REACHED");
    const { status, body } = billingErrorToResponse(err);
    return NextResponse.json(body, { status });
  }

  try {
    const created = await createCompetitor(userId, { project_id: projectId, domain, name: name ?? null });
    const usage = await peekUsage(userId, "serpapi", plan);
    return NextResponse.json({ data: created, usage }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "该竞品域名已存在" }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id") ?? "");

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效" }, { status: 400 });
  }

  const ok = await deleteCompetitor(userId, id);
  if (!ok) {
    return NextResponse.json({ error: "未找到该竞品" }, { status: 404 });
  }
  const usage = await peekUsage(userId, "serpapi", plan);
  return NextResponse.json({ data: { ok: true }, usage });
}
