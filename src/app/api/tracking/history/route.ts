// ===== /api/tracking/history =====
// 返回某追踪词的历史排名数据

import { NextResponse } from "next/server";
import { getRankHistory } from "@/lib/db";
import { peekUsage } from "@/lib/seo/cache";
import { requireAuthOrDemo } from "@/lib/auth";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id") ?? "");
  const days = Number(searchParams.get("days") ?? "30");

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json<SeoApiError>(
      { error: "id 参数无效", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(days) || days <= 0 || days > 365) {
    return NextResponse.json<SeoApiError>(
      { error: "days 参数无效（1-365）", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const history = await getRankHistory(userId, id, days);
  const usage = await peekUsage(userId, "serpapi", plan);
  return NextResponse.json({ data: history, usage });
}
