import { createServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth-config";
import ProjectList from "@/components/dashboard/ProjectList";
import { listProjectsWithMetrics, listProjectsWithMetricsForUser, listAlerts, countUnreadAlerts } from "@/lib/db";

export default async function WorkbenchPage() {
  // 演示模式：直接读 SQLite
  if (!isAuthEnabled) {
    const projects = await listProjectsWithMetrics();
    const alerts = await listAlerts(50);
    const unread = await countUnreadAlerts();
    return (
      <ProjectList
        projects={projects}
        alerts={alerts}
        displayName="本地开发"
        unreadAlertCount={unread}
      />
    );
  }

  const supabase = await createServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const displayName =
    profileData?.display_name || user.email?.split("@")[0] || "用户";

  // 查询当前用户的项目（Supabase RLS 自动按 user_id 过滤）
  const { data: userProjects } = await supabase
    .from("projects")
    .select("id, name, domain, created_at")
    .order("created_at", { ascending: true });

  // 用 domain 关联本地 SQLite/Turso 获取指标
  const projects = await listProjectsWithMetricsForUser(userProjects ?? []);
  const alerts = await listAlerts(50);
  const unread = await countUnreadAlerts();

  return (
    <ProjectList
      projects={projects}
      alerts={alerts}
      displayName={displayName}
      unreadAlertCount={unread}
    />
  );
}
