// ===== /api/ai-search/history =====
// GET：AI Search run 历史（只读；run 摘要，不含 raw AI answers）
//   - query: project_id, run_type?(brand_lookup|prompt), target?, from?, to?(YYYY-MM-DD), limit?(1-200)

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import { aiSearchRunHistory } from "@/lib/seo/ai-search-service";
import { mapAiSearchError } from "@/lib/seo/ai-search-api-helpers";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "AI Search 需要登录 SeeO 账号", code: "AI_SEARCH_NOT_AVAILABLE_ON_PLAN" }, { status: 403 });
  }
  const userId = auth.user.id;
  const { searchParams } = new URL(req.url);
  const projectRef = (searchParams.get("project_id") ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效", code: "INVALID_PROJECT_ID" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(userId, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const project = await getProjectById(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }

  const runType = (searchParams.get("run_type") ?? "").trim();
  if (runType && runType !== "brand_lookup" && runType !== "prompt") {
    return NextResponse.json({ error: "run_type 必须是 brand_lookup 或 prompt", code: "BAD_REQUEST" }, { status: 400 });
  }
  const from = (searchParams.get("from") ?? "").trim();
  const to = (searchParams.get("to") ?? "").trim();
  if ((from && !DATE_PATTERN.test(from)) || (to && !DATE_PATTERN.test(to))) {
    return NextResponse.json({ error: "from/to 日期格式必须为 YYYY-MM-DD", code: "BAD_REQUEST" }, { status: 400 });
  }
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 200) {
    return NextResponse.json({ error: "limit 必须是 1-200", code: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    const runs = await aiSearchRunHistory(userId, {
      projectId,
      ...(runType ? { runType } : {}),
      ...(searchParams.get("target") ? { target: (searchParams.get("target") as string).trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit: limitRaw,
    });
    return NextResponse.json({ data: { runs } });
  } catch (e) {
    return mapAiSearchError(e);
  }
}
