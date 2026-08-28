// ===== /api/gsc/performance =====
// GET：Search Analytics（P0-02-E GscService.searchAnalytics）
//   - query: project_id, dimensions(逗号分隔, 默认 query), start_date/end_date 或 date_range,
//            row_limit(1-1000), start_row(≥0), search_type, query/page 过滤
//   - 第一方免费数据源：不消耗 credits；防滥用靠 cache(24h) + rowLimit/date 跨度上限
//   - CTR 为 0-1 小数；position 为平均位置浮点（不取整）

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import { searchAnalytics, type GscPerformanceInput } from "@/lib/seo/gsc-service";
import { mapGscError } from "@/lib/seo/gsc-api-helpers";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return NextResponse.json({ error: "使用 Search Console 数据需要登录 SeeO 账号", code: "GSC_NOT_CONFIGURED" }, { status: 403 });
  }
  const userId = auth.user.id;
  const { searchParams } = new URL(req.url);
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

  const dimensions = (searchParams.get("dimensions") ?? "query")
    .split(",").map((d) => d.trim()).filter(Boolean);
  const rowLimitRaw = Number(searchParams.get("row_limit") ?? "1000");
  const startRowRaw = Number(searchParams.get("start_row") ?? "0");
  if (!Number.isInteger(rowLimitRaw) || rowLimitRaw < 1 || rowLimitRaw > 1000) {
    return NextResponse.json<SeoApiError>({ error: "row_limit 必须是 1-1000", code: "BAD_REQUEST" }, { status: 400 });
  }
  if (!Number.isInteger(startRowRaw) || startRowRaw < 0) {
    return NextResponse.json<SeoApiError>({ error: "start_row 必须是 ≥0 的整数", code: "BAD_REQUEST" }, { status: 400 });
  }

  // 维度过滤：query=... / page=...（GSC dimensionFilterGroups 由 service 包装）
  const queryFilter = (searchParams.get("query") ?? "").trim();
  const pageFilter = (searchParams.get("page") ?? "").trim();
  const filters = [
    ...(queryFilter ? [{ dimension: "query", operator: "equals", expression: queryFilter }] : []),
    ...(pageFilter ? [{ dimension: "page", operator: "equals", expression: pageFilter }] : []),
  ];

  const input: GscPerformanceInput = {
    userId,
    projectId,
    dimensions,
    ...(searchParams.get("start_date") ? { startDate: searchParams.get("start_date") as string } : {}),
    ...(searchParams.get("end_date") ? { endDate: searchParams.get("end_date") as string } : {}),
    ...(!searchParams.get("start_date") && searchParams.get("date_range")
      ? { dateRange: searchParams.get("date_range") as GscPerformanceInput["dateRange"] }
      : {}),
    ...(filters.length > 0 ? { filters } : {}),
    rowLimit: rowLimitRaw,
    startRow: startRowRaw,
    ...(searchParams.get("search_type") ? { searchType: searchParams.get("search_type") as GscPerformanceInput["searchType"] } : {}),
  };

  try {
    const result = await searchAnalytics(input);
    return NextResponse.json({ data: result });
  } catch (e) {
    return mapGscError(e);
  }
}
