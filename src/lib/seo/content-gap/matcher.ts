// ===== Content Gap 匹配（纯函数：站点页面 × 策略主题的覆盖/缺口/内耗判定） =====
//
// 诚实边界：
//   - 匹配证据全部来自真实抓取到的 title/h1/slug 与策略关键词的词面重合；
//   - 抓取失败/未抓到的页面绝不当成「缺口」证据——页面不足时归 Needs Review；
//   - 内耗（Cannibalization）必须有逐条匹配依据，不能因为共享一个词就判定。

import type { StrategyDoc } from "../strategy-model";

export interface SitePageRecord {
  url: string;
  title: string | null;
  h1: string | null;
  httpStatus: number | null;
  error: string | null;
}

export type GapStatus = "covered" | "potential-gap" | "needs-review";

export interface TopicCoverage {
  topicId: string;
  topicName: string;
  status: GapStatus;
  /** 匹配到的站内页面（含证据） */
  matchedPages: Array<{ url: string; title: string | null; h1: string | null; evidence: string[] }>;
  /** 判定说明 */
  reason: string;
}

export interface CannibalizationCase {
  topicId: string;
  topicName: string;
  pages: Array<{ url: string; title: string | null; h1: string | null; evidence: string[] }>;
  reason: string;
  /** 建议：合并 / 区分意图 / 建立内链 */
  suggestion: string;
}

export interface ContentGapResult {
  coverage: TopicCoverage[];
  cannibalization: CannibalizationCase[];
  /** 抓取完整性：分析是否建立在足够样本上 */
  crawledCount: number;
  failedCount: number;
  totalKnown: number;
}

/** 轻量 token 化：小写、拉丁按非字母数字切、CJK 2-gram；与策略侧停用词口径一致 */
function tokens(text: string): string[] {
  const out = new Set<string>();
  const lower = (text ?? "").toLowerCase();
  for (const t of lower.split(/[^a-z0-9\u4e00-\u9fff']+/)) {
    if (t.length >= 2) out.add(t);
  }
  const runs = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of runs) {
    for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

function slugOf(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).join(" "));
  } catch {
    return "";
  }
}

/** 页面文本指纹：title + h1 + slug（真实抓取到的字段） */
function pageTokens(page: SitePageRecord): Set<string> {
  return new Set([...tokens(page.title ?? ""), ...tokens(page.h1 ?? ""), ...tokens(slugOf(page.url))]);
}

/** 主题查询词：topic 名 + 成员关键词（策略侧真实关键词） */
function topicTokens(doc: StrategyDoc, topicId: string): { query: Set<string>; keywords: string[] } {
  const topic = doc.topics.find((t) => t.id === topicId);
  if (!topic) return { query: new Set(), keywords: [] };
  const kwById = new Map(doc.keywords.map((k) => [k.id, k]));
  const keywords = topic.keywordIds.map((id) => kwById.get(id)?.keyword ?? id).slice(0, 20);
  const query = new Set<string>(tokens(topic.name));
  for (const kw of keywords) for (const t of tokens(kw)) query.add(t);
  return { query, keywords };
}

const MATCH_MIN_TOKENS = 2;

export function analyzeContentGap(
  doc: StrategyDoc,
  pages: SitePageRecord[],
  opts?: { minTitleMatchForCannibalization?: number },
): ContentGapResult {
  const crawled = pages.filter((p) => p.httpStatus && p.httpStatus >= 200 && p.httpStatus < 300 && !p.error);
  const failed = pages.length - crawled.length;
  const crawledTokenized = crawled.map((p) => ({ page: p, tokens: pageTokens(p) }));

  const coverage: TopicCoverage[] = [];
  const cannibalization: CannibalizationCase[] = [];

  for (const topic of doc.topics) {
    const { query, keywords } = topicTokens(doc, topic.id);
    const matched: TopicCoverage["matchedPages"] = [];

    for (const { page, tokens: pt } of crawledTokenized) {
      // 证据：topic 查询 token 与页面 token 的交集（真实词面重合）
      const hit = [...query].filter((t) => pt.has(t));
      // 页面命中该主题下≥1个完整关键词（title/h1 词面包含）也算强证据
      const kwHit = keywords.find((kw) => {
        const kwLower = kw.toLowerCase();
        return (
          (page.title ?? "").toLowerCase().includes(kwLower) ||
          (page.h1 ?? "").toLowerCase().includes(kwLower)
        );
      });
      if (hit.length >= MATCH_MIN_TOKENS || kwHit) {
        const evidence = [
          ...(hit.length ? [`共同词：${hit.slice(0, 6).join("、")}`] : []),
          ...(kwHit ? [`页面标题/H1 命中关键词「${kwHit}」`] : []),
        ];
        matched.push({ url: page.url, title: page.title, h1: page.h1, evidence });
      }
    }

    // 判定：
    //   有匹配页面 → Covered（多页强匹配则进入内耗检查）
    //   无匹配但抓取完整（crawled≥5 且 failed ≤ crawled 的 20%）→ Potential Gap
    //   抓取不完整/样本太小 → Needs Review（绝不说「肯定缺」）
    const crawlHealthy = crawled.length >= 5 && failed <= Math.ceil(crawled.length * 0.2);
    if (matched.length === 0) {
      coverage.push({
        topicId: topic.id,
        topicName: topic.name,
        status: crawlHealthy ? "potential-gap" : "needs-review",
        matchedPages: [],
        reason: crawlHealthy
          ? `站点扫描完整（${crawled.length} 页成功），未发现与该主题匹配的页面`
          : `抓取样本不足（成功 ${crawled.length} 页 / 失败 ${failed} 页），无法判定是否缺失`,
      });
      continue;
    }

    coverage.push({
      topicId: topic.id,
      topicName: topic.name,
      status: "covered",
      matchedPages: matched.slice(0, 10),
      reason: `发现 ${matched.length} 个相关页面`,
    });

    // 内耗：≥2 个页面都以「页面标题/H1 命中完整关键词」为证据，才值得审查
    const minStrong = opts?.minTitleMatchForCannibalization ?? 2;
    const strong = matched.filter((m) => m.evidence.some((e) => e.startsWith("页面标题/H1 命中")));
    if (strong.length >= minStrong) {
      cannibalization.push({
        topicId: topic.id,
        topicName: topic.name,
        pages: strong.slice(0, 8),
        reason: `${strong.length} 个页面的标题/H1 直接命中同一主题关键词`,
        suggestion:
          strong.length === 2
            ? "建议确认两页意图：相同意图则合并为一页并 301/内链归一；不同意图（如信息 vs 产品）则用不同标题与结构区分，并互相内链"
            : "多页同题竞争：保留最相关的一页为主页面，其余页面改造成子话题或合并，并从主页面建立内链",
      });
    }
  }

  return {
    coverage,
    cannibalization,
    crawledCount: crawled.length,
    failedCount: failed,
    totalKnown: pages.length,
  };
}
