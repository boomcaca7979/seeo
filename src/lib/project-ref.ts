// ===== 项目引用解析（server-only）=====
// 将前端传入的项目引用（SQLite 整数 id 字符串 或 Supabase UUID）解析为 SQLite 内部整数项目 id。
// 仅供 API route 使用；禁止被 client component 导入（依赖 supabase server client）。

import { getProjectByDomain } from "@/lib/db";
import { isAuthEnabled } from "@/lib/auth-config";

/**
 * 解析失败（UUID 不存在 / SQLite 无对应记录）返回 null。
 */
export async function resolveSqliteProjectId(userId: string, ref: string): Promise<number | null> {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  // 演示模式（或旧调用）：纯数字 → SQLite 整数 id 直传
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  // 鉴权模式：Supabase UUID → 查 domain → SQLite 反查整数 id
  if (!isAuthEnabled) return null;
  const { createServer } = await import("@/lib/supabase/server");
  const supabase = await createServer();
  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", trimmed)
    .eq("user_id", userId)
    .single();
  if (!project?.domain) return null;
  const sqliteProject = await getProjectByDomain(userId, project.domain);
  return sqliteProject?.id ?? null;
}
