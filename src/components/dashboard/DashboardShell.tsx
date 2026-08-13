"use client";

import Sidebar from "@/components/dashboard/Sidebar";
import Topbar from "@/components/dashboard/Topbar";
import { useUpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { EntitlementsProvider, useEntitlements } from "@/components/billing/EntitlementsContext";

interface DashboardShellProps {
  displayName: string;
  email: string;
  children: React.ReactNode;
}

export default function DashboardShell({ displayName, email, children }: DashboardShellProps) {
  return (
    <EntitlementsProvider>
      <DashboardShellInner displayName={displayName} email={email}>
        {children}
      </DashboardShellInner>
    </EntitlementsProvider>
  );
}

function DashboardShellInner({ displayName, email, children }: DashboardShellProps) {
  const { plan } = useEntitlements();
  const { modal } = useUpgradeModalProvider(plan);

  return (
    <div className="flex h-screen overflow-hidden bg-paper text-ink">
      <Sidebar displayName={displayName} email={email} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar displayName={displayName} email={email} />
        <main className="flex-1 overflow-y-auto bg-paper text-ink">{children}</main>
      </div>
      {modal}
    </div>
  );
}
