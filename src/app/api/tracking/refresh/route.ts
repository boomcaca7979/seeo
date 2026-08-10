// ===== /api/tracking/refresh =====
// 遍历所有追踪词刷新今日排名；同一天重复刷新走缓存不重复扣额度

import { NextResponse } from "next/server";
import {
  listTrackedKeywords,
  upsertRankHistory,
  updateLastRefreshed,
  hasTodayHistory,
  getRankHistory,
} from "@/lib/db";
import { serpApiProvider } from "@/lib/seo/serpapi";
import { SeoProviderError } from "@/lib/seo/provider";
import { consumeQuota, peekUsage, readCache, writeCache, QuotaExceededError } from "@/lib/seo/cache";
import { generateRankAlert } from "@/lib/seo/alerts";
import type { RankResult } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RefreshItem {
  id: number;
  keyword: string;
  domain: string;
  location: string;
  device: "PC" | "移动端";
  position: number | null;
  url: string | null;
  fromCache: boolean;
  skipped: boolean; // 今日已刷新过且缓存仍在 → 跳过不计费
  error?: string;
}

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

export async function POST() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const list = await listTrackedKeywords(userId);

  if (list.length === 0) {
    const usage = await peekUsage(userId, "serpapi", plan);
    return NextResponse.json({
      data: { items: [], summary: "暂无追踪词" },
      usage,
    });
  }

  const items: RefreshItem[] = [];
  const today = todayStr();

  for (const tk of list) {
    const params = {
      keyword: tk.keyword,
      domain: tk.domain,
      location: tk.location,
      device: tk.device,
    };

    // 1. 先查本地 rank 缓存（24h TTL，与 serp 路由共用 cache.ts）
    let rankResult: RankResult | null = null;
    let fromCache = false;
    let consumed = false;
    let errMsg: string | undefined;

    try {
      const cached = await readCache<RankResult>("rank", params);
      if (cached) {
        rankResult = cached;
        fromCache = true;
      } else {
        // 2. DB 中今日是否已有记录（避免同日重复扣额度）
        const dbHasToday = await hasTodayHistory(userId, tk.id);
        if (dbHasToday) {
          // 今日已查过且缓存已过期：用 DB 里的历史记录作为结果（不再扣额度）
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
          try {
            await consumeQuota(userId, "serpapi", plan);
            consumed = true;
            rankResult = await serpApiProvider.checkRank(params);
            // 写缓存
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
              errMsg = "本月免费额度已用尽（80/100），下月 1 日自动重置";
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
        //    缓存命中 / DB 今日已有记录的跳过路径一律不生成，避免同日重复
        if (consumed) {
          generateRankAlert(userId, tk, rankResult.rank, today);
        }
      }
    } catch (e) {
      errMsg = (e as Error).message;
    }

    items.push({
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
    });
  }

  const usage = await peekUsage(userId, "serpapi", plan);
  const successCount = items.filter((i) => !i.error).length;
  const summary = `已刷新 ${successCount}/${items.length} 个词` + (items.some((i) => i.fromCache) ? "（部分命中缓存未扣额度）" : "");

  return NextResponse.json({
    data: { items, summary },
    usage,
  });
}
