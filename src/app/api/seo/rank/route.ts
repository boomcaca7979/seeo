// ===== /api/seo/rank =====
// 服务端路由：查某域名在某关键词 SERP 前 100 名中的真实位置

import { NextResponse } from "next/server";
import { searchRank } from "@/lib/seo/serp-service";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import { peekUsage } from "@/lib/seo/cache";
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
  const domain = (searchParams.get("domain") ?? "").trim();
  const location = (searchParams.get("location") ?? "中国").trim();
  const device = (searchParams.get("device") ?? "PC").trim() as "PC" | "移动端";

  if (!keyword) return badParams("keyword 参数不能为空");
  if (!domain) return badParams("domain 参数不能为空");
  if (device !== "PC" && device !== "移动端") return badParams("device 必须是 PC 或 移动端");

  const params = { keyword, domain, location, device };

  // P0-02-D：缓存与计费统一在 serp-service.searchRank（rank 命名空间，provider 版本 + language 参与 key）
  try {
    const { result, fromCache } = await searchRank(userId, plan, params);
    return NextResponse.json({
      data: { ...result, fromCache },
      usage: await peekUsage(userId, "serpapi", plan),
    });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}
