// ===== /api/keywords/trends =====
// Google Trends 数据端点（P4：趋势与相关需求维度）。
// 一个 data_type = 一次独立 SerpApi 引擎调用（TIMESERIES / GEO_MAP_0 / RELATED_QUERIES /
// RELATED_TOPICS），缓存与配额统一在 trends-service 单点完成。
// 请求策略约束：本端点只能由用户显式触发（页面加载绝不自动调用）；每个请求独立受
// serpapi 日/月配额保护； Trends value 是相对指数/上升百分比，绝不是月搜索量。

import { NextResponse } from "next/server";
import { fetchTrendsData, getTrendsUsage } from "@/lib/seo/trends-service";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DATA_TYPES = ["TIMESERIES", "GEO_MAP_0", "RELATED_QUERIES", "RELATED_TOPICS"] as const;
type DataType = (typeof VALID_DATA_TYPES)[number];

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
  let body: { seed?: string; location?: string; dataType?: string; date?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return badParams("请求体格式错误，需要 JSON");
  }

  const seed = (body.seed ?? "").trim();
  const location = (body.location ?? "中国").trim();
  const dataType = (body.dataType ?? "").trim() as DataType;
  const date = (body.date ?? "").trim();
  const language = (body.language ?? "").trim();

  if (!seed) return badParams("seed 不能为空");
  if (!(VALID_DATA_TYPES as readonly string[]).includes(dataType)) {
    return badParams(`dataType 必须是 ${VALID_DATA_TYPES.join(" / ")} 之一`);
  }

  try {
    const result = await fetchTrendsData(userId, plan, {
      keyword: seed,
      location,
      dataType,
      ...(date ? { date } : {}),
      ...(language ? { language } : {}),
    });
    return NextResponse.json({ data: result, usage: await getTrendsUsage(userId, plan) });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}
