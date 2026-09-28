// ===== Lead Master 存储层（CSV）=====
// 单一主库：seo-growth/leads.csv
// 之所以用 CSV 而不是新增后台/API：免费、可直接用表格软件每天录入与筛选，
// 且不引入任何公开 URL 或客户端可读路径（见 leads.test.ts 的访问控制守卫）。
//
// 写入策略：先写临时文件再 rename（原子替换），避免中途失败损坏历史数据。

import fs from "node:fs";
import path from "node:path";
import { LEAD_FIELDS, emptyLead, type Lead } from "./schema.ts";
import { parseCsv, serializeCsv } from "./csv.ts";
import { makeLeadId, normalizeDomain, normalizeEmail } from "./normalize.ts";
import { checkTransition, validateLead, fillAttribution } from "./pipeline.ts";

/** 相对仓库根目录的主库路径（唯一 Lead Master） */
export const LEAD_MASTER_RELATIVE_PATH = "seo-growth/leads.csv";

export function leadMasterPath(cwd: string = process.cwd()): string {
  return path.join(cwd, LEAD_MASTER_RELATIVE_PATH);
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** 读取主库；文件不存在时返回空数组（不自动建文件，避免误覆盖） */
export function readLeads(cwd: string = process.cwd()): Lead[] {
  const file = leadMasterPath(cwd);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf-8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));

  return rows.slice(1).map((cells) => {
    const lead = emptyLead();
    for (const field of LEAD_FIELDS) {
      const i = idx.get(field);
      lead[field] = i === undefined ? "" : (cells[i] ?? "");
    }
    return lead;
  });
}

/** 全量写回（调用方负责保证数据完整：历史行必须原样带回来） */
export function writeLeads(leads: readonly Lead[], cwd: string = process.cwd()): void {
  const file = leadMasterPath(cwd);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rows = leads.map((l) => LEAD_FIELDS.map((f) => l[f] ?? ""));
  const content = serializeCsv(LEAD_FIELDS, rows);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, file);
}

export interface AddLeadResult {
  ok: boolean;
  lead?: Lead;
  /** 拒绝原因（重复 / 校验失败） */
  reason?: string;
  reasons?: string[];
  /** 允许但需注意（例如同公司第二个联系人） */
  warnings?: string[];
}

/**
 * 新增 Lead。
 * 去重规则（显式，不静默产生第二条）：
 *   1. 归一化邮箱相同（两边都有邮箱）        → 拒绝
 *   2. 归一化域名相同 且 邮箱缺失或相同      → 拒绝（提示去更新已有 Lead）
 *   3. 归一化域名相同 但 两边邮箱不同且都非空 → 允许，但返回告警
 */
export function addLead(
  input: Partial<Lead> & { website: string },
  opts: { cwd?: string; now?: Date } = {}
): AddLeadResult {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? new Date();
  const existing = readLeads(cwd);

  const domain = normalizeDomain(input.website);
  const email = normalizeEmail(input.email ?? "");
  if (!domain) return { ok: false, reason: "website 不能为空" };

  for (const e of existing) {
    const eDomain = normalizeDomain(e.website);
    const eEmail = normalizeEmail(e.email);
    if (email && eEmail && email === eEmail) {
      return { ok: false, reason: `重复 Lead：邮箱已存在（${email}），现有 lead_id=${e.lead_id}` };
    }
    if (eDomain === domain && (!email || !eEmail || email === eEmail)) {
      return { ok: false, reason: `重复 Lead：网站已存在（${domain}），现有 lead_id=${e.lead_id}；请更新该条而不是新建` };
    }
  }

  const warnings: string[] = [];
  if (email) {
    for (const e of existing) {
      if (normalizeDomain(e.website) === domain && normalizeEmail(e.email) && normalizeEmail(e.email) !== email) {
        warnings.push(`同一网站已有其他联系人（lead_id=${e.lead_id}, email=${e.email}）—— 确认这是不同人再保留`);
      }
    }
  }

  const lead = emptyLead();
  for (const f of LEAD_FIELDS) {
    const v = (input as Record<string, string | undefined>)[f];
    if (typeof v === "string") lead[f] = v;
  }
  lead.website = input.website.trim();
  lead.email = email;
  lead.lead_id = input.lead_id?.trim() || makeLeadId(lead.website, email);
  if (!lead.status) lead.status = "New";
  const stamp = now.toISOString();
  if (!lead.created_at) lead.created_at = stamp;
  lead.updated_at = stamp;

  const filled = fillAttribution(lead);
  const issues = validateLead(filled);
  if (issues.length > 0) {
    return { ok: false, reasons: issues.map((i) => `${i.field}: ${i.message}`) };
  }

  writeLeads([...existing, filled], cwd);
  return { ok: true, lead: filled, warnings: warnings.length > 0 ? warnings : undefined };
}

export interface UpdateLeadResult {
  ok: boolean;
  lead?: Lead;
  reasons?: string[];
}

/**
 * 更新 Lead（按 lead_id）。状态变更必须通过状态机校验；
 * 进入 Contacted / Follow-up 时自动维护 first/last_contacted_at。
 */
export function updateLead(
  leadId: string,
  patch: Partial<Lead>,
  opts: { cwd?: string; now?: Date } = {}
): UpdateLeadResult {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? new Date();
  const leads = readLeads(cwd);
  const index = leads.findIndex((l) => l.lead_id === leadId);
  if (index < 0) return { ok: false, reasons: [`未找到 lead_id=${leadId}`] };

  const current = leads[index];
  const merged: Lead = { ...current };
  for (const f of LEAD_FIELDS) {
    const v = (patch as Record<string, string | undefined>)[f];
    if (typeof v === "string") merged[f] = v;
  }

  const reasons: string[] = [];
  if (patch.status && patch.status !== current.status) {
    const check = checkTransition(current, patch.status);
    reasons.push(...check.reasons);
  }
  const issues = validateLead(merged);
  reasons.push(...issues.map((i) => `${i.field}: ${i.message}`));
  if (reasons.length > 0) return { ok: false, reasons };

  // 触达时间戳自动维护（避免每天手工填）
  const touching = ["Contacted", "Follow-up 1", "Follow-up 2"];
  if (patch.status && touching.includes(patch.status)) {
    const d = todayDate(now);
    if (!merged.first_contacted_at) merged.first_contacted_at = d;
    merged.last_contacted_at = d;
  }
  merged.updated_at = nowIso();

  const finalLead = fillAttribution(merged);
  const next = [...leads];
  next[index] = finalLead;
  writeLeads(next, cwd);
  return { ok: true, lead: finalLead };
}

/** 按关键词搜索（域名 / 公司 / 邮箱 / 联系人），供日常筛选 */
export function searchLeads(query: string, cwd: string = process.cwd()): Lead[] {
  const q = query.trim().toLowerCase();
  if (!q) return readLeads(cwd);
  return readLeads(cwd).filter((l) =>
    [l.website, l.company, l.email, l.contact_name, l.lead_id, l.status, l.lead_type]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}
