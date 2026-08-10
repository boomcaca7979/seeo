// ===== 竞品排名查询 =====
// 复用 serp 命名空间缓存（24h TTL）+ consumeQuota 计数
// 与 /api/seo/serp、/api/keywords/expand 共享缓存，避免重复扣额度

import { serpApiProvider } from "@/lib/seo/serpapi";
import { SeoProviderError } from "@/lib/seo/provider";
import { consumeQuota, readCache, writeCache, peekUsage, QuotaExceededError } from "@/lib/seo/cache";
import type { SerpResult, ApiUsage } from "@/lib/seo/types";
import type { PlanTier } from "@/lib/auth";
import type { ApiType } from "@/lib/db";

export interface CompetitorInput {
  id: number;
  domain: string;
}

export interface CompetitorRankResult {
  competitorId: number;
  domain: string;
  rank: number | null;
  targetUrl: string | null;
}

export interface CheckResult {
  results: CompetitorRankResult[];
  fromCache: boolean;
  usage: ApiUsage;
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
}

/**
 * 查一个关键词的 SERP，解析出所有竞品排名
 * 复用 serp 命名空间缓存：与 /api/seo/serp 共享，避免重复扣额度
 * P0 商业化改造：按 userId + plan 计量，禁止匿名消耗公共额度
 */
export async function checkCompetitorRanks(params: {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  competitors: CompetitorInput[];
  userId: string;
  plan?: PlanTier;
  apiType?: ApiType;
}): Promise<CheckResult> {
  const { keyword, location, device, competitors, userId, plan = "free", apiType = "serpapi" } = params;
  const cacheParams = { keyword, location, device };

  // 1. 先读 serp 命名空间缓存
  let cached: SerpResult | null = null;
  try {
    cached = await readCache<SerpResult>("serp", cacheParams);
  } catch {
    // 缓存读取失败不阻塞
  }

  let serpResult: SerpResult;
  let fromCache: boolean;
  let usage: ApiUsage;

  if (cached) {
    serpResult = cached;
    fromCache = true;
    usage = await peekUsage(userId, apiType, plan);
  } else {
    // 2. 真实调用：先消耗额度（用户级隔离）
    try {
      usage = await consumeQuota(userId, apiType, plan);
    } catch (e) {
      if (e instanceof QuotaExceededError) throw e;
      if (e instanceof Error && e.message === "QUOTA_EXCEEDED") {
        throw e;
      }
      throw e;
    }
    // 3. 调 SerpApi
    try {
      serpResult = await serpApiProvider.searchSerp({ keyword, location, device });
    } catch (e) {
      if (e instanceof SeoProviderError) throw e;
      throw e;
    }
    // 写缓存（与 /api/seo/serp 共享命名空间）
    try {
      await writeCache("serp", cacheParams, serpResult);
    } catch {
      // 缓存写入失败不阻塞
    }
    fromCache = false;
  }

  const results = parseSerpForCompetitors(serpResult, competitors);
  return { results, fromCache, usage };
}

function parseSerpForCompetitors(
  data: SerpResult,
  competitors: CompetitorInput[]
): CompetitorRankResult[] {
  const organic = data.organic ?? [];
  return competitors.map((comp) => {
    const compDomain = normalizeDomain(comp.domain);
    let foundRank: number | null = null;
    let foundUrl: string | null = null;

    for (let i = 0; i < organic.length; i++) {
      const item = organic[i];
      const link = (item.link ?? "").toLowerCase();
      const domain = normalizeDomain(item.domain ?? link);
      if (domain === compDomain || domain.endsWith(`.${compDomain}`) || link.includes(compDomain)) {
        foundRank = i + 1;
        foundUrl = item.link ?? null;
        break;
      }
    }

    return {
      competitorId: comp.id,
      domain: comp.domain,
      rank: foundRank,
      targetUrl: foundUrl,
    };
  });
}
