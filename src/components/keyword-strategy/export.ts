// ===== 策略 CSV 导出（客户端纯函数）=====
// 口径：
//   - Volume / KD / CPC 取不到时导出空单元格（绝不用 0 冒充）；
//   - 附带 market / device / collected_at / metrics_source，文件脱离页面仍可判断来源；
//   - BOM + CRLF，保证 Excel 正确识别中文与换行。

import type { StrategyDoc, StrategyKeyword } from "@/lib/seo/strategy-model";

export const STRATEGY_CSV_HEADERS = [
  "keyword",
  "topic",
  "role",
  "intent",
  "intent_source",
  "seeds",
  "origins",
  "manual",
  "search_volume",
  "kd",
  "cpc",
  "market",
  "device",
  "collected_at",
  "metrics_source",
] as const;

function escapeCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildStrategyCsv(
  doc: StrategyDoc,
  rows: StrategyKeyword[],
  ctx: { name: string; market: string; device: string; collectedAt: string | null }
): string {
  const topicName = new Map(doc.topics.map((t) => [t.id, t.name]));
  void ctx.name;
  const lines: string[] = [STRATEGY_CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        escapeCell(row.keyword),
        escapeCell(topicName.get(row.topicId) ?? ""),
        escapeCell(row.role === "pillar" ? "Pillar" : row.role === "subpage" ? "Subpage" : "Ungrouped"),
        escapeCell(row.intent),
        escapeCell(row.intentSource === "provider" ? "provider" : "estimated"),
        escapeCell(row.seeds.join("|")),
        escapeCell(row.origins.join("|")),
        escapeCell(row.manual ? "yes" : "no"),
        escapeCell(row.volume),
        escapeCell(row.kd === null ? null : Math.round(row.kd)),
        escapeCell(row.cpc === null ? null : row.cpc.toFixed(2)),
        escapeCell(ctx.market),
        escapeCell(ctx.device),
        escapeCell(ctx.collectedAt),
        escapeCell(doc.meta.metrics.volume === "provider" || doc.meta.metrics.kd === "provider" ? "dataforseo" : ""),
      ].join(",")
    );
  }
  return `\ufeff${lines.join("\r\n")}`;
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
