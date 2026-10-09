// ===== 广告收入：CSV / 手工导入 =====
//
// 平台无可用 API（或尚未授权）时的**唯一合法**录入途径 —— 不做 scraping。
// 复用共享 CSV 解析（src/lib/data/csv.ts），不新增第 4 份副本。
//
// CSV 格式（首行表头，大小写不敏感；逗号或制表符分隔均可）：
//   date,revenue,impressions,clicks,currency
//   2026-10-01,12.34,12000,45,USD
//
// 校验（任一不满足即该行报错，不写入）：
//   - date 必须 YYYY-MM-DD 且为真实日期
//   - revenue 必须 ≥ 0 的数值（主单位，如 12.34）
//   - impressions / clicks 必须 ≥ 0 的整数（缺省 0）
//   - currency 缺省 USD，必须 3 位字母

import { parseCsv } from "@/lib/data/csv";
import type { AdRevenueDay } from "./provider";

export interface AdImportRowError {
  /** 数据行号（1 起，不含表头） */
  line: number;
  reason: string;
}

export interface AdImportParseResult {
  rows: AdRevenueDay[];
  errors: AdImportRowError[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 真实日历日期校验（拒绝 2026-02-31 之类） */
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** 解析广告收入 CSV 文本；不抛异常，逐行返回错误原因 */
export function parseAdRevenueCsv(text: string): AdImportParseResult {
  const rows: AdRevenueDay[] = [];
  const errors: AdImportRowError[] = [];
  const table = parseCsv(text.replace(/\t/g, ","));
  if (table.length === 0) {
    return { rows, errors: [{ line: 0, reason: "文件为空" }] };
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = col("date", "日期");
  const iRevenue = col("revenue", "estimated_earnings", "earnings", "收入");
  const iImpr = col("impressions", "展示");
  const iClicks = col("clicks", "点击");
  const iCurrency = col("currency", "币种");

  if (iDate < 0 || iRevenue < 0) {
    return {
      rows,
      errors: [{ line: 0, reason: "缺少必需表头：date 与 revenue（示例：date,revenue,impressions,clicks,currency）" }],
    };
  }

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    // 跳过完全空行
    if (cells.every((c) => !c.trim())) continue;
    const line = r; // 数据行号（表头为第 0 行，数据从第 1 行开始）
    const date = (cells[iDate] ?? "").trim();
    if (!isRealDate(date)) {
      errors.push({ line, reason: `date 非法：${date || "(空)"}（需 YYYY-MM-DD 且为真实日期）` });
      continue;
    }
    const revenueRaw = (cells[iRevenue] ?? "").trim().replace(/[$¥,\s]/g, "");
    const revenue = Number(revenueRaw);
    if (!Number.isFinite(revenue) || revenue < 0) {
      errors.push({ line, reason: `revenue 非法：${cells[iRevenue] ?? "(空)"}（需 ≥ 0 的数值）` });
      continue;
    }
    const impressions = parseCount(cells[iImpr]);
    if (impressions === null) {
      errors.push({ line, reason: `impressions 非法：${cells[iImpr] ?? "(空)"}（需 ≥ 0 的整数）` });
      continue;
    }
    const clicks = parseCount(cells[iClicks]);
    if (clicks === null) {
      errors.push({ line, reason: `clicks 非法：${cells[iClicks] ?? "(空)"}（需 ≥ 0 的整数）` });
      continue;
    }
    const currency = (iCurrency >= 0 ? (cells[iCurrency] ?? "").trim() : "").toUpperCase() || "USD";
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ line, reason: `currency 非法：${currency}（需 3 位字母，如 USD）` });
      continue;
    }
    rows.push({
      date,
      revenueCents: Math.round(revenue * 100),
      impressions: impressions ?? 0,
      clicks: clicks ?? 0,
      currency,
    });
  }

  return { rows, errors };
}

/** 空单元格 → 0；非法 → null */
function parseCount(raw: string | undefined): number | null {
  const v = (raw ?? "").trim().replace(/[,\s]/g, "");
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
