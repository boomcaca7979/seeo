import { createServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth-config";
import Sidebar from "@/components/dashboard/Sidebar";
import Topbar from "@/components/dashboard/Topbar";
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
      <div className="flex h-screen overflow-hidden bg-paper text-ink">
        <Sidebar displayName="本地开发" email="dev@seeo.local" />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar displayName="本地开发" email="dev@seeo.local" />
          <main className="flex-1 overflow-y-auto bg-paper text-ink">{children}</main>
        </div>
      </div>
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
    <div className="flex h-screen overflow-hidden bg-paper text-ink">
      <Sidebar displayName={displayName} email={email} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar displayName={displayName} email={email} />
        <main className="flex-1 overflow-y-auto bg-paper text-ink">{children}</main>
      </div>
    </div>
  );
}
