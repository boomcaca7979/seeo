import { createServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isAuthEnabled } from "@/lib/auth-config";
import ProjectList from "@/components/dashboard/ProjectList";
import Onboarding from "@/components/dashboard/Onboarding";
import { listProjectsWithMetrics, listProjectsWithMetricsForUser, listAlerts, countUnreadAlerts } from "@/lib/db";

// 演示模式下读 Turso/SQLite，避免 Vercel 构建期静态预渲染导致 router.refresh() 拿到旧快照
export const dynamic = "force-dynamic";

export default async function WorkbenchPage() {
  // 演示模式：直接读 SQLite
  if (!isAuthEnabled) {
    const ts = await getTranslations("dashboard.sidebar");
    const projects = await listProjectsWithMetrics("demo-user");
    // 无项目时显示首次使用 Onboarding，跳过 alerts/预警区块
    if (projects.length === 0) {
      return <Onboarding displayName={ts("demoUser")} />;
    }
    const alerts = await listAlerts("demo-user", 50);
    const unread = await countUnreadAlerts("demo-user");
    return (
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
    return <Onboarding displayName={displayName} />;
  }

  const alerts = await listAlerts(user.id, 50);
  const unread = await countUnreadAlerts(user.id);

  return (
    <ProjectList
      projects={projects}
      alerts={alerts}
      displayName={displayName}
      unreadAlertCount={unread}
    />
  );
}
