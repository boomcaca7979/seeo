// ===== GSC CSV 报表导入（真实 Search Console 导出格式）=====
//
// 背景：在真实 OAuth 凭据可用之前，允许老板把 Search Console「效果报告 → 导出 → 下载 CSV」
// 得到的文件直接导入，作为可用的数据接入方式。OAuth 自动同步代码原样保留，两者写同一批表。
//
// 真实导出格式（GSC UI 导出为 ZIP，内含各维度 CSV；单文件也可能直接下载）：
//   Queries.csv：表头 `Top queries,Clicks,Impressions,CTR,Position`
//   Pages.csv  ：表头 `Top pages,Clicks,Impressions,CTR,Position`（个别界面用 Page / Landing Page）
//   Dates.csv  ：表头 `Date,Clicks,Impressions,CTR,Position`
//   - CTR 是百分比字符串（如 `12.34%`），空值时以 clicks/impressions 回算
//   - Position 是小数（如 `3.4`），可为空
//   - 文件可能带元数据头部（标题行 / 空行 / 分组行），解析时自动跳过直到表头行
//   - 单文件上限 1000 行（GSC 平台限制）
//
// 幂等：写入与 OAuth 同步完全同表同主键，全部 ON CONFLICT 覆盖 —— 重复导入同一份报表
// 不会重复累计；同日期/同维度重新导入以最新文件为准。

import { parseCsv } from "@/lib/data/csv";
import { getAdapter } from "@/lib/db/migrations";
import { unzipSync } from "fflate";

export type GscImportKind = "queries" | "pages" | "dates";

export const GSC_IMPORT_KINDS: readonly GscImportKind[] = ["queries", "pages", "dates"];

export const GSC_IMPORT_MAX_ROWS = 1000;

export interface GscImportRow {
  /** queries=搜索词 / pages=URL / dates=YYYY-MM-DD */
  key: string;
  clicks: number;
  impressions: number;
  /** 0–1；单元格为空时以 clicks/impressions 回算 */
  ctr: number;
  /** 可为 null（GSC 允许空） */
  position: number | null;
}

export interface GscImportRowError {
  line: number;
  reason: string;
}

export interface GscImportParseResult {
  rows: GscImportRow[];
  errors: GscImportRowError[];
}

/** 每种维度可接受的表头首列别名（小写比较） */
const LABEL_ALIASES: Record<GscImportKind, readonly string[]> = {
  queries: ["top queries", "query", "search query", "查询", "热门查询", "搜索查询"],
  pages: ["top pages", "page", "landing page", "页面", "热门页面", "着陆页"],
  dates: ["date", "day", "日期"],
};

const REQUIRED_NUMERIC = ["clicks", "impressions", "ctr", "position"];

/** 去掉 BOM / 引号 / 前后空白并小写 */
function normCell(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim()
    .toLowerCase();
}

/** 在 CSV 行里定位表头行；返回列索引映射或 null */
function matchHeader(cells: string[], kind: GscImportKind): Record<string, number> | null {
  const lowered = cells.map(normCell);
  const idx = new Map<string, number>();
  // 首列 = 标签列
  let labelIdx = -1;
  for (let i = 0; i < lowered.length; i++) {
    if (LABEL_ALIASES[kind].includes(lowered[i])) {
      labelIdx = i;
      break;
    }
  }
  if (labelIdx === -1) return null;
  idx.set("label", labelIdx);
  for (const name of REQUIRED_NUMERIC) {
    const at = lowered.indexOf(name);
    if (at === -1) return null;
    idx.set(name, at);
  }
  return Object.fromEntries(idx);
}

/** "12.34%" / "12.34" / "0.1234" → 0–1；空串返回 null；无法解析返回 undefined */
function parseCtr(raw: string): number | null | undefined {
  const t = (raw ?? "").trim();
  if (t === "") return null; // 调用方回算
  const isPct = t.endsWith("%");
  const n = Number(t.replace(/%\s*$/, "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (isPct) return n / 100;
  // 无百分号：>1 视作百分数（GSC 导出恒带 %，这里只做兼容）
  return n > 1 ? n / 100 : n;
}

function parseCount(raw: string): number | null {
  const t = (raw ?? "").trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function parsePosition(raw: string): number | null | undefined {
  const t = (raw ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 真实日期校验（与 ads/manual.isRealDate 同语义：必须 YYYY-MM-DD 且日历存在） */
export function isRealGscDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * 解析 GSC 导出的单个 CSV 文本。
 * 自动跳过元数据头部；表头不匹配时以 line 0 报错（不给示例假数据）。
 */
export function parseGscExportCsv(text: string, kind: GscImportKind): GscImportParseResult {
  const errors: GscImportRowError[] = [];
  const rows: GscImportRow[] = [];
  if (!text.trim()) {
    return { rows, errors: [{ line: 0, reason: "文件为空" }] };
  }

  const table = parseCsv(text.replace(/\t/g, ","));
  let header: Record<string, number> | null = null;
  let dataStartLine = -1;

  for (let i = 0; i < table.length; i++) {
    const h = matchHeader(table[i], kind);
    if (h) {
      header = h;
      dataStartLine = i + 1; // 人类可读行号从表头下一行开始
      break;
    }
  }
  if (!header) {
    return {
      rows,
      errors: [
        {
          line: 0,
          reason:
            kind === "queries"
              ? "未找到表头：需要 Top queries / Query + Clicks + Impressions + CTR + Position"
              : kind === "pages"
                ? "未找到表头：需要 Top pages / Page + Clicks + Impressions + CTR + Position"
                : "未找到表头：需要 Date + Clicks + Impressions + CTR + Position",
        },
      ],
    };
  }

  for (let i = dataStartLine; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => (c ?? "").trim() === "")) continue; // 空行
    const lineNo = i + 1;

    const label = (cells[header.label] ?? "").replace(/^\uFEFF/, "").trim().replace(/^"(.*)"$/, "$1").trim();
    if (!label) {
      errors.push({ line: lineNo, reason: "第一列为空" });
      continue;
    }
    if (rows.length >= GSC_IMPORT_MAX_ROWS) {
      errors.push({ line: lineNo, reason: `超过单文件上限 ${GSC_IMPORT_MAX_ROWS} 行（GSC 导出平台限制）` });
      break;
    }

    const clicks = parseCount(cells[header.clicks]);
    if (clicks === null) {
      errors.push({ line: lineNo, reason: `clicks 非法：${(cells[header.clicks] ?? "").trim() || "空"}` });
      continue;
    }
    const impressions = parseCount(cells[header.impressions]);
    if (impressions === null) {
      errors.push({ line: lineNo, reason: `impressions 非法：${(cells[header.impressions] ?? "").trim() || "空"}` });
      continue;
    }
    let ctr = parseCtr(cells[header.ctr]);
    if (ctr === undefined) {
      errors.push({ line: lineNo, reason: `ctr 非法：${(cells[header.ctr] ?? "").trim()}` });
      continue;
    }
    if (ctr === null) ctr = impressions > 0 ? clicks / impressions : 0;

    const position = parsePosition(cells[header.position]);
    if (position === undefined) {
      errors.push({ line: lineNo, reason: `position 非法：${(cells[header.position] ?? "").trim()}` });
      continue;
    }

    if (kind === "dates" && !isRealGscDate(label)) {
      errors.push({ line: lineNo, reason: `日期非法：${label}（需要 YYYY-MM-DD 且真实存在）` });
      continue;
    }

    rows.push({ key: label, clicks, impressions, ctr, position });
  }

  return { rows, errors };
}

/**
 * 把解析后的行写入与 OAuth 同步相同的表（同主键、覆盖式 upsert）。
 * 返回写入行数；重复导入同一份报表不会重复累计。
 */
export async function writeGscImportRows(
  kind: GscImportKind,
  rows: GscImportRow[],
  args: { propertyUrl: string; windowDays?: number }
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await getAdapter();
  const capturedOn = new Date().toISOString().slice(0, 10);
  const windowDays = args.windowDays ?? 28;
  let written = 0;

  for (const r of rows) {
    if (kind === "dates") {
      await db.run(
        `INSERT INTO gsc_daily_metrics (property_url, date, clicks, impressions, ctr, position, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(property_url, date) DO UPDATE SET
           clicks = excluded.clicks,
           impressions = excluded.impressions,
           ctr = excluded.ctr,
           position = excluded.position,
           synced_at = datetime('now')`,
        [args.propertyUrl, r.key, r.clicks, r.impressions, r.ctr, r.position]
      );
    } else if (kind === "queries") {
      await db.run(
        `INSERT INTO gsc_query_metrics
           (property_url, captured_on, window_days, query, country, device, clicks, impressions, ctr, position, synced_at)
         VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(property_url, captured_on, window_days, country, device, query) DO UPDATE SET
           clicks = excluded.clicks,
           impressions = excluded.impressions,
           ctr = excluded.ctr,
           position = excluded.position,
           synced_at = datetime('now')`,
        [args.propertyUrl, capturedOn, windowDays, r.key, r.clicks, r.impressions, r.ctr, r.position]
      );
    } else {
      await db.run(
        `INSERT INTO gsc_page_metrics
           (property_url, captured_on, window_days, page, clicks, impressions, ctr, position, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(property_url, captured_on, window_days, page) DO UPDATE SET
           clicks = excluded.clicks,
           impressions = excluded.impressions,
           ctr = excluded.ctr,
           position = excluded.position,
           synced_at = datetime('now')`,
        [args.propertyUrl, capturedOn, windowDays, r.key, r.clicks, r.impressions, r.ctr, r.position]
      );
    }
    written++;
  }
  return written;
}

// ---------- ZIP 直接导入（Search Console「导出 → 下载 CSV」实际给出 ZIP） ----------
//
// 安全与限制（默认值；测试可注入更小上限）：
//   - ZIP 本体 ≤ 10MB、条目 ≤ 30、单条目解压 ≤ 2MB、解压总量 ≤ 8MB
//   - 只处理 .csv 文件；目录项 / __MACOSX / 非预期文件被跳过并记录原因
//   - entry 名含路径穿越（..、绝对路径、反斜杠）→ 拒绝整个条目
//   - 解压（unzipSync）是纯内存解压，绝不执行压缩包内容

export const ZIP_DEFAULT_LIMITS = {
  maxZipBytes: 10 * 1024 * 1024,
  maxEntries: 30,
  maxEntryBytes: 2 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
} as const;

export type ZipLimits = Partial<{ [K in keyof typeof ZIP_DEFAULT_LIMITS]: number }>;

export interface GscZipFileResult {
  file: string;
  /** 自动识别出的维度；无法识别时为 null */
  kind: GscImportKind | null;
  written: number;
  errors: GscImportRowError[];
  /** 非错误性跳过原因（不支持的维度 / 非预期文件类型） */
  skipped?: string;
}

export interface GscZipImportResult {
  files: GscZipFileResult[];
  /** 全部维度合计写入行数 */
  written: number;
  /** 整包级致命错误（损坏 ZIP / 超限），出现时不做任何写入 */
  fatal?: string;
}

/** 文件名 → 维度；返回 null 表示该文件名不属于可导入维度 */
function kindFromFileName(name: string): GscImportKind | null | "unsupported-known" {
  const lower = name.toLowerCase().split("/").pop() ?? "";
  if (lower.startsWith("queries")) return "queries";
  if (lower.startsWith("pages")) return "pages";
  if (lower.startsWith("dates")) return "dates";
  // GSC ZIP 里已知但暂不支持的维度 —— 明确跳过而不是报错
  if (
    lower.startsWith("countries") ||
    lower.startsWith("devices") ||
    lower.startsWith("search_appearance") ||
    lower.startsWith("search appearance")
  ) {
    return "unsupported-known";
  }
  return null;
}

/** entry 名安全校验：拒绝路径穿越 / 绝对路径 / 反斜杠 */
function isUnsafeEntryName(name: string): boolean {
  return (
    name.includes("..") ||
    name.startsWith("/") ||
    name.includes("\\") ||
    /^[a-za-z]:/.test(name)
  );
}

export async function importGscZip(
  data: Uint8Array,
  args: { propertyUrl: string; windowDays?: number },
  limits: ZipLimits = {}
): Promise<GscZipImportResult> {
  const lim = { ...ZIP_DEFAULT_LIMITS, ...limits };
  if (data.length === 0) {
    return { files: [], written: 0, fatal: "ZIP 内容为空" };
  }
  if (data.length > lim.maxZipBytes) {
    return { files: [], written: 0, fatal: `ZIP 超过大小上限（${(lim.maxZipBytes / 1048576).toFixed(0)}MB）` };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    return { files: [], written: 0, fatal: "ZIP 损坏或不是有效的 ZIP 文件" };
  }

  const names = Object.keys(entries);
  if (names.length > lim.maxEntries) {
    return {
      files: [],
      written: 0,
      fatal: `ZIP 内文件数超过上限（${names.length} > ${lim.maxEntries}）`,
    };
  }

  const files: GscZipFileResult[] = [];
  let written = 0;
  let totalBytes = 0;

  // 排序保证确定性（GSC ZIP 内文件顺序无关，但重复导入结果必须一致）
  for (const name of names.sort()) {
    if (name.endsWith("/")) continue; // 目录项
    if (isUnsafeEntryName(name)) {
      files.push({ file: name, kind: null, written: 0, errors: [{ line: 0, reason: "条目路径不安全，已拒绝" }] });
      continue;
    }
    if (name.startsWith("__MACOSX/") || name.split("/").pop()?.startsWith(".")) {
      files.push({ file: name, kind: null, written: 0, errors: [], skipped: "系统文件，已跳过" });
      continue;
    }
    if (!name.toLowerCase().endsWith(".csv")) {
      files.push({ file: name, kind: null, written: 0, errors: [], skipped: "非 CSV 文件，已跳过" });
      continue;
    }

    const content = entries[name];
    if (content.length > lim.maxEntryBytes) {
      files.push({
        file: name,
        kind: null,
        written: 0,
        errors: [{ line: 0, reason: `文件解压后 ${(content.length / 1048576).toFixed(1)}MB，超过单文件上限` }],
      });
      continue;
    }
    totalBytes += content.length;
    if (totalBytes > lim.maxTotalBytes) {
      files.push({
        file: name,
        kind: null,
        written: 0,
        errors: [{ line: 0, reason: "解压后总大小超过上限，已停止处理" }],
      });
      break;
    }

    let kind = kindFromFileName(name);
    if (kind === "unsupported-known") {
      files.push({
        file: name,
        kind: null,
        written: 0,
        errors: [],
        skipped: "该维度暂不支持导入（国家 / 设备 / 搜索外观）",
      });
      continue;
    }

    const text = new TextDecoder().decode(content);
    if (kind === null) {
      // 文件名不认识：用表头试探三种维度
      const guesses = (["queries", "pages", "dates"] as const).map((k) => ({
        k,
        r: parseGscExportCsv(text, k),
      }));
      const hit = guesses.find((g) => g.r.errors.length === 0 && g.r.rows.length > 0);
      if (!hit) {
        files.push({
          file: name,
          kind: null,
          written: 0,
          errors: [{ line: 0, reason: "无法识别维度：文件名与表头均不匹配 Queries / Pages / Dates" }],
        });
        continue;
      }
      kind = hit.k;
    }

    const parsed = parseGscExportCsv(text, kind);
    let n = 0;
    if (parsed.rows.length > 0) {
      try {
        n = await writeGscImportRows(kind, parsed.rows, {
          propertyUrl: args.propertyUrl,
          windowDays: args.windowDays,
        });
      } catch (err) {
        files.push({
          file: name,
          kind,
          written: 0,
          errors: [{ line: 0, reason: err instanceof Error ? err.message : "写入失败" }],
        });
        continue;
      }
    }
    written += n;
    files.push({ file: name, kind, written: n, errors: parsed.errors });
  }

  return { files, written };
}
