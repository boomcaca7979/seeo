// ===== /api/tracking =====
// 排名追踪词的 CRUD，数据持久化到 SQLite
// P1 改造：TRACKING_LIMIT 硬编码改为 getPlanLimits() 动态获取

import { NextResponse } from "next/server";
import {
  listTrackedKeywords,
  addTrackedKeyword,
  removeTrackedKeyword,
  countTrackedKeywords,
  getTrackedKeywordById,
} from "@/lib/db";
import { peekUsage } from "@/lib/seo/cache";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";
import { PlanLimitError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayStr(): string {
  // 本地时区 YYYY-MM-DD
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

async function withUsage<T>(payload: T, userId: string, plan: import("@/lib/auth").PlanTier) {
  const usage = await peekUsage(userId, "serpapi", plan);
  return NextResponse.json({ data: payload, usage });
}

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const list = await listTrackedKeywords(userId);
  const usage = await peekUsage(userId, "serpapi", plan);
  return NextResponse.json({
    data: list,
    usage,
    limit: auth.limits.max_tracked_keywords,
  });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json<SeoApiError>(
      { error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const keyword = String(body.keyword ?? "").trim();
  const location = String(body.location ?? "中国").trim();
  const device = String(body.device ?? "PC").trim() as "PC" | "移动端";
  const domain = String(body.domain ?? "").trim();

  if (!keyword) {
    return NextResponse.json<SeoApiError>(
      { error: "keyword 不能为空", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  if (!domain) {
    return NextResponse.json<SeoApiError>(
      { error: "domain 不能为空", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  if (device !== "PC" && device !== "移动端") {
    return NextResponse.json<SeoApiError>(
      { error: "device 必须是 PC 或 移动端", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  // 上限检查（P1：从套餐限制动态获取，P3：统一为 PlanLimitError）
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const trackingLimit = auth.limits.max_tracked_keywords;
  const count = await countTrackedKeywords(userId);
  if (count >= trackingLimit) {
    const err = new PlanLimitError("追踪关键词", auth.plan, trackingLimit, "KEYWORD_LIMIT_REACHED");
    const { status, body } = billingErrorToResponse(err);
    return NextResponse.json(body, { status });
  }

  // 重复检查
  try {
    const created = await addTrackedKeyword(userId, { keyword, location, device, domain });
    const newCount = await countTrackedKeywords(userId);
    return await withUsage({ created, limit: trackingLimit, remaining: trackingLimit - newCount }, userId, plan);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("UNIQUE")) {
      return NextResponse.json<SeoApiError>(
        { error: "该关键词已在追踪中（同关键词+地区+设备+域名视为重复）", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }
    throw e;
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id") ?? "");
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json<SeoApiError>(
      { error: "id 参数无效", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const trackingLimit = auth.limits.max_tracked_keywords;
  const ok = await removeTrackedKeyword(userId, id);
  if (!ok) {
    return NextResponse.json<SeoApiError>(
      { error: "未找到该追踪词", code: "BAD_REQUEST" },
      { status: 404 }
    );
  }
  const usage = await peekUsage(userId, "serpapi", plan);
  const currentCount = await countTrackedKeywords(userId);
  const remaining = trackingLimit - currentCount;
  return NextResponse.json({ data: { ok: true, remaining }, usage, limit: trackingLimit });
}

// 导出供其他模块使用（TRACKING_LIMIT 已移除，改用 getPlanLimits 动态获取）
export { todayStr, getTrackedKeywordById };
