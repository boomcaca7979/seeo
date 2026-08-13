// ===== /api/keywords/expand =====
// 拓词 API：调用 SerpApi google_search，返回相关搜索 + PAA
// 复用 serp 命名空间缓存 + 用量计数

import { NextResponse } from "next/server";
import { serpApiProvider } from "@/lib/seo/serpapi";
import { SeoProviderError } from "@/lib/seo/provider";
import { consumeQuota, peekUsage, readCache, writeCache, QuotaExceededError } from "@/lib/seo/cache";
import type { SeoApiError, SerpResult } from "@/lib/seo/types";
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
    return NextResponse.json({ error: auth.error }, { status: 401 });
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

  const params = { keyword: seed, location, device };

  // 1. 先读 serp 命名空间缓存（与 /api/seo/serp 共享，避免重复扣额度）
  try {
    const cached = await readCache<SerpResult>("serp", params);
    if (cached) {
      const usage = await peekUsage(userId, "serpapi", plan);
      const resp: ExpandResponse = {
        seed,
        related: cached.relatedSearches.map((r) => r.query),
        paa: cached.relatedQuestions.map((q) => q.question),
        location,
        device: device === "PC" ? "desktop" : "mobile",
        fromCache: true,
      };
      return NextResponse.json({ data: resp, usage });
    }
  } catch {
    // 缓存读取失败不阻塞主流程
  }

  // 2. 真实调用：先消耗额度（用户级隔离）
  let usage;
  try {
    usage = await consumeQuota(userId, "serpapi", plan);
  } catch (e) {
    return mapError(e);
  }

  // 3. 调用 SerpApi
  try {
    const result = await serpApiProvider.searchSerp(params);
    // 写缓存（与 /api/seo/serp 共享命名空间）
    try {
      await writeCache("serp", params, result);
    } catch {
      // 缓存写入失败不阻塞返回
    }
    const resp: ExpandResponse = {
      seed,
      related: result.relatedSearches.map((r) => r.query),
      paa: result.relatedQuestions.map((q) => q.question),
      location,
      device: device === "PC" ? "desktop" : "mobile",
      fromCache: false,
    };
    return NextResponse.json({ data: resp, usage });
  } catch (e) {
    return mapError(e);
  }
}
