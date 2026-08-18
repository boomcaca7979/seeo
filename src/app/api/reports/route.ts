// /api/reports — 报告列表与创建（不影响现有 /api/reports/stats 等子路由）

import { NextResponse } from "next/server";
import {
  createReport,
  listReports,
  type ReportType,
} from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: ReportType[] = ["ranking", "audit", "content", "weekly"];

/** GET /api/reports?project_id=123 — 报告列表 */
export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const projectIdRaw = searchParams.get("project_id");
  const projectId = projectIdRaw ? Number(projectIdRaw) : undefined;

  if (projectId !== undefined && !Number.isFinite(projectId)) {
    return NextResponse.json({ error: "project_id 参数无效", code: "INVALID_PROJECT_ID" }, { status: 400 });
  }

  const userId = auth.user?.id ?? "demo-user";
  const reports = await listReports(userId, projectId);
  return NextResponse.json({ data: reports });
}

/** POST /api/reports — 创建报告记录 */
export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "INVALID_JSON" }, { status: 400 });
  }

  const type = String(body.type ?? "") as ReportType;
  const title = String(body.title ?? "").trim();
  const dataJson = String(body.data_json ?? "");
  const projectId = body.project_id !== undefined && body.project_id !== null
    ? Number(body.project_id)
    : null;

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "type 必须是 ranking/audit/content/weekly", code: "REPORT_TYPE_INVALID" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title 不能为空", code: "TITLE_REQUIRED" }, { status: 400 });
  }
  if (!dataJson) {
    return NextResponse.json({ error: "data_json 不能为空", code: "DATA_JSON_REQUIRED" }, { status: 400 });
  }

  const userId = auth.user?.id ?? "demo-user";
  const id = await createReport(userId, projectId, type, title, dataJson);
  return NextResponse.json({ data: { id } }, { status: 201 });
}
