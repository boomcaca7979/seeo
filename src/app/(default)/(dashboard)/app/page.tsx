import { createServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isAuthEnabled } from "@/lib/auth-config";
import ProjectList from "@/components/dashboard/ProjectList";
import GrowthOpportunityPanel from "@/components/dashboard/GrowthOpportunityPanel";
import WorkspaceHeader from "@/components/dashboard/WorkspaceHeader";
import WorkspaceDashboard from "@/components/dashboard/WorkspaceDashboard";
import { getWorkspaceActionSummary } from "@/lib/seo/work-queue";
import { getWorkspaceOverview, type WorkspaceOverviewData } from "@/lib/seo/workspace-overview";
import Onboarding from "@/components/dashboard/Onboarding";
import { listProjectsWithMetrics, listProjectsWithMetricsForUser, listAlerts, countUnreadAlerts } from "@/lib/db";

// 演示模式下读 Turso/SQLite，避免 Vercel 构建期静态预渲染导致 router.refresh() 拿到旧快照
export const dynamic = "force-dynamic";

/** 决策面板数据：真实审计/追踪汇总 + 增长机会分层 + 今日 top action。任何失败都降级为"无数据"，绝不阻塞工作台渲染。 */
async function loadActionSummary(
  userId: string,
  domains: string[],
  projects?: Array<{ id: number; domain: string }>
) {
  try {
    // 上限 5 个域名，避免多项目时把首页查询打成 N+1
    return await getWorkspaceActionSummary(userId, domains.slice(0, 5), projects);
  } catch {
    return {
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
  }
}

/** 工作台可视化概览（只读聚合）。失败一律降级为"无数据"，不填任何占位数字。 */
async function loadOverview(
  userId: string,
  projects: Array<{ id: number; domain: string }>
): Promise<WorkspaceOverviewData> {
  try {
    return await getWorkspaceOverview(userId, projects);
  } catch {
    return {
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
    };
  }
}

/** 工作台首屏：头部 → 可视化概览 → 增长机会决策面板 → 项目与预警明细 */
function WorkbenchBody({
  displayName,
  projects,
  alerts,
  unread,
  actionSummary,
  overview,
}: {
  displayName: string;
  projects: Awaited<ReturnType<typeof listProjectsWithMetrics>>;
  alerts: Awaited<ReturnType<typeof listAlerts>>;
  unread: number;
  actionSummary: Awaited<ReturnType<typeof loadActionSummary>>;
  overview: WorkspaceOverviewData;
}) {
  return (
    <>
      <WorkspaceHeader
        displayName={displayName}
        projectCount={projects.length}
        auditedCount={overview.auditedDomains}
        unreadAlertCount={unread}
      />
      <div className="dash-container px-6 pt-6 sm:px-8">
        <WorkspaceDashboard data={overview} />
        <div className="mt-6">
          <GrowthOpportunityPanel summary={actionSummary} />
        </div>
      </div>
      <ProjectList projects={projects} alerts={alerts} />
    </>
  );
}

export default async function WorkbenchPage() {
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
    const scoped = projects.map((p) => ({ id: Number(p.id), domain: p.domain }));
    const [actionSummary, overview] = await Promise.all([
      loadActionSummary("demo-user", projects.map((p) => p.domain), scoped),
      loadOverview("demo-user", scoped),
    ]);
    return (
      <WorkbenchBody
        displayName={ts("demoUser")}
        projects={projects}
        alerts={alerts}
        unread={unread}
        actionSummary={actionSummary}
        overview={overview}
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
  const scoped = projects.map((p) => ({ id: Number(p.id), domain: p.domain }));
  const [actionSummary, overview] = await Promise.all([
    loadActionSummary(user.id, projects.map((p) => p.domain), scoped),
    loadOverview(user.id, scoped),
  ]);

  return (
    <WorkbenchBody
      displayName={displayName}
      projects={projects}
      alerts={alerts}
      unread={unread}
      actionSummary={actionSummary}
      overview={overview}
    />
  );
}
