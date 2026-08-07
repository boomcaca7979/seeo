// ===== 技术 SEO 审计：BFS 爬取同域名页面，检测问题 =====
// 服务端专用；不消耗 SerpApi 额度，全部自建抓取
// 使用 audit-checks.ts 中的 20+ 项检查

import {
  fetchPage,
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
  runPerPageChecks,
  runCrossPageChecks,
  calculateHealthScore,
  type AuditIssue,
  type CrossPageExtra,
} from "@/lib/seo/audit-checks";
import { compareAudits } from "@/lib/seo/audit-history";

const MAX_PAGES_FULL = 50;
const MAX_PAGES_QUICK = 1;
const CONCURRENCY = 2;
const ROBOTS_TIMEOUT_MS = 5000;
const SITEMAP_TIMEOUT_MS = 5000;
const STARTPAGE_RETRY_MS = 12_000; // 首页重试时给 Vercel 冷启动更长一点的窗口

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

/** 读取 robots.txt 全文（用于 Disallow 规则 + Sitemap 检测） */
async function fetchRobotsText(origin: string): Promise<string | null> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    try {
      const res = await fetch(robotsUrl, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return null;
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** 从 robots.txt 解析 User-agent: * 的 Disallow 规则 */
function parseRobotsRules(robotsText: string | null): string[] {
  if (!robotsText) return [];
  const lines = robotsText.split("\n");
  const rules: string[] = [];
  let inUniversal = false;
  for (const raw of lines) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.startsWith("user-agent:")) {
      const agent = trimmed.slice("user-agent:".length).trim();
      inUniversal = agent === "*";
      continue;
    }
    if (inUniversal && trimmed.startsWith("disallow:")) {
      const rule = trimmed.slice("disallow:".length).trim();
      if (rule) rules.push(rule);
    }
  }
  return rules;
}

function isDisallowed(pathname: string, rules: string[]): boolean {
  return rules.some((rule) => pathname.startsWith(rule));
}

/** 从 robots.txt 解析声明的 sitemap URL 列表 */
function extractSitemapUrls(robotsText: string | null, origin: string): string[] {
  if (!robotsText) return [];
  const urls: string[] = [];
  for (const raw of robotsText.split("\n")) {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("sitemap:")) {
      const url = trimmed.slice("sitemap:".length).trim();
      if (url) urls.push(url);
    }
  }
  // robots 没声明 sitemap，回退到 /sitemap.xml
  if (urls.length === 0) urls.push(`${origin}/sitemap.xml`);
  return urls;
}

/** 抓取 sitemap.xml 并解析出同域名 URL（用于首页超时降级） */
async function fetchSitemapUrls(origin: string, robotsText: string | null): Promise<string[]> {
  const sitemapUrls = extractSitemapUrls(robotsText, origin);
  const collected = new Set<string>();
  for (const sitemapUrl of sitemapUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SITEMAP_TIMEOUT_MS);
      let text: string;
      try {
        const res = await fetch(sitemapUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SeeO-SEO-Bot/1.0; +https://seeo.app/bot)" },
          cache: "no-store",
        });
        if (!res.ok) continue;
        text = await res.text();
      } finally {
        clearTimeout(timer);
      }
      // 简单 XML 解析：<loc>https://...</loc>
      const matches = text.matchAll(/<loc>([^<]+)<\/loc>/gi);
      for (const m of matches) {
        const u = m[1].trim();
        try {
          const parsed = new URL(u);
          if (parsed.origin === origin) {
            collected.add(`${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`);
          }
        } catch {
          // 无效 URL，跳过
        }
      }
    } catch {
      // sitemap 抓取失败，继续尝试下一个
    }
  }
  return Array.from(collected);
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

/** 将 AuditIssue 写入数据库（type=checkId, detail=message） */
async function writeIssueToDb(userId: string, auditId: number, issue: AuditIssue): Promise<void> {
  await addAuditIssue(userId, {
    audit_id: auditId,
    type: issue.checkId,
    severity: issue.severity,
    url: issue.url,
    detail: issue.message,
    suggestion: issue.suggestion,
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

/**
 * 执行一次完整审计：BFS 爬取同域名页面，逐页运行 20+ 项检查，
 * 完成后计算健康分（基于权重）、生成历史对比、写入数据库。
 *
 * - depth: 'quick'（默认）：只爬首页（1 页），3-5 秒完成，覆盖 80% 单页检查项
 *   不包含：重复标题、重复描述、重复 H1、死链、sitemap（这些需要多页交叉）
 * - depth: 'full'：保持现有 50 页 BFS，用于本地开发
 */
export async function runAudit(
  userId: string,
  auditId: number,
  domain: string,
  options?: RunAuditOptions
): Promise<AuditResult> {
  const depth: AuditDepth = options?.depth ?? "quick";
  const maxPages = depth === "quick" ? MAX_PAGES_QUICK : MAX_PAGES_FULL;
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
  const robotsText = await fetchRobotsText(origin);
  const robotsRules = parseRobotsRules(robotsText);

  const visited = new Set<string>();
  const queue: string[] = [baseUrl.toString()];
  const crawledPages: PageData[] = [];
  const brokenLinks: Array<{ url: string; statusCode: number }> = [];
  const pagesDetail: PageDetailEntry[] = [];
  let pagesCrawled = 0;
  let homepageParsed = false;
  let homepageTimeoutRetried = false;

  try {
    while (queue.length > 0 && pagesCrawled < maxPages) {
      const batch: string[] = [];
      while (
        batch.length < CONCURRENCY &&
        queue.length > 0 &&
        pagesCrawled + batch.length < maxPages
      ) {
        const url = queue.shift()!;
        if (visited.has(url)) continue;
        try {
          const u = new URL(url);
          if (isDisallowed(u.pathname, robotsRules)) {
            visited.add(url);
            continue;
          }
        } catch {
          continue;
        }
        visited.add(url);
        batch.push(url);
      }

      if (batch.length === 0) break;

      // 首页批次特殊处理：超时自动重试一次（应对 Vercel 冷启动）
      const isFirstBatch = pagesCrawled === 0;
      const fetchWithRetry = async (url: string) => {
        try {
          return { ok: true as const, result: await fetchPage(url) };
        } catch (e) {
          if (isFirstBatch && !homepageTimeoutRetried && e instanceof CrawlError && e.code === "TIMEOUT") {
            homepageTimeoutRetried = true;
            // 重试：给冷启动更长窗口（12s）
            try {
              return { ok: true as const, result: await fetchPage(url, STARTPAGE_RETRY_MS) };
            } catch (e2) {
              return { ok: false as const, error: e2 };
            }
          }
          return { ok: false as const, error: e };
        }
      };

      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const retryResult = await fetchWithRetry(url);
          if (!retryResult.ok) throw retryResult.error;
          const result = retryResult.result;
          const pageData = parsePage(result.html, result.url);
          pageData.responseTimeMs = result.responseTimeMs;
          pageData.status = result.status;
          pageData.finalUrl = result.url;
          return { result, pageData };
        })
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const url = batch[i];
        pagesCrawled++;
        await updateAuditProgress(userId, auditId, pagesCrawled);

        if (r.status === "rejected") {
          const err = r.reason;
          if (err instanceof CrawlError) {
            if (err.code === "HTTP_ERROR") {
              // 记录为 broken-links
              const statusMatch = err.message.match(/HTTP (\d+)/);
              const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
              brokenLinks.push({ url, statusCode });
              pagesDetail.push({ url, responseTimeMs: 0, status: statusCode, ok: false });
              await writeIssueToDb(userId, auditId, {
                checkId: "broken-links",
                checkName: "站内死链",
                message: err.message,
                url,
                severity: statusCode === 404 ? "error" : "warning",
                suggestion: statusCode === 404
                  ? "添加 301 重定向到相关页面，或恢复缺失内容"
                  : "检查服务器状态与页面可用性",
              });
            } else if (err.code === "TIMEOUT") {
              pagesDetail.push({ url, responseTimeMs: homepageTimeoutRetried ? STARTPAGE_RETRY_MS : 10_000, status: 0, ok: false });
              await writeIssueToDb(userId, auditId, {
                checkId: "slow-page",
                checkName: "页面加载慢",
                message: homepageTimeoutRetried
                  ? `首页抓取超时（重试 ${STARTPAGE_RETRY_MS / 1000}s 仍失败）`
                  : "抓取超时（10s）",
                url,
                severity: "warning",
                suggestion: "优化服务器响应时间，检查后端服务状态",
              });
            } else if (err.code === "NETWORK") {
              pagesDetail.push({ url, responseTimeMs: 0, status: 0, ok: false });
              await writeIssueToDb(userId, auditId, {
                checkId: "broken-links",
                checkName: "站内死链",
                message: err.message,
                url,
                severity: "error",
                suggestion: "检查域名解析与服务器可达性",
              });
            }
          } else {
            pagesDetail.push({ url, responseTimeMs: 0, status: 0, ok: false });
            await writeIssueToDb(userId, auditId, {
              checkId: "broken-links",
              checkName: "站内死链",
              message: (err as Error).message || "未知错误",
              url,
              severity: "error",
              suggestion: "检查 URL 是否可访问",
            });
          }

          // 首页最终无法解析：尝试 sitemap 降级（仅 full 模式有意义）
          if (isFirstBatch && !homepageParsed && depth === "full") {
            const sitemapUrls = await fetchSitemapUrls(origin, robotsText);
            for (const smUrl of sitemapUrls) {
              if (visited.has(smUrl)) continue;
              if (queue.includes(smUrl)) continue;
              if (queue.length > 500) break;
              queue.push(smUrl);
            }
          }
          continue;
        }

        const { result, pageData } = r.value;
        crawledPages.push(pageData);
        pagesDetail.push({
          url,
          responseTimeMs: result.responseTimeMs,
          status: result.status,
          ok: true,
        });

        if (isFirstBatch) {
          homepageParsed = true;
        }

        // 运行单页检查
        const pageIssues = runPerPageChecks(pageData, baseUrl.toString());
        for (const issue of pageIssues) {
          await writeIssueToDb(userId, auditId, issue);
        }

        // 收集同域名链接入队（quick 模式只爬首页，跳过收集）
        if (depth === "full") {
          for (const link of pageData.links) {
            if (link.isExternal) continue;
            const normalized = normalizeLink(link.href);
            if (!normalized) continue;
            if (visited.has(normalized)) continue;
            if (queue.includes(normalized)) continue;
            if (queue.length > 500) break;
            queue.push(normalized);
          }
        }
      }
    }

    // 起始页最终未能解析：明确标记审计不可用，不给虚高分
    if (!homepageParsed) {
      await writeIssueToDb(userId, auditId, {
        checkId: "startpage-unparsed",
        checkName: "起始页未能解析",
        message: "起始页未能解析，单页检查项未执行，本次审计结果不可用",
        url: baseUrl.toString(),
        severity: "error",
        suggestion: "请稍后重试，或检查目标站点是否可访问。冷启动场景下重试一次通常可成功",
      });

      const pagesDetailJson = JSON.stringify(pagesDetail);
      await finishAudit(userId, auditId, {
        health_score: 0,
        errors: 1,
        warnings: 0,
        notices: 0,
        status: "completed",
        comparison: null,
        pages_detail: pagesDetailJson,
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

    // 运行跨页检查（quick 模式跳过：重复标题/描述/H1、死链、sitemap 需多页交叉）
    if (depth === "full") {
      const extra: CrossPageExtra = { robotsText, brokenLinks };
      const crossIssues = runCrossPageChecks(crawledPages, baseUrl.toString(), extra);
      for (const issue of crossIssues) {
        await writeIssueToDb(userId, auditId, issue);
      }
    }

    // 计算健康分（基于权重）
    const dbIssues = await getAuditIssues(userId, auditId);
    const allIssues = dbIssuesToAuditIssues(dbIssues);
    const healthScore = calculateHealthScore(allIssues);

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

    const pagesDetailJson = JSON.stringify(pagesDetail);
    await finishAudit(userId, auditId, {
      health_score: healthScore,
      errors,
      warnings,
      notices,
      status: "completed",
      comparison: comparisonJson,
      pages_detail: pagesDetailJson,
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
