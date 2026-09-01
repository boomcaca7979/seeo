// ===== 技术 SEO 审计：BFS 爬取同域名页面（Audit Engine V2） =====
//
// 架构（V2）：
// - 一次抓取（fetchPageWithRedirects 记录重定向链/hop/环）→ 一次解析（parsePage）
//   → normalizePage 产出 NormalizedPage（contentType / 阈值 / text-html-ratio /
//   structured-data / 内链外链统计），全部规则共享同一份数据，避免 N× 请求。
// - robots.txt / sitemap / llms.txt 各只请求一次（site-reports.ts）。
// - 统一规则目录（audit-checks.ts）执行，issue 统一结构写库；
//   健康分由 audit-score.ts 基于 severity × weight × affectedPageRatio 计算。
// - 历史记录写入 engine_version / rule_set_version，规则演进后可解释旧结果。
//
// 抓取上限统一走 crawlLimitFor(depth)：quick=1，full=DEFAULT_CRAWL_LIMIT(50)。
// 未来套餐扩展 100/500 时只需改 DEFAULT_CRAWL_LIMIT 或按套餐映射，不散落硬编码。

import {
  fetchPageWithRedirects,
  parsePage,
  CrawlError,
  normalizeUrl,
  type PageData,
} from "@/lib/crawl";
import {
  updateAuditProgress,
  finishAudit,
  addAuditIssue,
  getAuditIssues,
  getPreviousAudit,
  createAlert,
  hasAlertToday,
} from "@/lib/db";
import {
  runAuditRules,
  executionToIssues,
  normalizePage,
  urlDedupKey,
  type AuditContext,
  type AuditIssue,
  type FetchRecord,
  type NormalizedPage,
  type RuleExecution,
  type LocalizedText,
} from "@/lib/seo/audit-checks";
import {
  calculateHealthScoreV2,
  ENGINE_VERSION,
  RULE_SET_VERSION,
  type ScoreRuleInput,
  type ScoreSeverity,
} from "@/lib/seo/audit-score";
import {
  fetchRobotsReport,
  fetchSitemapReport,
  fetchLlmsTxtReport,
  type RobotsReport,
  type SitemapReport,
  type LlmsTxtReport,
} from "@/lib/seo/site-reports";
import { compareAudits } from "@/lib/seo/audit-history";
import { buildDashboardSnapshot } from "@/lib/seo/audit-dashboard";

/** full 深度抓取上限（唯一上限入口；未来按套餐映射 100/500） */
export const DEFAULT_CRAWL_LIMIT = 50;
/** quick 深度只爬起始页 */
export const QUICK_CRAWL_LIMIT = 1;

const CONCURRENCY = 2;
const STARTPAGE_RETRY_MS = 12_000; // 首页重试时给 Vercel 冷启动更长一点的窗口
const QUEUE_LIMIT = 500;

export type AuditDepth = "quick" | "full";

export interface RunAuditOptions {
  depth?: AuditDepth;
}

export interface PageDetailEntry {
  url: string;
  responseTimeMs: number;
  status: number;
  ok: boolean;
}

export interface AuditResult {
  auditId: number;
  domain: string;
  depth: AuditDepth;
  pagesCrawled: number;
  healthScore: number;
  errors: number;
  warnings: number;
  notices: number;
  status: "completed" | "failed";
  error?: string;
  pagesDetail?: PageDetailEntry[];
  homepageParsed?: boolean;
}

/** 统一抓取上限：按深度返回，不写死 50/1 */
export function crawlLimitFor(depth: AuditDepth): number {
  return depth === "full" ? DEFAULT_CRAWL_LIMIT : QUICK_CRAWL_LIMIT;
}

/** 规范化 URL：去 hash、保留 pathname+search */
function normalizeLink(href: string): string | null {
  try {
    const u = new URL(href);
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** 爬取失败（超时/网络/HTTP 错误）构造 FetchRecord */
function errorRecord(url: string, e: unknown): FetchRecord {
  const msg = e instanceof Error ? e.message : String(e);
  let errorCode: FetchRecord["errorCode"];
  let status = 0;
  if (e instanceof CrawlError && (e.code === "TIMEOUT" || e.code === "NETWORK" || e.code === "HTTP_ERROR")) {
    errorCode = e.code;
    if (e.code === "HTTP_ERROR") {
      const m = msg.match(/HTTP (\d+)/);
      status = m ? Number(m[1]) : 0;
    }
  } else {
    errorCode = "NETWORK";
  }
  return {
    url,
    finalUrl: url,
    status,
    responseTimeMs: 0,
    hops: 0,
    redirectChain: [],
    isLoop: false,
    ok: false,
    errorCode,
    source: "link",
    depth: 0,
  };
}

/** 单 URL 抓取：首页批次超时自动重试一次（应对 Vercel 冷启动） */
async function fetchRecordFor(
  url: string,
  retried: { current: boolean }
): Promise<{ rec: FetchRecord; page?: PageData }> {
  let detail;
  try {
    detail = await fetchPageWithRedirects(url);
  } catch (e) {
    if (e instanceof CrawlError && e.code === "TIMEOUT" && !retried.current) {
      retried.current = true;
      try {
        detail = await fetchPageWithRedirects(url, STARTPAGE_RETRY_MS);
      } catch (e2) {
        return { rec: errorRecord(url, e2) };
      }
    } else {
      return { rec: errorRecord(url, e) };
    }
  }

  const ok = detail.status >= 200 && detail.status < 300 && detail.html.length > 0;
  const rec: FetchRecord = {
    url,
    finalUrl: detail.finalUrl,
    status: detail.status,
    responseTimeMs: detail.responseTimeMs,
    hops: detail.hops,
    redirectChain: detail.redirectChain,
    isLoop: detail.isLoop,
    ok,
    source: "link", // 由调用方按入队来源覆写
    depth: 0, // 由调用方按入队深度覆写
  };
  if (!ok) return { rec };

  const page = parsePage(detail.html, detail.finalUrl);
  page.responseTimeMs = detail.responseTimeMs;
  page.status = detail.status;
  page.finalUrl = detail.finalUrl;
  return { rec, page };
}

/** LText 序列化为 JSON 字符串存库；历史纯文本 string 原样存储 */
function serializeLocalized(t: LocalizedText): string {
  return typeof t === "string" ? t : JSON.stringify(t);
}

/** 将 AuditIssue 写入数据库（type=checkId, detail=message） */
async function writeIssueToDb(userId: string, auditId: number, issue: AuditIssue): Promise<void> {
  await addAuditIssue(userId, {
    audit_id: auditId,
    type: issue.checkId,
    severity: issue.severity,
    url: issue.url,
    detail: serializeLocalized(issue.message),
    suggestion: serializeLocalized(issue.suggestion),
  });
}

/** 将数据库 AuditIssueRow 转换回 AuditIssue（用于历史对比） */
function dbIssuesToAuditIssues(rows: Array<{
  type: string;
  severity: string;
  url: string;
  detail: string;
  suggestion: string | null;
}>): AuditIssue[] {
  return rows.map((r) => ({
    checkId: r.type,
    checkName: r.type,
    message: r.detail,
    url: r.url,
    severity: r.severity as AuditIssue["severity"],
    suggestion: r.suggestion ?? "",
  }));
}

/** 规则 findings 中最严重的 severity（允许 finding 级覆盖，如 5xx→warning） */
function worstSeverity(exec: RuleExecution): ScoreSeverity {
  const severities = exec.findings.map((f) => f.severity ?? exec.severity);
  if (severities.some((s) => s === "error")) return "error";
  if (severities.some((s) => s === "warning")) return "warning";
  return "notice";
}

/** 审计完成后生成预警（带同日去重兜底） */
async function generateAuditAlerts(
  userId: string,
  auditId: number,
  domain: string,
  errorCount: number,
  issues: Array<{ type: string; severity: string }>
): Promise<void> {
  const prev = await getPreviousAudit(userId, domain, auditId);

  const has404 = issues.some((i) => i.type === "broken-links" || i.type.includes("404"));
  if (has404) {
    const title = `${domain} 检测到 404 死链`;
    if (await hasAlertToday(userId, domain, title)) return;
    await createAlert(userId, {
      type: "new_error",
      level: "error",
      title,
      detail: `审计 #${auditId} 发现 404 错误页面，建议添加 301 重定向`,
      domain,
    });
    return;
  }

  if (prev && errorCount > prev.errors) {
    const title = `${domain} 审计错误数增加`;
    if (await hasAlertToday(userId, domain, title)) return;
    await createAlert(userId, {
      type: "new_error",
      level: "warning",
      title,
      detail: `本次 ${errorCount} 个错误，上次 ${prev.errors} 个`,
      domain,
    });
    return;
  }

  const title = `${domain} 审计完成`;
  if (await hasAlertToday(userId, domain, title)) return;
  await createAlert(userId, {
    type: "audit_done",
    level: "info",
    title,
    detail: `健康分 ${errorCount === 0 ? "良好" : `${errorCount} 个错误`} · ${issues.length} 个问题`,
    domain,
  });
}

interface QueueEntry {
  url: string;
  source: FetchRecord["source"];
  depth: number;
}

/**
 * 执行一次完整审计（Audit Engine V2）：
 * BFS 爬取同域名页面（跟随重定向并记录链/hop/环），一次抓取一次解析，
 * robots/sitemap/llms.txt 各请求一次，全部规则共享 NormalizedPage 数据，
 * 完成后按 severity × weight × affectedPageRatio 计算健康分、写历史对比。
 *
 * - depth: 'quick'（默认）：只爬首页（1 页），只执行页面级规则
 * - depth: 'full'：DEFAULT_CRAWL_LIMIT(50) 页 BFS，执行页面级 + 站点级规则
 */
export async function runAudit(
  userId: string,
  auditId: number,
  domain: string,
  options?: RunAuditOptions
): Promise<AuditResult> {
  const depth: AuditDepth = options?.depth ?? "quick";
  const crawlLimit = crawlLimitFor(depth);
  const startUrl = normalizeUrl(domain);

  let baseUrl: URL;
  try {
    baseUrl = new URL(startUrl);
  } catch (err) {
    const errMsg = (err as Error)?.message ?? String(err);
    await finishAudit(userId, auditId, {
      health_score: 0,
      errors: 1,
      warnings: 0,
      notices: 0,
      status: "failed",
      error: errMsg,
      engine_version: ENGINE_VERSION,
      rule_set_version: RULE_SET_VERSION,
    });
    return {
      auditId,
      domain,
      depth,
      pagesCrawled: 0,
      healthScore: 0,
      errors: 1,
      warnings: 0,
      notices: 0,
      status: "failed",
      error: errMsg,
    };
  }

  const origin = `${baseUrl.protocol}//${baseUrl.host}`;
  const robotsReport: RobotsReport = await fetchRobotsReport(origin);

  const visited = new Set<string>();
  // 已审计页面的最终 URL 键（跟随重定向后）：同一最终页面只会被审计一次。
  const resolvedUrls = new Set<string>();
  const queue: QueueEntry[] = [{ url: baseUrl.toString(), source: "start", depth: 0 }];
  const fetchRecords: FetchRecord[] = [];
  const normalizedPages: NormalizedPage[] = [];
  const linkGraph = new Map<string, Set<string>>();
  const pagesDetail: PageDetailEntry[] = [];
  const retriedRef = { current: false };
  let pagesCrawled = 0;
  let homepageParsed = false;

  try {
    while (queue.length > 0 && pagesCrawled < crawlLimit) {
      const batch: QueueEntry[] = [];
      while (
        batch.length < CONCURRENCY &&
        queue.length > 0 &&
        pagesCrawled + batch.length < crawlLimit
      ) {
        const entry = queue.shift()!;
        if (visited.has(entry.url)) continue;
        try {
          const u = new URL(entry.url);
          if (isDisallowedPath(u.pathname, robotsReport.universalDisallow)) {
            visited.add(entry.url);
            continue;
          }
        } catch {
          continue;
        }
        visited.add(entry.url);
        batch.push(entry);
      }

      if (batch.length === 0) break;

      const isFirstBatch = pagesCrawled === 0;
      const results = await Promise.allSettled(
        batch.map((entry) => fetchRecordFor(entry.url, retriedRef))
      );

      for (let i = 0; i < results.length; i++) {
        const entry = batch[i];
        const r = results[i];
        pagesCrawled++;
        await updateAuditProgress(userId, auditId, pagesCrawled);

        const rec: FetchRecord =
          r.status === "fulfilled" ? r.value.rec : errorRecord(entry.url, r.reason);
        rec.source = entry.source;
        rec.depth = entry.depth;
        fetchRecords.push(rec);
        pagesDetail.push({
          url: entry.url,
          responseTimeMs: rec.responseTimeMs,
          status: rec.status,
          ok: rec.ok,
        });

        if (!rec.ok) {
          // 起始页无法解析（full 模式）：用 robots 声明的 sitemap URL 降级入队
          if (isFirstBatch && !homepageParsed && depth === "full") {
            const smUrls =
              robotsReport.sitemapUrls.length > 0
                ? robotsReport.sitemapUrls
                : [`${origin}/sitemap.xml`];
            for (const smUrl of smUrls) {
              if (visited.has(smUrl)) continue;
              if (queue.some((q) => q.url === smUrl)) continue;
              if (queue.length > QUEUE_LIMIT) break;
              queue.push({ url: smUrl, source: "sitemap", depth: 1 });
            }
          }
          continue;
        }

        if (r.status !== "fulfilled" || !r.value.page) continue;
        const page = r.value.page;

        // 重定向别名去重：以最终 URL（跟随重定向后）为准，同一最终页面只解析一次
        const finalKey = urlDedupKey(rec.finalUrl);
        if (resolvedUrls.has(finalKey)) continue;
        resolvedUrls.add(finalKey);
        visited.add(rec.finalUrl);

        if (isFirstBatch) {
          homepageParsed = true;
        }

        const np = normalizePage(page, rec, linkGraph);
        normalizedPages.push(np);

        // 收集同域名内链入队（quick 模式只爬首页，跳过收集）
        if (depth === "full") {
          for (const link of page.links) {
            if (link.isExternal) continue;
            const normalized = normalizeLink(link.href);
            if (!normalized) continue;
            const targetKey = urlDedupKey(normalized);
            let sources = linkGraph.get(targetKey);
            if (!sources) {
              sources = new Set();
              linkGraph.set(targetKey, sources);
            }
            sources.add(rec.finalUrl);
            if (visited.has(normalized)) continue;
            if (queue.some((q) => q.url === normalized)) continue;
            if (queue.length > QUEUE_LIMIT) break;
            queue.push({ url: normalized, source: "link", depth: entry.depth + 1 });
          }
        }
      }
    }

    // 起始页最终未能解析：明确标记审计不可用，不给虚高分
    if (!homepageParsed) {
      await writeIssueToDb(userId, auditId, {
        checkId: "startpage-unparsed",
        checkName: { en: "Start page could not be parsed", zh: "起始页未能解析" },
        message: { en: "The start page could not be parsed; per-page checks were not executed and this audit is unusable", zh: "起始页未能解析，单页检查项未执行，本次审计结果不可用" },
        url: baseUrl.toString(),
        severity: "error",
        suggestion: { en: "Retry later or verify the target site is reachable; a single retry usually succeeds after cold start", zh: "请稍后重试，或检查目标站点是否可访问。冷启动场景下重试一次通常可成功" },
      });

      await finishAudit(userId, auditId, {
        health_score: 0,
        errors: 1,
        warnings: 0,
        notices: 0,
        status: "completed",
        comparison: null,
        pages_detail: JSON.stringify(pagesDetail),
        engine_version: ENGINE_VERSION,
        rule_set_version: RULE_SET_VERSION,
      });

      return {
        auditId,
        domain,
        depth,
        pagesCrawled,
        healthScore: 0,
        errors: 1,
        warnings: 0,
        notices: 0,
        status: "completed",
        pagesDetail,
        homepageParsed: false,
      };
    }

    // 站点级报告：robots 已在上方请求一次；sitemap / llms.txt 在 full 深度各请求一次
    let sitemap: SitemapReport | null = null;
    let llmsTxt: LlmsTxtReport | null = null;
    if (depth === "full") {
      const knownStatuses = new Map<string, { status: number; hops: number }>();
      for (const rec of fetchRecords) {
        knownStatuses.set(rec.url, { status: rec.status, hops: rec.hops });
        knownStatuses.set(rec.finalUrl, { status: rec.status, hops: rec.hops });
      }
      sitemap = await fetchSitemapReport(origin, robotsReport, knownStatuses);
      llmsTxt = await fetchLlmsTxtReport(origin);
    }

    const ctx: AuditContext = {
      baseUrl: baseUrl.toString(),
      origin,
      depth,
      crawlLimit,
      pages: normalizedPages,
      fetchRecords,
      linkGraph,
      robots: robotsReport,
      sitemap,
      llmsTxt,
      indexablePages: normalizedPages.length,
    };

    // 执行统一规则目录（quick 只执行页面级规则）
    const executions = runAuditRules(ctx);
    for (const exec of executions) {
      for (const issue of executionToIssues(exec)) {
        await writeIssueToDb(userId, auditId, issue);
      }
    }

    // V2 健康分：severity × scoreWeight × affectedPageRatio（indexablePages 为分母）
    const failedRules: ScoreRuleInput[] = executions
      .filter((e) => e.findings.length > 0)
      .map((e) => ({
        ruleId: e.rule.id,
        severity: worstSeverity(e),
        scoreWeight: e.rule.scoreWeight,
        pageLevel: e.rule.pageLevel,
        affectedPages: e.affectedPages,
      }));
    const healthScore = calculateHealthScoreV2(failedRules, ctx.indexablePages);

    // 达到抓取上限但队列仍有页面 → Partial audit
    const partial = queue.length > 0 && pagesCrawled >= crawlLimit;
    // 聚合 Dashboard 快照（Overview/Issues/Pages/Linking/SD/AI Search 单一数据源）
    const dashboardJson = JSON.stringify(
      buildDashboardSnapshot(ctx, executions, failedRules, healthScore, ENGINE_VERSION, RULE_SET_VERSION, partial)
    );

    const dbIssues = await getAuditIssues(userId, auditId);
    const allIssues = dbIssuesToAuditIssues(dbIssues);
    const errors = allIssues.filter((i) => i.severity === "error").length;
    const warnings = allIssues.filter((i) => i.severity === "warning").length;
    const notices = allIssues.filter((i) => i.severity === "notice").length;

    // 生成历史对比
    const prevAudit = await getPreviousAudit(userId, domain, auditId);
    let comparisonJson: string | null = null;
    if (prevAudit) {
      const prevIssues = dbIssuesToAuditIssues(await getAuditIssues(userId, prevAudit.id));
      const comparison = compareAudits(
        {
          score: healthScore,
          issues: allIssues,
          checkedAt: new Date().toISOString(),
        },
        {
          score: prevAudit.health_score ?? 0,
          issues: prevIssues,
          checkedAt: prevAudit.finished_at ?? prevAudit.started_at,
        }
      );
      comparisonJson = JSON.stringify(comparison);
    } else {
      const comparison = compareAudits(
        {
          score: healthScore,
          issues: allIssues,
          checkedAt: new Date().toISOString(),
        },
        null
      );
      comparisonJson = JSON.stringify(comparison);
    }

    await finishAudit(userId, auditId, {
      health_score: healthScore,
      errors,
      warnings,
      notices,
      status: "completed",
      comparison: comparisonJson,
      pages_detail: JSON.stringify(pagesDetail),
      engine_version: ENGINE_VERSION,
      rule_set_version: RULE_SET_VERSION,
      dashboard_json: dashboardJson,
    });

    await generateAuditAlerts(
      userId,
      auditId,
      domain,
      errors,
      allIssues.map((i) => ({ type: i.checkId, severity: i.severity }))
    );

    return {
      auditId,
      domain,
      depth,
      pagesCrawled,
      healthScore,
      errors,
      warnings,
      notices,
      status: "completed",
      pagesDetail,
      homepageParsed: true,
    };
  } catch (err) {
    const errMsg = (err as Error)?.message ?? String(err);
    await finishAudit(userId, auditId, {
      health_score: 0,
      errors: 1,
      warnings: 0,
      notices: 0,
      status: "failed",
      error: errMsg,
      pages_detail: JSON.stringify(pagesDetail),
      engine_version: ENGINE_VERSION,
      rule_set_version: RULE_SET_VERSION,
    });
    return {
      auditId,
      domain,
      depth,
      pagesCrawled,
      healthScore: 0,
      errors: 1,
      warnings: 0,
      notices: 0,
      status: "failed",
      error: errMsg,
      pagesDetail,
      homepageParsed,
    };
  }
}

/** 路径是否被 robots Disallow 规则（前缀匹配）阻断 */
function isDisallowedPath(pathname: string, rules: string[]): boolean {
  return rules.some((rule) => pathname.startsWith(rule));
}
