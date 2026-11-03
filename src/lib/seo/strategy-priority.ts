// ===== Strategy Priority（不依赖 Volume/KD/CPC 的主题优先级） =====
//
// 输入全部来自策略 doc 已持久化的真实数据：意图结构、SERP 证据规模、主题规模、
// 用户业务相关性权重、网站内容覆盖（可选，来自 Website Content Gap）。
//
// 诚实边界：
//   - 输出 Recommended / Review / Low priority + 逐条原因，绝不输出无解释的综合分数；
//   - 不使用搜索量、排名难度或流量预测；相关性默认由用户按主题判断（可调权重）。

import type { StrategyDoc, StrategyTopic } from "./strategy-model";
import type { SerpSnapshotMap } from "./serp-snapshot";

export type PriorityLevel = "recommended" | "review" | "low";

export interface TopicPriority {
  topicId: string;
  topicName: string;
  level: PriorityLevel;
  /** 自动分（0-100，仅内部排序与解释用，UI 展示原因而非裸分数） */
  internalScore: number;
  reasons: string[];
  /** 用户手动覆盖（持久化，重新计算时保留） */
  override?: PriorityLevel | null;
  /** 业务相关性：unset 时按用户全局权重处理；UI 可逐主题调整 */
  businessRelevance?: "high" | "normal" | "low" | null;
}

export interface PriorityInput {
  doc: StrategyDoc;
  snapshots?: SerpSnapshotMap | null;
  /** 用户业务相关性权重 0-2（默认 1；相关性=主题是否含业务核心词，简单实现为主题名命中 seeds） */
  relevanceWeight?: number;
  overrides?: Record<string, PriorityLevel> | null;
  /** 网站内容覆盖结果（可选）：topicId → covered | gap | unclear */
  contentCoverage?: Record<string, "covered" | "gap" | "unclear"> | null;
}

export function computeTopicPriorities(input: PriorityInput): TopicPriority[] {
  const { doc, snapshots } = input;
  const relevanceWeight = input.relevanceWeight ?? 1;
  const seeds = new Set(doc.meta.perSeed.filter((p) => p.ok).map((p) => p.seed.toLowerCase()));
  const coreSeed = seeds.size > 0 ? [...seeds][0] : "";

  return doc.topics.map((topic: StrategyTopic) => {
    const reasons: string[] = [];
    let score = 0;

    // 1. 意图清晰度：非未知意图占比
    const known = topic.intentCounts.informational + topic.intentCounts.commercial + topic.intentCounts.transactional + topic.intentCounts.navigational;
    const clarity = topic.keywordCount > 0 ? known / topic.keywordCount : 0;
    if (clarity >= 0.6) {
      score += 25;
      reasons.push(`意图明确（${known}/${topic.keywordCount} 个词有意图判断）`);
    } else if (clarity >= 0.3) {
      score += 12;
      reasons.push("意图部分明确");
    } else {
      score += 3;
      reasons.push("多数关键词意图未知，需要先补证据");
    }

    // 2. SERP 证据规模：主题主种子是否有快照（有 = 可做竞争分析/验证）
    const snapKey = Object.keys(snapshots ?? {}).find(
      (k) => topic.keywordIds.includes(k) || topic.name.toLowerCase().includes(k),
    );
    if (snapKey && (snapshots?.[snapKey]?.results.length ?? 0) > 0) {
      score += 20;
      reasons.push("已有 SERP 快照，竞争证据可直接分析");
    } else {
      reasons.push("暂无 SERP 快照（历史策略或缓存过期），可在需要时更新");
    }

    // 3. 主题规模：内容体量适中（过大难一次覆盖，过小撑不起一页）
    if (topic.keywordCount >= 4 && topic.keywordCount <= 25) {
      score += 20;
      reasons.push(`关键词体量适中（${topic.keywordCount} 个）`);
    } else if (topic.keywordCount > 25) {
      score += 10;
      reasons.push(`关键词较多（${topic.keywordCount} 个），建议拆分内容`);
    } else {
      score += 6;
      reasons.push(`关键词较少（${topic.keywordCount} 个）`);
    }

    // 4. 业务相关性：主题名/主种子命中业务核心词按权重放大
    const isCore = seeds.has(topic.name.toLowerCase()) || topic.name.toLowerCase().includes(coreSeed);
    if (isCore && relevanceWeight > 0) {
      score += Math.round(20 * relevanceWeight);
      reasons.push(relevanceWeight >= 1.5 ? "业务核心主题（高权重）" : "与业务核心直接相关");
    } else if (relevanceWeight < 1) {
      reasons.push("业务相关性权重已调低");
    }

    // 5. 网站覆盖（可选输入）
    const coverage = input.contentCoverage?.[topic.id];
    if (coverage === "gap") {
      score += 15;
      reasons.push("网站尚未覆盖该主题（内容缺口）");
    } else if (coverage === "covered") {
      score -= 8;
      reasons.push("网站已有相关页面，可优化而非新建");
    }

    // 6. 未分组主题降级
    if (topic.pillarId === null && topic.name === "Ungrouped keywords") {
      score = Math.min(score, 20);
      reasons.push("未分组关键词集合，需先人工归组");
    }

    const internalScore = Math.max(0, Math.min(100, score));
    const override = input.overrides?.[topic.id] ?? null;
    const level: PriorityLevel = override ?? (internalScore >= 60 ? "recommended" : internalScore >= 40 ? "review" : "low");

    return {
      topicId: topic.id,
      topicName: topic.name,
      level,
      internalScore,
      reasons: reasons.slice(0, 5),
      override,
      businessRelevance: null,
    };
  });
}
