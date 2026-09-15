// ===== /api/tools/backlink-checker =====
// 公开外链检查工具的匿名接口（无需登录）。
//
// 安全边界：
//   - 仅接受 POST + JSON，请求体上限 1KB
//   - DataForSEO 凭证只存在于服务端 provider 层，路由与前端均不接触
//   - 所有 provider / DB 异常都会被归一化为错误码，不返回堆栈或供应商细节
//   - 用户无法控制任何 provider 参数（target / limit 全部由服务端固定）
//
// 分层防滥用（逐层递减成本）：
//   1. 内存滑动窗口：单 IP 20 次 / 10 分钟（含缓存命中请求）
//   2. 单域名 10 分钟冷却（DB 标记，跨实例）
//   3. 单访客每日 5 次真实刷新（DB 原子计数，缓存命中不计数）
//   4. 全站每日 100 次真实刷新（DB 原子计数，硬成本闸门）

import { NextResponse } from "next/server";
import { getClientIp, checkSlidingWindowRateLimit } from "@/lib/rate-limit";
import { getPublicBacklinkPreview } from "@/lib/seo/public-backlink-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 1024;

/** 内存滑动窗口：单 IP 10 分钟内的最大请求数（含缓存命中） */
const BURST_LIMIT = 20;
const BURST_WINDOW_MS = 10 * 60 * 1000;

/**
 * 全部 code 均来自集中式 catalog（src/lib/errors/api-error-codes.ts），
 * 服务层错误码与路由层参数错误共用同一套取值。
 */
const STATUS_BY_CODE: Record<string, number> = {
  INVALID_JSON: 400,
  INVALID_DOMAIN: 400,
  PRIVATE_HOST: 400,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  BACKLINK_COOLDOWN: 429,
  CHECKER_DAILY_LIMIT: 429,
  CHECKER_RATE_LIMITED: 429,
  CHECKER_BUDGET_EXHAUSTED: 429,
  DATAFORSEO_NOT_CONFIGURED: 503,
  CHECKER_UNAVAILABLE: 503,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
};

/** 服务端兜底文案（前端会按 code 覆盖为本地化文案） */
const MESSAGE_BY_CODE: Record<string, string> = {
  INVALID_JSON: "The request could not be read.",
  INVALID_DOMAIN: "Enter a valid domain such as example.com.",
  PRIVATE_HOST: "That host cannot be checked.",
  METHOD_NOT_ALLOWED: "This endpoint accepts POST requests only.",
  PAYLOAD_TOO_LARGE: "The request body is too large.",
  BACKLINK_COOLDOWN: "This domain was checked moments ago. Try again shortly.",
  CHECKER_DAILY_LIMIT: "Daily free lookup limit reached for this visitor.",
  CHECKER_RATE_LIMITED: "Too many requests. Please slow down.",
  CHECKER_BUDGET_EXHAUSTED: "The free checker has reached today's shared lookup budget.",
  DATAFORSEO_NOT_CONFIGURED: "The checker is temporarily unavailable.",
  CHECKER_UNAVAILABLE: "The checker is temporarily unavailable.",
  UPSTREAM_TIMEOUT: "The data provider did not respond in time.",
  UPSTREAM_ERROR: "Backlink data could not be retrieved for that domain.",
};

function fail(code: string, retryAfterSeconds = 0) {
  const status = STATUS_BY_CODE[code] ?? 500;
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 405) headers["Allow"] = "POST";
  if (status === 429 && retryAfterSeconds > 0) headers["Retry-After"] = String(retryAfterSeconds);
  return NextResponse.json(
    { code, error: MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.CHECKER_UNAVAILABLE, retryAfterSeconds },
    { status, headers }
  );
}

export async function POST(req: Request) {
  const ip = getClientIp(req);

  // 1) 突发限流（最便宜的一层，先挡住轮询）
  const burst = checkSlidingWindowRateLimit(`public-checker:ip:${ip}`, BURST_LIMIT, BURST_WINDOW_MS);
  if (!burst.allowed) return fail("CHECKER_RATE_LIMITED", burst.retryAfterSeconds);

  // 2) 请求体读取（带长度上限）
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail("PAYLOAD_TOO_LARGE");

  let domain = "";
  try {
    const parsed = JSON.parse(raw) as { domain?: unknown };
    domain = typeof parsed.domain === "string" ? parsed.domain : "";
  } catch {
    return fail("INVALID_JSON");
  }

  // 3) 业务处理（校验 / 缓存 / 冷却 / 额度 / provider）
  try {
    const outcome = await getPublicBacklinkPreview(domain, ip);
    if (!outcome.ok) return fail(outcome.code, outcome.retryAfterSeconds);
    return NextResponse.json(
      { data: outcome.data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    // 内部异常（DB 不可用等）只记服务端日志，对外统一为归一化错误
    console.error("[api/tools/backlink-checker] unexpected error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return fail("CHECKER_UNAVAILABLE");
  }
}

/** 仅接受 POST；其余方法返回 405，避免被当作可抓取的 GET 端点 */
export async function GET() {
  return fail("METHOD_NOT_ALLOWED");
}
