// ===== Agent Runtime（P0-04） =====
// User message → Skill Router → Skill workflow（经 MCP tools）→ Evidence → Structured result。
//
// 边界：
// - Skill 一律经 MCP tool registry 调用业务能力（授权路径与外部 client 相同），不直接访问 DB。
// - LLM interpretation 不在本 runtime（SeeO 无 LLM provider）：结构化结果（FACT/SIGNAL/
//   DATA GAP）即交付物，解释由调用方 agent 按 skill 的 Output Format 完成。
// - 每个 skill 有工具调用上限与 cost-aware 工具顺序（免费/DB 工具优先）。

import { EvidenceCollector, createMcpToolExecutor, type ToolExecutor, type EvidenceRecord } from "./evidence";
import { SKILLS, type SkillDefinition, type SkillId } from "./skills";
import { routeSkill } from "./router";
import type { ToolAuthContext } from "@/server/mcp/context";
import { McpNormalizedError } from "@/server/mcp/errors";

export interface AgentSkillParams {
  /** 关键词研究 seed / 诊断目标品牌 */
  seed?: string;
  /** 竞品 id（项目已保存的 competitor） */
  competitorId?: number;
  locationCode?: number;
  languageCode?: string;
}

export interface AgentSkillResult {
  skill: SkillId;
  projectId: string;
  /** FACT：工具原始结构化证据（不可被 LLM 改写） */
  facts: Array<{ id: string; tool: string; label: string; data: unknown; capturedAt: string }>;
  /** SIGNAL：由多个 FACT 直接计算的确定性信号 */
  signals: Array<{ description: string; evidenceIds: string[] }>;
  /** DATA GAP：不可用数据及对置信度的影响 */
  dataGaps: Array<{ tool: string; reason: string; impact: string }>;
  warnings: string[];
  toolCallsUsed: number;
  toolCallBudget: number;
  /** 给解释层（LLM agent）的结构化提示：FACT→SIGNAL→解读→建议的骨架 */
  interpretation: {
    summary: string;
    observations: string[];
    recommendations: Array<{ action: string; evidenceIds: string[] }>;
  };
}

interface SkillContext {
  collector: EvidenceCollector;
  projectId: string;
  params: AgentSkillParams;
}

type SkillExecutor = (ctx: SkillContext) => Promise<{ summary: string; observations: string[]; recommendations: Array<{ action: string; evidenceIds: string[] }> }>;

// ---------- 工具输出读取辅助（防御式，provider 缺字段不炸） ----------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function keywordRows(evidence: EvidenceRecord | null): Array<Record<string, unknown>> {
  const data = asRecord(asRecord(evidence?.data).data);
  return Array.isArray(data.keywords) ? (data.keywords as Array<Record<string, unknown>>) : [];
}

// ---------- 六个 Skill workflow ----------

const EXECUTORS: Record<SkillId, SkillExecutor> = {
  // 7. 机会清单（Opportunity Engine 输出）
  "seo-opportunity": async (ctx) => {
    const { collector, projectId } = ctx;
    await collector.collect("project_context", { projectId }, "项目上下文");
    const opportunities = await collector.collect("get_seo_opportunities", { projectId, limit: 20 }, "SEO 机会清单（P0-P2）");
    const rows = keywordRows(opportunities);
    if (opportunities) {
      const p0 = rows.filter((row) => row.priority === "P0").length;
      collector.addSignal(`机会清单：共 ${rows.length} 条，其中 P0 ${p0} 条`, [opportunities.id]);
    }
    const recommendations = rows.slice(0, 5).map((row) => ({
      action: `[${row.priority}] ${row.type}: ${row.targetValue}${row.recommendation ? ` — ${row.recommendation}` : ""}`,
      evidenceIds: opportunities ? [opportunities.id] : [],
    }));
    return {
      summary: `Opportunity Engine 输出 ${rows.length} 条机会（证据与 action plan 见详情）。`,
      observations: ["状态流转（approve/execute/verify）在 SeeO UI 由用户完成；action plan 为 manual execution。"],
      recommendations,
    };
  },
  // 1. 总入口：排名分布 + 搜索表现 + 外链 + AI 可见性
  "seo-diagnostic": async (ctx) => {
    const { collector, projectId } = ctx;
    const context = await collector.collect("project_context", { projectId }, "项目上下文");
    const domain = asRecord(asRecord(context?.data).data) ? String(asRecord(asRecord(context?.data).data).domain ?? "") : "";
    const ranks = await collector.collect("get_rank_history", { projectId }, "排名分布与状态");
    const rankData = asRecord(asRecord(ranks?.data).data);
    const distribution = asRecord(rankData.distribution);
    if (ranks) {
      collector.addSignal(
        `排名分布：Top10 ${distribution.top10Count ?? 0} / Top50 ${distribution.top50Count ?? 0} / 无排名 ${distribution.notRankingCount ?? 0}（共 ${distribution.trackedCount ?? 0} 个追踪词）`,
        [ranks?.id]
      );
    }
    const gsc = await collector.collect("search_console_tools", { projectId, operation: "compare_periods" }, "GSC 流量对比");
    if (gsc) {
      const current = asRecord(asRecord(asRecord(gsc.data).data).current);
      const previous = asRecord(asRecord(asRecord(gsc.data).data).previous);
      const cur = asRecord(current.summary);
      const prev = asRecord(previous.summary);
      const deltaClicks = (Number(cur.clicks) || 0) - (Number(prev.clicks) || 0);
      collector.addSignal(`GSC 点击变化：${prev.clicks ?? "?"} → ${cur.clicks ?? "?"}（${deltaClicks >= 0 ? "+" : ""}${deltaClicks}）`, [gsc.id]);
    }
    const backlinks = await collector.collect("get_backlinks_profile", { projectId }, "外链概况");
    if (backlinks) {
      const summary = asRecord(asRecord(backlinks.data).summary);
      collector.addSignal(`外链：总链 ${summary.totalBacklinks ?? "无数据"} / 引用域 ${summary.referringDomains ?? "无数据"}`, [backlinks.id]);
    }
    const aiTarget = ctx.params.seed || domain;
    let aiEvidence: EvidenceRecord | null = null;
    if (aiTarget) {
      aiEvidence = await collector.collect("ai_search_brand_lookup", { projectId, target: aiTarget }, "AI Search 品牌可见性");
      if (aiEvidence) {
        const aiData = asRecord(asRecord(aiEvidence.data).data);
        collector.addSignal(`AI 可见性：mentions ${aiData.mentionsTotal ?? "无数据"}，hasData=${String(aiData.hasData)}`, [aiEvidence.id]);
      }
    } else {
      collector.warn("项目无 domain 且未提供 seed，跳过 AI 可见性检查");
    }
    const observations: string[] = [];
    if (Number(distribution.notRankingCount) > 0) observations.push(`${distribution.notRankingCount} 个追踪词当前无排名，优先补足内容匹配度`);
    if (Number(distribution.top10Count) > 0) observations.push(`${distribution.top10Count} 个词已进 Top10，具备巩固价值`);
    return {
      summary: "SEO 体检完成：证据覆盖排名分布、搜索表现、外链与 AI 可见性（缺口见 DATA GAPS）。",
      observations,
      recommendations: [
        { action: "优先处理 declined/lost 关键词（运行 rank-drop-diagnosis 深挖原因）", evidenceIds: ranks ? [ranks.id] : [] },
        ...(gsc ? [{ action: "对照 GSC 点击/曝光变化确认流量方向", evidenceIds: [gsc.id] }] : []),
        ...(aiEvidence ? [{ action: "检查 AI 搜索中的被引页面，补强被引内容", evidenceIds: [aiEvidence.id] }] : []),
      ],
    };
  },

  // 2. 关键词研究：seed 扩词 + 指标 + SERP 竞争度
  "keyword-research": async (ctx) => {
    const { collector, projectId, params } = ctx;
    await collector.collect("project_context", { projectId }, "项目上下文");
    if (!params.seed) {
      collector.gaps.push({ tool: "research_keywords", reason: "missing_seed", impact: "缺少 seed，无法展开关键词研究" });
      return { summary: "缺少 seed 参数，未执行研究。", observations: [], recommendations: [] };
    }
    const research = await collector.collect("research_keywords", { projectId, seedKeywords: [params.seed], limit: 20 }, `关键词展开（seed=${params.seed}）`);
    const rows = keywordRows(research);
    const withVolume = rows.filter((row) => row.searchVolume !== null);
    if (research) {
      collector.addSignal(`展开 ${rows.length} 个关键词，其中 ${withVolume.length} 个有真实 search volume`, [research.id]);
    }
    const topCandidate = String(withVolume[0]?.keyword ?? rows[0]?.keyword ?? "") || null;
    let serp: EvidenceRecord | null = null;
    if (topCandidate) {
      serp = await collector.collect("get_serp_results", { projectId, keyword: topCandidate }, `SERP 竞争度（${topCandidate}）`);
      if (serp) {
        const organic = asRecord(asRecord(serp.data).data).organic;
        collector.addSignal(`SERP Top ${Array.isArray(organic) ? organic.length : 0} 已取得（${topCandidate}）`, [serp.id]);
      }
    }
    // 定性决策规则（不做 Opportunity Score）：
    const recommendations: Array<{ action: string; evidenceIds: string[] }> = [];
    for (const row of rows.slice(0, 5)) {
      const volume = row.searchVolume as number | null;
      const difficulty = row.difficulty as number | null;
      let action: string;
      if (volume === null) action = `Monitor（无指标数据，先观察）：${row.keyword}`;
      else if (difficulty !== null && difficulty > 60) action = `Monitor（难度偏高 ${difficulty}）：${row.keyword}`;
      else if (volume !== null && volume >= 100) action = `Target（有真实需求且难度可接受）：${row.keyword}`;
      else action = `Monitor（低量长尾，适合内容补充）：${row.keyword}`;
      recommendations.push({ action, evidenceIds: research ? [research.id] : [] });
    }
    return {
      summary: `关键词研究完成（seed=${params.seed}）：${rows.length} 个候选，Top 候选 ${topCandidate ?? "无"}。`,
      observations: ["定性建议基于真实 provider 指标；无指标数据的行为 Monitor，不编造 intent。"],
      recommendations,
    };
  },

  // 3. 竞品分析：关键词差距 + head-to-head SERP
  "competitor-analysis": async (ctx) => {
    const { collector, projectId, params } = ctx;
    await collector.collect("project_context", { projectId }, "项目上下文");
    if (!params.competitorId) {
      collector.gaps.push({ tool: "get_competitor_keyword_gap", reason: "missing_competitor_id", impact: "缺少竞品 id，无法计算关键词差距" });
      return { summary: "缺少 competitorId 参数，未执行分析。", observations: [], recommendations: [] };
    }
    const gap = await collector.collect(
      "get_competitor_keyword_gap",
      { projectId, competitorId: params.competitorId },
      "竞品关键词差距"
    );
    const gapData = asRecord(asRecord(gap?.data).data);
    const summary = asRecord(gapData.summary);
    if (gap) {
      collector.addSignal(
        `差距分布：shared ${summary.shared ?? 0} / weaklyOwned ${summary.weaklyOwned ?? 0} / competitorOnly ${summary.competitorOnly ?? 0} / projectOnly ${summary.projectOnly ?? 0}`,
        [gap.id]
      );
    }
    const keywords = Array.isArray(gapData.keywords) ? (gapData.keywords as Array<Record<string, unknown>>) : [];
    const competitorOnly = keywords.filter((row) => row.category === "competitorOnly").slice(0, 3);
    let serp: EvidenceRecord | null = null;
    const headToHead = String(competitorOnly[0]?.keyword ?? "");
    if (headToHead) {
      serp = await collector.collect("get_serp_results", { projectId, keyword: headToHead }, `head-to-head SERP（${headToHead}）`);
    }
    const recommendations: Array<{ action: string; evidenceIds: string[] }> = [];
    for (const row of competitorOnly) {
      recommendations.push({
        action: `竞品独有词：评估内容覆盖「${row.keyword}」（竞品排名 #${row.competitorRank ?? "?"}，我方无排名）`,
        evidenceIds: gap ? [gap.id] : [],
      });
    }
    const weakly = keywords.filter((row) => row.category === "weaklyOwned").slice(0, 2);
    for (const row of weakly) {
      recommendations.push({
        action: `竞品明显领先：#${row.projectRank ?? "?"} vs #${row.competitorRank ?? "?"}「${row.keyword}」，考虑内容刷新`,
        evidenceIds: gap ? [gap.id] : [],
      });
    }
    void serp;
    return {
      summary: `竞品分析完成：${summary.analyzedKeywords ?? 0} 个追踪词中 competitorOnly ${summary.competitorOnly ?? 0} 个。`,
      observations: ["差距 universe 为项目 tracked keywords（非竞品全站词库）。"],
      recommendations,
    };
  },

  // 4. 排名下降诊断：declined/lost × SERP × GSC 交叉
  "rank-drop-diagnosis": async (ctx) => {
    const { collector, projectId } = ctx;
    const ranks = await collector.collect("get_rank_history", { projectId }, "排名状态与变化");
    const keywords = keywordRows(ranks);
    const declined = keywords.filter((row) => row.status === "declined" || row.status === "lost");
    if (ranks) {
      collector.addSignal(`declined/lost 关键词 ${declined.length} 个（共 ${keywords.length} 个追踪词）`, [ranks.id]);
    }
    if (declined.length === 0) {
      return { summary: "当前无 declined/lost 关键词。", observations: [], recommendations: [] };
    }
    // 最多深挖 2 个受影响关键词（成本护栏）
    const focus = declined.slice(0, 2);
    for (const row of focus) {
      const serp = await collector.collect("get_serp_results", { projectId, keyword: String(row.keyword) }, `SERP 现状（${row.keyword}）`);
      if (serp) {
        const organic = asRecord(asRecord(serp.data).data).organic;
        const domains = Array.isArray(organic) ? organic.map((item) => asRecord(item).domain) : [];
        collector.addSignal(`「${row.keyword}」当前 SERP 前列：${domains.slice(0, 3).join(", ") || "无结果"}`, [serp.id]);
      }
    }
    const gsc = await collector.collect("search_console_tools", { projectId, operation: "top_queries" }, "GSC 查询表现交叉验证");
    void gsc;
    return {
      summary: `排名下降诊断：${declined.length} 个词 declined/lost，已交叉 SERP 与 GSC（见证据）`,
      observations: [
        "SERP 前列域名若与 rank history 时期不同 → 竞争加剧信号；ranking URL 变化 → 页面切换信号。",
        "注意：rank（SERP 位置）与 GSC position（平均位置）是不同数据源，不可互换。",
      ],
      recommendations: [
        { action: "对 declined 关键词逐个复核 SERP 意图是否漂移，再决定内容刷新或放弃", evidenceIds: ranks ? [ranks.id] : [] },
        { action: "对比竞品 movement（/api/tracking/intelligence 含 competitorMovement，MCP 暂未暴露——GAP 已记录）", evidenceIds: ranks ? [ranks.id] : [] },
      ],
    };
  },

  // 5. GSC 流量诊断：区分 impressions / CTR / position / clicks 维度
  "gsc-diagnosis": async (ctx) => {
    const { collector, projectId } = ctx;
    const compare = await collector.collect("search_console_tools", { projectId, operation: "compare_periods" }, "GSC 周期对比");
    const queries = await collector.collect("search_console_tools", { projectId, operation: "top_queries", rowLimit: 10 }, "GSC Top 查询");
    const pages = await collector.collect("search_console_tools", { projectId, operation: "top_pages", rowLimit: 10 }, "GSC Top 页面");
    if (!compare) {
      return {
        summary: "GSC 不可用（未连接或无配额），流量诊断置信度受限。",
        observations: ["可改用 rank/SERP 侧信号（运行 rank-drop-diagnosis）。"],
        recommendations: [],
      };
    }
    const current = (asRecord(asRecord(asRecord(compare.data).data).current).summary ?? {}) as Record<string, unknown>;
    const previous = (asRecord(asRecord(asRecord(compare.data).data).previous).summary ?? {}) as Record<string, unknown>;
    const num = (value: unknown) => (typeof value === "number" ? value : 0);
    const clicksDelta = num(current.clicks) - num(previous.clicks);
    const impressionsDelta = num(current.impressions) - num(previous.impressions);
    const ctrDelta = num(current.ctr) - num(previous.ctr);
    const positionDelta = num(current.position) - num(previous.position); // 正 = 平均位置变差
    const classification =
      impressionsDelta < 0 ? "visibility 下降（曝光减少）——优先排查排名与收录"
      : clicksDelta < 0 && ctrDelta < 0 ? "CTR 下降（曝光基本稳定）——优先优化标题/摘要吸引力"
      : positionDelta > 0.5 ? "平均位置变差——交叉 rank history 确认"
      : clicksDelta < 0 ? "点击下降（结构未明）——对照 top pages 找失量页"
      : "流量平稳或上升";
    collector.addSignal(`GSC 分类：${classification}（clicks ${clicksDelta >= 0 ? "+" : ""}${clicksDelta}, impressions ${impressionsDelta >= 0 ? "+" : ""}${impressionsDelta}, ctr ${ctrDelta >= 0 ? "+" : ""}${ctrDelta.toFixed(4)}, position ${positionDelta >= 0 ? "+" : ""}${positionDelta.toFixed(1)}）`, [compare.id]);
    return {
      summary: `GSC 诊断：${classification}`,
      observations: ["流量下降 ≠ 排名下降：必须区分曝光/CTR/位置/点击四个维度（本 skill 的核心 rule）。"],
      recommendations: [
        { action: classification.includes("CTR") ? "重写 Top 页面的 title/description 提升 CTR" : classification.includes("visibility") ? "排查排名侧：运行 rank-drop-diagnosis" : "维持监控，对照 top pages 找结构变化", evidenceIds: [compare.id, queries?.id, pages?.id].filter((id): id is string => Boolean(id)) },
      ],
    };
  },

  // 6. AI 搜索可见性：mentions/citations/AI SOV
  "ai-search-visibility": async (ctx) => {
    const { collector, projectId, params } = ctx;
    const context = await collector.collect("project_context", { projectId }, "项目上下文（取 domain 作为默认 target）");
    const domain = String(asRecord(asRecord(context?.data).data).domain ?? "");
    const target = params.seed || domain;
    if (!target) {
      collector.gaps.push({ tool: "ai_search_brand_lookup", reason: "missing_target", impact: "无 brand/domain 可查询" });
      return { summary: "缺少 target（seed 或项目 domain）。", observations: [], recommendations: [] };
    }
    const lookup = await collector.collect("ai_search_brand_lookup", {
      projectId, target,
      ...(params.locationCode !== undefined ? { locationCode: params.locationCode } : {}),
      ...(params.languageCode ? { languageCode: params.languageCode } : {}),
    }, "AI Search 品牌可见性");
    const data = asRecord(asRecord(lookup?.data).data);
    if (lookup) {
      const sov = Array.isArray(data.aiShareOfVoice) ? (data.aiShareOfVoice as Array<Record<string, unknown>>) : [];
      const targetSov = sov.find((entry) => entry.isTarget === true);
      collector.addSignal(
        `AI 可见性：mentions ${data.mentionsTotal ?? "无数据"}，AI SOV ${targetSov ? `${targetSov.aiSharePct ?? "?"}%` : "未对比"}`,
        [lookup.id]
      );
    }
    return {
      summary: `AI 搜索可见性（target=${target}）：${data.hasData === true ? "有数据" : "provider 无数据"}。`,
      observations: [
        "mention ≠ citation：品牌被提及与 URL 被引用是两个独立信号。",
        "历史对比经 /api/ai-search/history（MCP 暂未暴露——GAP 已记录）。",
      ],
      recommendations: [
        { action: data.hasData === true ? "复核 topCitedDomains：被引页面内容是否可复用为站内优化方向" : "扩大 prompt 覆盖面或确认品牌拼写变体", evidenceIds: lookup ? [lookup.id] : [] },
      ],
    };
  },
};

/** 执行一个 skill（或从消息路由）。全部经 MCP tools，bounded。 */
export async function runAgentSkill(opts: {
  skillId?: SkillId;
  message?: string;
  projectId: string;
  ctx: ToolAuthContext;
  params?: AgentSkillParams;
}): Promise<AgentSkillResult> {
  const skillId = opts.skillId ?? (opts.message ? routeSkill(opts.message) : null) ?? "seo-diagnostic";
  const skill: SkillDefinition = SKILLS[skillId];
  const params = opts.params ?? {};
  for (const required of skill.requiredParams) {
    if (required === "seed" && !params.seed) {
      throw new McpNormalizedError("BAD_REQUEST", `Skill '${skillId}' requires a seed parameter.`);
    }
    if (required === "competitorId" && !params.competitorId) {
      throw new McpNormalizedError("BAD_REQUEST", `Skill '${skillId}' requires a competitorId parameter.`);
    }
  }

  let executor: ToolExecutor;
  try {
    executor = createMcpToolExecutor(opts.ctx);
  } catch {
    throw new McpNormalizedError("AUTH_REQUIRED", "A SeeO session or API key is required.");
  }
  const collector = new EvidenceCollector(executor, skill.maxToolCalls);
  const skillCtx: SkillContext = { collector, projectId: opts.projectId, params };

  const { summary, observations, recommendations } = await EXECUTORS[skillId](skillCtx);

  return {
    skill: skillId,
    projectId: opts.projectId,
    facts: collector.records.map(({ id, tool, label, data, capturedAt }) => ({ id, tool, label, data, capturedAt })),
    signals: collector.signals,
    dataGaps: collector.gaps,
    warnings: collector.warnings,
    toolCallsUsed: collector.records.length,
    toolCallBudget: skill.maxToolCalls,
    interpretation: { summary, observations, recommendations },
  };
}
