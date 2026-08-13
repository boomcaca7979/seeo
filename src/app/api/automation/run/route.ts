// ===== /api/automation/run =====
// POST：手动触发一次自动化任务（需登录鉴权，执行当前用户的任务）
// GET：Vercel Cron 触发（需 CRON_SECRET 验证，遍历所有用户执行）
// P0 防亏损保护：单次 Cron 执行用户数上限 + 总调用次数硬上限
// P3.5：
//   - POST 增加 peekQuota 预检，用户 SerpApi 额度耗尽时直接返回 billing error
//   - GET 增加 MAX_SERPAPI_CALLS_PER_RUN 系统级保险丝，防止单次 Cron 成本失控

import { NextResponse } from "next/server";
import { runDailyRefresh, runWeeklyReport, MAX_SERPAPI_CALLS_PER_RUN } from "@/lib/automation/cron";
import { requireAuthOrDemo } from "@/lib/auth";
import { listDistinctUserIds } from "@/lib/db";
import { peekQuota, QuotaExceededError, billingErrorToResponse } from "@/lib/guards";
import type { CronRunContext } from "@/lib/seo/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 单次 Cron 执行的最大用户数（防止用户激增导致单次执行超时）
const MAX_USERS_PER_RUN = 200;

export async function POST(request: Request) {
  // 用户鉴权（演示模式跳过）
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;

  let body: { type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const { type } = body;
  if (!type || (type !== "daily_refresh" && type !== "weekly_report")) {
    return NextResponse.json(
      { error: "type 必须是 daily_refresh 或 weekly_report" },
      { status: 400 }
    );
  }

  // P3.5：daily_refresh 需要消耗 SerpApi，执行前预检用户额度
  // peekQuota 是只读检查，不会重复扣费；实际扣费由 refreshAllRanks 内部 consumeQuota 完成
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
      // 手动触发传入真实 plan，避免付费用户被误限制为 free
      // 不传 cronCtx：系统级保险丝不生效，仅用户级 consumeQuota 保护
      await runDailyRefresh(userId, plan);
    } else {
      await runWeeklyReport(userId);
    }
    return NextResponse.json({ data: { type, status: "done" } });
  } catch (err) {
    // 运行时 quota 超限（consumeQuota 抛出）需返回 billing error 格式
    if (err instanceof QuotaExceededError) {
      const { status, body } = billingErrorToResponse(err);
      return NextResponse.json(body, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败" },
      { status: 500 }
    );
  }
}

// Vercel Cron 调用入口（每日 09:00 UTC）
// 无用户 session，遍历所有有数据的用户逐个执行
// P0 保护：用户数硬上限 MAX_USERS_PER_RUN + 系统级 SerpApi 调用硬上限 MAX_SERPAPI_CALLS_PER_RUN
export async function GET(request: Request) {
  // 验证请求来自 Vercel Cron（fail-closed：secret 为空时拒绝）
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allUserIds = await listDistinctUserIds();
    if (allUserIds.length === 0) allUserIds.push("demo-user");

    // 单次执行用户数硬上限保护
    const userIds = allUserIds.slice(0, MAX_USERS_PER_RUN);
    const skippedUsers = allUserIds.length - userIds.length;

    // P3.5：系统级 SerpApi 成本保险丝
    // 该计数器在 refreshAllRanks 内部每次成功 consumeQuota 后 +1
    // 达到上限后停止处理后续用户，但不影响已处理的用户
    const cronCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_PER_RUN,
      stoppedByCostLimit: false,
    };

    const errors: Array<{ userId: string; error: string }> = [];
    let processedUsers = 0;

    for (const userId of userIds) {
      // 系统级保险丝已触发，停止处理后续用户
      if (cronCtx.stoppedByCostLimit) break;

      try {
        // 不传 plan，runDailyRefresh 内部会通过 admin client 查询；
        // admin client 不可用时 fallback 为 free（最保守）
        // 传入 cronCtx：启用系统级保险丝 + 用户额度预检跳过
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
        errors,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败" },
      { status: 500 }
    );
  }
}
