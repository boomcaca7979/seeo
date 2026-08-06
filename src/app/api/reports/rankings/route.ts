// ===== GET /api/reports/rankings =====
// 导出全部追踪关键词 + 最近 30 天排名历史为 CSV（带 BOM，Excel 友好）

import { NextResponse } from "next/server";
import { listTrackedKeywordsWithHistory } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

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

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const rows = await listTrackedKeywordsWithHistory(30);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "暂无追踪关键词，请先在排名追踪页添加" },
      { status: 404 }
    );
  }

  const header = [
    "关键词",
    "目标URL",
    "最新排名",
    "最新日期",
    "近30天最高",
    "近30天最低",
    "近30天有数据天数",
  ].join(",");

  const lines: string[] = [header];

  for (const r of rows) {
    // 有数据的记录（position !== null）
    const validHist = r.history.filter((h) => h.position !== null);
    const positions = validHist.map((h) => h.position as number);

    const latest = validHist.length > 0 ? validHist[validHist.length - 1] : null;
    const latestRank = latest?.position !== null && latest?.position !== undefined
      ? String(latest.position)
      : "未上榜";
    const latestDate = latest?.date ?? "";

    const highest = positions.length > 0 ? String(Math.min(...positions)) : "";
    const lowest = positions.length > 0 ? String(Math.max(...positions)) : "";
    const dataDays = String(validHist.length);

    // 目标 URL：取最新一条带 url 的记录
    const withUrl = [...r.history].reverse().find((h) => h.url);
    const targetUrl = withUrl?.url ?? "";

    lines.push([
      csvEscape(r.keyword),
      csvEscape(targetUrl),
      csvEscape(latestRank),
      csvEscape(latestDate),
      csvEscape(highest),
      csvEscape(lowest),
      csvEscape(dataDays),
    ].join(","));
  }

  const csv = BOM + lines.join("\r\n");
  const filename = `seeo-rankings-${todayStr()}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
