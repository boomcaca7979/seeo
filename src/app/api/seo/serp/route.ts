// ===== /api/seo/serp =====
// 服务端路由，调用 SerpApi，带缓存和用量保护
// 关键词 SERP Top 10 + 相关搜索 + 相关问题

import { NextResponse } from "next/server";
import { getSerpUsage, searchSerp, summarizeSerp } from "@/lib/seo/serp-service";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badParams(msg: string) {
  return NextResponse.json<SeoApiError>({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const { searchParams } = new URL(req.url);
  const keyword = (searchParams.get("keyword") ?? "").trim();
  const location = (searchParams.get("location") ?? "中国").trim();
  const device = (searchParams.get("device") ?? "PC").trim() as "PC" | "移动端";
  // P0-02-B 新增（可选）：SerpApi hl 语言码；缺省行为不变（zh-cn）
  const languageRaw = (searchParams.get("language") ?? "").trim();

  if (!keyword) return badParams("keyword 参数不能为空");
  if (device !== "PC" && device !== "移动端") return badParams("device 必须是 PC 或 移动端");

  const params = {
    keyword,
    location,
    device,
    ...(languageRaw ? { language: languageRaw } : {}),
  };

  try {
    const { result } = await searchSerp(userId, plan, params);
    // summary 为 P0-02-B 新增字段；既有 data.* 字段全部原样保留
    return NextResponse.json({
      data: { ...result, summary: summarizeSerp(result) },
      usage: await getSerpUsage(userId, plan),
    });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}
