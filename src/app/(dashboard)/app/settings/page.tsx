"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/dashboard/Toast";
import { isAuthEnabled } from "@/lib/auth-config";
import { createBrowser } from "@/lib/supabase/browser";

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
  content_check_monthly_limit: number;
  can_export_pdf: boolean;
  can_export_excel: boolean;
  can_email_report: boolean;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

function formatLimitValue(v: number): string {
  if (v >= UNLIMITED) return "无限";
  return v.toLocaleString();
}

function buildPlanLimits(p: PlanInfo): { label: string; value: string }[] {
  return [
    { label: "项目数", value: formatLimitValue(p.max_projects) },
    { label: "关键词追踪", value: formatLimitValue(p.max_tracked_keywords) },
    { label: "每日审计", value: p.audit_daily_limit >= UNLIMITED ? "无限" : `${p.audit_daily_limit} 次` },
    { label: "报表导出", value: p.can_export_pdf ? "PDF / Excel" : "—" },
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

const WEEK_DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

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

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  lite: "Lite",
  pro: "Pro",
};

const FEATURE_LABELS: Record<string, string> = {
  pdf_export: "PDF 导出",
  excel_export: "Excel 导出",
  full_audit: "完整审计",
  backlinks: "外链分析",
  email_report: "邮件报告",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { show, Toast } = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabKey>("account");
  const [signingOut, setSigningOut] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
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
            displayName: "本地开发",
            email: "dev@seeo.local",
            userId: "demo-user-0001",
            createdAt: "—（演示模式）",
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
        const email = user.email ?? "未知";
        const displayName =
          (user.user_metadata as { display_name?: string } | null)?.display_name ||
          email.split("@")[0] ||
          "用户";
        const createdAt = user.created_at
          ? new Date(user.created_at).toLocaleString("zh-CN", { hour12: false })
          : "未知";
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
  }, []);

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
      show(`退出失败：${(err as Error).message}`, "error");
    } finally {
      setSigningOut(false);
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
    show("升级成功，套餐权益将在几秒内生效", "success");
    const timer = setTimeout(() => {
      void fetchUsage();
    }, 1500);
    return () => clearTimeout(timer);
  }, [isCheckoutSuccess, fetchUsage, show]);

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
    { key: "account", label: "账号信息" },
    { key: "plan", label: "订阅套餐" },
    { key: "usage", label: "用量统计" },
    { key: "automation", label: "自动化" },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 页头：编号 + 标题 + 发丝线 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">09</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          设置
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        管理账号、订阅与用量。
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 左侧 Tab */}
        <nav className="lg:col-span-3">
          <ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1.5 lg:flex-col lg:overflow-visible">
            {tabs.map((t) => (
              <li key={t.key} className="flex-shrink-0">
                <button
                  onClick={() => setTab(t.key)}
                  className={`w-full whitespace-nowrap rounded-lg px-3 py-2 text-left font-sans text-sm font-medium transition-colors ${
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
              <h2 className="font-display text-lg font-bold text-ink">账号信息</h2>
              {accountLoading ? (
                <div className="mt-6 font-mono text-xs text-ink-40">加载中…</div>
              ) : account ? (
                <>
                  <div className="mt-5 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                    {/* 头像占位 */}
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-brand/30 bg-brand/15 font-display text-2xl font-bold text-ink">
                      {account.displayName.slice(0, 1)}
                    </div>
                    <div className="flex-1">
                      <div className="font-sans text-base font-semibold text-ink">{account.displayName}</div>
                      <div className="mt-0.5 font-mono text-xs text-ink-40">{account.email}</div>
                    </div>
                    <button
                      onClick={() => show("当前为演示模式，编辑功能将在接入后端后开放", "info")}
                      className="btn-secondary"
                    >
                      编辑
                    </button>
                  </div>

                  {/* 字段表 */}
                  <div className="mt-6 divide-y divide-line-soft border-t border-line-soft">
                    {[
                      { label: "显示名", value: account.displayName },
                      { label: "邮箱", value: account.email },
                      { label: "账号 ID", value: account.userId },
                      { label: "注册时间", value: account.createdAt },
                      { label: "两步验证", value: "未开启" },
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
                        {signingOut ? "退出中…" : "退出登录"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-6 font-mono text-xs text-ink-40">无法获取账号信息</div>
              )}
            </div>
          )}

          {/* 订阅套餐 */}
          {tab === "plan" && (
            <div>
              <h2 className="font-display text-lg font-bold text-ink">订阅套餐</h2>
              <p className="mt-1 font-mono text-xs text-ink-40">
                {usageData
                  ? `当前：${PLAN_LABELS[usageData.plan] ?? usageData.plan} · 可随时升级或降级`
                  : "加载当前套餐中…"}
              </p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {plansLoading ? (
                  <div className="col-span-full font-mono text-xs text-ink-40">加载套餐中…</div>
                ) : plans && plans.length > 0 ? (
                  plans.map((p) => {
                    const isCurrent = usageData?.plan === p.plan;
                    const limits = buildPlanLimits(p);
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
                          <span className="absolute -top-2 right-4 rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                            推荐
                          </span>
                        )}
                        {isCurrent && (
                          <span className="absolute -top-2 right-4 rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                            当前套餐
                          </span>
                        )}

                        <div className="font-display text-base font-bold text-ink">{p.display.name}</div>
                        <div className="mt-2 flex items-baseline gap-0.5">
                          <span className="font-display text-3xl font-bold text-ink">
                            {p.display.price}
                          </span>
                          <span className="font-mono text-xs text-ink-40">{p.display.priceUnit}</span>
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
                              ? show("当前已在使用此套餐", "info")
                              : show("套餐变更将通过支付页面完成，支持支付宝 / 微信支付", "info")
                          }
                          className={isCurrent ? "btn-secondary mt-5 w-full" : "btn-primary mt-5 w-full"}
                        >
                          {isCurrent ? "当前套餐" : p.display.ctaLabel}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="col-span-full font-mono text-xs text-ink-40">暂无套餐信息</div>
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
        showToast("自动化配置已保存", "success");
        await fetchSettings();
      } else {
        const json = await res.json();
        showToast(json.error || "保存失败", "error");
      }
    } catch {
      showToast("网络错误，保存失败", "error");
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
        showToast("每日刷新已执行", "success");
        await fetchLogs();
      } else {
        const json = await res.json();
        showToast(json.error || "执行失败", "error");
      }
    } catch {
      showToast("网络错误，执行失败", "error");
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
        showToast("每周报告已生成", "success");
        await fetchLogs();
      } else {
        const json = await res.json();
        showToast(json.error || "执行失败", "error");
      }
    } catch {
      showToast("网络错误，执行失败", "error");
    } finally {
      setRunningWeekly(false);
    }
  };

  if (loading) {
    return (
      <div className="card-a p-6">
        <div className="font-mono text-xs text-ink-40">加载中…</div>
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
            <h2 className="font-display text-lg font-bold text-ink">每日排名刷新</h2>
            <p className="mt-1 font-mono text-xs text-ink-40">
              自动刷新所有追踪关键词的排名并生成预警
            </p>
          </div>
          <Toggle checked={dailyEnabled} onChange={setDailyEnabled} />
        </div>
        {dailyEnabled && (
          <div className="mt-5 flex items-center gap-3 border-t border-line-soft pt-5">
            <label className="font-mono text-xs text-ink-60">执行时间</label>
            <input
              type="time"
              value={dailyTime}
              onChange={(e) => setDailyTime(e.target.value)}
              className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
            />
            <span className="font-mono text-xs text-ink-40">每天</span>
          </div>
        )}
      </div>

      {/* 每周报告 */}
      <div className="card-a p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">每周报告</h2>
            <p className="mt-1 font-mono text-xs text-ink-40">
              自动汇总过去 7 天的排名变化、审计情况和关键词概况
            </p>
          </div>
          <Toggle checked={weeklyEnabled} onChange={setWeeklyEnabled} />
        </div>
        {weeklyEnabled && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
            <div className="flex items-center gap-2">
              <label className="font-mono text-xs text-ink-60">执行日</label>
              <select
                value={weeklyDay}
                onChange={(e) => setWeeklyDay(Number(e.target.value))}
                className="rounded-lg border border-line bg-card px-3 py-1.5 font-sans text-sm text-ink focus:border-ink-25 focus:outline-none"
              >
                {WEEK_DAYS.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="font-mono text-xs text-ink-60">执行时间</label>
              <input
                type="time"
                value={weeklyTime}
                onChange={(e) => setWeeklyTime(e.target.value)}
                className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
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
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>

      {/* 手动执行 */}
      <div className="card-a p-6">
        <h2 className="font-display text-lg font-bold text-ink">手动执行</h2>
        <p className="mt-1 font-mono text-xs text-ink-40">
          立即触发一次任务，不影响定时计划
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
                执行中…
              </>
            ) : (
              "立即执行每日刷新"
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
                生成中…
              </>
            ) : (
              "立即生成每周报告"
            )}
          </button>
        </div>
      </div>

      {/* 执行历史 */}
      <div className="card-a p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">执行历史</h2>
          <span className="font-mono text-xs text-ink-40">
            最近 {logs.length} 条
          </span>
        </div>
        {logs.length === 0 ? (
          <div className="mt-6 border-t border-line-soft pt-6 text-center">
            <div className="font-sans text-sm text-ink-40">暂无执行记录</div>
            <p className="mt-1 font-mono text-xs text-ink-40">
              手动执行或启用定时任务后将在此显示
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden border-t border-line-soft">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">时间</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">类型</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">状态</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-line-soft transition-colors hover:bg-line-soft/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-ink-60">
                        {log.created_at}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge-info">
                          {log.type === "daily_refresh" ? "每日刷新" : "每周报告"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {log.status === "success" && <span className="badge-good">成功</span>}
                        {log.status === "failed" && <span className="badge-err">失败</span>}
                        {log.status === "running" && <span className="badge-warn">运行中</span>}
                      </td>
                      <td className="px-4 py-3 font-sans text-xs text-ink-60">
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
        showToast(`已清理 ${deleted} 条过期缓存`, "success");
      } else {
        showToast(json.error || "清理失败", "error");
      }
    } catch {
      showToast("网络错误，清理失败", "error");
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="card-a p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-ink">缓存管理</h2>
          <p className="mt-1 font-mono text-xs text-ink-40">
            SerpApi 结果缓存，自动在每日刷新后清理过期项
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          <div className="text-right">
            <div className="font-mono text-2xl font-bold text-ink">
              {total === null ? "—" : total.toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-ink-40">当前条目</div>
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
                清理中…
              </>
            ) : (
              "清理过期缓存"
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
  if (loading && !usageData) {
    return (
      <div className="card-a p-6">
        <div className="font-mono text-xs text-ink-40">加载中…</div>
      </div>
    );
  }

  if (!usageData) {
    return (
      <div className="card-a p-6">
        <div className="font-mono text-xs text-ink-40">暂无用量数据</div>
      </div>
    );
  }

  const planLabel = PLAN_LABELS[usageData.plan] ?? usageData.plan;

  // 用量项列表
  const usageItems = [
    { label: "SerpApi 搜索", key: "serpapi" as const, unit: "次" },
    { label: "DataForSEO 外链", key: "dataforseo" as const, unit: "次" },
    { label: "内容检查", key: "content_check" as const, unit: "次" },
    { label: "今日审计", key: "audit" as const, unit: "次" },
  ];

  const isUnlimited = (limit: number) => limit >= 2147483647;

  return (
    <div className="space-y-6">
      {/* Plan Usage Card */}
      <div className="card-a p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">套餐用量</h2>
            <p className="mt-1 font-mono text-xs text-ink-40">
              当前套餐：{planLabel} · 状态：{usageData.subscriptionStatus}
            </p>
          </div>
          <button onClick={onRefresh} className="btn-secondary">
            刷新
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
                      <span className="text-ink-40">无限</span>
                    ) : (
                      <>
                        <span className={isNearLimit ? "text-neg" : "text-ink"}>
                          {u.used.toLocaleString()}
                        </span>
                        <span className="text-ink-40"> / {u.limit.toLocaleString()} {item.unit}</span>
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
                <div className="mt-1 font-mono text-[10px] text-ink-40">
                  {unlimited ? "不限量" : `已用 ${Math.round(ratio * 100)}%`}
                  {!unlimited && isNearLimit && <span className="ml-2 text-neg">· 接近上限</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* 项目 / 关键词限额 */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line-soft pt-5">
          <div>
            <div className="font-mono text-[10px] text-ink-40">项目数上限</div>
            <div className="mt-1 font-mono text-lg font-bold text-ink">
              {isUnlimited(usageData.limits.max_projects) ? "无限" : usageData.limits.max_projects.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-ink-40">关键词追踪上限</div>
            <div className="mt-1 font-mono text-lg font-bold text-ink">
              {isUnlimited(usageData.limits.max_tracked_keywords) ? "无限" : usageData.limits.max_tracked_keywords.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Features 开关展示 */}
      <div className="card-a p-6">
        <h2 className="font-display text-lg font-bold text-ink">功能权益</h2>
        <p className="mt-1 font-mono text-xs text-ink-40">当前套餐可用功能</p>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(FEATURE_LABELS).map(([key, label]) => {
            const enabled = !!usageData.features[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-line bg-card px-4 py-3"
              >
                <span className="font-sans text-sm text-ink">{label}</span>
                {enabled ? (
                  <span className="flex items-center gap-1 font-mono text-xs text-green-600">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    已开通
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-mono text-xs text-ink-40">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    未开通
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
