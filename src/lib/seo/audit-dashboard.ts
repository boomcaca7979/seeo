// ===== Audit Dashboard 聚合（V2 第二阶段的单一数据源） =====
//
// 目标：把 Audit Engine 已产生的数据（NormalizedPage / RuleExecution /
// robots / sitemap / llms.txt）聚合成一份完整的 Dashboard 快照，
// 让 Overview / Issues / Crawled Pages / Linking / Structured Data /
// AI Search / History 全部从同一份数据渲染，杜绝重复请求。
//
// 本模块只做聚合，不修改 Engine（Crawler / Rules / Score）。
// 页面健康分类、Category Score、Score Breakdown 全部直接源自 V2 Score Engine。

import type { AuditContext, RuleExecution, RuleCategory, RuleSeverity, LocalizedText } from "./audit-checks";
import { urlDedupKey } from "./audit-checks";
import { ruleImpact, scoreGrade, type ScoreRuleInput, type ScoreGrade } from "./audit-score";
import type { PageType } from "./page-type";
import type { StructuredDataStatus } from "./structured-data";
import type { AiCrawlerAccess, RobotsStatus } from "./site-reports";

export type { LocalizedText, RuleCategory, RuleSeverity, StructuredDataStatus, ScoreGrade };

// ---------- 快照类型 ----------

export type PageHealth = "healthy" | "needs-attention" | "critical" | "redirect" | "blocked";

export interface PageSnapshot {
  /** 实际请求的 URL */
  url: string;
  /** 跟随重定向后的最终 URL */
  finalUrl: string;
  status: number;
  ok: boolean;
  responseTimeMs: number;
  depth: number;
  hops: number;
  isRedirect: boolean;
  isLoop: boolean;
  source: string;
  pageType: PageType | null;
  wordCount: number | null;
  contentStatus: string | null;
  textHtmlRatio: number | null;
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  h1Count: number | null;
  internalLinks: number | null;
  externalLinks: number | null;
  inLinks: number | null;
  htmlSize: number | null;
  visibleTextSize: number | null;
  structuredDataStatus: StructuredDataStatus | null;
  structuredDataTypes: string[];
  semanticMainCount: number | null;
  robotsNoindex: boolean;
  health: PageHealth;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  noticeCount: number;
}

export interface FindingSnapshot {
  ruleId: string;
  url: string;
  severity: RuleSeverity;
  message: LocalizedText;
  metrics: Record<string, string | number | boolean> | null;
}

export interface RuleSnapshot {
  ruleId: string;
  name: LocalizedText;
  description: LocalizedText;
  recommendation: LocalizedText;
  category: RuleCategory;
  severity: RuleSeverity;
  pageLevel: "page" | "site";
  scoreWeight: number;
  status: "pass" | "fail";
  findings: number;
  affectedPages: number;
  affectedRatio: number;
  scoreImpact: number;
  sampleUrl: string | null;
  sampleMessage: LocalizedText | null;
  sampleMetrics: Record<string, string | number | boolean> | null;
  /** 问题模式：site-wide（多信号模板级）/ repeated（重复模式）/ null（分散） */
  pattern: IssuePattern;
}

export type IssuePattern = "site-wide" | "repeated" | null;

export interface CategoryScore {
  category: RuleCategory;
  score: number;
  /** true = 无足够数据（如无可解析页面），不展示数字分数 */
  notEnoughData: boolean;
  rules: number;
  failedRules: number;
  findings: number;
  affectedPages: number;
  /** 该分类中优先级最高的问题（ruleId + 名称） */
  majorIssue: { ruleId: string; name: LocalizedText; severity: RuleSeverity } | null;
  severities: { error: number; warning: number; notice: number };
}

export interface ScoreBreakdownEntry {
  ruleId: string;
  severity: RuleSeverity;
  scoreWeight: number;
  affectedPages: number;
  ratio: number;
  impact: number;
}

export interface DashboardSnapshot {
  engineVersion: string;
  ruleSetVersion: string;
  depth: "quick" | "full";
  generatedAt: string;
  /** true = 达到抓取上限时队列仍有页面（Partial audit） */
  partial: boolean;
  pagesCrawled: number;
  indexablePages: number;
  score: number;
  grade: ScoreGrade;
  rules: RuleSnapshot[];
  findings: FindingSnapshot[];
  pages: PageSnapshot[];
  scoreBreakdown: ScoreBreakdownEntry[];
  categories: CategoryScore[];
  coverage: { passed: number; failed: number; total: number; ratio: number };
  crawler: {
    pagesCrawled: number;
    htmlPages: number;
    redirects: number;
    errors: number;
    loops: number;
    avgResponseMs: number;
    fastestMs: number | null;
    slowestMs: number | null;
    httpStatus: { "2xx": number; "3xx": number; "4xx": number; "5xx": number; other: number };
  };
  content: {
    avgWordCount: number;
    lowContent: number;
    veryLowContent: number;
    avgTextHtmlRatio: number;
    byType: Record<string, number>;
  };
  linking: {
    avgInternalLinks: number;
    zeroInternalLinks: number;
    deepPages: number;
    orphans: number;
    linksToRedirects: number;
    depthDistribution: Record<string, number>;
  };
  structuredData: {
    statusCounts: Partial<Record<StructuredDataStatus, number>>;
    schemaTypes: Record<string, number>;
    pagesWithSD: number;
  };
  aiSearch: {
    crawlers: Record<string, AiCrawlerAccess>;
    llmsTxt: { status: "found" | "missing" | "invalid"; httpStatus: number | null } | null;
    semanticHtmlAffected: number;
  };
  robots: { status: RobotsStatus; httpStatus: number | null; sitemapUrls: string[]; disallowAll: boolean };
  sitemap: { found: boolean; urls: number; httpStatus: number | null } | null;
}

// ---------- 页面健康分类 ----------

function robotsHasNoindex(robotsMeta: string | null): boolean {
  if (!robotsMeta) return false;
  const d = robotsMeta.toLowerCase();
  return d.includes("noindex") || d.includes("none");
}

/** 页面健康分类：critical（error/失效）> blocked（noindex）> redirect > needs-attention（warning）> healthy */
export function classifyPageHealth(input: {
  ok: boolean;
  hops: number;
  errorCount: number;
  warningCount: number;
  robotsNoindex: boolean;
}): PageHealth {
  if (!input.ok || input.errorCount > 0) return "critical";
  if (input.robotsNoindex) return "blocked";
  if (input.hops > 0) return "redirect";
  if (input.warningCount > 0) return "needs-attention";
  return "healthy";
}

// ---------- 问题模式检测（多信号，防机械误判） ----------

/** 归一化消息：去数字/百分号/空白 → 用于模式比较 */
function normalizeMessage(v: LocalizedText | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : `${v.en} ${v.zh}`;
  return s.replace(/[\d.,%]+/g, "#").replace(/\s+/g, " ").trim();
}

/** metric 签名（键值排序序列化） */
function metricSignature(m: Record<string, string | number | boolean> | null): string {
  if (!m || Object.keys(m).length === 0) return "";
  return JSON.stringify(Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])));
}

/**
 * 问题模式检测。只有多个信号同时成立时才判 site-wide（模板级）：
 * - 同一规则
 * - 同一归一化消息（去数字）
 * - 同一 metric 模式（键与值一致）
 * - 高覆盖率（≥60% 可索引页面）
 * - 页面类型高度一致（≥80% findings 落在同一类型）
 *
 * 47 页出现同一问题 ≠ 47 页来自同一模板：仅"同一消息"时最多判 repeated，
 * 不轻易下 site-wide 结论。
 */
export function detectIssuePattern(input: {
  findings: FindingSnapshot[];
  pageTypeByUrl: Map<string, PageType | null>;
  indexablePages: number;
}): IssuePattern {
  const { findings, pageTypeByUrl, indexablePages } = input;
  if (findings.length < 3) return null;

  // 信号 S1：消息归一化后唯一（同一种问题描述）
  const msgSet = new Set(findings.map((f) => normalizeMessage(f.message)));
  const s1 = msgSet.size === 1;

  // 信号 S2：metric 模式一致（键值相同）
  let firstSig: string | null = null;
  let metricConsistent = true;
  let hasMetrics = false;
  for (const f of findings) {
    if (f.metrics && Object.keys(f.metrics).length > 0) hasMetrics = true;
    const sig = metricSignature(f.metrics);
    if (firstSig === null) firstSig = sig;
    else if (sig !== firstSig) metricConsistent = false;
  }
  const s2 = hasMetrics && metricConsistent;

  // 信号 S3：高覆盖率
  const distinctUrls = new Set(findings.map((f) => f.url)).size;
  const ratio = indexablePages > 0 ? distinctUrls / indexablePages : 0;
  const s3 = ratio >= 0.6;

  // 信号 S4：页面类型高度一致
  const typeCounts = new Map<string, number>();
  for (const f of findings) {
    const t = pageTypeByUrl.get(f.url) ?? pageTypeByUrl.get(f.url.replace(/\/$/, "")) ?? "unknown";
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const maxTypeCount = typeCounts.size > 0 ? Math.max(...typeCounts.values()) : 0;
  const s4 = maxTypeCount / findings.length >= 0.8;

  // site-wide：消息一致 + metric 一致 +（高覆盖或同类型）——多信号才成立
  if (s1 && s2 && (s3 || s4)) return "site-wide";
  // repeated：消息一致 + 至少一个附加信号
  if (s1 && (s2 || s3 || s4)) return "repeated";
  return null;
}

// ---------- 聚合 ----------

export function buildDashboardSnapshot(
  ctx: AuditContext,
  executions: RuleExecution[],
  failedRules: ScoreRuleInput[],
  score: number,
  engineVersion: string,
  ruleSetVersion: string,
  partial = false
): DashboardSnapshot {
  const indexablePages = ctx.indexablePages;

  // 1. findings 平铺（severity 允许 finding 级覆盖）
  const findings: FindingSnapshot[] = [];
  for (const exec of executions) {
    for (const f of exec.findings) {
      findings.push({
        ruleId: exec.rule.id,
        url: f.url,
        severity: f.severity ?? exec.severity,
        message: f.message,
        metrics: f.metrics ?? null,
      });
    }
  }

  // 2. 每页 issue 统计（按 URL 精确匹配；与规则输出的 finding.url 一致）
  const urlStats = new Map<string, { error: number; warning: number; notice: number }>();
  for (const f of findings) {
    const s = urlStats.get(f.url) ?? { error: 0, warning: 0, notice: 0 };
    s[f.severity]++;
    urlStats.set(f.url, s);
  }

  // 3. 已解析页面快照
  const pages: PageSnapshot[] = [];
  const parsedKeys = new Set<string>();
  for (const np of ctx.pages) {
    const stats = urlStats.get(np.finalUrl) ?? { error: 0, warning: 0, notice: 0 };
    parsedKeys.add(urlDedupKey(np.finalUrl));
    pages.push({
      url: np.requestedUrl,
      finalUrl: np.finalUrl,
      status: np.status,
      ok: true,
      responseTimeMs: np.responseTimeMs,
      depth: np.depth,
      hops: np.hops,
      isRedirect: np.hops > 0,
      isLoop: np.isLoop,
      source: "start",
      pageType: np.contentType,
      wordCount: np.wordCount,
      contentStatus: np.contentStatus,
      textHtmlRatio: np.textHtmlRatio,
      title: np.page.title,
      description: np.page.metaDescription,
      h1: np.page.h1[0] ?? null,
      canonical: np.page.canonical,
      h1Count: np.page.h1.length,
      internalLinks: np.internalLinkCount,
      externalLinks: np.externalLinkCount,
      inLinks: np.inLinkCount,
      htmlSize: np.page.htmlSize ?? null,
      visibleTextSize: np.page.visibleTextSize ?? null,
      structuredDataStatus: np.structuredData.status,
      structuredDataTypes: np.structuredData.nodeTypes,
      semanticMainCount: np.page.semanticMainCount ?? null,
      robotsNoindex: robotsHasNoindex(np.page.robotsMeta),
      health: classifyPageHealth({
        ok: true,
        hops: np.hops,
        errorCount: stats.error,
        warningCount: stats.warning,
        robotsNoindex: robotsHasNoindex(np.page.robotsMeta),
      }),
      issueCount: stats.error + stats.warning + stats.notice,
      errorCount: stats.error,
      warningCount: stats.warning,
      noticeCount: stats.notice,
    });
  }

  // 4. 未解析但被请求的失效/重定向记录 → 追加为页面行（Broken/Redirect 分类可见）
  const brokenEntries: PageSnapshot[] = [];
  for (const rec of ctx.fetchRecords) {
    if (rec.ok) continue;
    if (parsedKeys.has(urlDedupKey(rec.finalUrl))) continue; // 已作为解析页
    const stats = urlStats.get(rec.url) ?? { error: 0, warning: 0, notice: 0 };
    brokenEntries.push({
      url: rec.url,
      finalUrl: rec.finalUrl,
      status: rec.status,
      ok: false,
      responseTimeMs: rec.responseTimeMs,
      depth: rec.depth,
      hops: rec.hops,
      isRedirect: rec.hops > 0,
      isLoop: rec.isLoop,
      source: rec.source,
      pageType: null,
      wordCount: null,
      contentStatus: null,
      textHtmlRatio: null,
      title: null,
      description: null,
      h1: null,
      canonical: null,
      h1Count: null,
      internalLinks: null,
      externalLinks: null,
      inLinks: null,
      htmlSize: null,
      visibleTextSize: null,
      structuredDataStatus: null,
      structuredDataTypes: [],
      semanticMainCount: null,
      robotsNoindex: false,
      health: rec.isLoop ? "redirect" : "critical",
      issueCount: stats.error + stats.warning + stats.notice,
      errorCount: stats.error,
      warningCount: stats.warning,
      noticeCount: stats.notice,
    });
  }
  pages.push(...brokenEntries);

  // 5. 规则快照（含 score impact、受影响比例与问题模式）
  const impactById = new Map<string, { impact: number; ratio: number }>();
  for (const fr of failedRules) {
    const imp = ruleImpact(fr, indexablePages);
    impactById.set(fr.ruleId, { impact: imp.impact, ratio: imp.ratio });
  }
  const pageTypeByUrl = new Map<string, PageType | null>();
  for (const p of pages) {
    pageTypeByUrl.set(p.url, p.pageType);
    pageTypeByUrl.set(p.finalUrl, p.pageType);
  }
  const rules: RuleSnapshot[] = executions.map((exec) => {
    const imp = impactById.get(exec.rule.id);
    const first = exec.findings[0];
    const execFindings = findings.filter((f) => f.ruleId === exec.rule.id);
    return {
      ruleId: exec.rule.id,
      name: exec.rule.name,
      description: exec.rule.description,
      recommendation: exec.rule.recommendation,
      category: exec.rule.category,
      severity: exec.severity,
      pageLevel: exec.rule.pageLevel,
      scoreWeight: exec.rule.scoreWeight,
      status: exec.status,
      findings: exec.findings.length,
      affectedPages: exec.affectedPages,
      affectedRatio: indexablePages > 0 ? Math.round((exec.affectedPages / indexablePages) * 1000) / 1000 : 0,
      scoreImpact: imp ? Math.round(imp.impact * 100) / 100 : 0,
      sampleUrl: first?.url ?? null,
      sampleMessage: first?.message ?? null,
      sampleMetrics: first?.metrics ?? null,
      pattern: detectIssuePattern({
        findings: execFindings,
        pageTypeByUrl,
        indexablePages,
      }),
    };
  });

  // 6. Score breakdown（V2 引擎逐规则影响，与健康分完全同源）
  const scoreBreakdown: ScoreBreakdownEntry[] = failedRules.map((fr) => {
    const imp = ruleImpact(fr, indexablePages);
    return {
      ruleId: fr.ruleId,
      severity: fr.severity,
      scoreWeight: fr.scoreWeight,
      affectedPages: fr.affectedPages,
      ratio: Math.round(imp.ratio * 1000) / 1000,
      impact: Math.round(imp.impact * 100) / 100,
    };
  });

  // 7. Category scores：归一化（per-rule health 均值，规则数量不影响可比性）
  const categories: CategoryScore[] = [];
  const byCategory = new Map<RuleCategory, RuleExecution[]>();
  for (const exec of executions) {
    const arr = byCategory.get(exec.rule.category) ?? [];
    arr.push(exec);
    byCategory.set(exec.rule.category, arr);
  }
  for (const [category, execs] of byCategory) {
    const failed = execs.filter((e) => e.findings.length > 0);
    const catFindings = failed.flatMap((e) => e.findings);
    const catPages = new Set(catFindings.map((f) => f.url)).size;

    // 每规则归一化健康分：100 × (1 - 实际impact / 该规则最大impact)
    // → severity / weight / affectedRatio 都参与，规则数量与绝对权重不影响可比性
    let totalHealth = 0;
    for (const e of execs) {
      const maxImpact = ruleImpact(
        { ruleId: e.rule.id, severity: e.severity, scoreWeight: e.rule.scoreWeight, pageLevel: e.rule.pageLevel, affectedPages: indexablePages },
        indexablePages
      ).impact;
      const actualImpact = impactById.get(e.rule.id)?.impact ?? 0;
      const health = maxImpact > 0 ? 100 * (1 - actualImpact / maxImpact) : 100;
      totalHealth += Math.max(0, Math.min(100, health));
    }
    const avgHealth = execs.length > 0 ? totalHealth / execs.length : 100;

    // 分类中最需要处理的问题（severity 主导 + ratio + impact）
    let majorIssue: CategoryScore["majorIssue"] = null;
    let majorKey = -1;
    for (const e of failed) {
      const imp = impactById.get(e.rule.id);
      const rank = e.severity === "error" ? 3 : e.severity === "warning" ? 2 : 1;
      const ratio = indexablePages > 0 ? e.affectedPages / indexablePages : 0;
      const key = rank * 10000 + Math.round(ratio * 1000) * 10 + Math.round(imp?.impact ?? 0) * 10;
      if (key > majorKey) {
        majorKey = key;
        majorIssue = { ruleId: e.rule.id, name: e.rule.name, severity: e.severity };
      }
    }

    categories.push({
      category,
      score: Math.max(0, Math.min(100, Math.round(avgHealth))),
      notEnoughData: indexablePages === 0,
      rules: execs.length,
      failedRules: failed.length,
      findings: catFindings.length,
      affectedPages: catPages,
      majorIssue,
      severities: {
        error: catFindings.filter((f) => (f.severity ?? "warning") === "error").length,
        warning: catFindings.filter((f) => (f.severity ?? "warning") === "warning").length,
        notice: catFindings.filter((f) => (f.severity ?? "warning") === "notice").length,
      },
    });
  }
  categories.sort((a, b) => a.score - b.score);

  // 8. Coverage
  const failedCount = executions.filter((e) => e.findings.length > 0).length;
  const coverage = {
    passed: executions.length - failedCount,
    failed: failedCount,
    total: executions.length,
    ratio: executions.length > 0 ? Math.round(((executions.length - failedCount) / executions.length) * 1000) / 1000 : 0,
  };

  // 9. Crawler / HTTP stats
  const httpStatus = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  let redirects = 0;
  let errors = 0;
  let loops = 0;
  let htmlPages = 0;
  const times: number[] = [];
  for (const rec of ctx.fetchRecords) {
    if (rec.hops > 0) redirects++;
    if (rec.isLoop) loops++;
    if (rec.status >= 500) { httpStatus["5xx"]++; errors++; }
    else if (rec.status >= 400) { httpStatus["4xx"]++; errors++; }
    else if (rec.status >= 300) { httpStatus["3xx"]++; }
    else if (rec.status >= 200) { httpStatus["2xx"]++; htmlPages++; }
    else if (rec.errorCode === "NETWORK" || rec.errorCode === "TIMEOUT") { httpStatus.other++; errors++; }
    else httpStatus.other++;
    times.push(rec.responseTimeMs);
  }
  const avgResponseMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;

  // 10. Content stats
  const wordCounts = ctx.pages.map((p) => p.wordCount);
  const avgWordCount = wordCounts.length > 0 ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0;
  const ratios = ctx.pages.map((p) => p.textHtmlRatio);
  const avgTextHtmlRatio = ratios.length > 0 ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 1000 : 0;
  const byType: Record<string, number> = {};
  for (const p of ctx.pages) byType[p.contentType] = (byType[p.contentType] ?? 0) + 1;

  // 11. Linking stats
  const avgInternalLinks = ctx.pages.length > 0
    ? Math.round((ctx.pages.reduce((a, p) => a + p.internalLinkCount, 0) / ctx.pages.length) * 10) / 10
    : 0;
  const depthDistribution: Record<string, number> = { 0: 0, 1: 0, 2: 0, 3: 0, "4+": 0 };
  for (const p of ctx.pages) {
    const key = p.depth <= 3 ? String(p.depth) : "4+";
    depthDistribution[key] = (depthDistribution[key] ?? 0) + 1;
  }
  const ruleCount = (id: string): number => rules.find((r) => r.ruleId === id)?.findings ?? 0;

  // 12. Structured Data stats
  const sdStatusCounts: Partial<Record<StructuredDataStatus, number>> = {};
  const schemaTypes: Record<string, number> = {};
  let pagesWithSD = 0;
  for (const p of ctx.pages) {
    const s = p.structuredData.status;
    sdStatusCounts[s] = (sdStatusCounts[s] ?? 0) + 1;
    if (s !== "none") pagesWithSD++;
    for (const t of p.structuredData.nodeTypes) schemaTypes[t] = (schemaTypes[t] ?? 0) + 1;
  }

  // 13. AI Search
  const llmsTxt = ctx.llmsTxt
    ? { status: ctx.llmsTxt.status as "found" | "missing" | "invalid", httpStatus: ctx.llmsTxt.httpStatus }
    : null;

  return {
    engineVersion,
    ruleSetVersion,
    depth: ctx.depth,
    generatedAt: new Date().toISOString(),
    partial,
    pagesCrawled: ctx.fetchRecords.length,
    indexablePages,
    score,
    grade: scoreGrade(score),
    rules,
    findings,
    pages,
    scoreBreakdown,
    categories,
    coverage,
    crawler: {
      pagesCrawled: ctx.fetchRecords.length,
      htmlPages,
      redirects,
      errors,
      loops,
      avgResponseMs,
      fastestMs: times.length > 0 ? Math.min(...times) : null,
      slowestMs: times.length > 0 ? Math.max(...times) : null,
      httpStatus,
    },
    content: {
      avgWordCount,
      lowContent: ctx.pages.filter((p) => p.contentStatus === "low").length,
      veryLowContent: ctx.pages.filter((p) => p.contentStatus === "very-low").length,
      avgTextHtmlRatio,
      byType,
    },
    linking: {
      avgInternalLinks,
      zeroInternalLinks: ctx.pages.filter((p) => p.internalLinkCount === 0).length,
      deepPages: ctx.pages.filter((p) => p.depth > 4).length,
      orphans: ruleCount("orphan-pages"),
      linksToRedirects: ruleCount("links-to-redirects"),
      depthDistribution,
    },
    structuredData: {
      statusCounts: sdStatusCounts,
      schemaTypes,
      pagesWithSD,
    },
    aiSearch: {
      crawlers: ctx.robots.aiCrawlers,
      llmsTxt,
      semanticHtmlAffected: ruleCount("semantic-html"),
    },
    robots: {
      status: ctx.robots.status,
      httpStatus: ctx.robots.httpStatus,
      sitemapUrls: ctx.robots.sitemapUrls,
      disallowAll: ctx.robots.disallowAll,
    },
    sitemap: ctx.sitemap
      ? { found: ctx.sitemap.found, urls: ctx.sitemap.urls.length, httpStatus: ctx.sitemap.httpStatus }
      : null,
  };
}

/** 按 ruleId 取规则快照 */
export function ruleById(snapshot: DashboardSnapshot, ruleId: string): RuleSnapshot | undefined {
  return snapshot.rules.find((r) => r.ruleId === ruleId);
}

/** 某规则的受影响 URL 列表（按 finding 分组，保持顺序） */
export function affectedUrlsOf(snapshot: DashboardSnapshot, ruleId: string): FindingSnapshot[] {
  return snapshot.findings.filter((f) => f.ruleId === ruleId);
}
