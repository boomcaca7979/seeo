"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { isAuthEnabled } from "@/lib/auth-config";
import { createBrowser } from "@/lib/supabase/browser";
import { handleBillingError } from "@/lib/billing-error-client";
import { formatNumber, intlLocale, type Locale } from "@/lib/ui-locale";
import { PLAN_LABELS, planLabel, FEATURE_LABELS, featureLabel } from "@/lib/plan-labels";

type TabKey = "account" | "plan" | "usage" | "automation";

// 套餐展示数据（从 /api/plans 获取，不再前端硬编码）
interface PlanDisplayInfo {
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  ctaLabel: string;
  checkoutPlan?: "lite" | "pro";
  ctaHref?: string;
  highlighted?: boolean;
}

interface PlanInfo {
  plan: string;
  display: PlanDisplayInfo;
  max_projects: number;
  max_tracked_keywords: number;
  max_competitors: number;
  audit_daily_limit: number;
  audit_max_depth: number;
  serpapi_monthly_limit: number;
  serpapi_daily_limit: number;
  content_check_monthly_limit: number;
  can_export_pdf: boolean;
  can_export_excel: boolean;
  can_email_report: boolean;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

type SettingsTranslator = (key: string, values?: Record<string, string | number>) => string;

function formatLimitValue(v: number, locale: Locale, t: SettingsTranslator): string {
  if (v >= UNLIMITED) return t("unlimited");
  return formatNumber(v, locale);
}

function buildPlanLimits(p: PlanInfo, locale: Locale, t: SettingsTranslator): { label: string; value: string }[] {
  return [
    { label: t("limitProjects"), value: formatLimitValue(p.max_projects, locale, t) },
    { label: t("limitKeywords"), value: formatLimitValue(p.max_tracked_keywords, locale, t) },
    { label: t("limitDailyAudit"), value: p.audit_daily_limit >= UNLIMITED ? t("unlimited") : t("timesCount", { n: p.audit_daily_limit }) },
    { label: t("limitSerpapiMonthly"), value: p.serpapi_monthly_limit >= UNLIMITED ? t("unlimited") : t("timesCount", { n: p.serpapi_monthly_limit }) },
    { label: t("limitSerpapiDaily"), value: p.serpapi_daily_limit > 0 ? t("timesCount", { n: p.serpapi_daily_limit }) : "—" },
    { label: t("limitExport"), value: p.can_export_pdf ? "PDF / Excel" : "—" },
  ];
}

interface AutomationSettingsData {
  daily_refresh_enabled: number;
  daily_refresh_time: string;
  weekly_report_enabled: number;
  weekly_report_day: number;
  weekly_report_time: string;
}

interface AutomationLogRow {
  id: number;
  type: "daily_refresh" | "weekly_report";
  status: "success" | "failed" | "running";
  summary: string | null;
  details: string | null;
  created_at: string;
}

// 星期显示名（仅 UI 展示）
const WEEK_DAYS: Record<Locale, string[]> = {
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

interface AccountInfo {
  displayName: string;
  email: string;
  userId: string;
  createdAt: string;
}

interface UsageData {
  plan: string;
  subscriptionStatus: string;
  usage: {
    serpapi: { used: number; limit: number; usedPct: number };
    serpapiDaily: { used: number; limit: number; usedPct: number };
    dataforseo: { used: number; limit: number; usedPct: number };
    content_check: { used: number; limit: number; usedPct: number };
    audit: { used: number; limit: number; usedPct: number };
  };
  limits: {
    max_projects: number;
    max_tracked_keywords: number;
  };
  features: Record<string, boolean>;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { show, Toast } = useToast();
  const t = useTranslations("dashboard.settings");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabKey>("account");
  const [signingOut, setSigningOut] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  // BUG-002：auth-enabled 生产环境的真实编辑流程状态
  const [editingAccount, setEditingAccount] = useState(false);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);

  // 拉取当前 Supabase 会话中的真实用户信息
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 演示模式：保留占位（不走 Supabase）
      if (!isAuthEnabled) {
        if (!cancelled) {
          setAccount({
            displayName: t("demoName"),
            email: "demo@seeo.local",
            userId: "demo-user-0001",
            createdAt: t("demoCreatedAt"),
          });
          setAccountLoading(false);
        }
        return;
      }
      try {
        const supabase = createBrowser();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled || !user) {
          setAccountLoading(false);
          return;
        }
        const email = user.email ?? t("unknown");
        const displayName =
          (user.user_metadata as { display_name?: string } | null)?.display_name ||
          email.split("@")[0] ||
          t("defaultUser");
        const createdAt = user.created_at
          ? new Date(user.created_at).toLocaleString(intlLocale(locale), { hour12: false })
          : t("unknown");
        setAccount({
          displayName,
          email,
          userId: user.id,
          createdAt,
        });
      } catch {
        // ignore
      } finally {
        if (!cancelled) setAccountLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, t]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createBrowser();
      // scope=global 清除所有会话；await 完成后再导航，避免请求被中断
      await supabase.auth.signOut({ scope: "global" });
      // 等待浏览器完全关闭 fetch 连接，避免导航中止底层 TCP
      await new Promise((resolve) => setTimeout(resolve, 200));
      window.location.assign("/login");
    } catch (err) {
      show(t("signOutFailed", { message: (err as Error).message }), "error");
    } finally {
      setSigningOut(false);
    }
  };

  // BUG-002：编辑账号信息。
  // auth-enabled：进入真实编辑流程（Supabase Auth user_metadata.display_name，即页面 displayName 数据源）；
  // demo / auth-disabled：保持原有演示模式提示，不进入编辑。
  const startEditAccount = () => {
    if (!isAuthEnabled) {
      show(t("editDemoToast"), "info");
      return;
    }
    setEditName(account?.displayName ?? "");
    setEditingAccount(true);
  };

  // 保存显示名称：调用 Supabase Auth updateUser 持久化到 user_metadata
  const saveDisplayName = async () => {
    const name = editName.trim();
    if (!name || !account) return;
    setSavingName(true);
    try {
      const supabase = createBrowser();
      const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
      if (error) throw error;
      setAccount({ ...account, displayName: name });
      setEditingAccount(false);
      show(t("editSaved"), "success");
    } catch {
      show(t("saveFailed"), "error");
    } finally {
      setSavingName(false);
    }
  };

  // P3：从 /api/account/usage 获取真实用量数据
  const fetchUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch("/api/account/usage", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.data) {
        setUsageData(json.data as UsageData);
      }
    } catch {
      // ignore
    } finally {
      setUsageLoading(false);
    }
  }, []);

  // 支付回流处理：支付成功后显示提示并延迟刷新套餐状态（等待 notify 回调）
  const isCheckoutSuccess = searchParams.get("payment") === "success";
  useEffect(() => {
    if (!isCheckoutSuccess) return;
    show(t("upgradeSuccessToast"), "success");
    const timer = setTimeout(() => {
      void fetchUsage();
    }, 1500);
    return () => clearTimeout(timer);
  }, [isCheckoutSuccess, fetchUsage, show, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/account/usage", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && json.data) {
          setUsageData(json.data as UsageData);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setUsageLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 从 /api/plans 拉取所有套餐数据（统一数据源，不再前端硬编码）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/plans", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && Array.isArray(json.data)) {
          setPlans(json.data as PlanInfo[]);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "account", label: t("tabAccount") },
    { key: "plan", label: t("tabPlan") },
    { key: "usage", label: t("tabUsage") },
    { key: "automation", label: t("tabAutomation") },
  ];

  return (
    <div className="dash-container p-6 lg:p-8">
      {/* 页头：编号 + 标题 + 发丝线 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">09</span>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t("title")}
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-2 font-sans text-sm text-ink-60">
        {t("subtitle")}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 左侧 Tab */}
        <nav className="lg:col-span-3">
          <ul className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-card p-2 lg:flex-col lg:overflow-visible">
            {tabs.map((t) => (
              <li key={t.key} className="flex-shrink-0">
                <button
                  onClick={() => setTab(t.key)}
                  className={`w-full whitespace-nowrap rounded-md px-3 py-2 text-left font-sans text-sm font-medium transition-colors ${
                    tab === t.key
                      ? "bg-brand/15 text-ink"
                      : "text-ink-60 hover:bg-line-soft hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* 右侧内容 */}
        <div className="lg:col-span-9">
          {/* 账号信息 */}
          {tab === "account" && (
            <div className="card-a p-6">
              <h2 className="font-display text-lg font-semibold text-ink">{t("accountTitle")}</h2>
              {accountLoading ? (
                <div className="mt-6 font-mono text-xs text-ink-40">{tc("loading")}</div>
              ) : account ? (
                <>
                  <div className="mt-5 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                    {/* 头像占位 */}
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-brand/30 bg-brand/15 font-display text-2xl font-semibold text-ink">
                      {account.displayName.slice(0, 1)}
                    </div>
                    {editingAccount ? (
                      /* BUG-002：auth-enabled 真实编辑（仅显示名称；邮箱变更需验证流程，不在此提供） */
                      <div className="flex-1">
                        <label className="font-mono text-xs text-ink-40" htmlFor="edit-display-name">
                          {t("fieldDisplayName")}
                        </label>
                        <input
                          id="edit-display-name"
                          type="text"
                          value={editName}
                          maxLength={50}
                          onChange={(e) => setEditName(e.target.value)}
                          disabled={savingName}
                          className="mt-1 w-full rounded-md border border-line bg-card h-8 px-3 font-sans text-sm text-ink focus:border-ink-25 focus:outline-none disabled:opacity-60"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => void saveDisplayName()}
                            disabled={!editName.trim() || savingName}
                            className="btn-primary disabled:opacity-60"
                          >
                            {savingName ? t("saving") : t("editSave")}
                          </button>
                          <button
                            onClick={() => setEditingAccount(false)}
                            disabled={savingName}
                            className="btn-secondary disabled:opacity-60"
                          >
                            {tc("cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1">
                          <div className="font-sans text-base font-semibold text-ink">{account.displayName}</div>
                          <div className="mt-0.5 font-mono text-xs text-ink-40">{account.email}</div>
                        </div>
                        <button
                          onClick={startEditAccount}
                          className="btn-secondary"
                        >
                          {t("edit")}
                        </button>
                      </>
                    )}
                  </div>

                  {/* 字段表 */}
                  <div className="mt-6 divide-y divide-line-soft border-t border-line-soft">
                    {[
                      { label: t("fieldDisplayName"), value: account.displayName },
                      { label: t("fieldEmail"), value: account.email },
                      { label: t("fieldAccountId"), value: account.userId },
                      { label: t("fieldCreatedAt"), value: account.createdAt },
                      { label: t("field2fa"), value: t("twofaOff") },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between py-3">
                        <span className="font-mono text-xs text-ink-40">{row.label}</span>
                        <span className="font-sans text-sm text-ink break-all text-right">{row.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* 退出登录（鉴权模式） */}
                  {isAuthEnabled && (
                    <div className="mt-6 border-t border-line-soft pt-5">
                      <button
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="btn-secondary text-neg disabled:opacity-60"
                      >
                        {signingOut ? t("signingOut") : t("signOut")}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-6 font-mono text-xs text-ink-40">{t("accountUnavailable")}</div>
              )}
            </div>
          )}

          {/* 订阅套餐 */}
          {tab === "plan" && (
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">{t("planTitle")}</h2>
              <p className="mt-1 font-mono text-xs text-ink-40">
                {usageData
                  ? t("currentLine", { plan: planLabel(usageData.plan, locale) })
                  : t("loadingCurrentPlan")}
              </p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {plansLoading ? (
                  <div className="col-span-full font-mono text-xs text-ink-40">{t("loadingPlans")}</div>
                ) : plans && plans.length > 0 ? (
                  plans.map((p) => {
                    const isCurrent = usageData?.plan === p.plan;
                    const limits = buildPlanLimits(p, locale, t);
                    // 套餐显示名：优先共享 plan-labels（free/lite/pro），其余回退 API 数据
                    const knownName = PLAN_LABELS[locale][p.plan];
                    const planName = knownName ?? p.display.name;
                    // 价格周期 "/30天"：数字取自数据，文案按 locale 翻译
                    const priceDays = p.display.priceUnit.match(/\d+/)?.[0];
                    const priceUnitText = priceDays
                      ? t("priceUnitDays", { n: priceDays })
                      : p.display.priceUnit;
                    const ctaText = knownName
                      ? p.plan === "free"
                        ? t("ctaStart")
                        : t("ctaUpgrade", { plan: planName })
                      : p.display.ctaLabel;
                    return (
                      <div
                        key={p.plan}
                        className={`card-a relative flex flex-col p-5 transition-colors ${
                          isCurrent
                            ? "border-brand"
                            : p.display.highlighted
                              ? "border-brand/40"
                              : ""
                        }`}
                      >
                        {/* 推荐 / 当前套餐 标签 */}
                        {p.display.highlighted && !isCurrent && (
                          <span className="absolute -top-2 right-4 rounded-full bg-brand px-2 py-0.5 font-mono text-xs font-semibold text-ink">
                            {t("badgeRecommended")}
                          </span>
                        )}
                        {isCurrent && (
                          <span className="absolute -top-2 right-4 rounded-full bg-brand px-2 py-0.5 font-mono text-xs font-semibold text-ink">
                            {t("badgeCurrent")}
                          </span>
                        )}

                        <div className="font-display text-base font-semibold text-ink">{planName}</div>
                        <div className="mt-2 flex items-baseline gap-0.5">
                          <span className="font-display text-3xl font-semibold text-ink">
                            {p.display.price}
                          </span>
                          <span className="font-mono text-xs text-ink-40">{priceUnitText}</span>
                        </div>

                        <ul className="mt-4 flex-1 space-y-2">
                          {limits.map((l) => (
                            <li key={l.label} className="flex items-center justify-between font-mono text-xs">
                              <span className="text-ink-40">{l.label}</span>
                              <span className="text-ink">{l.value}</span>
                            </li>
                          ))}
                        </ul>

                        <button
                          onClick={() =>
                            isCurrent
                              ? show(t("currentPlanToast"), "info")
                              : show(t("planChangeToast"), "info")
                          }
                          className={isCurrent ? "btn-secondary mt-5 w-full" : "btn-primary mt-5 w-full"}
                        >
                          {isCurrent ? t("badgeCurrent") : ctaText}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="col-span-full font-mono text-xs text-ink-40">{t("noPlans")}</div>
                )}
              </div>
            </div>
          )}

          {/* 用量统计 */}
          {tab === "usage" && (
            <UsageDashboard usageData={usageData} loading={usageLoading} onRefresh={fetchUsage} />
          )}

          {/* 自动化 */}
          {tab === "automation" && (
            <AutomationPanel showToast={show} />
          )}
        </div>
      </div>

      <Toast />
    </div>
  );
}

// ===== 自动化面板 =====

function AutomationPanel({ showToast }: { showToast: (msg: string, type?: "info" | "success" | "error") => void }) {
  const t = useTranslations("dashboard.settings");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const [logs, setLogs] = useState<AutomationLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningDaily, setRunningDaily] = useState(false);
  const [runningWeekly, setRunningWeekly] = useState(false);

  // 表单状态
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [dailyTime, setDailyTime] = useState("09:00");
  const [weeklyEnabled, setWeeklyEnabled] = useState(false);
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [weeklyTime, setWeeklyTime] = useState("09:00");

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/settings", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.data) {
        const s = json.data as AutomationSettingsData;
        setDailyEnabled(!!s.daily_refresh_enabled);
        setDailyTime(s.daily_refresh_time);
        setWeeklyEnabled(!!s.weekly_report_enabled);
        setWeeklyDay(s.weekly_report_day);
        setWeeklyTime(s.weekly_report_time);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/logs?limit=20", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.data) {
        setLogs(json.data as AutomationLogRow[]);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchSettings(), fetchLogs()]);
      setLoading(false);
    })();
  }, [fetchSettings, fetchLogs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/automation/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daily_refresh_enabled: dailyEnabled ? 1 : 0,
          daily_refresh_time: dailyTime,
          weekly_report_enabled: weeklyEnabled ? 1 : 0,
          weekly_report_day: weeklyDay,
          weekly_report_time: weeklyTime,
        }),
      });
      if (res.ok) {
        showToast(t("saveSuccess"), "success");
        await fetchSettings();
      } else {
        const json = await res.json().catch(() => ({}));
        const { message } = handleBillingError(json, t("saveFailed"));
        showToast(message, "error");
      }
    } catch {
      showToast(t("saveNetworkError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleRunDaily = async () => {
    setRunningDaily(true);
    try {
      const res = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily_refresh" }),
      });
      if (res.ok) {
        showToast(t("dailyRunDone"), "success");
        await fetchLogs();
      } else {
        const json = await res.json().catch(() => ({}));
        const { message } = handleBillingError(json, t("runFailed"));
        showToast(message, "error");
      }
    } catch {
      showToast(t("runNetworkError"), "error");
    } finally {
      setRunningDaily(false);
    }
  };

  const handleRunWeekly = async () => {
    setRunningWeekly(true);
    try {
      const res = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "weekly_report" }),
      });
      if (res.ok) {
        showToast(t("weeklyRunDone"), "success");
        await fetchLogs();
      } else {
        const json = await res.json().catch(() => ({}));
        const { message } = handleBillingError(json, t("runFailed"));
        showToast(message, "error");
      }
    } catch {
      showToast(t("runNetworkError"), "error");
    } finally {
      setRunningWeekly(false);
    }
  };

  if (loading) {
    return (
      <div className="card-a p-6">
        <div className="font-mono text-xs text-ink-40">{tc("loading")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 缓存管理 */}
      <CacheManagement showToast={showToast} />

      {/* 每日排名刷新 */}
      <div className="card-a p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{t("dailyTitle")}</h2>
            <p className="mt-1 font-mono text-xs text-ink-40">
              {t("dailyDesc")}
            </p>
          </div>
          <Toggle checked={dailyEnabled} onChange={setDailyEnabled} />
        </div>
        {dailyEnabled && (
          <div className="mt-5 flex items-center gap-3 border-t border-line-soft pt-5">
            <label className="font-mono text-xs text-ink-60">{t("runTimeLabel")}</label>
            <input
              type="time"
              value={dailyTime}
              onChange={(e) => setDailyTime(e.target.value)}
              className="rounded-md border border-line bg-card h-8 px-3 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
            />
            <span className="font-mono text-xs text-ink-40">{t("everyDay")}</span>
          </div>
        )}
      </div>

      {/* 每周报告 */}
      <div className="card-a p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{t("weeklyTitle")}</h2>
            <p className="mt-1 font-mono text-xs text-ink-40">
              {t("weeklyDesc")}
            </p>
          </div>
          <Toggle checked={weeklyEnabled} onChange={setWeeklyEnabled} />
        </div>
        {weeklyEnabled && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
            <div className="flex items-center gap-2">
              <label className="font-mono text-xs text-ink-60">{t("runDayLabel")}</label>
              <select
                value={weeklyDay}
                onChange={(e) => setWeeklyDay(Number(e.target.value))}
                className="rounded-md border border-line bg-card h-8 px-3 font-sans text-sm text-ink focus:border-ink-25 focus:outline-none"
              >
                {WEEK_DAYS[locale].map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="font-mono text-xs text-ink-60">{t("runTimeLabel")}</label>
              <input
                type="time"
                value={weeklyTime}
                onChange={(e) => setWeeklyTime(e.target.value)}
                className="rounded-md border border-line bg-card h-8 px-3 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary disabled:opacity-60"
        >
          {saving ? t("saving") : t("saveBtn")}
        </button>
      </div>

      {/* 手动执行 */}
      <div className="card-a p-6">
        <h2 className="font-display text-lg font-semibold text-ink">{t("manualTitle")}</h2>
        <p className="mt-1 font-mono text-xs text-ink-40">
          {t("manualDesc")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={handleRunDaily}
            disabled={runningDaily}
            className="btn-secondary disabled:opacity-60"
          >
            {runningDaily ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t("runningBtn")}
              </>
            ) : (
              t("runDailyBtn")
            )}
          </button>
          <button
            onClick={handleRunWeekly}
            disabled={runningWeekly}
            className="btn-secondary disabled:opacity-60"
          >
            {runningWeekly ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t("generatingBtn")}
              </>
            ) : (
              t("runWeeklyBtn")
            )}
          </button>
        </div>
      </div>

      {/* 执行历史 */}
      <div className="card-a p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">{t("historyTitle")}</h2>
          <span className="font-mono text-xs text-ink-40">
            {t("recentCount", { n: logs.length })}
          </span>
        </div>
        {logs.length === 0 ? (
          <div className="mt-6 border-t border-line-soft pt-6 text-center">
            <div className="font-sans text-sm text-ink-40">{t("historyEmpty")}</div>
            <p className="mt-1 font-mono text-xs text-ink-40">
              {t("historyEmptyHint")}
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden border-t border-line-soft">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("colTime")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("colType")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("colStatus")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("colSummary")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-line-soft transition-colors hover:bg-line-soft/40"
                    >
                      <td className="px-4 py-3 font-mono text-sm text-ink-60">
                        {log.created_at}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge-info">
                          {log.type === "daily_refresh" ? t("typeDaily") : t("typeWeekly")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {log.status === "success" && <span className="badge-good">{t("statusSuccess")}</span>}
                        {log.status === "failed" && <span className="badge-err">{t("statusFailed")}</span>}
                        {log.status === "running" && <span className="badge-warn">{t("statusRunning")}</span>}
                      </td>
                      <td className="px-4 py-3 font-sans text-sm text-ink-60">
                        {log.summary ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 缓存管理组件 =====

function CacheManagement({ showToast }: { showToast: (msg: string, type?: "info" | "success" | "error") => void }) {
  const t = useTranslations("dashboard.settings");
  const locale = useLocale() as "en" | "zh";
  const [total, setTotal] = useState<number | null>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/cache/cleanup", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && json.data) {
          setTotal(json.data.total as number);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const res = await fetch("/api/cache/cleanup", { method: "POST" });
      const json = await res.json();
      if (res.ok && json.data) {
        const deleted = json.data.deleted as number;
        setTotal(json.data.remaining as number);
        showToast(t("cacheCleaned", { n: deleted }), "success");
      } else {
        const { message } = handleBillingError(json, t("cacheCleanFailed"));
        showToast(message, "error");
      }
    } catch {
      showToast(t("cacheNetworkError"), "error");
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="card-a p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink">{t("cacheTitle")}</h2>
          <p className="mt-1 font-mono text-xs text-ink-40">
            {t("cacheDesc")}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-ink">
              {total === null ? "—" : formatNumber(total, locale)}
            </div>
            <div className="font-mono text-xs text-ink-40">{t("cacheEntries")}</div>
          </div>
          <button
            onClick={handleCleanup}
            disabled={cleaning || total === 0}
            className="btn-secondary disabled:opacity-60"
          >
            {cleaning ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t("cacheCleaning")}
              </>
            ) : (
              t("cacheCleanBtn")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Usage Dashboard 组件（P3：Plan Usage Card） =====

function UsageDashboard({
  usageData,
  loading,
  onRefresh,
}: {
  usageData: UsageData | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("dashboard.settings");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";

  if (loading && !usageData) {
    return (
      <div className="card-a p-6">
        <div className="font-mono text-xs text-ink-40">{tc("loading")}</div>
      </div>
    );
  }

  if (!usageData) {
    return (
      <div className="card-a p-6">
        <div className="font-mono text-xs text-ink-40">{t("usageNoData")}</div>
      </div>
    );
  }

  const currentPlanName = planLabel(usageData.plan, locale);

  // 用量项列表（serpapiDaily 仅在套餐配置了每日限额时展示，limit=0 表示无日度限制）
  const usageItems = [
    { label: t("usageSerpapi"), key: "serpapi" as const, unit: t("unitTimes") },
    { label: t("usageSerpapiDaily"), key: "serpapiDaily" as const, unit: t("unitTimes"), show: usageData.usage.serpapiDaily?.limit > 0 },
    { label: t("usageDataforseo"), key: "dataforseo" as const, unit: t("unitTimes"), show: usageData.usage.dataforseo.limit > 0 },
    { label: t("usageContentCheck"), key: "content_check" as const, unit: t("unitTimes"), show: usageData.usage.content_check.limit > 0 },
    { label: t("usageAudit"), key: "audit" as const, unit: t("unitTimes") },
  ].filter((item) => item.show !== false);

  const isUnlimited = (limit: number) => limit >= 2147483647;

  return (
    <div className="space-y-6">
      {/* Plan Usage Card */}
      <div className="card-a p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{t("planUsageTitle")}</h2>
            <p className="mt-1 font-mono text-xs text-ink-40">
              {t("currentStatusLine", { plan: currentPlanName, status: usageData.subscriptionStatus })}
            </p>
          </div>
          <button onClick={onRefresh} className="btn-secondary">
            {t("refresh")}
          </button>
        </div>

        {/* 用量进度条 */}
        <div className="mt-6 space-y-5">
          {usageItems.map((item) => {
            const u = usageData.usage[item.key];
            const unlimited = isUnlimited(u.limit);
            const ratio = unlimited ? 0 : u.used / u.limit;
            const isNearLimit = ratio > 0.8;
            return (
              <div key={item.key}>
                <div className="flex items-center justify-between">
                  <span className="font-sans text-sm font-medium text-ink">{item.label}</span>
                  <span className="font-mono text-xs">
                    {unlimited ? (
                      <span className="text-ink-40">{t("unlimited")}</span>
                    ) : (
                      <>
                        <span className={isNearLimit ? "text-neg" : "text-ink"}>
                          {formatNumber(u.used, locale)}
                        </span>
                        <span className="text-ink-40"> / {formatNumber(u.limit, locale)} {item.unit}</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line-soft">
                  <div
                    className={`h-full rounded-full ${isNearLimit ? "bg-neg" : "bg-brand"}`}
                    style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                  />
                </div>
                <div className="mt-1 font-mono text-xs text-ink-40">
                  {unlimited ? t("unlimitedNote") : t("usedPct", { n: Math.round(ratio * 100) })}
                  {!unlimited && isNearLimit && <span className="ml-2 text-neg">· {t("nearLimit")}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* 项目 / 关键词限额 */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line-soft pt-5">
          <div>
            <div className="font-mono text-xs text-ink-40">{t("limitProjectsMax")}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-ink">
              {isUnlimited(usageData.limits.max_projects) ? t("unlimited") : formatNumber(usageData.limits.max_projects, locale)}
            </div>
          </div>
          <div>
            <div className="font-mono text-xs text-ink-40">{t("limitKeywordsMax")}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-ink">
              {isUnlimited(usageData.limits.max_tracked_keywords) ? t("unlimited") : formatNumber(usageData.limits.max_tracked_keywords, locale)}
            </div>
          </div>
        </div>
      </div>

      {/* Features 开关展示 */}
      <div className="card-a p-6">
        <h2 className="font-display text-lg font-semibold text-ink">{t("featuresTitle")}</h2>
        <p className="mt-1 font-mono text-xs text-ink-40">{t("featuresSubtitle")}</p>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.keys(FEATURE_LABELS[locale]).map((key) => {
            const enabled = !!usageData.features[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-line bg-card px-4 py-3"
              >
                <span className="font-sans text-sm text-ink">{featureLabel(key, locale)}</span>
                {enabled ? (
                  <span className="flex items-center gap-1 font-mono text-xs text-green-600">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t("featureOn")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-mono text-xs text-ink-40">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    {t("featureOff")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===== Toggle 开关组件 =====

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-colors ${
        checked
          ? "border-brand bg-brand"
          : "border-line bg-line-soft"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-card transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        } mt-0.5`}
      />
    </button>
  );
}
