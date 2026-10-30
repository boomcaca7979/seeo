// ===== 关键词合并/去重（纯函数，客户端与服务端共用） =====
// Keyword Research 的唯一合并去重实现：/api/keywords/suggestions（服务端）与
// keyword-expand 页面（客户端，把建议词并入已有结果）都从这里取逻辑，禁止各自复制。
// 与 KeywordOrigin 相关的类型也集中在此，keyword-research-service re-export 保持既有契约。

/** 关键词来源：seed=种子词；related=Google 相关搜索；paa=People Also Ask；
    autocomplete=Google 自动补全（用户主动获取）；labs_suggestions=DataForSEO Labs 长尾建议；
    labs_ideas=Labs 语义相关词；trends_queries=Google Trends 相关查询（top+rising，用户主动获取）；
    trends_topics=Google Trends 相关主题（主题实体，通常不作为关键词合并，仅来源标记保留）；
    serp_content=SERP 标题/摘要内容提取（真实 SERP 文本的候选，绝不是 Google 推荐词） */
export type KeywordOrigin =
  | "seed"
  | "related"
  | "paa"
  | "autocomplete"
  | "labs_suggestions"
  | "labs_ideas"
  | "trends_queries"
  | "trends_topics"
  | "serp_content";

/** 去重 key：与 OpenSEO 一致的 trim + 小写归一 */
export function normalizeKeywordForDedup(keyword: string): string {
  return keyword.trim().toLowerCase();
}

/** 合并后的候选关键词：origin 为首个来源，origins 为全部来源（跨来源去重合并） */
export interface KeywordCandidate {
  keyword: string;
  origin: KeywordOrigin;
  origins: KeywordOrigin[];
}

/** 数据库扩词等额外来源（origin 不含 seed/related/paa） */
export interface KeywordExtraSource {
  origin: Exclude<KeywordOrigin, "seed" | "related" | "paa">;
  keywords: string[];
}

/**
 * 合并 seed / related / paa / 额外来源（自动补全、数据库扩词）为去重后的候选列表（保留首次出现的原文）。
 * 同一关键词命中多个来源时只保留一条，并把来源合并进 origins（不按来源重复计数）。
 */
export function mergeKeywordCandidates(
  seed: string,
  related: string[],
  paa: string[],
  limit: number,
  extraSources: KeywordExtraSource[] = []
): KeywordCandidate[] {
  const byKey = new Map<string, KeywordCandidate>();
  const push = (keyword: string, origin: KeywordOrigin) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    const key = normalizeKeywordForDedup(trimmed);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
      return;
    }
    if (byKey.size >= limit) return;
    byKey.set(key, { keyword: trimmed, origin, origins: [origin] });
  };
  push(seed, "seed");
  for (const keyword of related) push(keyword, "related");
  for (const keyword of paa) push(keyword, "paa");
  for (const source of extraSources) {
    for (const keyword of source.keywords) push(keyword, source.origin);
  }
  return [...byKey.values()];
}

/** 建议词列表去重（服务端建议词端点用；与 mergeKeywordCandidates 同一套归一口径） */
export function dedupeKeywordList(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of keywords) {
    const key = normalizeKeywordForDedup(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword.trim());
  }
  return result;
}
