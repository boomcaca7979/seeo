// ===== GET /api/reports/content-checks =====
// 导出最近 100 条内容检测记录为 CSV（带 BOM，Excel 友好）
// P2：增加 excel_export Feature 权限校验

import { NextResponse } from "next/server";
import { listContentChecks } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";
import { requireFeature, FeatureNotAllowedError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOM = "\uFEFF";

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10).replace(/-/g, "");
}

interface CheckItem {
  name: string;
  passed: boolean;
  current: string;
  suggested: string;
}

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

  // P2：Excel 导出权限校验
  try {
    await requireFeature(userId, "excel_export");
  } catch (e) {
    if (e instanceof FeatureNotAllowedError) {
      const { status, body } = billingErrorToResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }

  const rows = await listContentChecks(userId, 100);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "暂无内容检测记录，请先在内容优化页进行检测" },
      { status: 404 }
    );
  }

  const header = [
    "检测时间",
    "URL",
    "关键词",
    "得分",
    "字数",
    "通过项",
    "未通过项",
  ].join(",");

  const lines: string[] = [header];

  for (const r of rows) {
    let passedItems: string[] = [];
    let failedItems: string[] = [];
    try {
      const checks = JSON.parse(r.checks_json) as CheckItem[];
      passedItems = checks.filter((c) => c.passed).map((c) => c.name);
      failedItems = checks.filter((c) => !c.passed).map((c) => c.name);
    } catch {
      // ignore parse error
    }

    lines.push([
      csvEscape(r.created_at),
      csvEscape(r.url),
      csvEscape(r.keyword),
      csvEscape(String(r.score)),
      csvEscape(r.word_count.toLocaleString()),
      csvEscape(passedItems.join("、")),
      csvEscape(failedItems.join("、")),
    ].join(","));
  }

  const csv = BOM + lines.join("\r\n");
  const filename = `seeo-content-checks-${todayStr()}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
