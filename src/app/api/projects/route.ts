// ===== /api/projects =====
// 项目 CRUD，数据持久化到 SQLite

import { NextResponse } from "next/server";
import {
  listProjectsWithMetrics,
  addProject,
  removeProject,
  getProjectByDomain,
} from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const projects = await listProjectsWithMetrics();
  return NextResponse.json({ data: projects });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const domain = String(body.domain ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
  }
  if (!domain) {
    return NextResponse.json({ error: "域名不能为空" }, { status: 400 });
  }

  // 域名格式校验
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
  if (!domainRegex.test(domain)) {
    return NextResponse.json({ error: "域名格式不正确，如 example.com" }, { status: 400 });
  }

  // 重复检查
  const existing = await getProjectByDomain(domain);
  if (existing) {
    return NextResponse.json({ error: "该域名已存在项目" }, { status: 400 });
  }

  const created = await addProject(name, domain);
  return NextResponse.json({ data: created });
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

  const ok = await removeProject(id);
  if (!ok) {
    return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
  }

  return NextResponse.json({ data: { ok: true } });
}
