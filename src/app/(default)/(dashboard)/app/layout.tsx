import { createServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { isAuthEnabled } from "@/lib/auth-config";
import DashboardShell from "@/components/dashboard/DashboardShell";
import type { DatabaseProfile } from "@/lib/types";
import { startAutomation, isStarted } from "@/lib/automation/cron";
import {
  DASHBOARD_BRAND,
  composeDashboardTitle,
  matchDashboardTitleRoute,
} from "@/lib/dashboard-titles";

// 工作台标题按路由解析（BUG-09）。13 个功能页是 "use client"，无法各自导出 metadata，
// 所以在 layout 的 generateMetadata 里输出 SSR 标题，而不是客户端改 document.title
// （客户端补丁会让首屏 HTML 仍是「SeeO Account」，并与 SSR metadata 冲突）。
// pathname 取自 proxy 注入的 x-seeo-pathname（文档加载与 RSC 导航都有）；
// 两个 header 都读不到时不猜具体功能名，退回品牌名，避免给别的页签挂上概览标题。
// description 同样在此本地化：不输出就会一路继承 (default)/layout 的英文兜底描述，
// 中文工作台出现「标题中文、描述英文」的自相矛盾 head。
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  const headersList = await headers();
  const pathname =
    headersList.get("x-seeo-pathname") ?? headersList.get("next-url")?.split("?")[0];
  const route = pathname ? matchDashboardTitleRoute(pathname) : null;
  const description = t("metaDescription");
  if (!route) return { title: DASHBOARD_BRAND, description };
  return { title: composeDashboardTitle(t(route.titleKey)), description };
}

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
  // 演示模式：固定演示用户（本地化文案），不查 Supabase
  if (!isAuthEnabled) {
    const t = await getTranslations("dashboard.sidebar");
    return (
      <DashboardShell displayName={t("demoUser")} email={t("demoEmail")}>
        {children}
      </DashboardShell>
    );
  }

  const supabase = await createServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 访客审计：/app/audit 是 Free SEO Audit 获客入口，允许未登录使用
    //（与 proxy 的 isPublicAudit 豁免一致），其余 /app 页面仍重定向登录。
    // proxy 注入的 x-seeo-pathname 在初始文档加载时也可用（next-url 仅 RSC 导航有）。
    const headersList = await headers();
    const pathname =
      headersList.get("x-seeo-pathname") ??
      headersList.get("next-url")?.split("?")[0] ??
      "/app";
    if (pathname === "/app/audit" || pathname.startsWith("/app/audit/")) {
      const t2 = await getTranslations("dashboard.sidebar");
      return (
        <DashboardShell displayName={t2("guestUser")} email="" isGuest>
          {children}
        </DashboardShell>
      );
    }
    // 保留来源路径：RSC 导航时从 next-url header 读取 pathname，
    // 初始加载时 proxy(middleware) 已处理 redirect，此处为兜底
    const nextUrl = headersList.get("next-url");
    const redirectPath = nextUrl && nextUrl.startsWith("/app") ? nextUrl : pathname.startsWith("/app") ? pathname : "/app";
    redirect(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const profile = profileData as DatabaseProfile | null;
  const displayName =
    profile?.display_name || user.email?.split("@")[0] || "SeeO";
  const email = user.email ?? "";

  return (
    <DashboardShell displayName={displayName} email={email}>
      {children}
    </DashboardShell>
  );
}
