// ===== GET /api/reports/stats =====
// 报告中心页真实数据状态：追踪词数、最近审计、内容检测累计次数

import { NextResponse } from "next/server";
import {
  countTrackedKeywords,
  countContentChecks,
  getGlobalLatestAudit,
} from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LatestAuditInfo {
  id: number;
  domain: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  pagesCrawled: number;
  healthScore: number | null;
}

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const trackedCount = await countTrackedKeywords(userId);
  const contentCount = await countContentChecks(userId);
  const latest = await getGlobalLatestAudit(userId);

  const latestAudit: LatestAuditInfo | null = latest
    ? {
        id: latest.id,
        domain: latest.domain,
        startedAt: latest.started_at,
        finishedAt: latest.finished_at,
        status: latest.status,
        pagesCrawled: latest.pages_crawled,
        healthScore: latest.health_score,
      }
    : null;

  return NextResponse.json({
    data: {
      trackedCount,
      contentCount,
      latestAudit,
    },
  });
}
