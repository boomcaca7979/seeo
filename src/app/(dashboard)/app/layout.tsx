import { createServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth-config";
import DashboardShell from "@/components/dashboard/DashboardShell";
import type { DatabaseProfile } from "@/lib/types";
import { startAutomation, isStarted } from "@/lib/automation/cron";

// 服务端启动 cron（dev server 首次加载时注册一次）
if (!isStarted()) {
  try {
    startAutomation();
  } catch {
    // 启动失败不影响页面渲染
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 演示模式：固定本地用户，不查 Supabase
  if (!isAuthEnabled) {
    return (
      <DashboardShell displayName="本地开发" email="dev@seeo.local">
        {children}
      </DashboardShell>
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

  const profile = profileData as DatabaseProfile | null;
  const displayName =
    profile?.display_name || user.email?.split("@")[0] || "用户";
  const email = user.email ?? "";

  return (
    <DashboardShell displayName={displayName} email={email}>
      {children}
    </DashboardShell>
  );
}
