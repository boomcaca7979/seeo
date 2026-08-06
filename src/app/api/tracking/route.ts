// ===== /api/tracking =====
// 排名追踪词的 CRUD，数据持久化到 SQLite

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRACKING_LIMIT = 5;

function todayStr(): string {
  // 本地时区 YYYY-MM-DD
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

async function withUsage<T>(payload: T) {
  const usage = await peekUsage();
  return NextResponse.json({ data: payload, usage });
}

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const list = await listTrackedKeywords();
  const usage = await peekUsage();
  return NextResponse.json({
    data: list,
    usage,
    limit: TRACKING_LIMIT,
  });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
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

  // 上限检查
  const count = await countTrackedKeywords();
  if (count >= TRACKING_LIMIT) {
    return NextResponse.json<SeoApiError>(
      { error: `演示期限定追踪 ${TRACKING_LIMIT} 个关键词，请先删除不再追踪的词`, code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  // 重复检查
  try {
    const created = await addTrackedKeyword({ keyword, location, device, domain });
    const newCount = await countTrackedKeywords();
    return await withUsage({ created, limit: TRACKING_LIMIT, remaining: TRACKING_LIMIT - newCount });
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
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id") ?? "");
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json<SeoApiError>(
      { error: "id 参数无效", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  const ok = await removeTrackedKeyword(id);
  if (!ok) {
    return NextResponse.json<SeoApiError>(
      { error: "未找到该追踪词", code: "BAD_REQUEST" },
      { status: 404 }
    );
  }
  const usage = await peekUsage();
  const currentCount = await countTrackedKeywords();
  const remaining = TRACKING_LIMIT - currentCount;
  return NextResponse.json({ data: { ok: true, remaining }, usage, limit: TRACKING_LIMIT });
}

// 导出供其他模块使用
export { TRACKING_LIMIT, todayStr, getTrackedKeywordById };
