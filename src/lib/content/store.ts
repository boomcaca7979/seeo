// ===== F｜Content Master 存储层 =====
// 单一事实来源：seo-growth/content-bank.csv
// 只有这一个文件是内容主库；渠道版本按 CHANNEL_PLAYBOOK.md 派生，不另建第二份主题库。

import fs from "node:fs";
import path from "node:path";
import {
  CONTENT_FIELDS,
  emptyTopic,
  isContentStatus,
  type ContentStatus,
  type ContentTopic,
} from "./schema.ts";
import { parseCsv, serializeCsv } from "./csv.ts";
import { findDuplicateIds, validateTopic } from "./validate.ts";

export const CONTENT_MASTER_RELATIVE_PATH = "seo-growth/content-bank.csv";

export function contentMasterPath(cwd: string = process.cwd()): string {
  return path.join(cwd, CONTENT_MASTER_RELATIVE_PATH);
}

function todayDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function readTopics(cwd: string = process.cwd()): ContentTopic[] {
  const file = contentMasterPath(cwd);
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf-8"));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));
  return rows.slice(1).map((cells) => {
    const t = emptyTopic();
    for (const f of CONTENT_FIELDS) {
      const i = idx.get(f);
      t[f] = i === undefined ? "" : (cells[i] ?? "");
    }
    return t;
  });
}

export function writeTopics(topics: readonly ContentTopic[], cwd: string = process.cwd()): void {
  const file = contentMasterPath(cwd);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rows = topics.map((t) => CONTENT_FIELDS.map((f) => t[f] ?? ""));
  const content = serializeCsv(CONTENT_FIELDS, rows);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, file);
}

/** 新增主题（重复 content_id 直接拒绝） */
export function addTopic(
  topic: ContentTopic,
  opts: { cwd?: string; now?: Date } = {}
): { ok: boolean; reasons?: string[] } {
  const cwd = opts.cwd ?? process.cwd();
  const existing = readTopics(cwd);
  if (existing.some((t) => t.content_id.trim() === topic.content_id.trim())) {
    return { ok: false, reasons: [`content_id 已存在：${topic.content_id}`] };
  }
  if (!topic.created_at) topic.created_at = todayDate(opts.now ?? new Date());
  if (!topic.times_used) topic.times_used = "0";
  const issues = validateTopic(topic);
  if (issues.length > 0) return { ok: false, reasons: issues.map((i) => `${i.field}: ${i.message}`) };
  writeTopics([...existing, topic], cwd);
  return { ok: true };
}

export interface UseResult {
  ok: boolean;
  topic?: ContentTopic;
  reasons?: string[];
}

/**
 * 标记一次使用（§16）：status → Published、last_used_at = today、times_used += 1。
 */
export function markUsed(
  contentId: string,
  opts: { cwd?: string; now?: Date; status?: ContentStatus } = {}
): UseResult {
  const cwd = opts.cwd ?? process.cwd();
  const topics = readTopics(cwd);
  const i = topics.findIndex((t) => t.content_id.trim() === contentId.trim());
  if (i < 0) return { ok: false, reasons: [`未找到 content_id=${contentId}`] };

  const next = { ...topics[i] };
  const status = opts.status ?? "Published";
  if (!isContentStatus(status)) return { ok: false, reasons: [`未知状态：${status}`] };
  next.status = status;
  next.last_used_at = todayDate(opts.now ?? new Date());
  next.times_used = String(Number(next.times_used || "0") + 1);

  const issues = validateTopic(next);
  if (issues.length > 0) return { ok: false, reasons: issues.map((x) => `${x.field}: ${x.message}`) };

  const list = [...topics];
  list[i] = next;
  writeTopics(list, cwd);
  return { ok: true, topic: next };
}

/** 按状态筛选（§16 的「筛选 Status = Ready」） */
export function listByStatus(status: ContentStatus, cwd: string = process.cwd()): ContentTopic[] {
  return readTopics(cwd).filter((t) => t.status === status);
}

/**
 * 找「长期没用过」的主题（§12/§16）：last_used_at 为空或距今 >= recommended_reuse_gap。
 * today 显式传入，便于确定性测试。
 */
export function staleTopics(today: string, cwd: string = process.cwd()): ContentTopic[] {
  return readTopics(cwd).filter((t) => {
    if (t.status === "Retired") return false;
    const gap = Number(t.recommended_reuse_gap || "0");
    if (!gap) return false;
    if (!t.last_used_at) return true;
    const used = new Date(`${t.last_used_at}T00:00:00Z`).getTime();
    const now = new Date(`${today}T00:00:00Z`).getTime();
    if (Number.isNaN(used) || Number.isNaN(now)) return true;
    return (now - used) / 86_400_000 >= gap;
  });
}

/** 全量校验（供测试与 CLI doctor 使用） */
export function auditMaster(cwd: string = process.cwd()): {
  total: number;
  duplicates: string[];
  issues: Array<{ content_id: string; field: string; message: string }>;
} {
  const topics = readTopics(cwd);
  const issues = topics.flatMap((t) =>
    validateTopic(t).map((i) => ({ content_id: t.content_id, field: i.field, message: i.message }))
  );
  return { total: topics.length, duplicates: findDuplicateIds(topics), issues };
}
