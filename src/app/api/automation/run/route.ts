// ===== /api/automation/run =====
// POST：手动触发一次自动化任务（需登录鉴权，执行当前用户的任务）
// GET：Vercel Cron 触发（需 CRON_SECRET 验证，遍历所有用户执行）
//
// P0 稳定性修复：
//   - POST 也传入 cronCtx，双重保险丝对手动触发生效（cost=20, runtime=90s）
//   - GET 加 maxDuration=300 + MAX_CRON_RUNTIME_MS 时间限制（三重保险丝）
//   - runtime fuse 穿透到 refreshAllRanks/refreshRanksBatch/refreshSingleKeyword 三层

import { NextResponse } from "next/server";
import {
  runDailyRefresh,
  runWeeklyReport,
  MAX_SERPAPI_CALLS_PER_RUN,
} from "@/lib/automation/cron";
import {
  MAX_SERPAPI_CALLS_MANUAL,
  MAX_MANUAL_RUNTIME_MS,
  hasCronRuntimeExpired,
  type CronRunContext,
} from "@/lib/seo/refresh";
import { requireAuthOrDemo } from "@/lib/auth";
import { listDistinctUserIds } from "@/lib/db";
import { peekQuota, QuotaExceededError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 单次 Cron 执行的最大用户数（防止用户激增导致单次执行超时）
const MAX_USERS_PER_RUN = 200;

// P0：Cron 单次运行时间硬上限（4 分钟，给 maxDuration=300s 留 1 分钟 buffer）
const MAX_CRON_RUNTIME_MS = 240_000;

// maxDuration 保险丝（模块级，POST 和 GET 共享）
// GET Cron 需要 300s（三重保险丝目标 < 240s）；POST 手动触发最坏 70s（MAX_SERPAPI_CALLS_MANUAL=20）
export const maxDuration = 300;

export async function POST(request: Request) {
  // 用户鉴权（演示模式跳过）
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;

  let body: { type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "INVALID_JSON" }, { status: 400 });
  }

  const { type } = body;
  if (!type || (type !== "daily_refresh" && type !== "weekly_report")) {
    return NextResponse.json(
      { error: "type 必须是 daily_refresh 或 weekly_report", code: "AUTOMATION_TYPE_INVALID" },
      { status: 400 }
    );
  }

  // daily_refresh 需要消耗 SerpApi，执行前预检用户额度
  if (type === "daily_refresh") {
    try {
      const usage = await peekQuota(userId, "serpapi");
      if (usage.used >= usage.limit) {
        const err = new QuotaExceededError(usage.used, usage.limit, "serpapi", usage.month, plan);
        const { status, body: errBody } = billingErrorToResponse(err);
        return NextResponse.json(errBody, { status });
      }
    } catch {
      // peekQuota 失败不阻止执行，交由 consumeQuota 兜底
    }
  }

  try {
    if (type === "daily_refresh") {
      // P0 修复：手动触发也传入 cronCtx，双重保险丝对手动触发生效
      // maxSerpApiCalls = MAX_SERPAPI_CALLS_MANUAL（20），maxRuntimeMs = 90s
      const manualCtx: CronRunContext = {
        serpApiCalls: 0,
        maxSerpApiCalls: MAX_SERPAPI_CALLS_MANUAL,
        stoppedByCostLimit: false,
        startTime: Date.now(),
        maxRuntimeMs: MAX_MANUAL_RUNTIME_MS,
        stoppedByTimeLimit: false,
      };
      await runDailyRefresh(userId, plan, manualCtx);
      return NextResponse.json({
        data: {
          type,
          status: (manualCtx.stoppedByCostLimit || manualCtx.stoppedByTimeLimit)
            ? "stopped_by_limit"
            : "done",
          serpApiCalls: manualCtx.serpApiCalls,
          stoppedByCostLimit: manualCtx.stoppedByCostLimit,
          stoppedByTimeLimit: manualCtx.stoppedByTimeLimit,
        },
      });
    } else {
      await runWeeklyReport(userId);
      return NextResponse.json({ data: { type, status: "done" } });
    }
  } catch (err) {
    // 运行时 quota 超限（consumeQuota 抛出）需返回 billing error 格式
    if (err instanceof QuotaExceededError) {
      const { status, body } = billingErrorToResponse(err);
      return NextResponse.json(body, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败", code: "UPSTREAM_ERROR" },
      { status: 500 }
    );
  }
}

// Vercel Cron 调用入口（每日 09:00 UTC）
// P0 保护：三重保险丝 + runtime fuse 穿透
//   1. MAX_USERS_PER_RUN = 200（用户数硬上限）
//   2. MAX_SERPAPI_CALLS_PER_RUN = 500（SerpApi 调用硬上限）
//   3. MAX_CRON_RUNTIME_MS = 240s（运行时间硬上限，穿透到 batch/chunk/keyword 层级）
// 任一触及即停止处理后续用户，已完成结果保留
export async function GET(request: Request) {
  // 验证请求来自 Vercel Cron（fail-closed：secret 为空时拒绝）
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const allUserIds = await listDistinctUserIds();
    if (allUserIds.length === 0) allUserIds.push("demo-user");

    // 保险丝 1：用户数硬上限
    const userIds = allUserIds.slice(0, MAX_USERS_PER_RUN);
    const skippedUsers = allUserIds.length - userIds.length;

    // 双重保险丝：系统级 SerpApi 成本 + 运行时间
    const cronCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_PER_RUN,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: MAX_CRON_RUNTIME_MS,
      stoppedByTimeLimit: false,
    };

    const errors: Array<{ userId: string; error: string }> = [];
    let processedUsers = 0;

    for (const userId of userIds) {
      // 保险丝 2：系统级 SerpApi 上限已触及
      if (cronCtx.stoppedByCostLimit) break;

      // 保险丝 3：运行时间上限已触及（可能在用户内部 batch 中已设置）
      if (cronCtx.stoppedByTimeLimit) break;
      if (hasCronRuntimeExpired(cronCtx)) {
        cronCtx.stoppedByTimeLimit = true;
        break;
      }

      try {
        // 不传 plan，runDailyRefresh 内部会通过 admin client 查询；
        // admin client 不可用时 fallback 为 free（最保守）
        // 传入 cronCtx：启用双重保险丝 + 用户额度预检
        await runDailyRefresh(userId, undefined, cronCtx);
        processedUsers++;
      } catch (err) {
        errors.push({ userId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({
      data: {
        type: "daily_refresh",
        status: "done",
        processedUsers,
        skippedUsers,
        serpApiCalls: cronCtx.serpApiCalls,
        stoppedByCostLimit: cronCtx.stoppedByCostLimit,
        stoppedByTimeLimit: cronCtx.stoppedByTimeLimit,
        runtimeMs: Date.now() - cronCtx.startTime,
        errors,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败", code: "UPSTREAM_ERROR" },
      { status: 500 }
    );
  }
}
