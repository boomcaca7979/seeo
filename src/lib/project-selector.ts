// ===== 项目选择器共享逻辑（client-safe）=====
// 项目 ID 体系说明：
//   - 鉴权模式：Supabase projects.id（UUID string）——前端 selector / localStorage / 事件统一使用
//   - 演示模式：SQLite projects.id（整数，以 string 传递）
// 注意：本文件会被 client component（Topbar/competitors）导入，禁止引入 server-only 依赖。
// UUID → SQLite 整数 id 的解析请使用 server-only 的 @/lib/project-ref。

/** localStorage key：当前选中的项目 id（string） */
export const SELECTED_PROJECT_KEY = "seeo:selected-project-id";

/** 自定义事件：项目上下文变化时通知同 tab 的其他页面（payload: { id: string; source }） */
export const PROJECT_CHANGED_EVENT = "seeo:project-changed";

/**
 * 事件来源：
 *   - user    Topbar 里用户主动点了另一个项目（唯一应当改变页面数据范围的事件）
 *   - init    Topbar 挂载时恢复持久化选中项（只是"当前活跃项目是谁"的广播）
 *   - context 页面按自己的事实（如 URL 的 ?domain=、项目详情页）设定活跃项目
 * 区分来源是为了让「页面自己写回上下文」不会被误读成「用户又切了一次项目」，
 * 从而不再依赖事件到达顺序的基线猜测。
 */
export type ProjectChangedSource = "user" | "init" | "context";

/** 事件 payload（监听方只读 id 时向后兼容，source 为可选新增字段） */
export interface ProjectChangedDetail {
  id: string;
  source?: ProjectChangedSource;
}

/** 读取事件 payload；id 非法（缺失/非 string/空）返回 null */
export function projectChangedDetail(e: Event): ProjectChangedDetail | null {
  const detail = (e as CustomEvent<ProjectChangedDetail>).detail;
  if (!detail || typeof detail.id !== "string" || !detail.id) return null;
  return detail;
}

/**
 * 校验 localStorage 中恢复的项目 id 是否为当前项目列表中的合法 id。
 * 不合法（含旧版本遗留的 "0"/"123" 等数字 id、已删除项目、跨账号残留）返回 null，
 * 由调用方 fallback 到列表第一个项目。绝不 Number()/parseInt() 转换，避免 NaN。
 */
export function validStoredProjectId(stored: string | null, validIds: string[]): string | null {
  if (!stored) return null;
  return validIds.includes(stored) ? stored : null;
}

/**
 * 把指定项目设为「当前活跃项目」——与 Topbar 切换器等价的写入路径。
 * 供项目维度的页面（详情页、带 ?domain= 范围参数的页面）使用，保证进入这些页面时
 * Topbar、localStorage 与其他页面读到的是同一个项目，而不是之前选中的另一个项目。
 * 派发事件对已同步的监听方是幂等的（各自按 id 相等短路），重复调用安全。
 * source 默认 "context"：页面自己写回上下文，不应被其他页面当成用户主动切换。
 */
export function setActiveProject(id: string, source: ProjectChangedSource = "context"): void {
  if (typeof window === "undefined" || !id) return;
  try {
    window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
  } catch {
    // localStorage 不可用（隐私模式）：仍派发事件，同 tab 页面本次会话内保持一致
  }
  window.dispatchEvent(new CustomEvent<ProjectChangedDetail>(PROJECT_CHANGED_EVENT, { detail: { id, source } }));
}
