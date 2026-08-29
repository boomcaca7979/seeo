// ===== Opportunity Engine（P1 SEO Opportunity & Execution Layer） =====
// 统一入口：collectSignals → evaluateRules → generateCandidates → dedupe → prioritize → persist。
//
// 边界（任务硬要求）：
// - 只消费现有 Intelligence service/DB（rank_history、competitor_ranks、audit_issues、
//   ai_search_runs、GSC service），绝不直接调 DataForSEO/SerpApi provider。
// - Provider 成本受控：扫描主体 DB-only；CTR 证据经 gsc-service（24h 缓存优先，单次调用）；
//   不重抓全量。
// - Priority 是 deterministic 规则（可解释/可复现/有测试），不是黑盒分数。
// - Execution 诚实标记：SeeO 无 CMS/GitHub/部署集成 → action plan 全部 executionMode: manual。
// - Verification 分层：rank 可即时复检（searchRank，1 unit）；GSC/AI 有数据滞后 → PENDING，
//   不把"立即看不到变化"判定为失败。
// - dismissed/completed 的机会在扫描时被抑制（fingerprint upsert 语义）。

import { createHash } from "node:crypto";
import {
  buildOpportunityFingerprint,
  upsertOpportunity,
  type OpportunityActionPlan,
  type OpportunityEvidence,
  type OpportunityType,
} from "@/lib/db/opportunities";
import { getRankWindow, type RankWindowRow } from "@/lib/db/rankings";
import { getProjectById } from "@/lib/db";
import { getLatestAudit, getAuditIssues } from "@/lib/db/audits";
import { listAiSearchRuns } from "@/lib/db/ai-search";
import { searchRank } from "./serp-service";
import { searchAnalytics } from "./gsc-service";
import type { PlanTier } from "@/lib/auth";

// ---------- 信号适配器（全部来自持久化数据 / 缓存优先的 service） ----------

interface KeywordSignal {
  keywordId: number;
  keyword: string;
  location: string;
  device: string;
  currentRank: number | null;
  previousRank: number | null;
  currentUrl: string | null;
  previousUrl: string | null;
}

/** rank_history 窗口 → 每个关键词的 current/previous 快照（一次查询，避免 N+1） */
export async function collectRankSignals(userId: string, domain: string, days = 30): Promise<KeywordSignal[]> {
  const window = await getRankWindow(userId, domain, days);
  const byKeyword = new Map<number, RankWindowRow[]>();
  for (const row of window) {
    const list = byKeyword.get(row.keyword_id) ?? [];
    list.push(row);
    byKeyword.set(row.keyword_id, list);
  }
  const signals: KeywordSignal[] = [];
  for (const rows of byKeyword.values()) {
    const current = rows[rows.length - 1];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    signals.push({
      keywordId: current.keyword_id,
      keyword: current.keyword,
      location: current.location,
      device: current.device,
      currentRank: current.position,
      previousRank: previous?.position ?? null,
      currentUrl: current.url,
      previousUrl: previous?.url ?? null,
    });
  }
  return signals;
}

interface CompetitorSignal {
  keywordId: number;
  competitorDomain: string;
  competitorRank: number | null;
}

/** 竞品最新排名（bounded：只对候选关键词逐个查询，不在全量上展开） */
export async function collectCompetitorSignals(userId: string, keywordIds: number[]): Promise<Map<number, CompetitorSignal[]>> {
  const { getLatestCompetitorRanks } = await import("@/lib/db");
  const result = new Map<number, CompetitorSignal[]>();
  for (const keywordId of keywordIds) {
    const latest = await getLatestCompetitorRanks(userId, keywordId);
    result.set(keywordId, latest.map((row) => ({
      keywordId,
      competitorDomain: row.domain,
      competitorRank: row.rank,
    })));
  }
  return result;
}

// ---------- CTR baseline（公式明确、可测试） ----------
// 行业通用的位置-CTR 近似曲线（聚合多项公开 CTR 研究的中位水平），
// 作为"预期 CTR"基线；实际 CTR < 0.5 × baseline → CTR 机会。
// 这是启发式基线（非 Google 官方数据），公式随代码可见、可复现。
export const CTR_BASELINE_BY_POSITION: ReadonlyArray<{ maxPosition: number; ctr: number }> = [
  { maxPosition: 1, ctr: 0.28 },
  { maxPosition: 2, ctr: 0.15 },
  { maxPosition: 3, ctr: 0.10 },
  { maxPosition: 4, ctr: 0.07 },
  { maxPosition: 5, ctr: 0.05 },
  { maxPosition: 8, ctr: 0.03 },
  { maxPosition: 10, ctr: 0.02 },
];

export function expectedCtrForPosition(position: number): number | null {
  for (const band of CTR_BASELINE_BY_POSITION) {
    if (position <= band.maxPosition) return band.ctr;
  }
  return null;
}

const CTR_MIN_IMPRESSIONS = 100;
const CTR_STRONG_IMPRESSIONS = 500;

// ---------- Priority（deterministic，非分数） ----------

export interface OpportunityCandidate {
  type: OpportunityType;
  targetType: "keyword" | "url" | "domain";
  targetValue: string;
  priority: "P0" | "P1" | "P2";
  impact: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  evidence: OpportunityEvidence[];
  signals: Record<string, unknown>;
  recommendation: string;
}

function evidence(source: string, ref: string, summary: string): OpportunityEvidence {
  return { source, ref, summary, capturedAt: new Date().toISOString() };
}

// ---------- 规则评估（输入为已收集信号，纯函数、可测试） ----------

/** Rank Improvement：8 ≤ rank ≤ 30 且竞品进 Top10（真实需求 + 上升空间） */
export function evaluateRankImprovement(
  signal: KeywordSignal,
  competitors: CompetitorSignal[]
): OpportunityCandidate | null {
  if (signal.currentRank === null || signal.currentRank < 8 || signal.currentRank > 30) return null;
  const bestCompetitor = competitors
    .filter((c) => c.competitorRank !== null && c.competitorRank >= 1 && c.competitorRank <= 10)
    .sort((a, b) => (a.competitorRank ?? 99) - (b.competitorRank ?? 99))[0];
  if (!bestCompetitor) return null;
  const priority = signal.currentRank <= 15 && (bestCompetitor.competitorRank ?? 99) <= 5 ? "P0" : "P1";
  return {
    type: "rank_improvement",
    targetType: "keyword",
    targetValue: signal.keyword,
    priority,
    impact: "high",
    confidence: "high",
    evidence: [
      evidence("rank_history", `keyword:${signal.keywordId}`, `${signal.keyword} 当前 #${signal.currentRank}（上次 #${signal.previousRank ?? "?"}）`),
      evidence("competitor_ranks", `keyword:${signal.keywordId}`, `${bestCompetitor.competitorDomain} 排名 #${bestCompetitor.competitorRank}（已验证该词有真实需求）`),
    ],
    signals: {
      currentRank: signal.currentRank,
      previousRank: signal.previousRank,
      competitorDomain: bestCompetitor.competitorDomain,
      competitorRank: bestCompetitor.competitorRank,
      rankingUrl: signal.currentUrl,
    },
    recommendation: `改进「${signal.keyword}」的现有页面内容与内链，向 Top5 逼近（当前 #${signal.currentRank}，竞品 #${bestCompetitor.competitorRank}）`,
  };
}

/** Lost Ranking Recovery：上次有排名、本次无（跌出前 100） */
export function evaluateLostRecovery(signal: KeywordSignal): OpportunityCandidate | null {
  if (signal.currentRank !== null || signal.previousRank === null) return null;
  return {
    type: "lost_recovery",
    targetType: "keyword",
    targetValue: signal.keyword,
    priority: "P0",
    impact: "high",
    confidence: "high",
    evidence: [
      evidence("rank_history", `keyword:${signal.keywordId}`, `${signal.keyword} 从 #${signal.previousRank} 跌出前 100`),
      ...(signal.previousUrl ? [evidence("rank_history", `keyword:${signal.keywordId}:url`, `上次排名 URL：${signal.previousUrl}`)] : []),
    ],
    signals: { previousRank: signal.previousRank, previousUrl: signal.previousUrl, currentUrl: signal.currentUrl },
    recommendation: `恢复「${signal.keyword}」排名：先确认页面仍可访问/未被 noindex，再对照 SERP 现状评估内容差距`,
  };
}

/** Content Refresh：declined ≥5 位且 ranking URL 未变 → 内容老化信号 */
export function evaluateContentRefresh(signal: KeywordSignal): OpportunityCandidate | null {
  if (signal.currentRank === null || signal.previousRank === null) return null;
  const decline = signal.currentRank - signal.previousRank; // 正 = 排名数字变大 = 下滑
  if (decline < 5) return null;
  const urlChanged = signal.previousUrl !== null && signal.currentUrl !== null && signal.previousUrl !== signal.currentUrl;
  if (urlChanged) return null; // URL 切换是另一类问题，不伪装成内容老化
  return {
    type: "content_refresh",
    targetType: "url",
    targetValue: signal.currentUrl ?? signal.keyword,
    priority: decline >= 8 ? "P0" : "P1",
    impact: "medium",
    confidence: "medium",
    evidence: [
      evidence("rank_history", `keyword:${signal.keywordId}`, `${signal.keyword} #${signal.previousRank} → #${signal.currentRank}（- ${decline} 位）`),
      evidence("rank_history", `keyword:${signal.keywordId}:url`, `ranking URL 未变（${signal.currentUrl}）→ 内容老化信号而非页面切换`),
    ],
    signals: { previousRank: signal.previousRank, currentRank: signal.currentRank, decline, rankingUrl: signal.currentUrl },
    recommendation: `刷新 ${signal.currentUrl}：对照当前 SERP 前列结果补齐内容差距（排名 ${decline} 位下滑而 URL 未变）`,
  };
}

/** Competitor Gap：竞品进 Top10 而我方无排名 */
export function evaluateCompetitorGap(signal: KeywordSignal, competitors: CompetitorSignal[]): OpportunityCandidate | null {
  if (signal.currentRank !== null) return null;
  const bestCompetitor = competitors
    .filter((c) => c.competitorRank !== null && c.competitorRank <= 10)
    .sort((a, b) => (a.competitorRank ?? 99) - (b.competitorRank ?? 99))[0];
  if (!bestCompetitor) return null;
  return {
    type: "competitor_gap",
    targetType: "keyword",
    targetValue: signal.keyword,
    priority: "P1",
    impact: "medium",
    confidence: "medium",
    evidence: [
      evidence("rank_history", `keyword:${signal.keywordId}`, `${signal.keyword} 我方无排名`),
      evidence("competitor_ranks", `keyword:${signal.keywordId}`, `${bestCompetitor.competitorDomain} 排名 #${bestCompetitor.competitorRank}`),
    ],
    signals: { competitorDomain: bestCompetitor.competitorDomain, competitorRank: bestCompetitor.competitorRank },
    recommendation: `创建/扩展「${signal.keyword}」内容：竞品 ${bestCompetitor.competitorDomain} 已凭该词进入 Top${bestCompetitor.competitorRank}`,
  };
}

// ---------- CTR 机会（GSC 缓存优先，单次调用） ----------

export interface GscQueryRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** 纯函数：GSC 查询行 → CTR 机会（impressions≥100 且 position≤10 且 ctr < 0.5×baseline） */
export function evaluateCtrOpportunity(row: GscQueryRow): OpportunityCandidate | null {
  const query = row.keys[0];
  if (!query || row.impressions < CTR_MIN_IMPRESSIONS) return null;
  if (row.position <= 0 || row.position > 10) return null;
  const baseline = expectedCtrForPosition(Math.ceil(row.position));
  if (baseline === null) return null;
  if (row.ctr >= baseline * 0.5) return null;
  return {
    type: "ctr",
    targetType: "keyword",
    targetValue: query,
    priority: row.impressions >= CTR_STRONG_IMPRESSIONS ? "P1" : "P2",
    impact: row.impressions >= CTR_STRONG_IMPRESSIONS ? "high" : "medium",
    confidence: "medium",
    evidence: [
      evidence("gsc", `query:${query}`, `impressions ${row.impressions}、平均位置 ${row.position.toFixed(1)}、CTR ${(row.ctr * 100).toFixed(2)}%（同位置基线 ${(baseline * 100).toFixed(1)}% 的 50%）`),
    ],
    signals: { impressions: row.impressions, position: row.position, ctr: row.ctr, expectedBaselineCtr: baseline },
    recommendation: `优化「${query}」的 title/meta：曝光充足、位置尚可但 CTR 显著低于同位置基线`,
  };
}

// ---------- AI Visibility Gap（仅读最近 run，不触发 provider） ----------

export interface AiRunSummary {
  hasData: boolean;
  mentionsTotal: number | null;
  aiShareOfVoice: Array<{ label: string; isTarget: boolean; mentions: number | null; aiSharePct: number | null }> | null;
}

export function evaluateAiVisibilityGap(run: AiRunSummary | null): OpportunityCandidate | null {
  if (!run || !run.hasData) return null; // 无数据 → DATA GAP，不伪造
  if (run.mentionsTotal === 0) {
    return {
      type: "ai_visibility",
      targetType: "domain",
      targetValue: "brand",
      priority: "P2",
      impact: "medium",
      confidence: "medium",
      evidence: [evidence("ai_search_runs", "latest_brand_lookup", "最近一次 AI Search 扫描 mentions 为 0（ChatGPT/Google AI Overview 均未提及）")],
      signals: { mentionsTotal: 0 },
      recommendation: "提升 AI 引用覆盖：产出可被 AI 引用的权威内容（对比/数据/定义型页面），并在高需求词上建立 Google 侧排名（AI Overview 引用与 SERP 强相关）",
    };
  }
  if (run.aiShareOfVoice) {
    const target = run.aiShareOfVoice.find((entry) => entry.isTarget);
    const best = run.aiShareOfVoice
      .filter((entry) => !entry.isTarget && entry.mentions !== null)
      .sort((a, b) => (b.mentions ?? 0) - (a.mentions ?? 0))[0];
    if (target && best && (target.mentions ?? 0) < (best.mentions ?? 0)) {
      return {
        type: "ai_visibility",
        targetType: "domain",
        targetValue: "brand",
        priority: "P2",
        impact: "medium",
        confidence: "medium",
        evidence: [
          evidence("ai_search_runs", "latest_brand_lookup", `AI SOV：${target.label} ${target.aiSharePct ?? "?"}% vs ${best.label} ${best.aiSharePct ?? "?"}%`),
        ],
        signals: { targetMentions: target.mentions, competitorLabel: best.label, competitorMentions: best.mentions },
        recommendation: `缩小 AI 提及差距：${best.label} 的提及量约为我方 ${(best.mentions ?? 0) / Math.max(1, target.mentions ?? 1)} 倍，优先补充被高频引用的内容形态`,
      };
    }
  }
  return null;
}

// ---------- Technical（audit_issues 真实数据） ----------

const MAX_TECHNICAL_OPPORTUNITIES = 5;

export async function collectTechnicalCandidates(userId: string, domain: string): Promise<OpportunityCandidate[]> {
  const audit = await getLatestAudit(userId, domain);
  if (!audit) return []; // 无审计数据 → DATA GAP（不伪造）
  const issues = await getAuditIssues(userId, audit.id);
  const errors = issues.filter((issue) => issue.severity === "error");
  const byUrl = new Map<string, number>();
  for (const issue of errors) {
    if (!issue.url) continue;
    byUrl.set(issue.url, (byUrl.get(issue.url) ?? 0) + 1);
  }
  return Array.from(byUrl.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TECHNICAL_OPPORTUNITIES)
    .map(([url, count]) => ({
      type: "technical" as const,
      targetType: "url",
      targetValue: url,
      priority: "P1" as const,
      impact: "high",
      confidence: "high",
      evidence: [
        evidence("audit_issues", `audit:${audit.id}:${url}`, `该页面存在 ${count} 个 error 级审计问题（audit #${audit.id}）`),
      ],
      signals: { auditId: audit.id, errorCount: count },
      recommendation: `修复 ${url} 上的 ${count} 个 error 级技术问题（详见 SeeO 审计报告 #${audit.id}）`,
    }));
}

// ---------- Action Planner（确定性模板；executionMode 诚实为 manual） ----------

export function buildActionPlan(candidate: OpportunityCandidate): OpportunityActionPlan {
  const byType: Record<OpportunityType, OpportunityActionPlan> = {
    rank_improvement: {
      executionMode: "manual",
      actionType: "content_update",
      steps: [
        `打开当前排名页：${String(candidate.signals.rankingUrl ?? "（见证据中的 rankingUrl）")}`,
        "对照该词 SERP 前列结果，列出内容差距（覆盖面/深度/结构化数据）",
        "补充缺失章节与内链入口，更新页面",
        "在 SeeO 中刷新该词排名并观察 1-2 周",
      ],
    },
    lost_recovery: {
      executionMode: "manual",
      actionType: "technical_fix",
      steps: [
        "确认上次排名 URL 仍可访问（200、未被 noindex/robots 屏蔽）",
        "对照该词当前 SERP 前列结果评估内容差距",
        "修复技术问题或刷新内容后，重新提交收录并复查排名",
      ],
    },
    content_refresh: {
      executionMode: "manual",
      actionType: "refresh_page",
      steps: [
        `刷新页面：${String(candidate.signals.rankingUrl ?? candidate.targetValue)}`,
        "对照当前 SERP 前列结果更新内容、补充近期信息",
        "保持 URL 不变，更新 lastmod；复查排名变化",
      ],
    },
    competitor_gap: {
      executionMode: "manual",
      actionType: "create_content",
      steps: [
        `调研「${candidate.targetValue}」的搜索意图与竞品覆盖角度`,
        "规划并创建目标页面（或扩展现有页面的独立章节）",
        "加入相关内链；发布后加入 rank tracking 并观察",
      ],
    },
    ctr: {
      executionMode: "manual",
      actionType: "meta_update",
      steps: [
        `检查「${candidate.targetValue}」当前 title 与 meta description`,
        "对照 SERP 前列竞品的标题形态，撰写更有差异化的版本",
        "更新后观察 GSC CTR 变化（留 1-2 周数据延迟）",
      ],
    },
    ai_visibility: {
      executionMode: "manual",
      actionType: "content_update",
      steps: [
        "盘点被 AI 高频引用的内容形态（对比/数据/定义/清单）",
        "在核心主题上创建或强化可引用资产，确保事实清晰、结构可摘录",
        "提升对应关键词的 Google 排名（AI Overview 引用与 SERP 强相关）",
      ],
    },
    technical: {
      executionMode: "manual",
      actionType: "technical_fix",
      steps: [
        `打开 SeeO 审计报告定位 ${candidate.targetValue} 的 error 级问题`,
        "逐项修复并重新爬取验证",
      ],
    },
  };
  return byType[candidate.type];
}

// ---------- Scanner（统一入口） ----------

export interface OpportunityScanResult {
  projectId: number;
  domain: string;
  generated: number;
  refreshed: number;
  suppressed: number;
  dataGaps: string[];
  candidates: Array<{ type: OpportunityType; target: string; priority: "P0" | "P1" | "P2"; isNew: boolean }>;
}

const MAX_OPPORTUNITIES_PER_SCAN = 20;

export async function scanOpportunities(userId: string, plan: PlanTier, projectId: number, options?: {
  includeCtr?: boolean;
}): Promise<OpportunityScanResult> {
  const project = await getProjectById(userId, projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const domain = project.domain;
  const dataGaps: string[] = [];
  const candidates: OpportunityCandidate[] = [];

  // 1. Rank 侧信号（DB-only）
  const rankSignals = await collectRankSignals(userId, domain, 30);
  const candidateKeywords = rankSignals.filter((signal) => signal.currentRank !== null || signal.previousRank !== null);
  // 竞品证据 bounded：仅对可能成型的候选查竞品排名
  const pool = candidateKeywords
    .filter((signal) => (signal.currentRank !== null && signal.currentRank >= 8 && signal.currentRank <= 30) || signal.currentRank === null)
    .slice(0, 20);
  const competitorMap = await collectCompetitorSignals(userId, pool.map((signal) => signal.keywordId));

  for (const signal of candidateKeywords) {
    const competitors = competitorMap.get(signal.keywordId) ?? [];
    const batch = [
      evaluateRankImprovement(signal, competitors),
      evaluateLostRecovery(signal),
      evaluateContentRefresh(signal),
      evaluateCompetitorGap(signal, competitors),
    ];
    for (const candidate of batch) {
      if (candidate) candidates.push(candidate);
    }
  }

  // 2. Technical 信号（audit_issues，DB-only；无审计 → DATA GAP）
  const technical = await collectTechnicalCandidates(userId, domain);
  if (technical.length === 0) dataGaps.push("technical: 无可用审计数据（DATA GAP，不伪造）");
  candidates.push(...technical);

  // 3. CTR 信号（GSC，缓存优先、单次调用、bounded 100 行）
  if (options?.includeCtr !== false) {
    try {
      const gsc = await searchAnalytics({
        userId, projectId, dimensions: ["query"], rowLimit: 100, dateRange: "last_28_days",
      });
      let ctrCount = 0;
      for (const row of gsc.rows) {
        const candidate = evaluateCtrOpportunity({ keys: row.keys, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position });
        if (candidate) {
          candidates.push(candidate);
          ctrCount += 1;
          if (ctrCount >= 5) break; // CTR 机会上限 5
        }
      }
    } catch (e) {
      dataGaps.push(`ctr: GSC 不可用（${(e as Error).message}）`);
    }
  }

  // 4. AI Visibility（仅读最近 run，不触发 provider）
  try {
    const runs = await listAiSearchRuns(userId, { projectId, runType: "brand_lookup", limit: 1 });
    const latest = runs[0] ?? null;
    const candidate = evaluateAiVisibilityGap(
      latest
        ? {
            hasData: latest.summary.hasData === true,
            mentionsTotal: typeof latest.summary.mentionsTotal === "number" ? latest.summary.mentionsTotal : null,
            aiShareOfVoice: Array.isArray(latest.summary.aiShareOfVoice)
              ? (latest.summary.aiShareOfVoice as AiRunSummary["aiShareOfVoice"])
              : null,
          }
        : null
    );
    if (candidate) candidates.push(candidate);
    else if (!latest) dataGaps.push("ai_visibility: 尚无 AI Search run（先运行 ai_search_brand_lookup）");
  } catch (e) {
    dataGaps.push(`ai_visibility: ${(e as Error).message}`);
  }

  // 5. dedupe（fingerprint）+ 按优先级排序 + 上限
  const seen = new Set<string>();
  const deduped: OpportunityCandidate[] = [];
  const priorityOrder = { P0: 0, P1: 1, P2: 2 } as const;
  const withFingerprint = candidates.map((candidate) => ({
    candidate,
    fingerprint: buildOpportunityFingerprint(projectId, candidate.type, candidate.targetValue),
  }));
  // 同 fingerprint 多规则命中时保留优先级最高的一条
  withFingerprint.sort((a, b) => priorityOrder[a.candidate.priority] - priorityOrder[b.candidate.priority]);
  for (const item of withFingerprint) {
    if (seen.has(item.fingerprint)) continue;
    seen.add(item.fingerprint);
    deduped.push(item.candidate);
  }
  deduped.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const selected = deduped.slice(0, MAX_OPPORTUNITIES_PER_SCAN);
  if (deduped.length > selected.length) dataGaps.push(`scan: ${deduped.length - selected.length} 个候选超出单次扫描上限（${MAX_OPPORTUNITIES_PER_SCAN}），未入库`);

  // 6. persist（upsert 语义：dismissed/completed 抑制）
  let generated = 0;
  let refreshed = 0;
  let suppressed = 0;
  const persisted: Array<{ type: OpportunityType; target: string; priority: "P0" | "P1" | "P2"; isNew: boolean }> = [];
  for (const candidate of selected) {
    const result = await upsertOpportunity(userId, {
      user_id: userId,
      project_id: projectId,
      type: candidate.type,
      target_type: candidate.targetType,
      target_value: candidate.targetValue,
      priority: candidate.priority,
      impact: candidate.impact,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
      signals: { ...candidate.signals, recommendation: candidate.recommendation },
      actionPlan: buildActionPlan(candidate),
    });
    if (result.suppressed) suppressed += 1;
    else if (result.isNew) generated += 1;
    else refreshed += 1;
    persisted.push({ type: candidate.type, target: candidate.targetValue, priority: candidate.priority, isNew: result.isNew });
  }

  return { projectId, domain, generated, refreshed, suppressed, dataGaps, candidates: persisted };
}

// ---------- Verification（分层：rank 即时复检；GSC/AI PENDING） ----------

export interface VerificationOutcome {
  checks: Array<{ check: string; status: "pass" | "pending" | "failed" | "stale"; detail: string | null; checkedAt: string | null }>;
}

/** 对已批准的机会执行验证：rank 即时复检（真实 provider，1 unit）；GSC/AI 标 PENDING（数据滞后） */
export async function verifyOpportunity(userId: string, plan: PlanTier, params: {
  projectId: number;
  type: OpportunityType;
  targetType: string;
  targetValue: string;
  signals: Record<string, unknown>;
}): Promise<VerificationOutcome> {
  const now = new Date().toISOString();
  const checks: VerificationOutcome["checks"] = [];

  if (params.type === "technical") {
    const audit = await getLatestAudit(userId, (await getProjectById(userId, params.projectId))?.domain ?? "");
    const issues = audit ? await getAuditIssues(userId, audit.id) : [];
    const remaining = issues.filter((issue) => issue.url === params.targetValue && issue.severity === "error").length;
    checks.push({
      check: "technical",
      status: remaining === 0 ? "pass" : "failed",
      detail: remaining === 0 ? "该 URL 已无 error 级问题（最新审计）" : `仍有 ${remaining} 个 error 级问题`,
      checkedAt: now,
    });
  } else if (params.targetType === "keyword" && (params.type === "rank_improvement" || params.type === "lost_recovery" || params.type === "content_refresh")) {
    try {
      const domain = (await getProjectById(userId, params.projectId))?.domain ?? "";
      const { result } = await searchRank(userId, plan, {
        keyword: params.targetValue, domain, location: "中国", device: "PC",
      });
      checks.push({
        check: "rank",
        status: result.rank !== null ? "pass" : "pending",
        detail: result.rank !== null ? `当前 #${result.rank}（${result.matchedUrl ?? ""}）` : "未进前 100（GSC/AI 侧继续观察）",
        checkedAt: now,
      });
    } catch (e) {
      checks.push({ check: "rank", status: "pending", detail: `复检失败（${(e as Error).message}），稍后重试`, checkedAt: now });
    }
  } else {
    checks.push({ check: "rank", status: "pending", detail: null, checkedAt: null });
  }

  // GSC / AI Search 有数据滞后：显式 PENDING，不判失败
  checks.push({ check: "gsc", status: "pending", detail: "等待 GSC 数据（滞后 2-3 天）后复核", checkedAt: null });
  checks.push({ check: "ai_search", status: "pending", detail: "AI 搜索数据需重新扫描后对比（ai_search_brand_lookup）", checkedAt: null });

  return { checks };
}

// ---------- 摘要 hash（evidence 完整性） ----------

export function evidenceHash(evidence: OpportunityEvidence[]): string {
  return createHash("sha256").update(JSON.stringify(evidence.map((item) => `${item.source}:${item.ref}`))).digest("hex").slice(0, 16);
}
