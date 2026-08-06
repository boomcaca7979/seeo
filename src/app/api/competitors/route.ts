// ===== /api/competitors =====
// GET：返回项目下所有竞品（query: project_id）
// POST：创建竞品（body: { project_id, domain, name? }）
// DELETE：删除竞品（query: id）

import { NextResponse } from "next/server";
import {
  listCompetitors,
  createCompetitor,
  deleteCompetitor,
  getProjectById,
} from "@/lib/db";
import { peekUsage } from "@/lib/seo/cache";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const projectId = Number(searchParams.get("project_id") ?? "");

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "project_id 参数无效" }, { status: 400 });
  }

  const list = await listCompetitors(projectId);
  const usage = await peekUsage();
  return NextResponse.json({ data: list, usage });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  let body: { project_id?: number; domain?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const projectId = Number(body.project_id);
  const domain = String(body.domain ?? "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const name = body.name?.trim() || undefined;

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "project_id 参数无效" }, { status: 400 });
  }
  if (!domain) {
    return NextResponse.json({ error: "domain 不能为空" }, { status: 400 });
  }

  // 校验项目存在
  const project = await getProjectById(projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
  }

  // 不能添加自己为竞品
  if (domain.toLowerCase() === project.domain.toLowerCase()) {
    return NextResponse.json({ error: "不能添加自己为竞品" }, { status: 400 });
  }

  try {
    const created = await createCompetitor({ project_id: projectId, domain, name: name ?? null });
    const usage = await peekUsage();
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
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id") ?? "");

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效" }, { status: 400 });
  }

  const ok = await deleteCompetitor(id);
  if (!ok) {
    return NextResponse.json({ error: "未找到该竞品" }, { status: 404 });
  }
  const usage = await peekUsage();
  return NextResponse.json({ data: { ok: true }, usage });
}
