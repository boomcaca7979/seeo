// ===== 项目删除提交守卫（纯函数）=====
// 背景：删除事故中操作方点错卡片后越过弹窗校验误删。本守卫在 handleDelete 发起
// DELETE 前做最后一道格式防线：id/domain 缺失或格式非法时拒绝提交。
// 注意：id 必须是「当前列表渲染时捕获的项目对象」上的 id（鉴权模式 Supabase UUID /
// 演示模式 SQLite 整数字符串），不允许 number（历史 id=0 事故防线）。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// SQLite 自增 id 从 1 开始；"0" 是历史 id=0 事故值，显式排除
const SQLITE_ID_RE = /^[1-9]\d*$/;

export interface DeleteTargetLike {
  id?: unknown;
  domain?: unknown;
}

/**
 * 是否允许对 target 发起 DELETE /api/projects?id=...
 * 要求：id 为合法 UUID string（鉴权模式）或纯数字 string（演示模式），
 * 且 domain 为非空 string。任何 number id（含 0）一律拒绝。
 */
export function canSubmitDelete(target: DeleteTargetLike | null | undefined): boolean {
  if (!target || typeof target !== "object") return false;
  const { id, domain } = target;
  if (typeof id !== "string" || id.length === 0) return false;
  if (!UUID_RE.test(id) && !SQLITE_ID_RE.test(id)) return false;
  if (typeof domain !== "string" || domain.trim().length === 0) return false;
  return true;
}
