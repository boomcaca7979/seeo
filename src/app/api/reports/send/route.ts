// /api/reports/send — 发送报告邮件（简化摘要，不带 PDF 附件，PDF 由客户端生成）
// P2：增加 email_report Feature 权限校验

import { NextResponse } from "next/server";
import { getReport } from "@/lib/db";
import { sendTransactionalEmail, isEmailProviderConfigured } from "@/lib/email/service";
import { buildReportEmailHtml } from "@/lib/email/templates/report";
import { requireAuthOrDemo } from "@/lib/auth";
import { requireFeature, FeatureNotAllowedError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const typeLabel: Record<string, string> = {
  ranking: "排名追踪",
  audit: "技术审计",
  content: "内容检查",
  weekly: "综合周报",
};

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

  // P2：邮件报告 Feature 权限校验
  try {
    await requireFeature(userId, "email_report");
  } catch (e) {
    if (e instanceof FeatureNotAllowedError) {
      const { status, body } = billingErrorToResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "INVALID_JSON" }, { status: 400 });
  }

  const reportId = Number(body.report_id);
  const email = String(body.email ?? "").trim();

  if (!Number.isFinite(reportId)) {
    return NextResponse.json({ error: "report_id 无效", code: "INVALID_ID" }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确", code: "EMAIL_INVALID" }, { status: 400 });
  }

  if (!isEmailProviderConfigured()) {
    return NextResponse.json(
      { error: "邮件功能未配置：缺少 RESEND_API_KEY 环境变量", code: "RESEND_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const report = await getReport(userId, reportId);
  if (!report) {
    return NextResponse.json({ error: "报告不存在", code: "REPORT_NOT_FOUND" }, { status: 404 });
  }

  // 解析报告数据生成摘要
  let summary = "请查看附件或登录 SeeO 工作台查看完整报告。";
  try {
    const data = JSON.parse(report.data_json) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof data.healthScore === "number") {
      parts.push(`健康分：<strong>${data.healthScore}</strong> / 100`);
    }
    if (typeof data.contentScore === "number") {
      parts.push(`内容评分：<strong>${data.contentScore}</strong> / 100`);
    }
    if (Array.isArray(data.keywords)) {
      parts.push(`追踪关键词：<strong>${data.keywords.length}</strong> 个`);
    }
    if (Array.isArray(data.issues)) {
      parts.push(`发现问题：<strong>${data.issues.length}</strong> 项`);
    }
    if (parts.length > 0) {
      summary = parts.join("；") + "。";
    }
  } catch {
    // ignore parse error
  }

  const html = buildReportEmailHtml(
    report.title,
    typeLabel[report.type] ?? report.type,
    summary,
    report.created_at
  );

  // 走统一发送层：事务性通道（不受营销退订影响），失败不阻塞业务且留 email_log
  const result = await sendTransactionalEmail({
    userId,
    email,
    templateKey: "report_email_v1",
    subject: `【SeeO】${typeLabel[report.type] ?? "SEO"} 报告：${report.title}`,
    html,
    automationKey: `report_email:${reportId}:${Date.now()}`,
  });

  if (result.status === "skipped_no_provider") {
    return NextResponse.json(
      { error: "邮件功能未配置：缺少 RESEND_API_KEY 环境变量", code: "RESEND_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  if (result.status !== "sent") {
    return NextResponse.json(
      { error: result.reason ?? "发送失败", code: "SEND_FAILED" },
      { status: 502 }
    );
  }

  return NextResponse.json({ data: { success: true, messageId: result.messageId } });
}
