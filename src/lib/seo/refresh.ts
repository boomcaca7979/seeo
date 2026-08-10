// ===== 刷新所有追踪关键词排名（共享逻辑） =====
// 供 API 路由和自动化任务复用，不重复造逻辑

import {
  listTrackedKeywords,
  upsertRankHistory,
  updateLastRefreshed,
  hasTodayHistory,
  getRankHistory,
} from "@/lib/db";
import { serpApiProvider } from "@/lib/seo/serpapi";
import { SeoProviderError } from "@/lib/seo/provider";
import { consumeQuota, readCache, writeCache, QuotaExceededError } from "@/lib/seo/cache";
import { generateRankAlert } from "@/lib/seo/alerts";
import type { RankResult } from "@/lib/seo/types";
import type { PlanTier } from "@/lib/auth";

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Cron 运行级共享上下文（P3.5：系统级 SerpApi 成本保险丝）
 * - serpApiCalls：本次 Cron 已消耗的 SerpApi 调用数
 * - maxSerpApiCalls：单次 Cron 的 SerpApi 调用硬上限
 * - stoppedByCostLimit：是否因触及系统级上限而停止
 *
 * 注意：该上下文仅由 Cron 入口传入，手动触发（POST /api/automation/run）不传入。
 * 用户级 consumeQuota 始终生效，与系统级保险丝互不替代。
 */
export interface CronRunContext {
  serpApiCalls: number;
  maxSerpApiCalls: number;
  stoppedByCostLimit: boolean;
}

export interface RefreshResult {
  refreshed: number;
  alerts: number;
  details: Array<{
    keyword: string;
    domain: string;
    oldRank: number | null;
    newRank: number | null;
    fromCache: boolean;
    error?: string;
  }>;
}

/** 刷新指定用户的所有追踪关键词排名，返回刷新结果摘要 */
export async function refreshAllRanks(
  userId: string,
  plan: PlanTier = "free",
  cronCtx?: CronRunContext
): Promise<RefreshResult> {
  const list = await listTrackedKeywords(userId);
  const today = todayStr();
  let refreshed = 0;
  let alerts = 0;
  const details: RefreshResult["details"] = [];

  for (const tk of list) {
    // 系统级保险丝：触及 Cron 总调用上限时停止处理后续关键词
    if (cronCtx && cronCtx.serpApiCalls >= cronCtx.maxSerpApiCalls) {
      cronCtx.stoppedByCostLimit = true;
      break;
    }

    const params = {
      keyword: tk.keyword,
      domain: tk.domain,
      location: tk.location,
      device: tk.device,
    };

    let rankResult: RankResult | null = null;
    let fromCache = false;
    let consumed = false;
    let errMsg: string | undefined;

    try {
      // 1. 先查本地 rank 缓存
      const cached = await readCache<RankResult>("rank", params);
      if (cached) {
        rankResult = cached;
        fromCache = true;
      } else {
        // 2. DB 中今日是否已有记录（避免同日重复扣额度）
        const dbHasToday = await hasTodayHistory(userId, tk.id);
        if (dbHasToday) {
          const history = await getRankHistory(userId, tk.id, 1);
          const todayRow = history.find((h) => h.date === today);
          if (todayRow) {
            rankResult = {
              keyword: tk.keyword,
              domain: tk.domain,
              location: tk.location,
              device: tk.device,
              fetchedAt: todayRow.created_at,
              rank: todayRow.position,
              matchedUrl: todayRow.url,
              fromCache: true,
            };
            fromCache = true;
          }
        }

        // 3. 真实调用 SerpApi（用户级额度扣减）
        if (!rankResult) {
          // 系统级保险丝：再次检查（可能在循环中途触及上限）
          if (cronCtx && cronCtx.serpApiCalls >= cronCtx.maxSerpApiCalls) {
            cronCtx.stoppedByCostLimit = true;
            break;
          }
          try {
            await consumeQuota(userId, "serpapi", plan);
            consumed = true;
            // 用户级扣费成功后，系统级计数 +1
            if (cronCtx) cronCtx.serpApiCalls++;
            rankResult = await serpApiProvider.checkRank(params);
            try {
              await writeCache("rank", params, rankResult);
            } catch {
              // ignore
            }
          } catch (e) {
            if (e instanceof SeoProviderError) {
              errMsg = e.message;
            } else if (e instanceof QuotaExceededError) {
              errMsg = e.message;
            } else if (e instanceof Error && e.message === "QUOTA_EXCEEDED") {
              errMsg = "本月免费额度已用尽，下月 1 日自动重置";
            } else {
              errMsg = (e as Error).message;
            }
          }
        }
      }

      // 4. 写入 DB
      if (rankResult) {
        await upsertRankHistory(userId, {
          keyword_id: tk.id,
          date: today,
          position: rankResult.rank,
          url: rankResult.matchedUrl,
        });
        await updateLastRefreshed(userId, tk.id);

        // 5. 仅在今日首次真实调用 SerpApi 的分支生成排名预警
        if (consumed) {
          await generateRankAlert(userId, tk, rankResult.rank, today);
          alerts++;
        }

        refreshed++;
      }

      details.push({
        keyword: tk.keyword,
        domain: tk.domain,
        oldRank: null,
        newRank: rankResult?.rank ?? null,
        fromCache,
        error: errMsg,
      });
    } catch (e) {
      details.push({
        keyword: tk.keyword,
        domain: tk.domain,
        oldRank: null,
        newRank: null,
        fromCache: false,
        error: (e as Error).message,
      });
    }
  }

  return { refreshed, alerts, details };
}
