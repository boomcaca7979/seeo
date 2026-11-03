// ===== Search Intent 2.0（多证据融合：文本规则 + SERP 页面类型 + PAA/Related 证据） =====
//
// 诚实边界：
//   - 输出 Primary/Secondary/Confidence/Evidence/Source，全部证据逐条可查；
//   - 证据不足保留 Unknown / Low confidence，绝不强行分类；
//   - 交易型（Transactional）只在高置信 SERP 产品证据下输出，文本规则无法可靠区分
//     Commercial / Transactional（与 keyword-intent.ts 的边界一致）；
//   - 日/德文只收录广泛成立的高置信修饰词，不为覆盖市场强行造规则。

import { classifySerpPageType, type SerpPageType } from "./page-type-serp";
import type { CompactSerpSnapshot } from "./serp-snapshot";

export type IntentLabel = "信息型" | "商业型" | "交易型" | "导航型" | "本地型" | "未知";
export type IntentConfidence = "high" | "medium" | "low";

export interface IntentEvidence {
  primary: IntentLabel;
  secondary: IntentLabel | null;
  confidence: IntentConfidence;
  evidence: string[];
  /** text = 关键词文本规则；serp = SERP 页面类型证据；mixed = 两者一致互相印证 */
  source: "text" | "serp" | "mixed" | "none";
}

// ---------- 文本规则（zh / en / ja / de） ----------

const TEXT_RULES: Array<{ pattern: RegExp; intent: IntentLabel; ev: string }> = [
  // 英文
  { pattern: /\b(what|how|why|which|guide|tutorial|learn|examples?|ideas?)\b|\b(is|are|does|do|can)\b.*\?/i, intent: "信息型", ev: "疑问/学习型词" },
  { pattern: /\b(best|top|review|reviews|compare|comparison|vs\.?|alternatives?)\b/i, intent: "商业型", ev: "比较/评测词" },
  { pattern: /\b(price|pricing|cost|cheap|cheapest|buy|order|deal|coupon|discount)\b/i, intent: "交易型", ev: "价格/购买词" },
  { pattern: /\b(login|log ?in|log ?into|sign ?in|sign ?up|signup|logout|download|app)\b/i, intent: "导航型", ev: "登录/导航词" },
  { pattern: /\b(near me|nearby|in .*(city|area)|local)\b/i, intent: "本地型", ev: "本地词" },
  // 中文
  { pattern: /什么|怎么|为什么|如何|是不是|哪些|教程|指南|入门/i, intent: "信息型", ev: "疑问/学习词" },
  { pattern: /推荐|最好|对比|评测|哪个好|排行/i, intent: "商业型", ev: "比较/推荐词" },
  { pattern: /价格|多少钱|购买|优惠|便宜|报价/i, intent: "交易型", ev: "价格/购买词" },
  { pattern: /登录|登入|官网|下载/i, intent: "导航型", ev: "登录/导航词" },
  { pattern: /附近|哪里有|本地/i, intent: "本地型", ev: "本地词" },
  // 日文（高置信修饰词）
  { pattern: /とは|方法|やり方|使い方|意味/i, intent: "信息型", ev: "意味/方法词" },
  { pattern: /おすすめ|比較|ランキング|評判/i, intent: "商业型", ev: "おすすめ/比較词" },
  { pattern: /料金|価格|購入|安い/i, intent: "交易型", ev: "料金/購入词" },
  { pattern: /ログイン|公式/i, intent: "导航型", ev: "ログイン/公式词" },
  // 德文（高置信修饰词）
  { pattern: /\b(wie|was|warum|anleitung|ratgeber)\b/i, intent: "信息型", ev: "Wie/Anleitung 词" },
  { pattern: /\b(beste|vergleich|erfahrungen|test)\b/i, intent: "商业型", ev: "Beste/Vergleich 词" },
  { pattern: /\b(preis|kaufen|günstig|kosten)\b/i, intent: "交易型", ev: "Preis/kaufen 词" },
  { pattern: /\b(login|anmelden|download)\b/i, intent: "导航型", ev: "Login/Anmelden 词" },
];

const SERP_TYPE_TO_INTENT: Record<SerpPageType, { intent: IntentLabel; weight: number; ev: string }> = {
  "tutorial-guide": { intent: "信息型", weight: 30, ev: "Top 10 以教程/指南为主" },
  "blog-article": { intent: "信息型", weight: 25, ev: "Top 10 以博客文章为主" },
  "forum-community": { intent: "信息型", weight: 25, ev: "Top 10 以社区讨论为主（信息探索）" },
  comparison: { intent: "商业型", weight: 30, ev: "Top 10 以比较/评测页为主" },
  listicle: { intent: "商业型", weight: 30, ev: "Top 10 以清单推荐页为主" },
  product: { intent: "交易型", weight: 35, ev: "Top 10 以产品/购买页为主" },
  category: { intent: "商业型", weight: 25, ev: "Top 10 以类目页为主" },
  video: { intent: "信息型", weight: 15, ev: "视频结果为主" },
  other: { intent: "未知", weight: 0, ev: "" },
  unknown: { intent: "未知", weight: 0, ev: "" },
};

const RELATED_COMMERCIAL = /\b(alternatives?|reviews?|vs\.?|comparison)\b|推荐|对比|alternatives/i;

export function detectIntentEvidence(
  query: string,
  snapshot?: CompactSerpSnapshot | null,
): IntentEvidence {
  const q = query.toLowerCase();
  const evidence: string[] = [];
  const scores = new Map<IntentLabel, number>();
  let textHits = 0;
  let serpHits = 0;

  const add = (intent: IntentLabel, w: number, ev: string) => {
    if (intent === "未知" || w === 0) return;
    scores.set(intent, (scores.get(intent) ?? 0) + w);
    evidence.push(ev);
  };

  // 1. 文本规则
  for (const rule of TEXT_RULES) {
    if (rule.pattern.test(q)) {
      textHits += 1;
      add(rule.intent, 30, `关键词包含${rule.ev}`);
    }
  }

  // 2. SERP 页面类型（对 Top 10 逐条分类后聚合）
  const typeCounts = new Map<SerpPageType, number>();
  if (snapshot) {
    for (const row of snapshot.results) {
      const r = classifySerpPageType(row);
      if (r.type !== "unknown") typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
    }
    for (const [type, count] of typeCounts) {
      if (count >= 3) {
        const sig = SERP_TYPE_TO_INTENT[type];
        serpHits += 1;
        add(sig.intent, sig.weight, `${sig.ev}（${count}/10 条）`);
      }
    }
    // 3. Related Searches 佐证
    const relatedText = snapshot.related.join(" ");
    if (relatedText && RELATED_COMMERCIAL.test(relatedText)) {
      serpHits += 1;
      add("商业型", 15, "相关搜索包含 alternatives/reviews/对比类词");
    }
  }

  if (scores.size === 0) {
    return { primary: "未知", secondary: null, confidence: "low", evidence: evidence.length ? evidence : ["无可识别意图信号"], source: "none" };
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [primary, pScore] = ranked[0];
  const secondary = ranked[1] && ranked[1][1] >= pScore * 0.6 ? ranked[1][0] : null;

  // 置信度：文本 + SERP 一致互相印证 → high；单一来源强信号 → medium；弱/冲突 → low
  const source: IntentEvidence["source"] =
    textHits > 0 && serpHits > 0 ? "mixed" : textHits > 0 ? "text" : "serp";
  let confidence: IntentConfidence;
  if (source === "mixed" && pScore >= 55) confidence = "high";
  else if (pScore >= 50 || (source === "mixed" && pScore >= 40)) confidence = "medium";
  else confidence = "low";

  return { primary, secondary, confidence, evidence: evidence.slice(0, 6), source };
}
