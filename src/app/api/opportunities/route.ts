// ===== /api/opportunities =====
// GET：机会列表（?project_id=&status=&type=&limit=）或详情（?id=）
//      详情 = opportunity + 解析后的 evidence/signals/actionPlan/verification
// 授权：user → project（resolveSqliteProjectId + getProjectById）

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import { getOpportunityById, listOpportunities } from "@/lib/db/opportunities";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseOpportunity(row: NonNullable<Awaited<ReturnType<typeof getOpportunityById>>>) {
  const parse = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  };
  return {
    id: row.id,
    type: row.type,
    targetType: row.target_type,
    targetValue: row.target_value,
    priority: row.priority,
    impact: row.impact,
    confidence: row.confidence,
    evidence: parse<Array<{ source: string; ref: string; summary: string; capturedAt: string }>>(row.evidence_json, []),
    signals: parse<Record<string, unknown>>(row.signals_json, {}),
    actionPlan: parse<{ executionMode: string; actionType: string; steps: string[] } | null>(row.action_plan_json, null),
    verification: parse<Array<{ check: string; status: string; detail: string | null; checkedAt: string | null }>>(row.verification_json, []),
    status: row.status,
    generatedAt: row.generated_at,
    lastEvaluatedAt: row.last_evaluated_at,
  };
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);

  // 详情模式
  const idRaw = searchParams.get("id");
  if (idRaw) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json<SeoApiError>({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
    }
    const row = await getOpportunityById(userId, id);
    if (!row) return NextResponse.json({ error: "未找到该机会", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });
    // 项目归属校验（防 opportunityId 越权）
    const projectRef = (searchParams.get("project_id") ?? "").trim();
    const projectId = projectRef ? await resolveSqliteProjectId(userId, projectRef) : null;
    if (projectId !== null && projectId !== row.project_id) {
      return NextResponse.json({ error: "未找到该机会", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ data: parseOpportunity(row) });
  }

  // 列表模式
  const projectRef = (searchParams.get("project_id") ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效", code: "INVALID_PROJECT_ID" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(userId, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const project = await getProjectById(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const status = (searchParams.get("status") ?? "").trim() || undefined;
  const type = (searchParams.get("type") ?? "").trim() || undefined;
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 200) {
    return NextResponse.json<SeoApiError>({ error: "limit 必须是 1-200", code: "BAD_REQUEST" }, { status: 400 });
  }
  const rows = await listOpportunities(userId, { project_id: projectId, status, type, limit: limitRaw });
  return NextResponse.json({ data: { opportunities: rows.map(parseOpportunity) } });
}
