// ===== GET /api/audit/latest?domain=xx =====
// 返回最近一次审计结果（含问题清单 + 历史对比 + 检查项覆盖 + 页面响应时间明细）

import { NextResponse } from "next/server";
import { getLatestAudit, getAuditIssues, getAuditHistory, reapStaleRunningAudit, type AuditIssueRow } from "@/lib/db";
import { allCheckMeta, checkMetaMap, nonCatalogCheckNames, pickText, type CheckMeta, type IssueSeverity } from "@/lib/seo/audit-checks";
import { resolveAuditDetail, resolveAuditSuggestion, type UiLocale } from "@/lib/seo/audit-legacy-text";
import type { AuditHistoryComparison } from "@/lib/seo/audit-history";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IssueGroup {
  checkId: string;
  checkName: string;
  severity: "error" | "warning" | "notice";
  affectedPages: number;
  sampleUrl: string;
  detail: string;
  suggestion: string | null;
}

interface HistoryItem {
  id: number;
  score: number | null;
  issuesCount: number;
  checkedAt: string;
}

interface PageDetailEntry {
  url: string;
  responseTimeMs: number;
  status: number;
  ok: boolean;
}

/** 读取 UI locale：NEXT_LOCALE cookie → en（与 billing-error-client 优先级一致） */
function readUiLocale(req: Request): UiLocale {
  const cookie = req.headers.get("cookie") ?? "";
  return /(?:^|;\s*)NEXT_LOCALE=zh(?:;|$)/.test(cookie) ? "zh" : "en";
}

/** checkId → 按 locale 展示名：catalog 内 → meta.name；catalog 外（如 startpage-unparsed）→ 补充映射；未知 → 原值 */
function checkIdToName(checkId: string, locale: UiLocale): string {
  const meta = checkMetaMap[checkId];
  if (meta) return pickText(meta.name, locale);
  const extra = nonCatalogCheckNames[checkId];
  if (extra) return pickText(extra, locale);
  return checkId;
}

function groupIssues(issues: AuditIssueRow[], locale: UiLocale): IssueGroup[] {
  const map = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const checkId = issue.type;
    const existing = map.get(checkId);
    if (existing) {
      existing.affectedPages++;
    } else {
      map.set(checkId, {
        checkId,
        checkName: checkIdToName(checkId, locale),
        severity: issue.severity,
        affectedPages: 1,
        sampleUrl: issue.url,
        detail: resolveAuditDetail(issue.detail, locale) ?? "",
        suggestion: resolveAuditSuggestion(issue.suggestion, locale),
      });
    }
  }
  const order = { error: 0, warning: 1, notice: 2 };
  return Array.from(map.values()).sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 计算检查项覆盖：哪些通过、哪些未通过（name/description 按 locale 输出纯文本） */
type CheckCoverageEntry = Omit<CheckMeta, "name" | "description"> & {
  name: string;
  description: string;
  passed: boolean;
  affectedPages: number;
};
function computeCheckCoverage(issues: AuditIssueRow[], locale: UiLocale): CheckCoverageEntry[] {
  const hitMap = new Map<string, number>();
  for (const issue of issues) {
    const checkId = issue.type;
    hitMap.set(checkId, (hitMap.get(checkId) ?? 0) + 1);
  }
  return allCheckMeta.map((meta) => ({
    ...meta,
    name: pickText(meta.name, locale),
    description: pickText(meta.description, locale),
    passed: !hitMap.has(meta.id),
    affectedPages: hitMap.get(meta.id) ?? 0,
  }));
}

/** comparison 快照中的 issue 结构（写入时序列化，message/checkName 为存储原值） */
interface ComparisonIssue {
  checkId: string;
  checkName: unknown;
  message: unknown;
  url: string;
  severity: string;
  suggestion?: unknown;
}

/**
 * comparison JSON 读取层双语化：
 * - checkName：历史/新数据均存 checkId（机器值）→ 映射当前 catalog 的本地化名称
 * - message：新数据为 LText JSON 字符串、历史数据为旧纯中文 → 按 locale 输出
 * 仅转换用户可见字段，score/issues 数量等机器值原样保留。
 */
function localizeComparisonIssue(
  issue: ComparisonIssue,
  locale: UiLocale
): { checkId: string; checkName: string; message: string; url: string; severity: IssueSeverity; suggestion: string } {
  const severity: IssueSeverity =
    issue.severity === "error" || issue.severity === "warning" || issue.severity === "notice"
      ? issue.severity
      : "notice";
  return {
    checkId: issue.checkId,
    checkName: checkIdToName(issue.checkId, locale),
    message:
      typeof issue.message === "string"
        ? resolveAuditDetail(issue.message, locale) ?? ""
        : "",
    url: issue.url,
    severity,
    suggestion:
      typeof issue.suggestion === "string"
        ? resolveAuditSuggestion(issue.suggestion, locale) ?? ""
        : "",
  };
}

function localizeComparison(
  comparison: AuditHistoryComparison,
  locale: UiLocale
): AuditHistoryComparison {
  return {
    ...comparison,
    newIssues: comparison.newIssues.map((i) => localizeComparisonIssue(i as unknown as ComparisonIssue, locale)),
    resolvedIssues: comparison.resolvedIssues.map((i) => localizeComparisonIssue(i as unknown as ComparisonIssue, locale)),
    unchangedIssues: comparison.unchangedIssues.map((i) => localizeComparisonIssue(i as unknown as ComparisonIssue, locale)),
  };
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const domain = (searchParams.get("domain") ?? "").trim().toLowerCase();

  if (!domain) {
    return NextResponse.json({ error: "缺少 domain 参数", code: "MISSING_DOMAIN" }, { status: 400 });
  }

  // 回收因 after() 被服务器回收而永久停留在 running 的审计行，
  // 使重新进入页面时不再误显“审计进行中”，并允许用户重跑。
  await reapStaleRunningAudit(userId, domain);

  const audit = await getLatestAudit(userId, domain);
  if (!audit) {
    return NextResponse.json({ data: null });
  }

  const issues = audit.status === "completed" ? await getAuditIssues(userId, audit.id) : [];
  const locale = readUiLocale(req);
  const grouped = groupIssues(issues, locale);
  const coverage = computeCheckCoverage(issues, locale);

  // 解析 comparison JSON（读取层双语化：checkName/message 按 locale 输出）
  let comparison: AuditHistoryComparison | null = null;
  if (audit.comparison) {
    try {
      const parsed = JSON.parse(audit.comparison) as AuditHistoryComparison;
      comparison = localizeComparison(parsed, locale);
    } catch {
      comparison = null;
    }
  }

  // 历史记录（最近 10 次）
  const historyRows = await getAuditHistory(userId, domain, 10);
  const history: HistoryItem[] = historyRows.map((h) => ({
    id: h.id,
    score: h.health_score,
    issuesCount: h.errors + h.warnings + h.notices,
    checkedAt: h.finished_at ?? h.started_at,
  }));

  // 解析页面响应时间明细
  let pagesDetail: PageDetailEntry[] = [];
  if (audit.pages_detail) {
    try {
      pagesDetail = JSON.parse(audit.pages_detail) as PageDetailEntry[];
    } catch {
      pagesDetail = [];
    }
  }

  return NextResponse.json({
    data: {
      id: audit.id,
      domain: audit.domain,
      status: audit.status,
      pagesCrawled: audit.pages_crawled,
      healthScore: audit.health_score,
      errors: audit.errors,
      warnings: audit.warnings,
      notices: audit.notices,
      startedAt: audit.started_at,
      finishedAt: audit.finished_at,
      issues: grouped,
      comparison,
      coverage,
      history,
      pagesDetail,
      error: audit.error,
    },
  });
}
