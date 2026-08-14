// ===== 刷新所有追踪关键词排名（共享逻辑） =====
// 供 API 路由和自动化任务复用，不重复造逻辑
//
// P0 稳定性修复：
//   - 单次请求有明确关键词上限（MAX_KEYWORDS_PER_REQUEST）
//   - 并发受控（CONCURRENCY），禁止 Promise.all(200)
//   - 单项失败不阻塞整批（Promise.allSettled）
//   - 系统级 SerpApi 保险丝对手动触发也生效

import {
  listTrackedKeywords,
  upsertRankHistory,
  updateLastRefreshed,
  hasTodayHistory,
  getRankHistory,
  type TrackedKeyword,
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
 * - serpApiCalls：本次运行已消耗的 SerpApi 调用数
 * - maxSerpApiCalls：本次运行的 SerpApi 调用硬上限
 * - stoppedByCostLimit：是否因触及系统级上限而停止
 *
 * P0 修复：手动触发（POST /api/automation/run）也传入 cronCtx，
 * 系统级保险丝对手动触发同样生效（maxSerpApiCalls 较小）。
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

/** 单个关键词刷新结果（供 API 路由直接返回前端） */
export interface RefreshItem {
  id: number;
  keyword: string;
  domain: string;
  location: string;
  device: "PC" | "移动端";
  position: number | null;
  url: string | null;
  fromCache: boolean;
  skipped: boolean;
  error?: string;
}

// ---------- P0 稳定性常量 ----------

/** 单次 HTTP 请求最多处理的关键词数（前端可分批续请求） */
export const MAX_KEYWORDS_PER_REQUEST = 20;

/** 并发调用 SerpApi 的最大并发数（禁止 Promise.all(200)） */
export const CONCURRENCY = 3;

/**
 * 手动触发（POST /api/automation/run）的 SerpApi 调用硬上限。
 * 远小于 Cron 的 500，防止单次手动操作消耗过多成本。
 * 20 次 × 10s / 3 并发 ≈ 70s，在 maxDuration=300s 内安全完成。
 */
export const MAX_SERPAPI_CALLS_MANUAL = 20;

/**
 * 刷新单个关键词的完整流程（缓存→DB 今日记录→SerpApi→写 DB→预警）。
 * 单项失败只返回 error，不抛异常，由调用方决定如何处理。
 */
async function refreshSingleKeyword(
  userId: string,
  tk: TrackedKeyword,
  plan: PlanTier,
  today: string,
  cronCtx?: CronRunContext
): Promise<RefreshItem> {
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
    // 1. 先查本地 rank 缓存（24h TTL）
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
        // 系统级保险丝：再次检查（可能在并发批次中途触及上限）
        if (cronCtx && cronCtx.serpApiCalls >= cronCtx.maxSerpApiCalls) {
          cronCtx.stoppedByCostLimit = true;
          return {
            id: tk.id,
            keyword: tk.keyword,
            domain: tk.domain,
            location: tk.location,
            device: tk.device,
            position: null,
            url: null,
            fromCache: false,
            skipped: true,
            error: "系统级 SerpApi 上限已触及，跳过",
          };
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
            errMsg = "本月额度已用尽，下月 1 日自动重置";
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
      }
    }
  } catch (e) {
    errMsg = (e as Error).message;
  }

  return {
    id: tk.id,
    keyword: tk.keyword,
    domain: tk.domain,
    location: tk.location,
    device: tk.device,
    position: rankResult?.rank ?? null,
    url: rankResult?.matchedUrl ?? null,
    fromCache,
    skipped: !consumed,
    error: errMsg,
  };
}

/**
 * 并发处理一批关键词（Promise.allSettled，单项失败不阻塞整批）。
 *
 * 并发度受 CONCURRENCY 控制：将批次切成 CONCURRENCY 大小的子块，
 * 每个子块用 Promise.allSettled 并发，子块之间串行。
 *
 * 系统级保险丝在子块之间检查，触及上限时停止处理后续子块。
 */
export async function refreshRanksBatch(
  userId: string,
  plan: PlanTier,
  batch: TrackedKeyword[],
  cronCtx?: CronRunContext
): Promise<RefreshItem[]> {
  const today = todayStr();
  const results: RefreshItem[] = [];

  // 将批次切成 CONCURRENCY 大小的子块
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    // 系统级保险丝：子块之间检查，触及上限时停止
    if (cronCtx && cronCtx.stoppedByCostLimit) break;
    if (cronCtx && cronCtx.serpApiCalls >= cronCtx.maxSerpApiCalls) {
      cronCtx.stoppedByCostLimit = true;
      break;
    }

    const chunk = batch.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((tk) => refreshSingleKeyword(userId, tk, plan, today, cronCtx))
    );

    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        results.push(s.value);
      } else {
        // refreshSingleKeyword 内部已 try/catch，理论上不会 reject
        // 此分支为防御性兜底
        const tk = chunk[j];
        results.push({
          id: tk.id,
          keyword: tk.keyword,
          domain: tk.domain,
          location: tk.location,
          device: tk.device,
          position: null,
          url: null,
          fromCache: false,
          skipped: true,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        });
      }
    }
  }

  return results;
}

/**
 * 刷新指定用户的所有追踪关键词排名，返回刷新结果摘要。
 *
 * P0 修复：内部分批 + 并发，单批 MAX_KEYWORDS_PER_REQUEST，
 * 并发度 CONCURRENCY，系统级保险丝全程生效。
 */
export async function refreshAllRanks(
  userId: string,
  plan: PlanTier = "free",
  cronCtx?: CronRunContext
): Promise<RefreshResult> {
  const list = await listTrackedKeywords(userId);

  // 分批处理，每批 MAX_KEYWORDS_PER_REQUEST
  let refreshed = 0;
  let alerts = 0;
  const details: RefreshResult["details"] = [];

  for (let i = 0; i < list.length; i += MAX_KEYWORDS_PER_REQUEST) {
    // 系统级保险丝：批次之间检查
    if (cronCtx && cronCtx.stoppedByCostLimit) break;

    const batch = list.slice(i, i + MAX_KEYWORDS_PER_REQUEST);
    const items = await refreshRanksBatch(userId, plan, batch, cronCtx);

    for (const item of items) {
      if (item.error) {
        details.push({
          keyword: item.keyword,
          domain: item.domain,
          oldRank: null,
          newRank: item.position,
          fromCache: item.fromCache,
          error: item.error,
        });
      } else if (item.position !== null || item.fromCache) {
        refreshed++;
        if (!item.skipped) alerts++;
        details.push({
          keyword: item.keyword,
          domain: item.domain,
          oldRank: null,
          newRank: item.position,
          fromCache: item.fromCache,
        });
      } else {
        details.push({
          keyword: item.keyword,
          domain: item.domain,
          oldRank: null,
          newRank: null,
          fromCache: false,
          error: item.error,
        });
      }
    }
  }

  return { refreshed, alerts, details };
}
