"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/dashboard/Sidebar";
import Topbar from "@/components/dashboard/Topbar";
import { useUpgradeModalProvider } from "@/components/billing/UpgradeModal";

interface DashboardShellProps {
  displayName: string;
  email: string;
  children: React.ReactNode;
}

export default function DashboardShell({ displayName, email, children }: DashboardShellProps) {
  const [currentPlan, setCurrentPlan] = useState<string>("free");

  // 拉取当前用户套餐（用于 UpgradeModal 展示）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/account/usage", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && json?.data?.plan) {
          setCurrentPlan(json.data.plan as string);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { modal } = useUpgradeModalProvider(currentPlan);

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
