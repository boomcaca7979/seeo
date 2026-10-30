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
import { listContentChecks } from "@/lib/db/content";
import { pickText } from "./audit-checks";
import type { DashboardSnapshot } from "./audit-dashboard";
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
  /** 窗口内出现过的最好名次（null/undefined = 窗口内从未进入前 100） */
  bestRankInWindow?: number | null;
  /** 窗口内最后一次真正进榜的日期 */
  lastRankedDate?: string | null;
  /** 窗口内总观测行数 / 其中有名次的行数（用于识别稀疏数据） */
  windowRows?: number;
  rankedRows?: number;
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
    const latest = rows[rows.length - 1];
    // 稀疏数据处理（真实数据里 position 常为 null = 未进前 100）：
    // "上一次排名"取最近一次**真正有名次**的较早观测，而不是机械地取上一行。
    const earlierRanked = rows.slice(0, -1).filter((r) => r.position !== null);
    const prevRanked = earlierRanked.length > 0 ? earlierRanked[earlierRanked.length - 1] : null;
    const ranked = rows.filter((r) => r.position !== null);
    signals.push({
      keywordId: latest.keyword_id,
      keyword: latest.keyword,
      location: latest.location,
      device: latest.device,
      currentRank: latest.position,
      previousRank: prevRanked?.position ?? null,
      currentUrl: latest.url,
      previousUrl: prevRanked?.url ?? null,
      bestRankInWindow: ranked.length > 0 ? Math.min(...ranked.map((r) => r.position as number)) : null,
      lastRankedDate: ranked.length > 0 ? String(ranked[ranked.length - 1].date) : null,
      windowRows: rows.length,
      rankedRows: ranked.length,
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

// ---------- CTR baseline ----------
// 基线曲线已抽取到 ./ctr-baseline（纯模块，客户端关键词研究页共用同一份）；
// 这里仅 re-export 保持既有对外契约。
export { CTR_BASELINE_BY_POSITION, expectedCtrForPosition } from "./ctr-baseline";
import { expectedCtrForPosition } from "./ctr-baseline";

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
  /** 双语推荐语（UI 按 locale 渲染，避免英文界面出现中文推荐） */
  recommendationI18n?: { en: string; zh: string };
}

function evidence(source: string, ref: string, summary: string): OpportunityEvidence {
  return { source, ref, summary, capturedAt: new Date().toISOString() };
}

/** 证据摘要恒为英文（见 pickText(..., "en")），所以天数也要遵守英文单复数 */
export function daysAgoLabel(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"} ago`;
}

/**
 * 解析数据库时间戳。兼容以下真实数据形态：
 *   - ISO：`2026-10-14T06:15:53Z` / `2026-10-14T06:15:53+08:00`
 *   - SQLite `datetime('now')`：`2026-10-14 06:15:53`（UTC，无时区标记；手工拼 "Z" 是非 ISO
 *     输入，严格解析器下为 NaN → 曾导致"时效"判断静默失效）
 *   - 带毫秒：`2026-10-14 06:15:53.123`
 *   - date-only：`2026-10-14`（rank_history.date 等日期字段，按 UTC 零点）
 * @returns 毫秒时间戳；无法解析时返回 null（调用方必须按"未知"处理，不得当作新鲜）
 */
export function parseDbTimestamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  const iso = m ? `${m[1]}T${m[2] ?? "00:00:00"}${m[3] ?? ""}${m[4] ?? "Z"}` : s;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** 距今天数（null = 无法解析，调用方按"未知"处理） */
export function ageInDays(raw: string | null | undefined): number | null {
  const t = parseDbTimestamp(raw);
  if (t === null) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
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
    recommendationI18n: {
      en: `Improve the existing page's content and internal links for "${signal.keyword}" to close in on the Top 5 (now #${signal.currentRank}, competitor #${bestCompetitor.competitorRank})`,
      zh: `改进「${signal.keyword}」的现有页面内容与内链，向 Top5 逼近（当前 #${signal.currentRank}，竞品 #${bestCompetitor.competitorRank}）`,
    },
  };
}

/**
 * Lost Ranking Recovery：曾进入排名、现在未进入。
 * 两种证据形态：
 *   1) 相邻两行：上次有排名、本次无
 *   2) **窗口内曾进榜但最近未进**（真实稀疏数据的常见形态；只看相邻两行会漏掉）
 */
export function evaluateLostRecovery(signal: KeywordSignal): OpportunityCandidate | null {
  if (signal.currentRank !== null) return null;
  const bestInWindow = signal.bestRankInWindow ?? null;
  const adjacentLost = signal.previousRank !== null;
  const windowLost = bestInWindow !== null;
  if (!adjacentLost && !windowLost) return null;
  const wasRank = signal.previousRank ?? bestInWindow!;
  return {
    type: "lost_recovery",
    targetType: "keyword",
    targetValue: signal.keyword,
    priority: "P0",
    impact: "high",
    confidence: "high",
    evidence: [
      evidence(
        "rank_history",
        `keyword:${signal.keywordId}`,
        adjacentLost
          ? `${signal.keyword} 从 #${wasRank} 跌出前 100`
          : `${signal.keyword} 在窗口内曾达 #${signal.bestRankInWindow}（最近进榜 ${signal.lastRankedDate ?? "未知"}），当前已不在前 100`
      ),
      ...(adjacentLost && signal.previousUrl
        ? [evidence("rank_history", `keyword:${signal.keywordId}:url`, `上次排名 URL：${signal.previousUrl}`)]
        : []),
    ],
    signals: {
      previousRank: signal.previousRank,
      bestRankInWindow: signal.bestRankInWindow,
      lastRankedDate: signal.lastRankedDate,
      previousUrl: signal.previousUrl,
      currentUrl: signal.currentUrl,
      windowRows: signal.windowRows,
      rankedRows: signal.rankedRows,
    },
    recommendation: `恢复「${signal.keyword}」排名：先确认页面仍可访问/未被 noindex，再对照 SERP 现状评估内容差距`,
    recommendationI18n: {
      en: `Recover rankings for "${signal.keyword}": first verify the page is still reachable and not noindexed, then assess the content gap against the current SERP`,
      zh: `恢复「${signal.keyword}」排名：先确认页面仍可访问/未被 noindex，再对照 SERP 现状评估内容差距`,
    },
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
    recommendationI18n: {
      en: `Refresh ${signal.currentUrl}: close the content gap against the current top SERP results (rank dropped ${decline} places while the URL stayed the same)`,
      zh: `刷新 ${signal.currentUrl}：对照当前 SERP 前列结果补齐内容差距（排名 ${decline} 位下滑而 URL 未变）`,
    },
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
    recommendationI18n: {
      en: `Create or expand content for "${signal.keyword}": competitor ${bestCompetitor.competitorDomain} already ranks Top${bestCompetitor.competitorRank} for it`,
      zh: `创建/扩展「${signal.keyword}」内容：竞品 ${bestCompetitor.competitorDomain} 已凭该词进入 Top${bestCompetitor.competitorRank}`,
    },
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
    recommendationI18n: {
      en: `Improve the title/meta for "${query}": impressions are healthy and the position is decent, but CTR is well below the same-position baseline`,
      zh: `优化「${query}」的 title/meta：曝光充足、位置尚可但 CTR 显著低于同位置基线`,
    },
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
      recommendationI18n: {
        en: "Increase AI citation coverage: publish authoritative, citable content (comparison / data / definition pages) and build Google-side rankings for high-demand terms (AI Overview citations correlate strongly with SERP rankings)",
        zh: "提升 AI 引用覆盖：产出可被 AI 引用的权威内容（对比/数据/定义型页面），并在高需求词上建立 Google 侧排名（AI Overview 引用与 SERP 强相关）",
      },
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
        recommendationI18n: {
          en: `Close the AI mention gap: ${best.label} is mentioned roughly ${((best.mentions ?? 0) / Math.max(1, target.mentions ?? 1)).toFixed(1)}× more often than you — prioritise the content formats that get cited most`,
          zh: `缩小 AI 提及差距：${best.label} 的提及量约为我方 ${(best.mentions ?? 0) / Math.max(1, target.mentions ?? 1)} 倍，优先补充被高频引用的内容形态`,
        },
      };
    }
  }
  return null;
}

// ---------- Technical（审计快照的真实检测结果） ----------

const MAX_TECHNICAL_OPPORTUNITIES = 10;
/** 审计结果超过该天数视为"可能已过期"，用于证据时效标注（不隐藏，只降级提示） */
const AUDIT_STALE_DAYS = 30;

/** 技术风险的确定性优先级：严重度 + 受影响页面占比 + 问题模式（模板级=一次修复覆盖多页） */
export function technicalRiskLevel(rule: {
  severity: string;
  affectedRatio: number;
  pattern: string | null;
}): { priority: "P0" | "P1" | "P2"; impact: "high" | "medium" | "low"; score: number } {
  let score = rule.severity === "error" ? 3 : rule.severity === "warning" ? 2 : 1;
  if (rule.affectedRatio >= 0.5) score += 2;
  else if (rule.affectedRatio >= 0.2) score += 1;
  if (rule.pattern === "site-wide") score += 2;
  else if (rule.pattern === "repeated") score += 1;
  return {
    priority: score >= 6 ? "P0" : score >= 4 ? "P1" : "P2",
    impact: rule.affectedRatio >= 0.5 ? "high" : rule.affectedRatio >= 0.2 ? "medium" : "low",
    score,
  };
}

/**
 * 技术机会：**规则级**（而非按 URL 聚合），直接来自最近一次已完成审计的快照。
 * 这样每条机会都能回答"哪个规则、影响多少页、证据在哪、为什么这个优先级"。
 * 旧引擎审计（无 dashboard_json）退回 audit_issues 的 error 级聚合，保持可用。
 */
export async function collectTechnicalCandidates(userId: string, domain: string): Promise<OpportunityCandidate[]> {
  const audit = await getLatestAudit(userId, domain);
  if (!audit) return []; // 无审计数据 → DATA GAP（不伪造）

  const auditedAt = audit.finished_at ?? audit.started_at;
  const ageDays = ageInDays(auditedAt);
  const stale = ageDays !== null && ageDays > AUDIT_STALE_DAYS;

  // ---- 偏好路径：V2 快照（规则级，含 severity / affectedPages / pattern / 双语修复建议）----
  if (audit.dashboard_json) {
    let snapshot: DashboardSnapshot | null = null;
    try {
      snapshot = JSON.parse(audit.dashboard_json) as DashboardSnapshot;
    } catch {
      snapshot = null;
    }
    if (snapshot) {
      const counts = new Map<string, number>();
      for (const f of snapshot.findings) counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
      return snapshot.rules
        .filter((rule) => rule.status === "fail")
        .map((rule) => {
          const { priority, impact } = technicalRiskLevel(rule);
          const findings = counts.get(rule.ruleId) ?? rule.findings;
          const sampleMessage = rule.sampleMessage ? pickText(rule.sampleMessage, "en") : "";
          const target = rule.sampleUrl ?? domain;
          const ev: OpportunityEvidence[] = [
            evidence(
              "audit",
              `audit:${audit.id}:${rule.ruleId}`,
              `${findings} finding(s) across ${rule.affectedPages} page(s) · severity=${rule.severity} · pattern=${rule.pattern ?? "scattered"}${stale && ageDays !== null ? ` · audited ${daysAgoLabel(ageDays)}` : ""}`
            ),
          ];
          if (rule.sampleUrl && sampleMessage) {
            ev.push(evidence("audit_issues", rule.sampleUrl, sampleMessage));
          }
          const recI18n = {
            en: pickText(rule.recommendation, "en"),
            zh: pickText(rule.recommendation, "zh"),
          };
          return {
            type: "technical" as const,
            targetType: "url" as const,
            targetValue: target,
            priority,
            impact,
            confidence: "high" as const, // 自研爬虫直接观测
            evidence: ev,
            signals: {
              auditId: audit.id,
              ruleId: rule.ruleId,
              severity: rule.severity,
              findings,
              affectedPages: rule.affectedPages,
              affectedRatio: rule.affectedRatio,
              pattern: rule.pattern,
              auditedAt,
              ageDays,
              stale,
            },
            recommendation: recI18n.zh,
            recommendationI18n: recI18n,
          };
        })
        .sort((a, b) => {
          const order = { P0: 0, P1: 1, P2: 2 } as const;
          return order[a.priority] - order[b.priority];
        })
        .slice(0, MAX_TECHNICAL_OPPORTUNITIES);
    }
  }

  // ---- 兼容路径：旧引擎审计只有 audit_issues（按 URL 聚合 error 级）----
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
      impact: "high" as const,
      confidence: "high" as const,
      evidence: [
        evidence("audit_issues", `audit:${audit.id}:${url}`, `${count} error-level issue(s) on this page (audit #${audit.id})`),
      ],
      signals: { auditId: audit.id, errorCount: count, auditedAt, ageDays, stale, legacyEngine: true },
      recommendation: `Fix ${count} error-level issue(s) on ${url} (see audit #${audit.id})`,
      recommendationI18n: {
        en: `Fix ${count} error-level issue(s) on ${url} (see audit #${audit.id})`,
        zh: `修复 ${url} 上的 ${count} 个 error 级技术问题（详见审计报告 #${audit.id}）`,
      },
    }));
}

// ---------- Content（content_checks 的真实检查结果） ----------

const CONTENT_MAX_OPPORTUNITIES = 5;
const CONTENT_LOW_SCORE = 70;
/** 内容检查结果的时效窗口：超过则该结果不作为机会依据（避免用过时结果建议改动） */
const CONTENT_FRESH_DAYS = 30;

/** 内容检查得分 → 机会（纯函数，便于验证边界） */
export function evaluateContentCheck(row: {
  url: string;
  keyword: string;
  score: number;
  createdAt: string;
}): OpportunityCandidate | null {
  if (!row.url || row.score >= CONTENT_LOW_SCORE) return null;
  const ageDays = ageInDays(row.createdAt);
  if (ageDays === null) return null; // 时间不可解析 → 不作为机会依据
  if (ageDays > CONTENT_FRESH_DAYS) return null; // 过期结果不作为机会依据
  const gap = CONTENT_LOW_SCORE - row.score;
  const { priority, impact } = {
    priority: gap >= 30 ? ("P0" as const) : gap >= 15 ? ("P1" as const) : ("P2" as const),
    impact: gap >= 30 ? ("high" as const) : gap >= 15 ? ("medium" as const) : ("low" as const),
  };
  return {
    type: "content_refresh",
    targetType: "url",
    targetValue: row.url,
    priority,
    impact,
    confidence: "high", // 页面实测（词频/字数/结构）直接证据
    evidence: [
      evidence("content_checks", row.url, `Content score ${row.score}/100 for "${row.keyword}" (${daysAgoLabel(ageDays)})`),
    ],
    signals: {
      contentScore: row.score,
      keyword: row.keyword,
      ageDays,
      threshold: CONTENT_LOW_SCORE,
      source: "content_checks",
    },
    recommendation: `改进 ${row.url} 的内容以匹配「${row.keyword}」（当前内容得分 ${row.score}/100）`,
    recommendationI18n: {
      en: `Improve the content of ${row.url} so it matches "${row.keyword}" (current content score ${row.score}/100)`,
      zh: `改进 ${row.url} 的内容以匹配「${row.keyword}」（当前内容得分 ${row.score}/100）`,
    },
  };
}

/** 内容机会：只消费**最新且未过时**的内容检查记录，最多 5 条 */
export async function collectContentCandidates(userId: string): Promise<OpportunityCandidate[]> {
  const rows = await listContentChecks(userId, 20).catch(() => []);
  const out: OpportunityCandidate[] = [];
  for (const row of rows) {
    const candidate = evaluateContentCheck({
      url: row.url,
      keyword: row.keyword,
      score: row.score,
      createdAt: row.created_at,
    });
    if (candidate) out.push(candidate);
    if (out.length >= CONTENT_MAX_OPPORTUNITIES) break;
  }
  return out;
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
  /** 每个数据源的实际覆盖情况（行数 + 是否可用），用于解释"这个类别为什么没有机会" */
  sourceCoverage: OpportunitySourceCoverage[];
  candidates: Array<{ type: OpportunityType; target: string; priority: "P0" | "P1" | "P2"; isNew: boolean }>;
}

export interface OpportunitySourceCoverage {
  source: "audit" | "content_checks" | "rank_history" | "competitor_ranks" | "gsc" | "ai_search";
  rows: number;
  available: boolean;
  note: string;
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
  // 参与评估的关键词：当前有排名 / 上次有排名 / **窗口内曾进榜**（真实稀疏数据也能纳入）
  const candidateKeywords = rankSignals.filter(
    (signal) =>
      signal.currentRank !== null ||
      signal.previousRank !== null ||
      (signal.bestRankInWindow ?? null) !== null
  );
  if (candidateKeywords.length === 0) {
    dataGaps.push(
      rankSignals.length === 0
        ? "rank: 该域名在 30 天窗口内没有排名记录（先在 Position Tracking 添加并刷新关键词）"
        : `rank: 窗口内有 ${rankSignals.length} 个关键词的观测记录，但没有任何进榜名次（全部为「未进前 100」），因此不产生基于排名的机会`
    );
  }
  // 竞品证据 bounded：仅对可能成型的候选查竞品排名
  const pool = candidateKeywords
    .filter((signal) => (signal.currentRank !== null && signal.currentRank >= 8 && signal.currentRank <= 30) || signal.currentRank === null)
    .slice(0, 20);
  const competitorMap = await collectCompetitorSignals(userId, pool.map((signal) => signal.keywordId));
  const competitorRowCount = [...competitorMap.values()].reduce((n, rows) => n + rows.length, 0);
  if (competitorRowCount === 0) {
    dataGaps.push("competitor_gap: 没有竞品排名数据（先在 Competitors 添加竞品并刷新），该类别本次不产生机会");
  }

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

  // 2. Technical 信号（审计快照 / audit_issues，DB-only；无审计 → DATA GAP）
  const technical = await collectTechnicalCandidates(userId, domain);
  if (technical.length === 0) dataGaps.push("technical: 没有已完成的审计结果（先运行一次技术审计），该类别本次不产生机会");
  candidates.push(...technical);

  // 2b. Content 信号（content_checks 的真实检查结果；只消费未过时的低分记录）
  const contentCandidates = await collectContentCandidates(userId);
  if (contentCandidates.length === 0) {
    dataGaps.push("content_refresh: 没有 30 天内得分低于 70 的内容检查记录（先在 Content Optimization 运行检查）");
  }
  candidates.push(...contentCandidates);

  // 3. CTR 信号（GSC，缓存优先、单次调用、bounded 100 行）
  let gscRows = 0;
  let gscAvailable = false;
  if (options?.includeCtr !== false) {
    try {
      const gsc = await searchAnalytics({
        userId, projectId, dimensions: ["query"], rowLimit: 100, dateRange: "last_28_days",
      });
      gscAvailable = true;
      gscRows = gsc.rows.length;
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
  let aiRunFound = false;
  try {
    const runs = await listAiSearchRuns(userId, { projectId, runType: "brand_lookup", limit: 1 });
    const latest = runs[0] ?? null;
    aiRunFound = Boolean(latest);
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

  // 4b. 数据来源覆盖：让用户看到"这个类别为什么没有机会"，而不是只看到一个空列表
  const sourceCoverage: OpportunitySourceCoverage[] = [
    {
      source: "rank_history",
      rows: candidateKeywords.length,
      available: candidateKeywords.length > 0,
      note: "Tracked keywords with a rank position in the 30-day window",
    },
    {
      source: "competitor_ranks",
      rows: competitorRowCount,
      available: competitorRowCount > 0,
      note: "Competitor rank evidence for the candidate keywords",
    },
    {
      source: "audit",
      rows: technical.length,
      available: technical.length > 0,
      note: "Failing rules from the latest completed technical audit",
    },
    {
      source: "content_checks",
      rows: contentCandidates.length,
      available: contentCandidates.length > 0,
      note: "Content checks under 70 within the last 30 days",
    },
    {
      source: "gsc",
      rows: gscRows,
      available: gscAvailable,
      note: "Query-level impressions/clicks from Google Search Console (requires a bound property)",
    },
    {
      source: "ai_search",
      rows: aiRunFound ? 1 : 0,
      available: aiRunFound,
      note: "Most recent AI brand-visibility run",
    },
  ];

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
      signals: {
        ...candidate.signals,
        recommendation: candidate.recommendation,
        ...(candidate.recommendationI18n ? { recommendation_i18n: candidate.recommendationI18n } : {}),
      },
      actionPlan: buildActionPlan(candidate),
    });
    if (result.suppressed) suppressed += 1;
    else if (result.isNew) generated += 1;
    else refreshed += 1;
    persisted.push({ type: candidate.type, target: candidate.targetValue, priority: candidate.priority, isNew: result.isNew });
  }

  return { projectId, domain, generated, refreshed, suppressed, dataGaps, sourceCoverage, candidates: persisted };
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
