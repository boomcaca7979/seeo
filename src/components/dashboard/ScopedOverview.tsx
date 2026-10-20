"use client";

// ===== /app 概况页的数据范围边界（当前项目 ⇄ 全部项目）=====
//
// 为什么需要它（2026-10 单项目范围修复）：
//   此前 /app 概况页在服务端对**全部项目**做聚合（getWorkspaceDashboard 传所有项目），
//   而顶部选择器只改变客户端状态 —— 结果是顶部选着 www.toolstep.top，概况却显示
//   seeo.asia 的 96 分和技术问题（跨项目汇总冒充当前项目）。
//
// 本组件的做法（不推翻既有架构）：
//   - SSR 仍由 page.tsx 按范围 cookie 渲染初始数据（首次加载 / 刷新后恢复都不闪错数据）；
//   - 范围变化（顶部切项目、点「全部项目」）时向 /api/app/dashboard 取**该范围自己的**
//     服务端聚合结果 —— 数据本身属于当前范围，不是把别的卡片藏起来；
//   - 序号（seq）防竞态：旧请求晚于新请求返回时直接丢弃，最终展示的数据一定属于
//     最后选中的范围；
//   - 取数状态是**派生值**（loadedFor ≠ scope 即在取数）而不是 effect 里 setState，
//     遵守仓库 react-hooks/set-state-in-effect 规则；取数期间显示骨架屏
//     （不把旧项目数据冒充新项目，也不把加载中伪装成零值）；
//     失败记录 errorFor（按范围记忆），显示可重试错误态，绝不回退成其他范围的数据。
//
// 边界：
//   - 切换范围不导航（URL 不变），复用 WorkspaceHeader / WorkspaceDashboard /
//     GrowthOpportunityPanel，无 UI 重设计；
//   - 「我的项目」列表（ProjectList）仍是跨项目区块，保持原样；
//   - 服务端权限判定全部在 /api/app/dashboard 内完成，本组件不处理授权。

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import WorkspaceHeader from "@/components/dashboard/WorkspaceHeader";
import WorkspaceDashboard from "@/components/dashboard/WorkspaceDashboard";
import GrowthOpportunityPanel from "@/components/dashboard/GrowthOpportunityPanel";
import { useActiveProject } from "@/components/dashboard/ActiveProjectContext";
import {
  PROJECT_CHANGED_EVENT,
  projectChangedDetail,
  setOverviewScope,
  sameOverviewScope,
  type OverviewScope,
} from "@/lib/project-selector";
import type { WorkspaceOverviewData } from "@/lib/seo/workspace-overview";
import type { WorkspaceActionSummary } from "@/lib/seo/work-queue";

export interface ScopedOverviewProps {
  /** SSR 初始范围（page.tsx 按范围 cookie 解析；cookie 非法时为 all） */
  initialScope: OverviewScope;
  /** 与 initialScope 对应的 SSR 初始数据（绝不允许 scope 与数据错配） */
  initialOverview: WorkspaceOverviewData;
  initialActionSummary: WorkspaceActionSummary;
  displayName: string;
  /** 全部项目数量（「全部项目」模式头部统计用） */
  totalProjects: number;
  /** 未读预警数（用户级入口，不随项目范围变化） */
  unreadAlertCount: number;
}

export default function ScopedOverview({
  initialScope,
  initialOverview,
  initialActionSummary,
  displayName,
  totalProjects,
  unreadAlertCount,
}: ScopedOverviewProps) {
  const tw = useTranslations("dashboard.workspace");
  const { activeId, activeDomain, loading: contextLoading, failed: contextFailed } = useActiveProject();

  /**
   * 范围模式："follow" = 跟随顶部当前项目（默认）；"all" = 全部项目汇总。
   *
   * 2026-10-20 修复（真实会话 FAIL 的根因）：mode 此前按 SSR cookie 初始化——
   * 老用户 localStorage 已有当前项目但没有范围 cookie，SSR 回退 all → mode 被固定为
   * "all"，顶部解析出 toolstep 也不生效，必须手动点「当前项目」才能进入单项目模式。
   * 现在 mode 一律从 "follow" 开始：「打开概况时优先使用顶部当前已选择的具体项目」；
   * 「全部项目」只能是用户在本次访问中显式点击的选择，不按 SSR 初值继承。
   *
   * 有效范围是渲染期**纯派生值**（不用 effect/ref 同步，遵守仓库 react-hooks 规则）：
   *   - follow + 上下文就绪 → 当前项目；
   *   - follow + 上下文未就绪/失败 → 保持 SSR 初始范围（顶部此刻也没有有效选择，
   *     两边一致；上下文恢复后自动跟随）；
   *   - all → 全部项目。
   */
  const [mode, setMode] = useState<"follow" | "all">("follow");
  const contextReady = !contextLoading && !contextFailed;
  const scope: OverviewScope = useMemo(() => {
    if (mode === "all") return { kind: "all" };
    if (contextReady && activeId) return { kind: "project", id: activeId };
    return initialScope;
  }, [mode, contextReady, activeId, initialScope]);

  const [overview, setOverview] = useState<WorkspaceOverviewData>(initialOverview);
  const [actionSummary, setActionSummary] = useState<WorkspaceActionSummary>(initialActionSummary);
  /** 已持有数据对应的范围（SSR 初始数据属于 initialScope） */
  const [loadedFor, setLoadedFor] = useState<OverviewScope>(initialScope);
  /** 取数失败的范围（按范围记忆；对其他范围不影响）。null = 当前无失败 */
  const [errorFor, setErrorFor] = useState<OverviewScope | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const seqRef = useRef(0);

  const canScopeProject = contextReady && activeId !== null;
  // 派生状态：范围已持有数据 → 直接显示；否则若该范围无失败记录 → 取数中
  const isLoaded = sameOverviewScope(loadedFor, scope);
  const hasError = errorFor !== null && sameOverviewScope(errorFor, scope);
  const syncing = !isLoaded && !hasError;

  // 顶部选择决定当前项目上下文：用户切项目（Topbar source="user"）或页面写回上下文
  // （source="context"）时，即使处于「全部项目」模式也自动切回当前项目模式。
  // source="init"（挂载时恢复广播）与跨 tab 列表刷新不打断用户显式选择的「全部项目」。
  // setState 位于事件回调（异步语义），不在 effect 同步体内，符合仓库 react-hooks 规则。
  useEffect(() => {
    const onProjectChanged = (e: Event) => {
      const detail = projectChangedDetail(e);
      if (detail && (detail.source === "user" || detail.source === "context")) {
        setMode("follow");
      }
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
    return () => window.removeEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
  }, []);

  // 范围变化 → 取该范围自己的数据。seq 丢弃过期响应（旧请求晚于新请求返回不覆盖新数据）。
  // setState 只出现在异步回调里；effect 同步体只做 cookie 同步与发起请求（外部系统）。
  useEffect(() => {
    // 范围 cookie 只跟踪「当前项目」：刷新 / 下次打开概况时 SSR 从顶部当前项目开始。
    // 「全部项目」是本次访问内的显式选择，不落 cookie —— 避免 SSR all 初值把 mode
    // 钉死在跨项目模式（2026-10-20 真实会话 FAIL 的根因之一），也避免与上下文
    // 初始化写的项目 id 拉锯。
    if (scope.kind === "project") setOverviewScope(scope.id);
    if (sameOverviewScope(loadedFor, scope)) return;

    const seq = ++seqRef.current;
    const params = new URLSearchParams();
    if (scope.kind === "all") params.set("scope", "all");
    else params.set("projectId", scope.id);

    fetch(`/api/app/dashboard?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
        if (!res.ok || !json?.data) {
          throw new Error(res.status === 404 ? "PROJECT_NOT_FOUND" : "DASHBOARD_FAILED");
        }
        return json.data as { overview: WorkspaceOverviewData; actionSummary: WorkspaceActionSummary };
      })
      .then((payload) => {
        if (seqRef.current !== seq) return; // 旧请求：丢弃
        setOverview(payload.overview);
        setActionSummary(payload.actionSummary);
        setLoadedFor(scope);
        setErrorFor(null);
      })
      .catch(() => {
        if (seqRef.current !== seq) return; // 旧请求：丢弃
        setErrorFor(scope);
      });
  }, [scope, loadedFor, retryNonce]);

  return (
    <>
      <WorkspaceHeader
        displayName={displayName}
        projectCount={scope.kind === "all" ? totalProjects : 1}
        auditedCount={overview.auditedDomains}
        unreadAlertCount={unreadAlertCount}
        scope={scope.kind}
      />
      <div className="dash-container px-6 pt-6 sm:px-8">
        {/* ---- 范围切换：当前项目（默认）/ 全部项目（显式入口，保留跨项目汇总视图）---- */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tw("scope.aria")}>
          <button
            type="button"
            title={activeDomain || undefined}
            disabled={!canScopeProject}
            aria-pressed={scope.kind === "project"}
            onClick={() => setMode("follow")}
            className={scope.kind === "project" ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
          >
            {tw("scope.current")}
          </button>
          <button
            type="button"
            aria-pressed={scope.kind === "all"}
            onClick={() => setMode("all")}
            className={scope.kind === "all" ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
          >
            {tw("scope.all")}
          </button>
        </div>

        {syncing ? (
          <ScopeSkeleton label={tw("scope.syncing")} />
        ) : hasError ? (
          <ScopeError
            message={tw("scope.error")}
            retryLabel={tw("scope.retry")}
            onRetry={() => {
              setErrorFor(null);
              setRetryNonce((n) => n + 1);
            }}
          />
        ) : (
          <>
            <div className="mt-4">
              <WorkspaceDashboard data={overview} scopeAll={scope.kind === "all"} />
            </div>
            <div className="mt-6">
              <GrowthOpportunityPanel summary={actionSummary} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** 取数中：骨架屏（不显示旧范围数据，也不伪装成零值） */
function ScopeSkeleton({ label }: { label: string }) {
  return (
    <div className="mt-4" aria-busy="true" aria-live="polite">
      <p className="font-sans text-xs text-ink-40">{label}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-a h-24 animate-pulse" />
        ))}
      </div>
      <div className="card-a mt-4 h-64 animate-pulse" />
    </div>
  );
}

/** 取数失败：可重试的诚实错误态（不回退到其他范围的数据） */
function ScopeError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-4" role="alert">
      <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-paper px-4 py-6">
        <p className="font-sans text-sm text-ink-60">{message}</p>
        <button type="button" onClick={onRetry} className="btn-secondary px-3 py-1.5 text-xs">
          {retryLabel}
        </button>
      </div>
    </div>
  );
}
