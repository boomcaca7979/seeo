"use client";

// ===== 全局「当前项目」上下文（控制台唯一的项目真源）=====
//
// 为什么需要它（2026-10 修复）：
//   此前「当前项目」只存在于 Topbar 的局部 state + localStorage + 自定义事件里。
//   结果是两类页面各走一套：
//     1. 不订阅事件的页面（审计/内容/外链/排名检查/关键词扩展）→ 顶部切了也不变；
//     2. 各页面自己去 fetch /api/projects 兜底「第一个项目」→ 与顶部选择不一致，
//        而且同一份列表在一次渲染里被取 2~4 次。
//
// 本 Provider 的做法（不推翻既有架构）：
//   - 传输层保持不变：localStorage(SELECTED_PROJECT_KEY) + PROJECT_CHANGED_EVENT，
//     所以 competitors/reports/actions/opportunities/position-tracking 无需改动即可继续工作；
//   - 语义集中到一处：projects 列表、activeId、activeDomain 只在这里解析一次；
//   - Topbar / DomainSelect / 项目相关页面都从这里读，不再各自取列表、各自猜默认项目。
//
// 边界（刻意不做的事）：
//   - 不把当前项目写进 URL：切换项目不是导航，URL 里只保留"子对象范围"（如 ?domain=）；
//   - 不做长缓存：列表只在本次挂载内共享，项目增删由 PROJECTS_CHANGED_EVENT 显式失效；
//   - 不改变任何服务端权限判定：所有数据请求仍由各自 API 按 userId 校验归属。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PROJECT_CHANGED_EVENT,
  PROJECTS_CHANGED_EVENT,
  SELECTED_PROJECT_KEY,
  loadProjectList,
  projectChangedDetail,
  setActiveProject as writeActiveProject,
  validStoredProjectId,
  type ProjectListEntry,
} from "@/lib/project-selector";

export interface ActiveProjectValue {
  /** 当前账号的项目列表（id 为 string） */
  projects: ProjectListEntry[];
  /** 列表是否仍在加载 */
  loading: boolean;
  /** 列表加载失败（≠ 没有项目） */
  failed: boolean;
  /** 当前选中项目 id（无项目 / 未就绪时为 null） */
  activeId: string | null;
  /** 当前选中项目对应的域名（无有效项目时为 ""） */
  activeDomain: string;
  activeProject: ProjectListEntry | null;
  /** 用户主动切换：写 localStorage 并广播 source:"user"（等价于顶部下拉点击） */
  setActive: (id: string) => void;
  /** 重新拉取列表（force 用于下拉打开/重试/项目增删后） */
  reload: (options?: { force?: boolean }) => Promise<void>;
}

const ActiveProjectContext = createContext<ActiveProjectValue | null>(null);

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function ActiveProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // loading 只表示「首次解析尚未完成」。下拉打开触发的强制刷新（reload({force:true})）
  // 不得把 loading 翻回 true：否则各页面会按 loading 卸载/重挂项目选择器，出现闪动。
  const initializedRef = useRef(false);

  const reload = useCallback(async (options?: { force?: boolean }) => {
    if (!initializedRef.current) setLoading(true);
    try {
      const result = await loadProjectList({ force: options?.force });
      if (!result.ok) {
        setFailed(true);
        setProjects([]);
        setActiveId(null);
        return;
      }
      setFailed(false);
      setProjects(result.data);

      const storedId = validStoredProjectId(readStoredId(), result.data.map((p) => p.id));
      // 用户已有有效选择时保持不动（下拉刷新/列表重取不得把人打回第一个项目）；
      // 仅在「没有有效选择」时回落到第一个项目，并把回落结果持久化。
      setActiveId((prev) => {
        if (prev && result.data.some((p) => p.id === prev)) return prev;
        return storedId ?? result.data[0]?.id ?? null;
      });

      const initialId = storedId ?? result.data[0]?.id ?? null;
      if (!storedId && initialId) {
        // 回落结果持久化：下次挂载仍从同一个项目开始（与旧 Topbar 行为一致）
        try {
          window.localStorage.setItem(SELECTED_PROJECT_KEY, initialId);
        } catch {
          // 隐私模式：仅本会话内存态生效
        }
      }
      // 兼容既有订阅方（competitors/reports/actions/opportunities/position-tracking）：
      // 它们只监听事件、不认识 Provider，这里继续按原契约广播"当前活跃项目是谁"。
      if (initialId) writeActiveProject(initialId, "init");
    } catch {
      setFailed(true);
      setProjects([]);
      setActiveId(null);
    } finally {
      initializedRef.current = true;
      setLoading(false);
    }
  }, []);

  // 首次挂载取一次；之后由事件驱动（切项目不重取列表，列表变化才重取）
  // 延迟一拍再取：effect 同步体内 setState 会触发级联渲染（仓库 lint 规则禁止）
  useEffect(() => {
    const id = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(id);
  }, [reload]);

  useEffect(() => {
    const onProjectChanged = (e: Event) => {
      const detail = projectChangedDetail(e);
      if (detail) setActiveId(detail.id);
    };
    // 跨 tab：另一个标签页切了项目，本页跟上（与 competitors 的既有行为一致）。
    // 走 writeActiveProject("user") 而不是只改本地 state：同步概况范围 cookie +
    // 广播 PROJECT_CHANGED_EVENT，让概况页等监听方与顶部选择保持同一范围
    // （localStorage 同值写入不会再触发 storage 事件，无跨 tab 回环）。
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SELECTED_PROJECT_KEY) return;
      const stored = readStoredId();
      if (stored) {
        setActiveId(stored);
        writeActiveProject(stored, "user");
      }
    };
    const onProjectsChanged = () => {
      void reload({ force: true });
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
    window.addEventListener("storage", onStorage);
    window.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
    return () => {
      window.removeEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
    };
  }, [reload]);

  const setActive = useCallback((id: string) => {
    if (!id) return;
    setActiveId(id);
    writeActiveProject(id, "user");
  }, []);

  const activeProject = useMemo(
    () => (activeId ? projects.find((p) => p.id === activeId) ?? null : null),
    [projects, activeId],
  );

  const value = useMemo<ActiveProjectValue>(
    () => ({
      projects,
      loading,
      failed,
      activeId,
      activeDomain: activeProject?.domain ?? "",
      activeProject,
      setActive,
      reload,
    }),
    [projects, loading, failed, activeId, activeProject, setActive, reload],
  );

  return <ActiveProjectContext.Provider value={value}>{children}</ActiveProjectContext.Provider>;
}

/** 控制台内使用：Provider 缺失属于接线错误，直接抛错以便尽早发现 */
export function useActiveProject(): ActiveProjectValue {
  const ctx = useContext(ActiveProjectContext);
  if (!ctx) throw new Error("useActiveProject must be used within ActiveProjectProvider");
  return ctx;
}

/**
 * 可选读取：供既可能挂在控制台内、也可能被单独渲染的组件（DomainSelect）使用。
 * 返回 null 时调用方走自己的降级路径，避免为了一个测试/独立用法把 Provider 变成硬依赖。
 */
export function useActiveProjectOptional(): ActiveProjectValue | null {
  return useContext(ActiveProjectContext);
}
