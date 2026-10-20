// ===== /api/app/dashboard =====
// /app 概况页按「当前项目 / 全部项目」范围取数的唯一 API。
//
// 数据安全（与既有权限体系一致，不新增权限规则）：
//   1. requireAuthOrDemo 统一鉴权（演示模式 user=demo-user）；
//   2. 鉴权模式下，客户端传入的 projectId（Supabase UUID）必须出现在**该用户自己的**
//      Supabase projects 列表里（RLS 按 user_id 过滤 + 显式比对），否则 404；
//   3. 演示模式下，整数 id 必须命中该 user 名下 SQLite 项目列表，否则 404；
//   4. 不新增指标计算：完全复用 page.tsx 同一入口 getWorkspaceDashboard
//      （一次队列构建 → overview + actionSummary），客户端不做任何二次聚合。
//
// 竞态：客户端侧由 ScopedOverview 用序号丢弃过期响应；本路由无状态。

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { isAuthEnabled } from "@/lib/auth-config";
import { createServer } from "@/lib/supabase/server";
import { listProjectsWithMetrics, listProjectsWithMetricsForUser } from "@/lib/db";
import { getWorkspaceDashboard, type OverviewScopeKind } from "@/lib/seo/workspace-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

  const { searchParams } = new URL(req.url);
  const projectId = (searchParams.get("projectId") ?? "").trim();
  const scopeParam = (searchParams.get("scope") ?? "").trim();
  if (scopeParam !== "all" && !projectId) {
    return NextResponse.json(
      { error: "缺少 scope=all 或 projectId 参数", code: "INVALID_SCOPE" },
      { status: 400 },
    );
  }

  // 与 page.tsx 完全同一套项目列表口径（演示模式直读 SQLite；鉴权模式 Supabase → domain 关联指标）
  let projects: Array<{ id: number; domain: string }>;
  /** 鉴权模式：UUID → domain 映射（来自 RLS 过滤后的本人项目列表，即所有权凭证） */
  let domainByUuid: Map<string, string> | null = null;
  if (!isAuthEnabled) {
    const rows = await listProjectsWithMetrics(userId);
    projects = rows.map((p) => ({ id: Number(p.id), domain: p.domain }));
  } else {
    const supabase = await createServer();
    const { data: userProjects, error } = await supabase
      .from("projects")
      .select("id, name, domain, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: "查询项目失败", code: "PROJECT_QUERY_FAILED" }, { status: 500 });
    }
    domainByUuid = new Map((userProjects ?? []).map((p) => [p.id as string, p.domain as string]));
    // 所有权校验：UUID 必须属于当前用户（RLS 已按 user_id 过滤，这里再显式比对一次）
    if (projectId && !domainByUuid.has(projectId)) {
      return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
    }
    const rows = await listProjectsWithMetricsForUser(userId, userProjects ?? []);
    projects = rows.map((p) => ({ id: Number(p.id), domain: p.domain }));
  }

  let scoped: Array<{ id: number; domain: string }>;
  let scopeKind: OverviewScopeKind;
  if (projectId) {
    let matched: { id: number; domain: string } | undefined;
    if (isAuthEnabled) {
      const domain = domainByUuid?.get(projectId);
      matched = domain ? projects.find((p) => p.domain === domain) : undefined;
    } else {
      // 演示模式：整数 id 必须命中该 user 名下项目（listProjectsWithMetrics 已按 user 过滤）
      matched = projects.find((p) => String(p.id) === projectId);
    }
    if (!matched) {
      return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
    }
    scoped = [matched];
    scopeKind = "project";
  } else {
    scoped = projects;
    scopeKind = "all";
  }

  try {
    const data = await getWorkspaceDashboard(userId, scoped);
    return NextResponse.json({
      data: {
        scope: scopeKind,
        overview: data.overview,
        actionSummary: data.actionSummary,
      },
    });
  } catch {
    // 与 page.tsx 的降级口径一致：由客户端显示"加载失败/重试"，绝不返回伪造的零值快照
    return NextResponse.json({ error: "概况数据构建失败", code: "DASHBOARD_FAILED" }, { status: 500 });
  }
}
