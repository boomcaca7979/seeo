// ===== GET /api/reports/pdf?id=xx =====
// PDF 导出服务端权限入口
// PDF 仍由前端 html2pdf.js 生成，但前端生成前必须先调此接口验证：
//   1. 用户已登录（requireAuthOrDemo）
//   2. 拥有 pdf_export Feature 权限（requireFeature）
//   3. 报告归属校验（getReport）
// 验证通过后返回报告数据，前端再生成 PDF
// P3：统一使用 billingErrorToResponse 处理商业化错误

import { NextResponse } from "next/server";
import { getReport } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";
import { requireFeature, FeatureNotAllowedError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

  // P3：PDF 导出 Feature 权限校验
  try {
    await requireFeature(userId, "pdf_export");
  } catch (e) {
    if (e instanceof FeatureNotAllowedError) {
      const { status, body } = billingErrorToResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }

  // 报告归属校验
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get("id");
  if (!idParam) {
    return NextResponse.json({ error: "缺少 id 参数", code: "MISSING_ID" }, { status: 400 });
  }
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效", code: "INVALID_ID" }, { status: 400 });
  }

  const report = await getReport(userId, id);
  if (!report) {
    return NextResponse.json({ error: "报告不存在", code: "REPORT_NOT_FOUND" }, { status: 404 });
  }

  // 返回报告数据，前端据此生成 PDF
  return NextResponse.json({
    data: {
      id: report.id,
      type: report.type,
      title: report.title,
      data_json: report.data_json,
      created_at: report.created_at,
      authorized: true,
    },
  });
}
