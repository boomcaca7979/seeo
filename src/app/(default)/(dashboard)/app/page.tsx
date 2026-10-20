import { createServer } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isAuthEnabled } from "@/lib/auth-config";
import ProjectList from "@/components/dashboard/ProjectList";
import ScopedOverview from "@/components/dashboard/ScopedOverview";
import { getWorkspaceDashboard, type WorkspaceDashboardData, type OverviewScope } from "@/lib/seo/workspace-overview";
import type { WorkspaceActionSummary } from "@/lib/seo/work-queue";
import Onboarding from "@/components/dashboard/Onboarding";
import { listProjectsWithMetrics, listProjectsWithMetricsForUser, listAlerts, countUnreadAlerts } from "@/lib/db";
import { OVERVIEW_SCOPE_COOKIE } from "@/lib/project-selector";

// 演示模式下读 Turso/SQLite，避免 Vercel 构建期静态预渲染导致 router.refresh() 拿到旧快照
export const dynamic = "force-dynamic";

/**
 * 首页数据：概览 + 增长机会面板。
 * 两者共用同一次队列构建（getWorkspaceDashboard），不再对同一批项目各跑一遍。
 * 任何失败都降级为"无数据"，绝不阻塞工作台渲染。
 */
async function loadDashboardData(
  userId: string,
  projects: Array<{ id: number; domain: string }>
): Promise<WorkspaceDashboardData> {
  try {
    return await getWorkspaceDashboard(userId, projects);
  } catch {
    const actionSummary: WorkspaceActionSummary = {
      open: 0,
      inProgress: 0,
      fixedClaimed: 0,
      verifiedResolved: 0,
      auditedDomains: 0,
      topAction: null,
      growth: {
        counts: { regain: 0, capture: 0, improve: 0 },
        top: [],
        gaps: [],
      },
    };
    return {
      overview: {
        hasProjects: projects.length > 0,
        hasAudit: false,
        auditedDomains: 0,
        audit: null,
        counts: { open: 0, in_progress: 0, fixed_claimed: 0, verified_resolved: 0, dismissed: 0 },
        auditCounts: { open: 0, in_progress: 0, fixed_claimed: 0, verified_resolved: 0, dismissed: 0 },
        auditPriority: { P0: 0, P1: 0, P2: 0 },
        verification: { pass: 0, fail: 0, inconclusive: 0, pending: 0 },
        tasks: [],
        trend: null,
        gaps: ["no_completed_audit"],
      },
      actionSummary,
    };
  }
}

/**
 * 概况页 SSR 数据范围（2026-10 单项目模式）：
 * 按范围 cookie 把 SSR 数据收敛到「当前项目」自己的聚合；cookie 缺失/非法时回退
 * 「全部项目」（客户端 ScopedOverview 挂载后会按顶部项目上下文纠正到当前项目）。
 * cookie 只是范围选择，不携带授权语义：项目必须命中当前用户自己的项目列表，
 * 否则一律回退，绝不为伪造的 id 取数据。
 */
function resolveInitialScope(
  cookieValue: string,
  projects: Array<{ id: number; domain: string }>,
  /** 鉴权模式：UUID → domain（来自本人 Supabase 项目列表）；演示模式传 null */
  domainByUuid: Map<string, string> | null
): { scope: OverviewScope; scopedProjects: Array<{ id: number; domain: string }> } {
  if (!cookieValue || cookieValue === "all") {
    return { scope: { kind: "all" }, scopedProjects: projects };
  }
  if (domainByUuid) {
    const domain = domainByUuid.get(cookieValue);
    const matched = domain ? projects.find((p) => p.domain === domain) : undefined;
    if (matched) return { scope: { kind: "project", id: cookieValue }, scopedProjects: [matched] };
  } else {
    const matched = projects.find((p) => String(p.id) === cookieValue);
    if (matched) return { scope: { kind: "project", id: cookieValue }, scopedProjects: [matched] };
  }
  return { scope: { kind: "all" }, scopedProjects: projects };
}

/** 工作台首屏：范围边界（头部 + 可视化概览 + 增长机会面板）→ 项目与预警明细（跨项目列表） */
function WorkbenchBody({
  displayName,
  projects,
  alerts,
  unread,
  dashboard,
  initialScope,
}: {
  displayName: string;
  projects: Awaited<ReturnType<typeof listProjectsWithMetrics>>;
  alerts: Awaited<ReturnType<typeof listAlerts>>;
  unread: number;
  dashboard: WorkspaceDashboardData;
  initialScope: OverviewScope;
}) {
  return (
    <>
      <ScopedOverview
        initialScope={initialScope}
        initialOverview={dashboard.overview}
        initialActionSummary={dashboard.actionSummary}
        displayName={displayName}
        totalProjects={projects.length}
        unreadAlertCount={unread}
      />
      <ProjectList projects={projects} alerts={alerts} />
    </>
  );
}

export default async function WorkbenchPage() {
  const cookieStore = await cookies();
  const scopeCookie = cookieStore.get(OVERVIEW_SCOPE_COOKIE)?.value ?? "";

  // 演示模式：直接读 SQLite
  if (!isAuthEnabled) {
    const ts = await getTranslations("dashboard.sidebar");
    const projects = await listProjectsWithMetrics("demo-user");
    // 无项目时显示首次使用 Onboarding，跳过 alerts/预警区块
    if (projects.length === 0) {
      return <Onboarding displayName={ts("demoUser")} mode="demo" />;
    }
    const alerts = await listAlerts("demo-user", 50);
    const unread = await countUnreadAlerts("demo-user");
    const scopedAll = projects.map((p) => ({ id: Number(p.id), domain: p.domain }));
    const { scope: initialScope, scopedProjects } = resolveInitialScope(scopeCookie, scopedAll, null);
    // 概览与增长机会面板共用一次队列构建（范围为当前项目时只构建该项目的队列）
    const dashboard = await loadDashboardData("demo-user", scopedProjects);
    return (
      <WorkbenchBody
        displayName={ts("demoUser")}
        projects={projects}
        alerts={alerts}
        unread={unread}
        dashboard={dashboard}
        initialScope={initialScope}
      />
    );
  }

  const supabase = await createServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/app")}`);
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const displayName =
    profileData?.display_name || user.email?.split("@")[0] || "SeeO";

  // 查询当前用户的项目（Supabase RLS 自动按 user_id 过滤）
  const { data: userProjects } = await supabase
    .from("projects")
    .select("id, name, domain, created_at")
    .order("created_at", { ascending: true });

  // 用 domain 关联本地 SQLite/Turso 获取指标
  const projects = await listProjectsWithMetricsForUser(user.id, userProjects ?? []);

  // 无项目时显示首次使用 Onboarding
  if (projects.length === 0) {
    return <Onboarding displayName={displayName} mode="live" />;
  }

  const alerts = await listAlerts(user.id, 50);
  const unread = await countUnreadAlerts(user.id);
  const scopedAll = projects.map((p) => ({ id: Number(p.id), domain: p.domain }));
  // UUID → domain 映射来自本人项目列表（RLS 过滤），同时是范围 cookie 的所有权凭证
  const domainByUuid = new Map(
    (userProjects ?? []).map((p) => [p.id as string, p.domain as string]),
  );
  const { scope: initialScope, scopedProjects } = resolveInitialScope(scopeCookie, scopedAll, domainByUuid);
  // 概览与增长机会面板共用一次队列构建（范围为当前项目时只构建该项目的队列）
  const dashboard = await loadDashboardData(user.id, scopedProjects);

  return (
    <WorkbenchBody
      displayName={displayName}
      projects={projects}
      alerts={alerts}
      unread={unread}
      dashboard={dashboard}
      initialScope={initialScope}
    />
  );
}
