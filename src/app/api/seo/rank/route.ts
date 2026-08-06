// ===== /api/seo/rank =====
// 服务端路由：查某域名在某关键词 SERP 前 100 名中的真实位置

import { NextResponse } from "next/server";
import { serpApiProvider } from "@/lib/seo/serpapi";
import { SeoProviderError } from "@/lib/seo/provider";
import { consumeQuota, peekUsage, readCache, writeCache } from "@/lib/seo/cache";
import type { RankResult, SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      { error: "本月免费额度已用尽（80/100），下月 1 日自动重置", code: "QUOTA_EXCEEDED" },
      { status: 429 }
    );
  }
  return NextResponse.json<SeoApiError>(
    { error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" },
    { status: 500 }
  );
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const keyword = (searchParams.get("keyword") ?? "").trim();
  const domain = (searchParams.get("domain") ?? "").trim();
  const location = (searchParams.get("location") ?? "中国").trim();
  const device = (searchParams.get("device") ?? "PC").trim() as "PC" | "移动端";

  if (!keyword) return badParams("keyword 参数不能为空");
  if (!domain) return badParams("domain 参数不能为空");
  if (device !== "PC" && device !== "移动端") return badParams("device 必须是 PC 或 移动端");

  const params = { keyword, domain, location, device };

  // 1. 缓存优先
  try {
    const cached = await readCache<RankResult>("rank", params);
    if (cached) {
      const usage = await peekUsage();
      return NextResponse.json({
        data: { ...cached, fromCache: true },
        usage,
      });
    }
  } catch {
    // ignore
  }

  // 2. 消耗额度
  let usage;
  try {
    usage = await consumeQuota();
  } catch (e) {
    return mapError(e);
  }

  // 3. 调用 SerpApi
  try {
    const result = await serpApiProvider.checkRank(params);
    try {
      await writeCache("rank", params, result);
    } catch {
      // ignore
    }
    return NextResponse.json({ data: result, usage });
  } catch (e) {
    return mapError(e);
  }
}
