// ===== 项目选择器共享逻辑（client-safe）=====
// 项目 ID 体系说明：
//   - 鉴权模式：Supabase projects.id（UUID string）——前端 selector / localStorage / 事件统一使用
//   - 演示模式：SQLite projects.id（整数，以 string 传递）
// 注意：本文件会被 client component（Topbar/competitors）导入，禁止引入 server-only 依赖。
// UUID → SQLite 整数 id 的解析请使用 server-only 的 @/lib/project-ref。

/** localStorage key：当前选中的项目 id（string） */
export const SELECTED_PROJECT_KEY = "seeo:selected-project-id";

/**
 * Cookie：/app 概况页服务端渲染的数据范围。
 * 值为当前项目 id（鉴权模式 UUID / 演示模式整数）或 "all"（全部项目汇总）。
 * localStorage 只存在于客户端，服务端读不到；概况页要在 SSR 阶段就渲染出
 * 「当前项目」自己的数据，必须把范围同步写进 cookie（刷新后也靠它恢复）。
 */
export const OVERVIEW_SCOPE_COOKIE = "seeo_overview_scope";

/** 写概况页范围 cookie（client-only；失败静默：cookie 不可用时 SSR 回退全部项目，客户端再纠正） */
function writeOverviewScopeCookie(value: string): void {
  try {
    document.cookie = `${OVERVIEW_SCOPE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // 隐私模式 / cookie 被禁：仅影响下次 SSR 初值，页面数据仍由客户端同步纠正
  }
}

/** 自定义事件：项目上下文变化时通知同 tab 的其他页面（payload: { id: string; source }） */
export const PROJECT_CHANGED_EVENT = "seeo:project-changed";

/**
 * 自定义事件：项目**列表**发生变化（新建/删除）。
 * 与 PROJECT_CHANGED_EVENT 区分：那一个是「当前选中哪个项目」，这一个是「有哪些项目」。
 * 列表变化时必须让共享缓存失效，否则下拉框会漏掉刚建的项目。
 */
export const PROJECTS_CHANGED_EVENT = "seeo:projects-changed";

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
  // 概况页范围与当前项目保持同一真源：任何写回上下文的路径（顶部切换、
  // 项目详情页 context 写回）都同步 cookie，保证刷新后 SSR 从同一项目开始。
  writeOverviewScopeCookie(id);
  window.dispatchEvent(new CustomEvent<ProjectChangedDetail>(PROJECT_CHANGED_EVENT, { detail: { id, source } }));
}

/** 直接写概况页范围 cookie（值：项目 id 或 "all"；供概况页范围切换使用） */
export function setOverviewScope(value: string): void {
  if (typeof document === "undefined") return;
  writeOverviewScopeCookie(value);
}

// ===== 概况页数据范围（client-safe：ScopedOverview 与服务端共用同一套语义）=====
// 注意：放在本文件是因为 workspace-overview.ts 依赖服务端 db 模块，
// client component 一旦从中做值导入就会把 better-sqlite3 拉进浏览器 bundle。

/** 概况页数据范围：当前项目（id）或全部项目汇总 */
export type OverviewScope = { kind: "project"; id: string } | { kind: "all" };

export type OverviewScopeKind = "project" | "all";

/** 两个 scope 是否指向同一范围（值比较，避免对象身份造成多余取数） */
export function sameOverviewScope(a: OverviewScope, b: OverviewScope): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "all" || b.kind === "all" || a.id === b.id;
}

// ===== 项目列表：同一份数据的唯一取数入口 =====
// 背景：Topbar、DomainSelect、审计/报告/操作中心/竞品/位置追踪各自 `fetch("/api/projects")`，
// 而该接口在鉴权模式下要先过 Supabase 查询、再跑 4 条指标查询。
// 同一次页面渲染里有 2~4 个组件同时挂载 → 同一份数据被重复取 2~4 次。
//
// 这里做两件事（都不涉及"当前选中哪个项目"的语义，切换仍走事件）：
//   1. 并发去重：同一 tick 的多方调用共享同一个在途 Promise，只发一次请求；
//   2. 极短 TTL（2s）：只吸收"同一次挂载风暴"，不承担状态同步职责 ——
//      项目增删由 PROJECTS_CHANGED_EVENT 显式失效，用户切项目由 PROJECT_CHANGED_EVENT 广播。
// 刻意不做长缓存：列表过期会让刚创建的项目在下拉框里消失，那才是真正的状态不同步。

/** /api/projects 返回的项目条目（id 统一 string：鉴权模式 UUID / 演示模式整数） */
export interface ProjectListEntry {
  id: string;
  name: string;
  domain: string;
  healthScore: number | null;
}

/** 取数结果：ok=false 表示 HTTP 非 2xx（网络异常仍按原样抛出，调用方保留各自的 catch 分支） */
export interface ProjectListResult {
  ok: boolean;
  data: ProjectListEntry[];
}

const PROJECT_LIST_TTL_MS = 2000;

let listCache: { at: number; result: ProjectListResult } | null = null;
let listInflight: Promise<ProjectListResult> | null = null;

/** 显式失效（项目增删后调用） */
export function invalidateProjectList(): void {
  listCache = null;
  listInflight = null;
}

/**
 * 读取项目列表（并发去重 + 2s TTL）。
 * - force=true：跳过缓存（下拉框打开、重试、项目增删后）
 * - HTTP 非 2xx：返回 { ok:false, data: [] }，不抛错
 * - 网络异常：原样抛出（调用方据此区分"加载失败"与"没有项目"）
 */
export async function loadProjectList(options?: { force?: boolean }): Promise<ProjectListResult> {
  if (options?.force) invalidateProjectList();

  if (listCache && Date.now() - listCache.at < PROJECT_LIST_TTL_MS) {
    return listCache.result;
  }
  if (listInflight) return listInflight;

  const request = (async (): Promise<ProjectListResult> => {
    if (typeof fetch !== "function") return { ok: false, data: [] };
    const res = await fetch("/api/projects", { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const data = Array.isArray(json?.data) ? (json.data as ProjectListEntry[]) : [];
    const result: ProjectListResult = { ok: res.ok, data };
    listCache = { at: Date.now(), result };
    return result;
  })();

  listInflight = request;
  try {
    return await request;
  } finally {
    if (listInflight === request) listInflight = null;
  }
}
