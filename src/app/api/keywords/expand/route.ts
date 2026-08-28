// ===== /api/keywords/expand =====
// 拓词 API：调用 SerpApi google_search，返回相关搜索 + PAA
// 复用 serp 命名空间缓存 + 用量计数

import { NextResponse } from "next/server";
import { SeoProviderError } from "@/lib/seo/provider";
import { getSerpUsage, expandKeyword } from "@/lib/seo/serp-service";
import { QuotaExceededError } from "@/lib/seo/cache";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExpandResponse {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
}

function badParams(msg: string) {
  return NextResponse.json<SeoApiError>({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
}

function mapError(e: unknown) {
  if (e instanceof SeoProviderError) {
    const status =
      e.code === "INVALID_KEY" ? 401 :
      e.code === "QUOTA_EXCEEDED" ? 429 :
      e.code === "TIMEOUT" ? 504 :
      e.code === "BAD_REQUEST" ? 400 : 502;
    return NextResponse.json<SeoApiError>({ error: e.message, code: e.code }, { status });
  }
  if (e instanceof Error && e.message === "QUOTA_EXCEEDED") {
    return NextResponse.json<SeoApiError>(
      { error: "本月额度已用尽，下月 1 日自动重置", code: "QUOTA_EXCEEDED" },
      { status: 429 }
    );
  }
  if (e instanceof QuotaExceededError) {
    return NextResponse.json<SeoApiError>(
      { error: e.message, code: "QUOTA_EXCEEDED" },
      { status: 429 }
    );
  }
  return NextResponse.json<SeoApiError>(
    { error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" },
    { status: 500 }
  );
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  let body: { seed?: string; location?: string; device?: string };
  try {
    body = await req.json();
  } catch {
    return badParams("请求体格式错误，需要 JSON");
  }

  const seed = (body.seed ?? "").trim();
  const location = (body.location ?? "中国").trim();
  const device = (body.device ?? "PC").trim() as "PC" | "移动端";

  if (!seed) return badParams("seed 不能为空");
  if (device !== "PC" && device !== "移动端") return badParams("device 必须是 PC 或 移动端");

  try {
    const data = await expandKeyword(userId, plan, { keyword: seed, location, device });
    const resp: ExpandResponse = { ...data };
    return NextResponse.json({ data: resp, usage: await getSerpUsage(userId, plan) });
  } catch (e) {
    return mapError(e);
  }
}
