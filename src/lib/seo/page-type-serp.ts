// ===== SERP 页面类型识别（纯本地规则，零外部 API 成本） =====
//
// 依据：真实返回的标题、URL、摘要（含已有 SERP feature 上下文）。
// 诚实边界：这是启发式判断，不是对页面内容的实际抓取分析；
// 每个判断附带置信度与证据；无法判断时明确 Unknown，绝不强行分类。

export type SerpPageType =
  | "product"
  | "category"
  | "blog-article"
  | "tutorial-guide"
  | "comparison"
  | "listicle"
  | "forum-community"
  | "video"
  | "other"
  | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface SerpPageTypeResult {
  type: SerpPageType;
  confidence: Confidence;
  /** 命中的证据（真实标题/URL/摘要片段），UI 逐条可查 */
  evidence: string[];
}

const URL_RULES: Array<{ type: SerpPageType; patterns: RegExp; weight: Confidence }> = [
  { type: "blog-article", patterns: /\/(blog|articles?|posts?|news)\//i, weight: "high" },
  { type: "tutorial-guide", patterns: /\/(guide|guides|tutorial|tutorials|how-to|learn|docs?|documentation)\//i, weight: "high" },
  { type: "product", patterns: /\/(product|products|shop|store|pdp)\/|\/p\//i, weight: "high" },
  { type: "category", patterns: /\/(category|categories|collections?|c\/|tags?|topics?)\//i, weight: "medium" },
  { type: "forum-community", patterns: /\/(forum|forums|community|questions?|thread|discuss|topic)\//i, weight: "high" },
  { type: "listicle", patterns: /\/(list|listicle|top-\d+|best-\d+)/i, weight: "medium" },
];

const FORUM_DOMAINS = /(^|\.)(reddit\.com|quora\.com|stackoverflow\.com|stackexchange\.com|zhihu\.com|tieba\.baidu\.com|medium\.com)$/i;
const VIDEO_DOMAINS = /(^|\.)(youtube\.com|youtu\.be|bilibili\.com|vimeo\.com|tiktok\.com)$/i;
const MARKETPLACES = /(^|\.)(amazon\.|ebay\.|etsy\.|walmart\.|taobao\.|jd\.|tmall\.)/i;

const TITLE_RULES: Array<{ type: SerpPageType; patterns: RegExp; weight: Confidence; evidence: string }> = [
  { type: "listicle", patterns: /\b(top|best)\s+\d+\b|\d+\s+(best|ways|tips|tools|reasons)\b/i, weight: "high", evidence: "标题含数字清单模式" },
  { type: "comparison", patterns: /\b(vs\.?|versus|compared?|comparison|alternatives?)\b|\bvs\b/i, weight: "high", evidence: "标题含对比词（vs/alternatives/compared）" },
  { type: "tutorial-guide", patterns: /\bhow to\b|\bstep[- ]by[- ]step\b|\bguide\b|\btutorial\b|教程|指南|怎么|如何/i, weight: "medium", evidence: "标题含教程/指南模式" },
  { type: "comparison", patterns: /\bbest\b|最好的|推荐/i, weight: "low", evidence: "标题含 best/推荐（偏商业比较）" },
  { type: "product", patterns: /\b(buy|price|for sale|shop|discount|coupon)\b|购买|价格|优惠/i, weight: "medium", evidence: "标题含购买/价格信号" },
  { type: "video", patterns: /\bvideo\b|视频|watch/i, weight: "low", evidence: "标题含视频信号" },
];

export function classifySerpPageType(row: {
  title: string;
  url: string;
  snippet?: string;
  domain?: string;
  /** 该结果所在的 SERP 是否出现视频 feature（上下文证据，非页面本身） */
  hasVideoFeature?: boolean;
}): SerpPageTypeResult {
  const evidence: string[] = [];
  let type: SerpPageType = "unknown";
  let score = 0;

  // domain 缺省时从 URL 兜底提取（调用方未必总是带 domain）
  const derivedDomain =
    row.domain ??
    (() => {
      try {
        return new URL(row.url).host;
      } catch {
        return "";
      }
    })();
  const domain = derivedDomain.toLowerCase();

  const bump = (t: SerpPageType, w: number, ev: string) => {
    if (w > score) {
      score = w;
      type = t;
    }
    evidence.push(ev);
  };

  if (domain && VIDEO_DOMAINS.test(domain)) {
    bump("video", 95, `域名为视频平台（${domain}）`);
  } else if (row.hasVideoFeature && VIDEO_DOMAINS.test(domain)) {
    bump("video", 80, "视频 feature 且来自视频平台");
  }
  if (domain && FORUM_DOMAINS.test(domain)) {
    bump("forum-community", 95, `社区/问答平台域名（${domain}）`);
  }
  if (domain && MARKETPLACES.test(domain)) {
    bump("product", 85, `电商平台域名（${domain}）`);
  }

  for (const rule of URL_RULES) {
    if (rule.patterns.test(row.url)) {
      const w = rule.weight === "high" ? 70 : rule.weight === "medium" ? 45 : 25;
      bump(rule.type, w, `URL 路径模式（${rule.type}）`);
    }
  }
  for (const rule of TITLE_RULES) {
    if (rule.patterns.test(row.title)) {
      const w = rule.weight === "high" ? 60 : rule.weight === "medium" ? 40 : 20;
      bump(rule.type, w, rule.evidence);
    }
  }
  if (row.snippet && /\b(review|hands-on|tested|unboxing)\b/i.test(row.snippet)) {
    bump("comparison", 30, "摘要含评测信号");
  }

  if (score === 0) {
    return { type: "unknown", confidence: "low", evidence: ["标题/URL/摘要无可识别的类型信号"] };
  }
  const confidence: Confidence = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { type, confidence, evidence };
}
