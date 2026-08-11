"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createBrowser } from "@/lib/supabase/browser";
import { isAuthEnabled } from "@/lib/auth-config";

interface TopbarProps {
  displayName: string;
  email: string;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  lite: "Lite",
  pro: "Pro",
};

const PLAN_BADGE_STYLES: Record<string, string> = {
  free: "bg-line-soft text-ink-60",
  lite: "bg-brand/10 text-brand",
  pro: "bg-ink text-card",
};

interface AlertItem {
  id: number;
  level: "error" | "warning" | "info";
  title: string;
  domain: string | null;
  created_at: string;
}

interface ProjectItem {
  id: number;
  name: string;
  domain: string;
  healthScore: number | null;
}

const alertDotColor: Record<string, string> = {
  error: "bg-neg",
  warning: "bg-warn",
  info: "bg-ink-40",
};

const SELECTED_PROJECT_KEY = "seeo:selected-project-id";

function formatRelativeTime(isoStr: string): string {
  const then = new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z").getTime();
  if (Number.isNaN(then)) return isoStr;
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return new Date(then).toLocaleDateString("zh-CN");
}

export default function Topbar({ displayName, email }: TopbarProps) {
  const [projectOpen, setProjectOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const bellRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // 拉取当前用户套餐（用于 plan badge 展示）
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

  // 拉取真实项目列表 + 从 localStorage 恢复选中项
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const list: ProjectItem[] = (data.data ?? []).map((p: ProjectItem) => ({
          id: p.id,
          name: p.name,
          domain: p.domain,
          healthScore: p.healthScore,
        }));
        setProjects(list);

        // 恢复 localStorage 选中项
        const stored = window.localStorage.getItem(SELECTED_PROJECT_KEY);
        const storedId = stored ? Number(stored) : NaN;
        const exists = Number.isInteger(storedId) && list.some((p) => p.id === storedId);
        if (exists) {
          setSelectedId(storedId);
        } else if (list.length > 0) {
          // 默认选第一个
          setSelectedId(list[0].id);
          window.localStorage.setItem(SELECTED_PROJECT_KEY, String(list[0].id));
        } else {
          setSelectedId(null);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 拉取预警
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alerts", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setAlerts((data.data ?? []).slice(0, 5));
        setUnread(data.unread ?? 0);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellOpen && bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
      if (projectOpen && projectRef.current && !projectRef.current.contains(e.target as Node)) {
        setProjectOpen(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [bellOpen, projectOpen, userMenuOpen]);

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch("/api/alerts/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setUnread(data.unread ?? 0);
    } catch {
      // ignore
    }
  };

  const handleSelectProject = (id: number) => {
    setSelectedId(id);
    window.localStorage.setItem(SELECTED_PROJECT_KEY, String(id));
    setProjectOpen(false);
  };

  const handleLogout = async () => {
    if (!isAuthEnabled) {
      setUserMenuOpen(false);
      return;
    }
    const supabase = createBrowser();
    // await 完成后再导航，避免导航中断 logout 请求（ERR_ABORTED）
    await supabase.auth.signOut({ scope: "global" });
    // 等待浏览器完全关闭 fetch 连接，避免导航中止底层 TCP
    await new Promise((resolve) => setTimeout(resolve, 200));
    window.location.assign("/login");
  };

  const currentProject = selectedId !== null
    ? projects.find((p) => p.id === selectedId) ?? null
    : null;

  return (
    <header className="flex h-16 flex-none items-center justify-between gap-4 border-b border-line bg-card px-5">
      {/* 项目切换器：描边 chip */}
      <div className="relative" ref={projectRef}>
        <button
          onClick={() => setProjectOpen((o) => !o)}
          className="flex items-center gap-2.5 rounded-lg border border-line bg-card px-3 py-2 hover:border-ink-25"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded bg-ink text-xs font-semibold text-card">
            {currentProject ? currentProject.name.charAt(0).toUpperCase() : "—"}
          </span>
          <span className="font-sans text-sm font-medium text-ink">
            {currentProject ? currentProject.domain : "未选择项目"}
          </span>
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-ink-40">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {projectOpen && (
          <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-card p-1.5">
            <div className="px-2 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink-40">
              切换项目
            </div>
            {projects.length === 0 ? (
              <div className="px-2 py-3 font-sans text-xs text-ink-40">
                暂无项目
              </div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProject(p.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-line-soft"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-ink text-xs font-semibold text-card">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-ink truncate">
                      {p.domain}
                    </div>
                    <div className="font-sans text-[10px] text-ink-40">
                      健康 {p.healthScore === null ? "未审计" : p.healthScore}
                    </div>
                  </div>
                  {p.id === selectedId && (
                    <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                  )}
                </button>
              ))
            )}
            <div className="mt-1 border-t border-line-soft pt-1">
              <Link
                href="/app"
                onClick={() => setProjectOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 font-sans text-sm text-ink-60 hover:bg-line-soft hover:text-ink"
              >
                <span className="text-ink">+</span> 新建项目
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* 搜索框：白底描边 + ⌘K */}
      <div className="hidden flex-1 max-w-md sm:block">
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="搜索关键词、域名、报告…"
            className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-14 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[10px] text-ink-40">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-2">
        {/* 铃铛 + 下拉 */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setBellOpen((o) => !o)}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-60 hover:bg-card hover:text-ink"
            aria-label="预警通知"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-neg" />
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-line bg-card overflow-hidden">
              {/* 头部 */}
              <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
                <span className="text-sm font-bold text-ink">预警通知</span>
                {unread > 0 && (
                  <span className="font-sans text-[10px] text-ink-40">{unread} 条未读</span>
                )}
              </div>

              {/* 列表 */}
              {alerts.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="font-sans text-xs text-ink-40">暂无预警</div>
                </div>
              ) : (
                <div>
                  {alerts.map((a, idx) => (
                    <div
                      key={a.id}
                      className={`flex items-start gap-2.5 px-4 py-3 hover:bg-line-soft ${
                        idx !== alerts.length - 1 ? "border-b border-line-soft" : ""
                      }`}
                    >
                      <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${alertDotColor[a.level]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-sans text-xs text-ink leading-snug">{a.title}</div>
                        <div className="mt-0.5 font-sans text-[10px] text-ink-40">
                          {a.domain ?? "—"} · {formatRelativeTime(a.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 底部操作 */}
              <div className="flex items-center justify-between border-t border-line-soft px-4 py-2.5">
                {unread > 0 ? (
                  <button
                    onClick={handleMarkAllRead}
                    className="font-sans text-[11px] text-ink-60 hover:text-ink"
                  >
                    全部标为已读
                  </button>
                ) : (
                  <span className="font-sans text-[11px] text-ink-40">全部已读</span>
                )}
                <Link
                  href="/app"
                  onClick={() => setBellOpen(false)}
                  className="font-sans text-[11px] text-accent hover:underline"
                >
                  查看全部 →
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* 头像 + 用户菜单 */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg p-1 hover:bg-line-soft"
          >
            <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-medium ${PLAN_BADGE_STYLES[currentPlan] ?? PLAN_BADGE_STYLES.free}`}>
              {PLAN_LABELS[currentPlan] ?? currentPlan}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-semibold text-card">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-line bg-card overflow-hidden">
              <div className="border-b border-line-soft px-4 py-2.5">
                <p className="font-sans text-sm font-medium text-ink truncate">
                  {displayName}
                </p>
                <p className="font-mono text-[10px] text-ink-40 truncate">
                  {email}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${PLAN_BADGE_STYLES[currentPlan] ?? PLAN_BADGE_STYLES.free}`}>
                    {PLAN_LABELS[currentPlan] ?? currentPlan}
                  </span>
                  {(currentPlan === "free" || currentPlan === "lite") && (
                    <span className="font-mono text-[10px] text-ink-40">点击下方升级</span>
                  )}
                </div>
              </div>
              <div className="border-b border-line-soft py-1">
                <Link
                  href="/pricing"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2 font-sans text-sm text-ink-60 transition-colors duration-150 hover:bg-line-soft hover:text-ink"
                >
                  定价方案
                </Link>
                <Link
                  href="/docs"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2 font-sans text-sm text-ink-60 transition-colors duration-150 hover:bg-line-soft hover:text-ink"
                >
                  帮助文档
                </Link>
              </div>
              {isAuthEnabled ? (
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 font-sans text-sm text-ink-60 hover:bg-line-soft transition-colors duration-150"
                >
                  退出登录
                </button>
              ) : (
                <div className="px-4 py-2.5 font-sans text-[10px] text-ink-40">
                  演示模式 · 账号系统未启用
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
