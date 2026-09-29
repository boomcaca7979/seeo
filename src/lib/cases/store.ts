// ===== I｜Case Master 存储层 =====
// 唯一 Case Master：seo-growth/case-studies.csv
// 允许为 0 条 —— 没有真实案例时不做任何占位数据（§19）。

import fs from "node:fs";
import path from "node:path";
import { CASE_FIELDS, emptyCase, isCaseStatus, splitList, type CaseRecord, type CaseStatus } from "./schema.ts";
import { parseCsv, serializeCsv } from "../data/csv.ts";
import { findDuplicateCaseIds, validateCase } from "./validate.ts";

export const CASE_MASTER_RELATIVE_PATH = "seo-growth/case-studies.csv";

export function caseMasterPath(cwd: string = process.cwd()): string {
  return path.join(cwd, CASE_MASTER_RELATIVE_PATH);
}

export function readCases(cwd: string = process.cwd()): CaseRecord[] {
  const file = caseMasterPath(cwd);
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf-8"));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));
  return rows.slice(1).map((cells) => {
    const rec = emptyCase();
    for (const f of CASE_FIELDS) {
      const i = idx.get(f);
      rec[f] = i === undefined ? "" : (cells[i] ?? "");
    }
    return rec;
  });
}

export function writeCases(cases: readonly CaseRecord[], cwd: string = process.cwd()): void {
  const file = caseMasterPath(cwd);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rows = cases.map((c) => CASE_FIELDS.map((f) => c[f] ?? ""));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeCsv(CASE_FIELDS, rows), "utf-8");
  fs.renameSync(tmp, file);
}

/** 新增案例：case_id 不得重复；校验不通过直接拒绝（不落半成品） */
export function addCase(
  record: CaseRecord,
  opts: { cwd?: string } = {}
): { ok: boolean; reasons?: string[] } {
  const cwd = opts.cwd ?? process.cwd();
  const existing = readCases(cwd);
  if (existing.some((c) => c.case_id.trim() === record.case_id.trim())) {
    return { ok: false, reasons: [`case_id 已存在：${record.case_id}`] };
  }
  if (!record.status) record.status = "Lead";
  const issues = validateCase(record);
  if (issues.length > 0) return { ok: false, reasons: issues.map((i) => `${i.field}: ${i.message}`) };
  writeCases([...existing, record], cwd);
  return { ok: true };
}

/**
 * 变更状态。Approved / Published 会走完整校验门槛（§16），
 * 缺证据 / 缺同意一律拒绝。
 */
export function setStatus(
  caseId: string,
  status: CaseStatus,
  patch: Partial<CaseRecord> = {},
  opts: { cwd?: string } = {}
): { ok: boolean; record?: CaseRecord; reasons?: string[] } {
  const cwd = opts.cwd ?? process.cwd();
  const cases = readCases(cwd);
  const i = cases.findIndex((c) => c.case_id.trim() === caseId.trim());
  if (i < 0) return { ok: false, reasons: [`未找到 case_id=${caseId}`] };
  if (!isCaseStatus(status)) return { ok: false, reasons: [`未知状态：${status}`] };

  const next: CaseRecord = { ...cases[i], ...patch, status };
  const issues = validateCase(next);
  if (issues.length > 0) return { ok: false, reasons: issues.map((x) => `${x.field}: ${x.message}`) };

  const list = [...cases];
  list[i] = next;
  writeCases(list, cwd);
  return { ok: true, record: next };
}

/** 某个 F 内容主题被哪些案例支撑（§13，只建立引用关系） */
export function casesForContent(contentId: string, cwd: string = process.cwd()): CaseRecord[] {
  return readCases(cwd).filter((c) => splitList(c.related_content).includes(contentId));
}

/** 某个社区帖子引用了哪些案例（§14） */
export function casesForCommunityPost(postId: string, cwd: string = process.cwd()): CaseRecord[] {
  return readCases(cwd).filter((c) => splitList(c.community_posts).includes(postId));
}

/** 可公开的案例（published=yes 且状态为 Published） */
export function publishedCases(cwd: string = process.cwd()): CaseRecord[] {
  return readCases(cwd).filter((c) => c.published === "yes" && c.status === "Published");
}

/** 跨库引用校验：related_content 必须存在于 F 的内容主库；related_seo_page 必须在可收录路径内 */
export function crossReferenceIssues(
  cases: readonly CaseRecord[],
  knownContentIds: readonly string[],
  allowedPaths: readonly string[]
): Array<{ case_id: string; field: string; message: string }> {
  const out: Array<{ case_id: string; field: string; message: string }> = [];
  for (const c of cases) {
    for (const cid of splitList(c.related_content)) {
      if (!knownContentIds.includes(cid)) {
        out.push({ case_id: c.case_id, field: "related_content", message: `F 的内容主库里不存在 ${cid}` });
      }
    }
    for (const p of splitList(c.related_seo_page)) {
      if (!allowedPaths.includes(p)) {
        out.push({ case_id: c.case_id, field: "related_seo_page", message: `${p} 不是已收录的营销路径` });
      }
    }
  }
  return out;
}

/** 全量体检（测试与 CLI doctor 共用） */
export function auditCases(cwd: string = process.cwd()): {
  total: number;
  byStatus: Record<string, number>;
  duplicates: string[];
  issues: Array<{ case_id: string; field: string; message: string }>;
} {
  const cases = readCases(cwd);
  const byStatus: Record<string, number> = {};
  for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  return {
    total: cases.length,
    byStatus,
    duplicates: findDuplicateCaseIds(cases),
    issues: cases.flatMap((c) => validateCase(c).map((i) => ({ case_id: c.case_id, field: i.field, message: i.message }))),
  };
}
