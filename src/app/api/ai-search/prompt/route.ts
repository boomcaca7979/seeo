// ===== /api/ai-search/prompt =====
// POST：Prompt Explorer（P0-03-B AiSearchService.aiPromptExplore）
//   - body: { project_id, prompt, models?, highlight_brand?, web_search?, country_code? }
//   - model 白名单（chat_gpt:gpt-5 / perplexity:sonar-pro，Verified 2026-08-29）派发前校验
//   - 1 unit = 1 模型响应；响应 7 天缓存；run 摘要持久化（答案只存 ≤1200 字符摘要）

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import {
  aiPromptExplore,
  AiSearchInputError,
  AI_PROMPT_MODELS,
  type AiPromptModel,
} from "@/lib/seo/ai-search-service";
import { mapAiSearchError } from "@/lib/seo/ai-search-api-helpers";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "AI Search 需要登录 SeeO 账号", code: "AI_SEARCH_NOT_AVAILABLE_ON_PLAN" }, { status: 403 });
  }
  const userId = auth.user.id;
  let body: {
    project_id?: string | number;
    prompt?: string;
    models?: string[];
    highlight_brand?: string;
    web_search?: boolean;
    country_code?: string;
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
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt 不能为空", code: "BAD_REQUEST" }, { status: 400 });
  }
  const models = Array.isArray(body.models)
    ? body.models.map((m) => String(m)).filter((m): m is AiPromptModel => m in AI_PROMPT_MODELS)
    : undefined;

  try {
    const result = await aiPromptExplore({
      userId,
      plan: auth.plan,
      projectId,
      prompt,
      ...(models && models.length > 0 ? { models } : {}),
      ...(body.highlight_brand ? { highlightBrand: body.highlight_brand } : {}),
      ...(body.web_search !== undefined ? { webSearch: body.web_search === true } : {}),
      ...(body.country_code ? { countryCode: body.country_code } : {}),
    });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AiSearchInputError) {
      return NextResponse.json({ error: e.message, code: "BAD_REQUEST" }, { status: 400 });
    }
    return mapAiSearchError(e);
  }
}
