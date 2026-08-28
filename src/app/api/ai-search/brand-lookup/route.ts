// ===== /api/ai-search/brand-lookup =====
// POST：Brand Lookup（P0-03-B AiSearchService.aiBrandLookup）
//   - body: { project_id, target, competitors?, location_code?, language_code? }
//   - 授权链路：user → project（resolveSqliteProjectId + getProjectById）
//   - 配额：consumeQuota("dataforseo")，1 unit = 1 平台扇出批次；免费套餐（limit=0）→ 429
//   - run 摘要持久化到 ai_search_runs

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import { aiBrandLookup, AiSearchInputError } from "@/lib/seo/ai-search-service";
import { mapAiSearchError } from "@/lib/seo/ai-search-api-helpers";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 平台扇出（2 平台 × 3 调用 + 竞品对比）上游最长 120s/任务
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    // demo 模式禁止触达真实付费 provider
    return NextResponse.json({ error: "AI Search 需要登录 SeeO 账号", code: "AI_SEARCH_NOT_AVAILABLE_ON_PLAN" }, { status: 403 });
  }
  const userId = auth.user.id;
  let body: {
    project_id?: string | number;
    target?: string;
    competitors?: string[];
    location_code?: number;
    language_code?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
  }

  const projectRef = String(body.project_id ?? "").trim();
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
  const target = (body.target ?? "").trim();
  if (!target) {
    return NextResponse.json({ error: "target 不能为空", code: "BAD_REQUEST" }, { status: 400 });
  }
  if (body.location_code !== undefined && !Number.isInteger(body.location_code)) {
    return NextResponse.json({ error: "location_code 必须是整数", code: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    const result = await aiBrandLookup({
      userId,
      plan: auth.plan,
      projectId,
      target,
      ...(Array.isArray(body.competitors) ? { competitors: body.competitors.map((c) => String(c)) } : {}),
      ...(body.location_code !== undefined ? { locationCode: body.location_code } : {}),
      ...(body.language_code ? { languageCode: body.language_code } : {}),
    });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AiSearchInputError) {
      return NextResponse.json({ error: e.message, code: "BAD_REQUEST" }, { status: 400 });
    }
    return mapAiSearchError(e);
  }
}
