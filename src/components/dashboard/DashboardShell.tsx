"use client";

import { useState } from "react";
import Sidebar from "@/components/dashboard/Sidebar";
import Topbar from "@/components/dashboard/Topbar";
import { useUpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { EntitlementsProvider, useEntitlements } from "@/components/billing/EntitlementsContext";
import { CreateProjectProvider } from "@/components/dashboard/CreateProjectContext";

interface DashboardShellProps {
  displayName: string;
  email: string;
  children: React.ReactNode;
}

export default function DashboardShell({ displayName, email, children }: DashboardShellProps) {
  return (
    <CreateProjectProvider>
      <EntitlementsProvider>
        <DashboardShellInner displayName={displayName} email={email}>
          {children}
        </DashboardShellInner>
      </EntitlementsProvider>
    </CreateProjectProvider>
  );
}

function DashboardShellInner({ displayName, email, children }: DashboardShellProps) {
  const { plan } = useEntitlements();
  const { modal } = useUpgradeModalProvider(plan);
  // 移动端（<lg）侧边抽屉；桌面端 sidebar 常驻，此状态无效
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
        displayName={displayName}
        email={email}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          displayName={displayName}
          email={email}
          onMobileMenuClick={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-y-auto bg-paper text-ink">{children}</main>
      </div>
      {modal}
    </div>
  );
}
