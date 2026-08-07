// ===== GET /api/audit/latest?domain=xx =====
// 返回最近一次审计结果（含问题清单 + 历史对比 + 检查项覆盖 + 页面响应时间明细）

import { NextResponse } from "next/server";
import { getLatestAudit, getAuditIssues, getAuditHistory, type AuditIssueRow } from "@/lib/db";
import { allCheckMeta, checkMetaMap, type CheckMeta } from "@/lib/seo/audit-checks";
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

function groupIssues(issues: AuditIssueRow[]): IssueGroup[] {
  const map = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const checkId = issue.type;
    const meta = checkMetaMap[checkId];
    const existing = map.get(checkId);
    if (existing) {
      existing.affectedPages++;
    } else {
      map.set(checkId, {
        checkId,
        checkName: meta?.name ?? checkId,
        severity: issue.severity,
        affectedPages: 1,
        sampleUrl: issue.url,
        detail: issue.detail,
        suggestion: issue.suggestion,
      });
    }
  }
  const order = { error: 0, warning: 1, notice: 2 };
  return Array.from(map.values()).sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 计算检查项覆盖：哪些通过、哪些未通过 */
function computeCheckCoverage(issues: AuditIssueRow[]): Array<CheckMeta & { passed: boolean; affectedPages: number }> {
  const hitMap = new Map<string, number>();
  for (const issue of issues) {
    const checkId = issue.type;
    hitMap.set(checkId, (hitMap.get(checkId) ?? 0) + 1);
  }
  return allCheckMeta.map((meta) => ({
    ...meta,
    passed: !hitMap.has(meta.id),
    affectedPages: hitMap.get(meta.id) ?? 0,
  }));
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const domain = (searchParams.get("domain") ?? "").trim().toLowerCase();

  if (!domain) {
    return NextResponse.json({ error: "缺少 domain 参数" }, { status: 400 });
  }

  const audit = await getLatestAudit(userId, domain);
  if (!audit) {
    return NextResponse.json({ data: null });
  }

  const issues = audit.status === "completed" ? await getAuditIssues(userId, audit.id) : [];
  const grouped = groupIssues(issues);
  const coverage = computeCheckCoverage(issues);

  // 解析 comparison JSON
  let comparison: AuditHistoryComparison | null = null;
  if (audit.comparison) {
    try {
      comparison = JSON.parse(audit.comparison) as AuditHistoryComparison;
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
