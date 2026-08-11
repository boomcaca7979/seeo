// ===== /api/projects =====
// 项目 CRUD
// 演示模式：数据持久化到 SQLite（user_id='demo-user'）
// 鉴权模式：双写 Supabase projects 表（RLS 按 user_id 过滤）+ SQLite projects 表（存 domain 用于指标关联）
// P2：增加 max_projects 套餐限额校验

import { NextResponse } from "next/server";
import {
  listProjectsWithMetrics,
  listProjectsWithMetricsForUser,
  addProject,
  removeProject,
  getProjectByDomain,
  listProjects,
} from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";
import { isAuthEnabled } from "@/lib/auth-config";
import { createServer } from "@/lib/supabase/server";
import { PlanLimitError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

  // 演示模式：直接读 SQLite
  if (!isAuthEnabled) {
    const projects = await listProjectsWithMetrics(userId);
    return NextResponse.json({ data: projects });
  }

  // 鉴权模式：从 Supabase 查项目（RLS 自动按 user_id 过滤），再用 domain 关联本地指标
  const supabase = await createServer();
  const { data: userProjects, error } = await supabase
    .from("projects")
    .select("id, name, domain, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "查询项目失败" }, { status: 500 });
  }
  const projects = await listProjectsWithMetricsForUser(userId, userProjects ?? []);
  return NextResponse.json({ data: projects });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

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

  // 重复检查（SQLite 侧）
  const existing = await getProjectByDomain(userId, domain);
  if (existing) {
    return NextResponse.json({ error: "该域名已存在项目" }, { status: 400 });
  }

  // P2：套餐项目数量限额校验（max_projects）
  // free=1, lite=3, pro=10（详见 billing.ts DEFAULT_PLAN_LIMITS）
  const maxProjects = auth.limits.max_projects;
  const existingProjects = await listProjects(userId);
  if (existingProjects.length >= maxProjects) {
    const err = new PlanLimitError("项目", auth.plan, maxProjects, "PROJECT_LIMIT_REACHED");
    const { status, body: errBody } = billingErrorToResponse(err);
    return NextResponse.json(errBody, { status });
  }

  // 鉴权模式：先写 Supabase，再写 SQLite
  if (isAuthEnabled) {
    const supabase = await createServer();
    const { data: supaProject, error: supaErr } = await supabase
      .from("projects")
      .insert({ user_id: userId, name, domain })
      .select("id, name, domain, created_at, updated_at")
      .single();
    if (supaErr || !supaProject) {
      return NextResponse.json({ error: "创建项目失败（Supabase）" }, { status: 500 });
    }
    // 同步写 SQLite（存 domain 用于指标关联，user_id 隔离）
    await addProject(userId, name, domain);
    return NextResponse.json({ data: supaProject });
  }

  // 演示模式：只写 SQLite
  const created = await addProject(userId, name, domain);
  return NextResponse.json({ data: created });
}

export async function DELETE(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get("id") ?? "";

  // 鉴权模式：id 是 Supabase UUID
  if (isAuthEnabled) {
    const supabase = await createServer();
    // 先查 domain（用于删除 SQLite 侧关联数据）
    const { data: project } = await supabase
      .from("projects")
      .select("domain")
      .eq("id", idParam)
      .single();
    if (!project) {
      return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
    }
    // 删 Supabase
    const { error: delErr } = await supabase.from("projects").delete().eq("id", idParam);
    if (delErr) {
      return NextResponse.json({ error: "删除项目失败" }, { status: 500 });
    }
    // 删 SQLite（按 domain + user_id）
    const sqliteProject = await getProjectByDomain(userId, project.domain);
    if (sqliteProject) {
      await removeProject(userId, sqliteProject.id);
    }
    return NextResponse.json({ data: { ok: true } });
  }

  // 演示模式：id 是 SQLite 整数
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效" }, { status: 400 });
  }
  const ok = await removeProject(userId, id);
  if (!ok) {
    return NextResponse.json({ error: "未找到该项目" }, { status: 404 });
  }
  return NextResponse.json({ data: { ok: true } });
}
