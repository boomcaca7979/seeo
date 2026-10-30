// ===== 多方向扩词（纯函数：方向模板与查询组合，无任何网络/随机） =====
// P5-B：有控制的多方向扩词。方向模板只是「查询组合策略」，绝不是搜索数据；
// 只有把这些组合词交给真实 Google Autocomplete（/api/keywords/suggestions）后，
// 返回的建议词才会并入发现列表。绝不把模板本身当作关键词结果展示。
//
// 成本控制（硬约束）：
//   - 页面加载绝不自动发请求；用户主动点击某个方向才发起；
//   - 每个方向最多 4 个组合查询 = 最多 4 次 SerpApi 请求（24h 缓存命中零消耗）；
//   - 不递归、不串联二次扩词；
//   - 不适用的市场/语言明确禁用并说明原因，绝不输出错误翻译词。

export type DirectionId =
  | "free_price"
  | "best_alternatives"
  | "tutorial_questions"
  | "usecases_audience"
  | "compare_choose";

/** 单个修饰词：position 决定前缀/后缀组合（与真实搜索表达一致，如 "best X" / "X 免费"） */
export interface DirectionModifier {
  text: string;
  position: "prefix" | "suffix";
}

export interface ExpandDirection {
  id: DirectionId;
  zh: DirectionModifier[];
  en: DirectionModifier[];
}

/** 每方向最多 4 个修饰词（≤4 次 API 请求，成本上限明确） */
export const MAX_QUERIES_PER_DIRECTION = 4;

export const EXPAND_DIRECTIONS: ExpandDirection[] = [
  {
    id: "free_price",
    zh: [
      { text: "免费", position: "suffix" },
      { text: "价格", position: "suffix" },
      { text: "多少钱", position: "suffix" },
      { text: "收费", position: "suffix" },
    ],
    en: [
      { text: "free", position: "suffix" },
      { text: "pricing", position: "suffix" },
      { text: "cost", position: "suffix" },
      { text: "price", position: "suffix" },
    ],
  },
  {
    id: "best_alternatives",
    zh: [
      { text: "最佳", position: "prefix" },
      { text: "推荐", position: "suffix" },
      { text: "替代", position: "suffix" },
      { text: "排名", position: "suffix" },
    ],
    en: [
      { text: "best", position: "prefix" },
      { text: "top", position: "prefix" },
      { text: "alternative", position: "suffix" },
      { text: "alternatives", position: "suffix" },
    ],
  },
  {
    id: "tutorial_questions",
    zh: [
      { text: "教程", position: "suffix" },
      { text: "怎么用", position: "suffix" },
      { text: "如何", position: "prefix" },
      { text: "什么是", position: "prefix" },
    ],
    en: [
      { text: "how to", position: "prefix" },
      { text: "what is", position: "prefix" },
      { text: "tutorial", position: "suffix" },
      { text: "guide", position: "suffix" },
    ],
  },
  {
    id: "usecases_audience",
    zh: [
      { text: "用途", position: "suffix" },
      { text: "适合", position: "suffix" },
      { text: "案例", position: "suffix" },
      { text: "入门", position: "suffix" },
    ],
    en: [
      { text: "use cases", position: "suffix" },
      { text: "for beginners", position: "suffix" },
      { text: "examples", position: "suffix" },
      { text: "template", position: "suffix" },
    ],
  },
  {
    id: "compare_choose",
    zh: [
      { text: "对比", position: "suffix" },
      { text: "哪个好", position: "suffix" },
      { text: "区别", position: "suffix" },
      { text: "选择", position: "suffix" },
    ],
    en: [
      { text: "vs", position: "suffix" },
      { text: "comparison", position: "suffix" },
      { text: "review", position: "suffix" },
      { text: "reviews", position: "suffix" },
    ],
  },
];

export type DirectionLanguage = "zh" | "en";

/**
 * 市场 → 方向模板语言。仅对已验证模板的市场返回语言；其余市场返回 null
 * （UI 必须明确提示「该市场暂不支持方向扩词」，绝不输出错误翻译词）。
 * 与页面 KEYWORD_LOCATIONS 及 serpapi SERP_MARKETS 的 location 原值一致。
 */
export function directionLanguageForMarket(location: string): DirectionLanguage | null {
  const trimmed = location.trim();
  if (["中国", "香港", "台湾"].includes(trimmed)) return "zh";
  if (["美国", "英国"].includes(trimmed)) return "en";
  return null; // 日本/德国等：暂无已验证模板，明确不可用而非瞎猜翻译
}

/** 组合单个修饰词与种子词（模板组合是策略，不是搜索数据） */
function composeQuery(seed: string, modifier: DirectionModifier): string {
  return modifier.position === "prefix"
    ? `${modifier.text} ${seed}`
    : `${seed} ${modifier.text}`;
}

/**
 * 组合某方向在该市场语言下的查询列表（≤ MAX_QUERIES_PER_DIRECTION 条，保持模板顺序）。
 * 语言不可用时返回 []（调用方据此禁用并提示，绝不回退到另一语言的模板）。
 */
export function composeDirectionQueries(
  seed: string,
  directionId: DirectionId,
  language: DirectionLanguage
): string[] {
  const trimmedSeed = seed.trim();
  if (!trimmedSeed) return [];
  const direction = EXPAND_DIRECTIONS.find((d) => d.id === directionId);
  if (!direction) return [];
  const modifiers = direction[language] ?? [];
  return modifiers
    .slice(0, MAX_QUERIES_PER_DIRECTION)
    .map((m) => composeQuery(trimmedSeed, m));
}
