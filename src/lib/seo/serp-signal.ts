// ===== SeeO SERP Competition Signal（SeeO 自有竞争信号，非 Google KD）=====
// 确定性纯函数：只使用本次第一页快照中真实存在的证据（域名集中度、feature 挤压、
// 自然结果稀疏度、标题关键词匹配）。样本量 = 快照 organic 条数（约 10 条），不使用任何
// 搜索量/外链/权威度输入；0-100 只是 SeeO 的相对参考分，绝不标注为搜索量、难度或官方指标。
// 纯函数 + 零依赖：客户端页面（keyword-expand）与服务端共用同一份实现。

export interface SerpCompetitionSignal {
  /** 0-100（整数）；构成见 inputs，公式在 UI 文案中说明 */
  score: number;
  inputs: {
    organicCount: number;
    distinctDomains: number;
    featureCount: number;
    blockingFeatures: string[];
    /** 标题中包含种子词的结果条数（真实标题证据，P7 新增） */
    titleMatchCount: number;
  };
  /** 参与计算的快照结果条数（诚实标注小样本局限） */
  sampleSize: number;
}

/** 挤压自然结果的 SERP feature 权重（其余 feature 权重 1） */
const SERP_SIGNAL_BLOCKING_WEIGHTS: Record<string, number> = {
  ai_overview: 3,
  featured_snippet: 3,
  local_pack: 2,
  shopping_results: 2,
};

/**
 * SeeO SERP Competition Signal：
 *   score = 100 × (0.30 × 域名集中度 + 0.30 × feature 挤压度 + 0.20 × 自然结果稀疏度 + 0.20 × 标题关键词匹配度)
 *   - 域名集中度 = 1 − distinct(domains)/organicCount（独占域名越集中 → 头部越牢固）
 *   - feature 挤压度 = min(1, Σ块权重/6)（AI 概览/精选摘要=3，本地包/购物=2，其余=1）
 *   - 自然结果稀疏度 = max(0, 1 − organicCount/10)（快照里自然结果越少，点击余量越小）
 *   - 标题关键词匹配度 = 标题包含种子词的结果条数 / organicCount（P7：整页都在精确优化
 *     同一个词 → 头部针对性强；标题来自快照真实 title，匹配口径 = 小写 includes）
 * 无自然结果（organic 为空）时返回 null——不编造分数。
 */
export function computeSerpCompetitionSignal(
  result: { organic: { domain: string; title?: string }[]; features?: { featureType: string }[] | null },
  keyword: string
): SerpCompetitionSignal | null {
  const organic = result.organic;
  const features = result.features ?? [];
  if (organic.length === 0) return null;
  const distinctDomains = new Set(organic.map((row) => row.domain)).size;
  const concentration = Math.max(0, Math.min(1, 1 - distinctDomains / organic.length));
  let featureWeight = 0;
  const blockingFeatures: string[] = [];
  for (const feature of features) {
    const weight = SERP_SIGNAL_BLOCKING_WEIGHTS[feature.featureType];
    featureWeight += weight ?? 1;
    if (weight !== undefined) blockingFeatures.push(feature.featureType);
  }
  const featurePressure = Math.min(1, featureWeight / 6);
  const sparseOrganic = Math.max(0, Math.min(1, 1 - organic.length / 10));
  const needle = keyword.trim().toLowerCase();
  const titleMatchCount = needle
    ? organic.filter((row) => typeof row.title === "string" && row.title.toLowerCase().includes(needle)).length
    : 0;
  const titleMatch = titleMatchCount / organic.length;
  const score = Math.round(
    Math.max(
      0,
      Math.min(1, 0.3 * concentration + 0.3 * featurePressure + 0.2 * sparseOrganic + 0.2 * titleMatch)
    ) * 100
  );
  return {
    score,
    inputs: {
      organicCount: organic.length,
      distinctDomains,
      featureCount: features.length,
      blockingFeatures,
      titleMatchCount,
    },
    sampleSize: organic.length,
  };
}
