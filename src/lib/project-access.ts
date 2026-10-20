// ===== 项目归属读取：详情页与 proxy 共用的唯一判据 =====
// /app/projects/<id> 的「不存在」有两个消费点，必须给出同一个答案：
//   1. proxy：文档请求要在首个服务器响应之前进入 404 路由。页面里 notFound() 在动态
//      渲染下只能得到 Next 的 __next_error__ 错误壳（<html> 无 lang、body 为空、
//      robots 出现两份），正文要等 hydration 才有；segment-level not-found 只有在
//      流式渲染下才输出完整文档，而那会把状态码变回 200。所以路由级判定是这里
//      唯一能同时满足「HTTP 404 + 首屏 lang + 可读正文 + 单一 robots」的位置。
//   2. 页面：站内点击（RSC 导航）渲染 NotFoundPanel（与 (dashboard)/app/not-found.tsx
//      同一份文案）。这里不调 notFound()：它会触发 Next 内部 boundary 的
//      <meta name="robots" content="noindex"> 注入，与 (default) layout 的
//      noindex, follow 叠成两条 robots。
// 两处若各写一套查询，同一 URL 在「直接输入」与「站内点击进入」下会给出不同结果，
// 而且此前页面把 Supabase 报错读成 data === null，等于把数据库故障降级成 404。
//
// 三条不可妥协的语义：
//   1. 只有数据源明确回答「这个 user_id 名下没有这条 id」才算 missing（→ 404）。
//   2. 连接失败 / 查询报错 / 返回结构异常一律抛 ProjectDataUnavailableError，
//      由调用方决定呈现方式，绝不折算成 404（否则故障会把真实项目抹成不存在）。
//   3. 归属条件写进查询本身（eq user_id / SQL WHERE user_id = ?），不靠 RLS 单独兜底；
//      越权 id 与不存在的 id 得到同一个 404，不泄露「别人的项目是否存在」。

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectById } from "@/lib/db";
import type { DatabaseProject } from "@/lib/types";

/** 演示模式的固定用户 id（与 demo 分支写入 projects.user_id 的值一致） */
export const DEMO_USER_ID = "demo-user";

export type ProjectOwnership =
  | { status: "owned"; project: DatabaseProject }
  | { status: "missing" };

/** 数据源不可用（连不上、查询被拒、结构变化）——与「确实没有这条记录」是两回事 */
export class ProjectDataUnavailableError extends Error {
  constructor(reason: string) {
    super(`[project-access] project row read unavailable: ${reason}`);
    this.name = "ProjectDataUnavailableError";
  }
}

export type ProjectSource =
  | { mode: "demo" }
  | { mode: "supabase"; client: SupabaseClient; userId: string };

/**
 * 取「当前身份名下 id 对应的项目行」。
 * demo 库主键是 INTEGER：非正整数一定查不到，直接判 missing，不必打库；
 * 鉴权模式 UUID 不做格式校验（格式合法但不存在同样归 missing）。
 */
export async function readOwnedProject(
  id: string,
  source: ProjectSource
): Promise<ProjectOwnership> {
  if (source.mode === "demo") {
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId <= 0) return { status: "missing" };
    // getAdapter()/查询失败会抛错：那正是「不可用」，向上传递，不能当 missing
    const row = await getProjectById(DEMO_USER_ID, numId);
    if (!row) return { status: "missing" };
    return {
      status: "owned",
      project: {
        id: String(row.id),
        user_id: DEMO_USER_ID,
        name: row.name,
        domain: row.domain,
        created_at: row.created_at,
        updated_at: row.created_at,
      },
    };
  }

  const { client, userId } = source;
  // maybeSingle 而不是 single：0 行时 data === null 且 error === null；
  // single() 会把「没查到」也写成 error.code === 'PGRST116'，按 error 判故障时
  // 就无法区分故障与缺失（正是被修掉的降级路径）。
  const { data, error } = await client
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new ProjectDataUnavailableError(
      `supabase projects read: code=${error.code ?? "unknown"} ${error.message ?? ""}`.trim()
    );
  }
  if (!data) return { status: "missing" };
  return { status: "owned", project: data as DatabaseProject };
}

/**
 * 文档路径 → 项目 id（只认 `/app/projects/<id>` 这一段，query 不参与）。
 * 其它路径返回 null，调用方不必再自己拼 pathname 规则。
 */
export function projectIdFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 3) return null;
  const [first, second, id] = segments;
  if (first !== "app" || second !== "projects" || !id) return null;
  return id;
}
