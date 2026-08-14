// ===== 自动化任务调度引擎 =====
// 基于 node-cron 实现每日刷新 / 每周报告定时任务

import cron, { type ScheduledTask } from "node-cron";
import {
  getAutomationSettings,
  addAutomationLog,
  deleteExpiredCache,
  listDistinctUserIds,
} from "@/lib/db";
import { refreshAllRanks, type CronRunContext } from "@/lib/seo/refresh";
import { generateWeeklyReport } from "@/lib/automation/weekly";
import { getUserPlan } from "@/lib/supabase/admin";
import { peekUsage } from "@/lib/seo/cache";
import type { PlanTier } from "@/lib/auth";

/**
 * 单次 Cron 执行的 SerpApi 调用全局硬上限（P3.5：系统级成本保险丝）
 * 该上限不可替代用户级 consumeQuota，两层保护并存：
 *   - 用户级：consumeQuota() 按 user + api_type + month 隔离
 *   - 系统级：MAX_SERPAPI_CALLS_PER_RUN 防止单次 Cron 批量调用失控
 */
export const MAX_SERPAPI_CALLS_PER_RUN = 500;

let tasks: ScheduledTask[] = [];
let started = false;

/**
 * 启动自动化任务（先清旧任务再注册）。
 * 演示模式：只处理 demo-user；
 * 鉴权模式：遍历所有有数据的用户，为每个开启了自动化设置的用户注册定时任务。
 */
export async function startAutomation(): Promise<void> {
  stopAutomation();

  const userIds = await listDistinctUserIds();
  // 演示模式兜底：没有真实用户时也跑 demo-user
  if (userIds.length === 0) userIds.push("demo-user");

  for (const userId of userIds) {
    const settings = await getAutomationSettings(userId);
    if (!settings) continue;

    // 每日刷新
    if (settings.daily_refresh_enabled) {
      const [hour, minute] = settings.daily_refresh_time.split(":");
      if (cron.validate(`${minute} ${hour} * * *`)) {
        const task = cron.schedule(
          `${minute} ${hour} * * *`,
          async () => {
            await runDailyRefresh(userId);
          },
          { timezone: "Asia/Shanghai" }
        );
        tasks.push(task);
      }
    }

    // 每周报告
    if (settings.weekly_report_enabled) {
      const [hour, minute] = settings.weekly_report_time.split(":");
      const day = settings.weekly_report_day;
      if (cron.validate(`${minute} ${hour} * * ${day}`)) {
        const task = cron.schedule(
          `${minute} ${hour} * * ${day}`,
          async () => {
            await runWeeklyReport(userId);
          },
          { timezone: "Asia/Shanghai" }
        );
        tasks.push(task);
      }
    }
  }

  started = true;
}

/** 停止所有自动化任务 */
export function stopAutomation(): void {
  tasks.forEach((t) => t.stop());
  tasks = [];
  started = false;
}

/** 是否已启动 */
export function isStarted(): boolean {
  return started;
}

/**
 * 手动执行每日刷新（指定用户）
 * - 手动触发（POST /api/automation/run）传入 cronCtx（maxSerpApiCalls=MAX_SERPAPI_CALLS_MANUAL）
 * - Cron 触发（GET /api/automation/run）传入 cronCtx（maxSerpApiCalls=MAX_SERPAPI_CALLS_PER_RUN）
 * - 两条路径均受系统级 SerpApi 保险丝保护
 */
export async function runDailyRefresh(
  userId: string,
  plan?: PlanTier,
  cronCtx?: CronRunContext
): Promise<void> {
  await addAutomationLog(userId, {
    type: "daily_refresh",
    status: "running",
    summary: "开始执行每日排名刷新...",
    details: null,
  });

  try {
    // 未传 plan 时尝试查询；查询失败 fallback 为 free（最保守保护）
    const resolvedPlan: PlanTier = plan ?? (await getUserPlan(userId, "free"));

    // Cron 模式：预检查用户 SerpApi 额度，已耗尽则跳过该用户（不影响其他用户）
    if (cronCtx) {
      try {
        const usage = await peekUsage(userId, "serpapi", resolvedPlan);
        if (usage.used >= usage.limit) {
          await addAutomationLog(userId, {
            type: "daily_refresh",
            status: "failed",
            summary: "跳过：本月 SerpApi 额度已用尽",
            details: JSON.stringify({ used: usage.used, limit: usage.limit }),
          });
          return;
        }
      } catch {
        // peekUsage 失败不阻止执行，交由 consumeQuota 兜底
      }
    }

    const result = await refreshAllRanks(userId, resolvedPlan, cronCtx);

    // 清理过期缓存（失败不影响刷新结果）
    let cleanedCache = 0;
    try {
      cleanedCache = await deleteExpiredCache();
    } catch (err) {
      console.error("[Daily Refresh] 缓存清理失败:", err);
    }

    await addAutomationLog(userId, {
      type: "daily_refresh",
      status: "success",
      summary: `刷新完成：${result.refreshed} 个关键词，${result.alerts} 条预警，清理缓存 ${cleanedCache} 条`,
      details: JSON.stringify({ ...result.details, cleanedCache }),
    });
  } catch (err) {
    await addAutomationLog(userId, {
      type: "daily_refresh",
      status: "failed",
      summary: "刷新失败",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 手动执行每周报告生成（指定用户） */
export async function runWeeklyReport(userId: string): Promise<void> {
  await addAutomationLog(userId, {
    type: "weekly_report",
    status: "running",
    summary: "开始生成每周报告...",
    details: null,
  });

  try {
    const report = await generateWeeklyReport(userId);
    await addAutomationLog(userId, {
      type: "weekly_report",
      status: "success",
      summary: report.summary,
      details: JSON.stringify(report.details),
    });
  } catch (err) {
    await addAutomationLog(userId, {
      type: "weekly_report",
      status: "failed",
      summary: "报告生成失败",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
