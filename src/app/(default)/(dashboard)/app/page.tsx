import { createServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isAuthEnabled } from "@/lib/auth-config";
import ProjectList from "@/components/dashboard/ProjectList";
import GrowthOpportunityPanel from "@/components/dashboard/GrowthOpportunityPanel";
import { getWorkspaceActionSummary } from "@/lib/seo/work-queue";
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

/** 决策面板容器（与 ProjectList 的 dash-container 对齐） */
function withActionPanel(
  summary: Awaited<ReturnType<typeof loadActionSummary>>,
  list: React.ReactNode
) {
  return (
    <>
      <div className="dash-container px-6 pt-8 pb-0 sm:px-8">
        <GrowthOpportunityPanel summary={summary} />
      </div>
      {list}
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
    const actionSummary = await loadActionSummary(
      "demo-user",
      projects.map((p) => p.domain),
      projects.map((p) => ({ id: Number(p.id), domain: p.domain }))
    );
    return withActionPanel(
      actionSummary,
      <ProjectList
        projects={projects}
        alerts={alerts}
        displayName={ts("demoUser")}
        unreadAlertCount={unread}
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
  const actionSummary = await loadActionSummary(
    user.id,
    projects.map((p) => p.domain),
    projects.map((p) => ({ id: Number(p.id), domain: p.domain }))
  );

  return withActionPanel(
    actionSummary,
    <ProjectList
      projects={projects}
      alerts={alerts}
      displayName={displayName}
      unreadAlertCount={unread}
    />
  );
}
