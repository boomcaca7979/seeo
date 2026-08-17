// ===== 项目选择器共享逻辑（client-safe）=====
// 项目 ID 体系说明：
//   - 鉴权模式：Supabase projects.id（UUID string）——前端 selector / localStorage / 事件统一使用
//   - 演示模式：SQLite projects.id（整数，以 string 传递）
// 注意：本文件会被 client component（Topbar/competitors）导入，禁止引入 server-only 依赖。
// UUID → SQLite 整数 id 的解析请使用 server-only 的 @/lib/project-ref。

/** localStorage key：当前选中的项目 id（string） */
export const SELECTED_PROJECT_KEY = "seeo:selected-project-id";

/** 自定义事件：Topbar 切换项目时通知同 tab 的其他页面（payload: { id: string }） */
export const PROJECT_CHANGED_EVENT = "seeo:project-changed";

/**
 * 校验 localStorage 中恢复的项目 id 是否为当前项目列表中的合法 id。
 * 不合法（含旧版本遗留的 "0"/"123" 等数字 id、已删除项目、跨账号残留）返回 null，
 * 由调用方 fallback 到列表第一个项目。绝不 Number()/parseInt() 转换，避免 NaN。
 */
export function validStoredProjectId(stored: string | null, validIds: string[]): string | null {
  if (!stored) return null;
  return validIds.includes(stored) ? stored : null;
}
