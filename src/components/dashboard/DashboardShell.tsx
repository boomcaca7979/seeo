"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/dashboard/Sidebar";
import Topbar from "@/components/dashboard/Topbar";
import { useUpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { EntitlementsProvider, useEntitlements } from "@/components/billing/EntitlementsContext";
import { CreateProjectProvider } from "@/components/dashboard/CreateProjectContext";
import { ActiveProjectProvider } from "@/components/dashboard/ActiveProjectContext";

interface DashboardShellProps {
  displayName: string;
  email: string;
  /** 访客审计模式（未登录使用 /app/audit）：侧栏/头像菜单显示登录入口而非登出 */
  isGuest?: boolean;
  children: React.ReactNode;
}

export default function DashboardShell({ displayName, email, isGuest, children }: DashboardShellProps) {
  return (
    // ActiveProjectProvider 必须包住 Topbar 与所有 /app 页面：
    // 它是「当前项目」的唯一真源（顶部选择器写、页面读），缺了它 useActiveProject 会直接报错。
    <ActiveProjectProvider>
      <CreateProjectProvider>
        <EntitlementsProvider>
          <DashboardShellInner displayName={displayName} email={email} isGuest={isGuest}>
            {children}
          </DashboardShellInner>
        </EntitlementsProvider>
      </CreateProjectProvider>
    </ActiveProjectProvider>
  );
}

function DashboardShellInner({ displayName, email, isGuest, children }: DashboardShellProps) {
  const { plan } = useEntitlements();
  const { modal } = useUpgradeModalProvider(plan);
  // 移动端（<lg）侧边抽屉；桌面端 sidebar 常驻，此状态无效
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // BUG-18：抽屉只能靠点击遮罩关闭，键盘用户打开后关不掉（实测 390px：
  // Escape 后 drawer 仍在 left:0）。与营销站 Navbar 保持一致，用 Escape 收起。
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-paper text-ink">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          displayName={displayName}
          email={email}
          isGuest={isGuest}
          onMobileMenuClick={() => setMobileNavOpen(true)}
          mobileMenuOpen={mobileNavOpen}
        />
        <main className="flex-1 overflow-y-auto bg-paper text-ink">{children}</main>
      </div>
      {modal}
    </div>
  );
}
