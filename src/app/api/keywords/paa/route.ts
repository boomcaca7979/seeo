// ===== /api/keywords/paa =====
// PAA 深度展开端点（P7）：用户在 PAA 列表中对带 next_page_token 的问题点击「继续展开」
// 时触发。token 必须来自 SerpApi 真实响应（google 搜索的 related_questions[].next_page_token），
// 本端点绝不接受构造/猜测的 token 之外的任何快捷方式；缓存与配额在 serp-service 单点完成，
// 一次调用 = 1 个 serpapi 配额单位；新问题由调用方以 paa 来源并入统一发现表。

import { NextResponse } from "next/server";
import { expandPaaQuestions, getSerpUsage } from "@/lib/seo/serp-service";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return badParams("请求体格式错误，需要 JSON");
  }
  const token = (body.token ?? "").trim();
  if (!token) return badParams("token 不能为空（该问题没有可继续展开的分支）");

  try {
    const result = await expandPaaQuestions(userId, plan, token);
    return NextResponse.json({ data: result, usage: await getSerpUsage(userId, plan) });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}
