"use client";

// ===== 共享 Entitlements Context =====
// 提供：套餐信息 + Feature 权限 + useEntitlements hook + FeatureGate 组件
// DashboardShell 挂载 Provider，业务页面通过 useEntitlements() 或 <FeatureGate> 获取权限
// 避免各页面重复调用 /api/account/usage

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type PlanTier = "free" | "lite" | "pro";
export type FeatureKey =
  | "pdf_export"
  | "excel_export"
  | "full_audit"
  | "backlinks"
  | "email_report";

interface EntitlementsData {
  plan: PlanTier;
  features: Record<FeatureKey, boolean>;
  limits: EntitlementLimits | null;
}

interface EntitlementsContextValue extends EntitlementsData {
  loading: boolean;
}

const EntitlementsContext = createContext<EntitlementsContextValue>({
  plan: "free",
  features: {
    pdf_export: false,
    excel_export: false,
    full_audit: false,
    backlinks: false,
    email_report: false,
  },
  limits: null,
  loading: true,
});

const DEFAULT_FEATURES: Record<FeatureKey, boolean> = {
  pdf_export: false,
  excel_export: false,
  full_audit: false,
  backlinks: false,
  email_report: false,
};

/** usage API 返回的额度 limits（供 Topbar 等组件复用，避免重复 fetch） */
export interface EntitlementLimits {
  max_projects?: number;
  [key: string]: number | undefined;
}

interface EntitlementsProviderProps {
  children: ReactNode;
  /** 初始套餐（避免首次渲染闪烁），DashboardShell 传入已获取的 plan */
  initialPlan?: PlanTier;
}

export function EntitlementsProvider({ children, initialPlan }: EntitlementsProviderProps) {
  const [plan, setPlan] = useState<PlanTier>(initialPlan ?? "free");
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(DEFAULT_FEATURES);
  const [limits, setLimits] = useState<EntitlementLimits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/account/usage", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && json?.data) {
          const data = json.data as {
            plan?: PlanTier;
            features?: Record<FeatureKey, boolean>;
            limits?: EntitlementLimits;
          };
          if (data.plan) setPlan(data.plan);
          if (data.features) setFeatures(data.features);
          if (data.limits) setLimits(data.limits);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <EntitlementsContext.Provider value={{ plan, features, limits, loading }}>
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements(): EntitlementsContextValue {
  return useContext(EntitlementsContext);
}

// ===== FeatureGate 组件 =====
// 用法：<FeatureGate feature="backlinks" fallback={<UpgradeState />}>...</FeatureGate>
// loading 时返回 null，避免闪烁

interface FeatureGateProps {
  feature: FeatureKey;
  children: ReactNode;
  /** 无权限时展示的替代内容 */
  fallback?: ReactNode;
  /** loading 时展示的内容，默认 null */
  loadingPlaceholder?: ReactNode;
}

export function FeatureGate({ feature, children, fallback, loadingPlaceholder }: FeatureGateProps) {
  const { features, loading } = useEntitlements();

  if (loading) return loadingPlaceholder ?? null;
  if (!features[feature]) return <>{fallback}</>;
  return <>{children}</>;
}
