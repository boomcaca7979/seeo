// ===== /api/keywords/suggestions =====
// Google Autocomplete 建议词 API：用户在关键词研究页显式点击「获取更多建议」时触发。
// 与 /api/keywords/expand（分析主流程）分离：本路由绝不自动调用，每次真实引擎调用
// 消耗 1 个 serpapi 配额单位；同关键词/市场/语言 24h 缓存命中时零消耗。
// 去重与归一使用 keyword-merge 的单一实现（与 expand 合并同一口径）。

import { NextResponse } from "next/server";
import { getSerpUsage, fetchKeywordSuggestions } from "@/lib/seo/serp-service";
import { dedupeKeywordList } from "@/lib/seo/keyword-merge";
import { resolveSerpMarket } from "@/lib/seo/serpapi";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SuggestionsResponse {
  seed: string;
  location: string;
  language: string;
  /** 已去重后的建议词（Google 返回原文，保留大小写） */
  suggestions: string[];
  fromCache: boolean;
  /** 所选市场无精确映射时 true——定位可能与预期不符，由 UI 明示而非静默 */
  marketFallback: boolean;
}

function badParams(msg: string) {
  return NextResponse.json<SeoApiError>({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  let body: { seed?: string; location?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return badParams("请求体格式错误，需要 JSON");
  }

  const seed = (body.seed ?? "").trim();
  const location = (body.location ?? "中国").trim();
  const language = typeof body.language === "string" ? body.language.trim() : undefined;

  if (!seed) return badParams("seed 不能为空");

  try {
    const result = await fetchKeywordSuggestions(userId, plan, {
      keyword: seed,
      location,
      ...(language ? { language } : {}),
    });
    const resp: SuggestionsResponse = {
      seed: result.seed,
      location: result.location,
      language: result.language,
      suggestions: dedupeKeywordList(result.suggestions),
      fromCache: result.fromCache,
      marketFallback: resolveSerpMarket(location).fallback,
    };
    return NextResponse.json({ data: resp, usage: await getSerpUsage(userId, plan) });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}
