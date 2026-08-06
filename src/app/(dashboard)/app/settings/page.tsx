"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/dashboard/Toast";

type TabKey = "account" | "plan" | "usage" | "team" | "automation";

interface PlanTier {
  key: string;
  name: string;
  price: string;
  period: string;
  highlighted?: boolean; // 推荐
  current?: boolean;
  limits: { label: string; value: string }[];
  cta: string;
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

const plans: PlanTier[] = [
  {
    key: "starter",
    name: "入门版",
    price: "¥0",
    period: "/月",
    cta: "开始使用",
    limits: [
      { label: "项目数", value: "1 个" },
      { label: "关键词追踪", value: "100 个" },
      { label: "外链分析", value: "基础" },
      { label: "报表导出", value: "— " },
    ],
  },
  {
    key: "pro",
    name: "专业版",
    price: "¥299",
    period: "/月",
    highlighted: true,
    current: true,
    cta: "当前套餐",
    limits: [
      { label: "项目数", value: "5 个" },
      { label: "关键词追踪", value: "3,000 个" },
      { label: "外链分析", value: "完整" },
      { label: "报表导出", value: "PDF / Excel" },
    ],
  },
  {
    key: "team",
    name: "团队版",
    price: "¥899",
    period: "/月",
    cta: "升级",
    limits: [
      { label: "项目数", value: "20 个" },
      { label: "关键词追踪", value: "15,000 个" },
      { label: "外链分析", value: "完整" },
      { label: "报表导出", value: "白标 PDF" },
    ],
  },
  {
    key: "enterprise",
    name: "企业定制",
    price: "联系销售",
    period: "",
    cta: "联系我们",
    limits: [
      { label: "项目数", value: "无限" },
      { label: "关键词追踪", value: "无限" },
      { label: "外链分析", value: "完整 + API" },
      { label: "报表导出", value: "白标 + 自动化" },
    ],
  },
];

const usageStats = [
  { label: "项目数", used: 3, limit: 5, unit: "个" },
  { label: "关键词追踪", used: 2640, limit: 3000, unit: "个" },
  { label: "API 调用", used: 8200, limit: 10000, unit: "次" },
];

const WEEK_DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export default function SettingsPage() {
  const { show, Toast } = useToast();
  const [tab, setTab] = useState<TabKey>("account");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "account", label: "账号信息" },
    { key: "plan", label: "订阅套餐" },
    { key: "usage", label: "用量统计" },
    { key: "team", label: "团队" },
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
        管理账号、订阅、用量与团队。
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
              <div className="mt-5 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                {/* 头像占位 */}
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-brand/30 bg-brand/15 font-display text-2xl font-bold text-ink">
                  本
                </div>
                <div className="flex-1">
                  <div className="font-sans text-base font-semibold text-ink">本地开发</div>
                  <div className="mt-0.5 font-mono text-xs text-ink-40">dev@seeo.local</div>
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
                  { label: "显示名", value: "本地开发" },
                  { label: "邮箱", value: "dev@seeo.local" },
                  { label: "账号 ID", value: "demo-user-0001" },
                  { label: "注册时间", value: "—（演示模式）" },
                  { label: "两步验证", value: "未开启" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-3">
                    <span className="font-mono text-xs text-ink-40">{row.label}</span>
                    <span className="font-sans text-sm text-ink">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 订阅套餐 */}
          {tab === "plan" && (
            <div>
              <h2 className="font-display text-lg font-bold text-ink">订阅套餐</h2>
              <p className="mt-1 font-mono text-xs text-ink-40">
                当前：专业版 · 可随时升级或降级
              </p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {plans.map((p) => (
                  <div
                    key={p.key}
                    className={`card-a relative flex flex-col p-5 transition-colors ${
                      p.current
                        ? "border-brand"
                        : p.highlighted
                          ? "border-brand/40"
                          : ""
                    }`}
                  >
                    {/* 推荐 / 当前套餐 标签 */}
                    {p.highlighted && !p.current && (
                      <span className="absolute -top-2 right-4 rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                        推荐
                      </span>
                    )}
                    {p.current && (
                      <span className="absolute -top-2 right-4 rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                        当前套餐
                      </span>
                    )}

                    <div className="font-display text-base font-bold text-ink">{p.name}</div>
                    <div className="mt-2 flex items-baseline gap-0.5">
                      <span className={`font-display text-3xl font-bold ${p.highlighted || p.current ? "text-ink" : "text-ink"}`}>
                        {p.price}
                      </span>
                      <span className="font-mono text-xs text-ink-40">{p.period}</span>
                    </div>

                    <ul className="mt-4 flex-1 space-y-2">
                      {p.limits.map((l) => (
                        <li key={l.label} className="flex items-center justify-between font-mono text-xs">
                          <span className="text-ink-40">{l.label}</span>
                          <span className="text-ink">{l.value}</span>
                        </li>
                      ))}
                    </ul>

                    <button
                      onClick={() =>
                        p.current
                          ? show("当前已在使用此套餐", "info")
                          : show("当前为演示模式，套餐变更将在接入后端后开放", "info")
                      }
                      className={p.current ? "btn-secondary mt-5 w-full" : "btn-primary mt-5 w-full"}
                    >
                      {p.cta}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 用量统计 */}
          {tab === "usage" && (
            <div className="card-a p-6">
              <h2 className="font-display text-lg font-bold text-ink">用量统计</h2>
              <p className="mt-1 font-mono text-xs text-ink-40">
                当前周期：专业版 · 重置日期每月 1 日
              </p>
              <div className="mt-6 space-y-5">
                {usageStats.map((u) => {
                  const ratio = u.used / u.limit;
                  const isNearLimit = ratio > 0.8;
                  return (
                    <div key={u.label}>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-sm font-medium text-ink">{u.label}</span>
                        <span className="font-mono text-xs">
                          <span className={isNearLimit ? "text-neg" : "text-ink"}>
                            {u.used.toLocaleString()}
                          </span>
                          <span className="text-ink-40"> / {u.limit.toLocaleString()} {u.unit}</span>
                        </span>
                      </div>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line-soft">
                        <div
                          className={`h-full rounded-full ${isNearLimit ? "bg-neg" : "bg-brand"}`}
                          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                        />
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-ink-40">
                        已用 {Math.round(ratio * 100)}%
                        {isNearLimit && <span className="ml-2 text-neg">· 接近上限</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 团队占位 */}
          {tab === "team" && (
            <div className="card-a p-8">
              <h2 className="font-display text-lg font-bold text-ink">团队</h2>
              <div className="mt-6 flex flex-col items-center justify-center py-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-line-soft font-mono text-3xl text-ink-40">
                  👥
                </div>
                <div className="mt-4 font-sans text-sm font-medium text-ink-60">
                  团队功能即将上线
                </div>
                <p className="mt-1 max-w-sm font-mono text-xs text-ink-40">
                  上线后可邀请成员、分配角色权限、共享项目数据。当前演示模式下此区域为占位说明。
                </p>
                <button
                  onClick={() => show("团队功能即将上线，敬请期待", "info")}
                  className="btn-secondary mt-5"
                >
                  通知我上线
                </button>
              </div>
            </div>
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
