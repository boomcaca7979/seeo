// ===== 竞品排名查询 =====
// P0-02-C：SERP 获取统一走 serp-service.searchSerp（provider 缓存 + serpapi 计费单点），
// 不再自带一套 cache/quota 逻辑——修复与 /api/seo/serp 缓存 key 不一致导致的重复扣费。

import { searchSerp } from "@/lib/seo/serp-service";
import { peekUsage } from "@/lib/seo/cache";
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
 * 查一个关键词的 SERP，解析出所有竞品排名。
 * SERP 缓存/额度由 searchSerp 统一处理（serp 命名空间，provider+keyword+location+language+device key），
 * 与 /api/seo/serp、/api/keywords/expand 共享同一份快照，不重复扣额度。
 * apiType 参数保留（ranks route 语义），实际计费始终在 searchSerp 内按 serpapi 记账。
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
  const { keyword, location, device, competitors, userId, plan = "free" } = params;

  const { result, fromCache } = await searchSerp(userId, plan, { keyword, location, device });
  const usage = await peekUsage(userId, params.apiType ?? "serpapi", plan);

  const results = parseSerpForCompetitors(result, competitors);
  return { results, fromCache, usage };
}

/**
 * 在 SERP organic 结果中定位各竞品排名。
 * 域名匹配口径：registrable/hostname 相等或互为子域（与 checkRank 一致）。
 * 不做 link.includes(compDomain) 的模糊匹配——URL 路径或参数中出现竞品域名不算排名。
 */
export function parseSerpForCompetitors(
  data: SerpResult,
  competitors: CompetitorInput[]
): CompetitorRankResult[] {
  const organic = data.organic ?? [];
  return competitors.map((comp) => {
    const compDomain = normalizeDomain(comp.domain);
    let foundRank: number | null = null;
    let foundUrl: string | null = null;

    for (const item of organic) {
      const domain = normalizeDomain(item.domain ?? "");
      if (domain === compDomain || domain.endsWith(`.${compDomain}`)) {
        foundRank = item.position;
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
