"use client";

import { useState, useEffect, useRef, useId } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { createBrowser } from "@/lib/supabase/browser";
import { isAuthEnabled } from "@/lib/auth-config";
import { useActiveProject } from "@/components/dashboard/ActiveProjectContext";
import { useEntitlements } from "@/components/billing/EntitlementsContext";
import { planLabel } from "@/lib/plan-labels";
import { formatRelativeTime } from "@/lib/relative-time";
import { useCreateProject } from "@/components/dashboard/CreateProjectContext";
import { triggerUpgradeModal } from "@/components/billing/UpgradeModal";
import { resolveApiErrorMessage } from "@/lib/billing-error-client";
import { alertText } from "@/lib/alert-text";
import type { LocalizedText } from "@/lib/seo/audit-ltext";
import { track } from "@/lib/analytics/client";

interface TopbarProps {
  displayName: string;
  email: string;
  /** 访客审计模式（未登录使用 /app/audit）：用户菜单显示登录入口而非登出 */
  isGuest?: boolean;
  /** 移动端（<lg）打开侧边抽屉 */
  onMobileMenuClick?: () => void;
  /** 抽屉当前是否展开，仅用于 aria-expanded（BUG-18） */
  mobileMenuOpen?: boolean;
}

const PLAN_BADGE_STYLES: Record<string, string> = {
  free: "bg-line-soft text-ink-60",
  lite: "bg-brand/10 text-brand",
  pro: "bg-ink text-card",
};

interface AlertItem {
  id: number;
  level: "error" | "warning" | "info";
  /** 新数据双语、历史数据纯文本，统一用 alertText() 取当前 locale 的可读串 */
  title: LocalizedText;
  domain: string | null;
  created_at: string;
}

const alertDotColor: Record<string, string> = {
  error: "bg-neg",
  warning: "bg-warn",
  info: "bg-ink-40",
};

// 当前项目由 ActiveProjectContext 统一持有（唯一真源）：顶部只负责"显示"与"发起切换"。
// 列表、选中 id、id→域名映射都在 Provider 里解析，页面侧读同一份，不再各自取列表。


export default function Topbar({ displayName, email, isGuest, onMobileMenuClick, mobileMenuOpen }: TopbarProps) {
  const t = useTranslations("dashboard.topbar");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const [projectOpen, setProjectOpen] = useState(false);
  // BUG-16：加载失败 ≠ 没有项目。之前 500 / 网络异常都落到 (data.data ?? [])，
  // 菜单直接说「尚无项目」，用户会以为自己项目被删了。
  const {
    projects,
    failed: projectsFailed,
    activeId: selectedId,
    setActive,
    reload: reloadProjects,
  } = useActiveProject();
  const [bellOpen, setBellOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { plan: currentPlan, limits: entitlementLimits, loading: entitlementsLoading } = useEntitlements();
  // 项目额度上限：从 EntitlementsContext limits 派生（单一数据源）
  const maxProjects =
    typeof entitlementLimits?.max_projects === "number" ? entitlementLimits.max_projects : null;
  const { openCreateProject } = useCreateProject();
  const bellRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  // BUG-25：三个下拉此前只能"点外面"关闭 —— 键盘用户按 Esc 关不掉，读屏也听不到
  // 面板开合。触发按钮补 aria-expanded/haspopup/controls，面板补 id + role=group。
  const bellPanelId = useId();
  const projectPanelId = useId();
  const userMenuPanelId = useId();


  // 列表与选中态由 ActiveProjectContext 持有：这里不再 fetch /api/projects，
  // 也不再自己从 localStorage 恢复（否则又会出现"顶部一套、页面一套"两份状态）。
  // 下拉打开时强制刷新一次列表：创建/删除项目后额度校验与选项保持新鲜。
  const refreshProjects = () => void reloadProjects({ force: true });

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

  // BUG-25：Esc 收起任一打开的下拉（抽屉/弹层已有各自处理，这里只补顶栏下拉）
  useEffect(() => {
    if (!bellOpen && !projectOpen && !userMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setBellOpen(false);
      setProjectOpen(false);
      setUserMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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

  const handleSelectProject = (id: string) => {
    // 唯一写入路径：写 localStorage + 广播 source:"user"，当前页面靠事件即时跟随，
    // 不触发任何导航（切换项目不是导航操作）。
    setActive(id);
    setProjectOpen(false);
  };

  // F1：新建项目入口（额度校验后打开创建弹窗或升级提示）
  const handleNewProject = () => {
    setProjectOpen(false);
    if (maxProjects !== null && projects.length >= maxProjects) {
      triggerUpgradeModal({
        currentPlan,
        reason: resolveApiErrorMessage(
          { code: "PROJECT_LIMIT_REACHED", plan: planLabel(currentPlan, locale), limit: maxProjects },
          locale,
          t("upgradeHint")
        ),
        limit: maxProjects,
        used: projects.length,
      });
      return;
    }
    openCreateProject();
  };

  const handleLogout = async () => {
    if (!isAuthEnabled) {
      setUserMenuOpen(false);
      return;
    }
    const supabase = createBrowser();
    // 漏斗事件：在会话仍有效时上报登出（await 保证 user_id 落库）
    await track("logout");
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
      {/* 移动端菜单按钮 */}
      {onMobileMenuClick && (
        <button
          onClick={onMobileMenuClick}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-ink-60 hover:bg-line-soft hover:text-ink lg:hidden"
          aria-label={t("menu")}
          // BUG-18：抽屉是 fixed 覆盖层，展开时它遮挡整页。不加 aria-expanded，
          // 读屏用户无法知道菜单是否已打开，也不知道焦点落在被遮住的导航里。
          aria-expanded={mobileMenuOpen ?? false}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {/* 项目切换器：描边 chip */}
      <div className="relative min-w-0" ref={projectRef}>
        <button
          onClick={() => {
            // 打开下拉时刷新项目列表（创建/删除后额度校验数据保持新鲜）
            if (!projectOpen) refreshProjects();
            setProjectOpen((o) => !o);
          }}
          aria-haspopup="true"
          aria-expanded={projectOpen}
          aria-controls={projectOpen ? projectPanelId : undefined}
          className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-line bg-card px-3 py-2 hover:border-ink-25"
        >
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded bg-ink text-xs font-semibold text-card">
            {currentProject ? currentProject.name.charAt(0).toUpperCase() : "—"}
          </span>
          {/* min-w-0 是必需的：flex 子项默认 min-width:auto，长域名不会收缩，
              按钮会顶穿 360 屏上 128px 的容器，把域名画到铃铛/套餐徽标上面（BUG-45）。 */}
          <span className="max-w-[140px] min-w-0 truncate font-sans text-sm font-medium text-ink sm:max-w-[220px] lg:max-w-none">
            {currentProject ? currentProject.domain : t("noProject")}
          </span>
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-ink-40">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {projectOpen && (
          <div
            id={projectPanelId}
            role="group"
            aria-label={t("switchProject")}
            className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-card p-2"
          >
            <div className="px-2 py-1 font-sans text-xs uppercase tracking-wider text-ink-40">
              {t("switchProject")}
            </div>
            {projectsFailed ? (
              <div className="px-2 py-3">
                <div className="font-sans text-xs text-neg">{t("loadFailed")}</div>
                <button
                  onClick={() => refreshProjects()}
                  className="btn-secondary mt-2 px-2 py-1 text-xs"
                >
                  {t("retry")}
                </button>
              </div>
            ) : projects.length === 0 ? (
              <div className="px-2 py-3 font-sans text-xs text-ink-40">
                {t("noProjects")}
              </div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProject(p.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-line-soft"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-ink text-xs font-semibold text-card">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-ink truncate">
                      {p.domain}
                    </div>
                    <div className="font-sans text-xs text-ink-40">
                      {t("health")} {p.healthScore === null ? t("notAudited") : p.healthScore}
                    </div>
                  </div>
                  {p.id === selectedId && (
                    <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                  )}
                </button>
              ))
            )}
            <div className="mt-1 border-t border-line-soft pt-1">
              <button
                onClick={handleNewProject}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 font-sans text-sm text-ink-60 hover:bg-line-soft hover:text-ink"
              >
                <span className="text-ink">+</span> {t("newProject")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 全局搜索暂未提供；占位弹性行保持布局平衡 */}
      <div className="hidden flex-1 sm:block" aria-hidden="true" />

      {/* 右侧 */}
      <div className="flex items-center gap-2">
        {/* 铃铛 + 下拉 */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setBellOpen((o) => !o)}
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink-60 hover:bg-card hover:text-ink"
            aria-label={t("notifications")}
            aria-haspopup="true"
            aria-expanded={bellOpen}
            aria-controls={bellOpen ? bellPanelId : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {unread > 0 && (
              <span className="absolute right-1.5 top-2 h-1.5 w-1.5 rounded-full bg-neg" />
            )}
          </button>

          {bellOpen && (
            <div
              id={bellPanelId}
              role="group"
              aria-label={t("notifications")}
              className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-line bg-card overflow-hidden"
            >
              {/* 头部 */}
              <div className="flex items-center justify-between border-b border-line-soft px-4 py-2">
                <span className="text-sm font-semibold text-ink">{t("notifications")}</span>
                {unread > 0 && (
                  <span className="font-sans text-xs text-ink-40">{t("unread", { count: unread })}</span>
                )}
              </div>

              {/* 列表 */}
              {alerts.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="font-sans text-xs text-ink-40">{t("noAlerts")}</div>
                </div>
              ) : (
                <div>
                  {alerts.map((a, idx) => (
                    <div
                      key={a.id}
                      className={`flex items-start gap-2 px-4 py-3 hover:bg-line-soft ${
                        idx !== alerts.length - 1 ? "border-b border-line-soft" : ""
                      }`}
                    >
                      <span className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${alertDotColor[a.level]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-sans text-xs text-ink leading-snug">{alertText(a.title, locale)}</div>
                        <div className="mt-0.5 font-sans text-xs text-ink-40">
                          {a.domain ?? "—"} · {formatRelativeTime(a.created_at, locale, tc)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 底部操作 */}
              <div className="flex items-center justify-between border-t border-line-soft px-4 py-2">
                {unread > 0 ? (
                  <button
                    onClick={handleMarkAllRead}
                    className="font-sans text-xs text-ink-60 hover:text-ink"
                  >
                    {t("markAllRead")}
                  </button>
                ) : (
                  <span className="font-sans text-xs text-ink-40">{t("allRead")}</span>
                )}
                <Link
                  href="/app"
                  onClick={() => setBellOpen(false)}
                  className="font-sans text-xs text-accent hover:underline"
                >
                  {t("viewAll")}
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* 头像 + 用户菜单 */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-label={displayName}
            className="flex items-center gap-2 rounded p-1 hover:bg-line-soft"
            aria-haspopup="true"
            aria-expanded={userMenuOpen}
            aria-controls={userMenuOpen ? userMenuPanelId : undefined}
          >
            <span className={`rounded px-2 py-0.5 font-mono text-xs font-medium ${entitlementsLoading ? "bg-line-soft text-ink-40" : (PLAN_BADGE_STYLES[currentPlan] ?? PLAN_BADGE_STYLES.free)}`}>
              {entitlementsLoading ? "…" : planLabel(currentPlan, locale)}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-semibold text-card">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </button>

          {userMenuOpen && (
            <div
              id={userMenuPanelId}
              role="group"
              aria-label={t("menu")}
              className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-line bg-card overflow-hidden"
            >
              <div className="border-b border-line-soft px-4 py-2">
                <p className="font-sans text-sm font-medium text-ink truncate">
                  {displayName}
                </p>
                <p className="font-mono text-xs text-ink-40 truncate">
                  {email}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 font-mono text-xs font-medium ${entitlementsLoading ? "bg-line-soft text-ink-40" : (PLAN_BADGE_STYLES[currentPlan] ?? PLAN_BADGE_STYLES.free)}`}>
                    {entitlementsLoading ? "…" : planLabel(currentPlan, locale)}
                  </span>
                  {(currentPlan === "free" || currentPlan === "lite") && (
                    <span className="font-mono text-xs text-ink-40">{t("upgradeHint")}</span>
                  )}
                </div>
              </div>
              <div className="border-b border-line-soft py-1">
                <Link
                  href="/app/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2 font-sans text-sm text-ink-60 transition-colors duration-150 hover:bg-line-soft hover:text-ink"
                >
                  {t("settings")}
                </Link>
                <Link
                  href="/pricing"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2 font-sans text-sm text-ink-60 transition-colors duration-150 hover:bg-line-soft hover:text-ink"
                >
                  {t("pricing")}
                </Link>
                <Link
                  href="/docs"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2 font-sans text-sm text-ink-60 transition-colors duration-150 hover:bg-line-soft hover:text-ink"
                >
                  {t("docs")}
                </Link>
              </div>
              {isGuest ? (
                <Link
                  href="/login"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2 font-sans text-sm text-ink-60 hover:bg-line-soft transition-colors duration-150"
                >
                  {t("login")}
                </Link>
              ) : isAuthEnabled ? (
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 font-sans text-sm text-ink-60 hover:bg-line-soft transition-colors duration-150"
                >
                  {t("logout")}
                </button>
              ) : (
                <div className="px-4 py-2 font-sans text-xs text-ink-40">
                  {t("demoMode")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
