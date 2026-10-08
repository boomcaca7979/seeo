// ===== E｜Send Ledger：Resend 实际发件记录 ↔ Lead Master 对账 =====
//
// 为什么需要这个模块
// ------------------
// 2026-10-08 的全量发件核查发现：Lead Master 的 `email` / `website` 两个字段**不足以**
// 支撑「按 domain + email 去重」这条规则 ——
//   - 主库有 5 条 `Contacted` 行的 `email` 为空，但 Resend 里确有真实收件地址；
//   - 另有若干行的「主库 website 域名」与「实际收件域名」不是同一个域。
// 结果是按主库字段去重会漏掉已经联系过的人 —— 2026-09-29 的 NodePing 重复发送就是这么来的。
//
// 因此：**Resend 的实际发件记录是「历史 outreach 事实」的最高可信来源**，
// 它以 `seo-growth/send-ledger.csv` 的形式存放（gitignore，与 leads.csv 同级敏感）。
//
// 本模块只做**对账**，边界与 `reconcile.ts` 同一纪律：
//   - 只把「Resend 真实记录」这一事实与主库对齐：**回填缺失的真实 email**、
//     在 notes 记录「收件域名与主库 website 不一致」、标记投诉 / 退信
//   - **绝不**修改 `website`（改域名等于改写对方是谁）
//   - **绝不**修改 `first_contacted_at` / `last_contacted_at`（不得用推测值替换真实日期）
//   - **绝不**凭空补 `status = Contacted`（没有可靠发送事实就不许有 Contacted）
//   - **绝不**替没有证据的行填 `template`
//   - **绝不**重复计算发送数量（一条 ledger 记录算一次发送，回填不产生新的发送）
//   - **幂等**：重跑不再写入（靠 `LEDGER_NOTE_MARKER`）
//   - **无任何网络调用**（ledger 由人工从 Resend 导出后落盘；本模块只读文件）

import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv.ts";
import { normalizeDomain, normalizeEmail } from "./normalize.ts";
import type { Lead } from "./schema.ts";

/** 相对仓库根目录的 ledger 路径（与 leads.csv 同级、同样被 gitignore） */
export const SEND_LEDGER_RELATIVE_PATH = "seo-growth/send-ledger.csv";

export const SEND_LEDGER_FIELDS = ["resend_id", "sent_at", "recipient", "kind", "status", "subject"] as const;
export type SendLedgerField = (typeof SEND_LEDGER_FIELDS)[number];

/** 发送类别：outreach = 冷启动外发；lifecycle = 产品/生命周期邮件（不是潜客触达） */
export const LEDGER_KINDS = ["outreach", "lifecycle"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** Resend 的投递状态。`complained` = 收件人把它标成了垃圾邮件，等同于「明确拒绝」 */
export const LEDGER_STATUSES = ["delivered", "bounced", "complained", "sent", "failed"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export interface SendLedgerRecord {
  resend_id: string;
  /** ISO 时间戳（保留原始精度，仅用于审计展示与排序） */
  sent_at: string;
  recipient: string;
  kind: LedgerKind;
  status: LedgerStatus;
  subject: string;
}

/** 写进 `notes` 的对账标记。幂等判定的**唯一**依据（不要用日期判断） */
export const LEDGER_NOTE_MARKER = "[send-ledger]";

/** `notes` 里出现「Resend id」时用于把主库行与 ledger 行**精确**挂接（比域名匹配可靠） */
const RESEND_ID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function asKind(v: string): LedgerKind {
  const k = v.trim().toLowerCase();
  return (LEDGER_KINDS as readonly string[]).includes(k) ? (k as LedgerKind) : "lifecycle";
}

function asStatus(v: string): LedgerStatus {
  const s = v.trim().toLowerCase();
  return (LEDGER_STATUSES as readonly string[]).includes(s) ? (s as LedgerStatus) : "sent";
}

/** 收件人域名（小写、去 www）。非字符串入参一律视为「没有域名」，不做隐式转换。 */
export function recipientDomain(recipient: string): string {
  if (typeof recipient !== "string") return "";
  const e = normalizeEmail(recipient);
  const at = e.lastIndexOf("@");
  if (at < 0) return "";
  return e.slice(at + 1).replace(/^www\./, "");
}

/** 解析 ledger CSV 文本（纯函数，不读盘） */
export function parseSendLedger(text: string): SendLedgerRecord[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));
  const get = (cells: string[], f: string) => {
    const i = idx.get(f);
    return i === undefined ? "" : (cells[i] ?? "").trim();
  };
  const out: SendLedgerRecord[] = [];
  for (const cells of rows.slice(1)) {
    const resend_id = get(cells, "resend_id");
    const recipient = normalizeEmail(get(cells, "recipient"));
    if (!resend_id || !recipient) continue; // 不完整行直接跳过，不做猜测性补齐
    out.push({
      resend_id,
      sent_at: get(cells, "sent_at"),
      recipient,
      kind: asKind(get(cells, "kind")),
      status: asStatus(get(cells, "status")),
      subject: get(cells, "subject"),
    });
  }
  return out;
}

/** 读取 ledger；文件不存在时返回空数组（CI / 新克隆没有这个被 gitignore 的文件） */
export function readSendLedger(cwd: string = process.cwd()): SendLedgerRecord[] {
  const file = path.join(cwd, SEND_LEDGER_RELATIVE_PATH);
  if (!fs.existsSync(file)) return [];
  return parseSendLedger(fs.readFileSync(file, "utf-8"));
}

/** 只看 outreach（冷启动）记录 —— lifecycle 邮件不构成潜客触达 */
export function outreachRecords(records: readonly SendLedgerRecord[]): SendLedgerRecord[] {
  return records.filter((r) => r.kind === "outreach");
}

/** ledger 里所有真实收件地址（归一化）。这条去重基**优先于**主库的 email 字段 */
export function ledgerRecipientSet(records: readonly SendLedgerRecord[]): Set<string> {
  return new Set(outreachRecords(records).map((r) => normalizeEmail(r.recipient)));
}

/**
 * ledger 里所有真实收件域名。
 * 注意：它比「主库 website 域名」更接近「我们到底打扰了谁」，所以去重时两个集合都要查。
 */
export function ledgerDomainSet(records: readonly SendLedgerRecord[]): Set<string> {
  return new Set(outreachRecords(records).map((r) => recipientDomain(r.recipient)));
}

/** 该 lead 的 notes / last_action 里出现过的 Resend id（用于精确挂接） */
export function resendIdsInLead(lead: Lead): string[] {
  const hay = `${lead.notes} ${lead.last_action}`;
  const hits = hay.match(RESEND_ID_RE) ?? [];
  return [...new Set(hits.map((h) => h.toLowerCase()))];
}

// ---------- 对账计划（纯函数，不写库） ----------

export type LedgerAction =
  | "matched" // 主库已记录的就是真实收件地址，且域名一致
  | "backfill-email" // 主库 email 为空 → 用 ledger 的真实收件地址回填
  | "domain-mismatch" // 收件域名 ≠ 主库 website 域名（只记 notes，不改 website）
  | "duplicate-send" // 同一收件地址在 ledger 里出现多次（重复发送）
  | "bounce" // Resend 记录为退信 → 记 reply_status=bounced（enum 内合法值）
  | "complaint" // Resend 记录为垃圾邮件投诉 → 必须已被 Suppressed（由 suppress-complaint 落地）
  | "already-reconciled" // 已带 ledger 对账标记 → 重跑不再写入（幂等）
  | "unmatched"; // 主库声称已触达，但 ledger 里找不到任何发送记录

export interface LedgerEntry {
  lead_id: string;
  website: string;
  status: string;
  /** 主库当前记录的 email（回填前） */
  emailBefore: string;
  /** ledger 里的真实收件地址（unmatched 时为空） */
  ledgerRecipient: string;
  /** ledger 侧该 lead 关联到的所有记录 */
  ledgerIds: string[];
  actions: LedgerAction[];
  /** 人类可读依据 */
  reason: string;
  /** 本次是否真的会写这一行 */
  writes: boolean;
  /** 该行已带 ledger 对账标记（幂等：重跑不再写入） */
  reconciled: boolean;
}

export interface LedgerSummary {
  /** ledger 记录总数（含 lifecycle） */
  records: number;
  /** outreach 发送次数（**真实发送计数**，回填不得改变它） */
  outreachSends: number;
  /** outreach 唯一收件人数 */
  distinctRecipients: number;
  /** 主库 email 与 ledger 一致 */
  matched: number;
  /** 主库 email 为空、由 ledger 回填 */
  backfilledEmail: number;
  /** 收件域名 ≠ 主库 website 域名 */
  domainMismatch: number;
  /** 主库声称已触达但 ledger 无记录 */
  unmatched: number;
  /** ledger 侧重复发送的唯一收件人数 */
  duplicate: number;
  /** 被标记为垃圾邮件（complained） */
  complaint: number;
  /** 退信（bounced） */
  bounce: number;
  /** 会写库的行数 */
  writable: number;
}

export interface LedgerPlan {
  entries: LedgerEntry[];
  summary: LedgerSummary;
  /** ledger 里有、主库完全没有对应行的收件地址 */
  unmatchedRecipients: string[];
}

function collectRecipients(records: readonly SendLedgerRecord[]): Map<string, SendLedgerRecord[]> {
  const byRecipient = new Map<string, SendLedgerRecord[]>();
  for (const r of outreachRecords(records)) {
    const arr = byRecipient.get(r.recipient);
    if (arr) arr.push(r);
    else byRecipient.set(r.recipient, [r]);
  }
  return byRecipient;
}

/**
 * 生成对账计划。**纯函数**：不读文件、不写文件、不发网络请求。
 *
 * 挂接顺序（先精确后模糊）：
 *   1. notes / last_action 里的 Resend id（最可靠 —— 5 条 email 为空的历史行只有这条线索）
 *   2. 归一化后的收件地址 == 主库 email
 *   3. 收件域名 == 主库 website 域名
 */
export function planLedgerReconciliation(
  leads: readonly Lead[],
  records: readonly SendLedgerRecord[]
): LedgerPlan {
  const outreach = outreachRecords(records);
  const byId = new Map(outreach.map((r) => [r.resend_id.toLowerCase(), r]));
  const byRecipient = collectRecipients(records);
  const byDomain = new Map<string, SendLedgerRecord[]>();
  for (const r of outreach) {
    const d = recipientDomain(r.recipient);
    const arr = byDomain.get(d);
    if (arr) arr.push(r);
    else byDomain.set(d, [r]);
  }

  const claimed = new Set<string>();
  const entries: LedgerEntry[] = [];

  for (const lead of leads) {
    const domain = normalizeDomain(lead.website);
    const email = normalizeEmail(lead.email);

    // 1) 精确：notes 里写过的 Resend id
    let linked: SendLedgerRecord[] = resendIdsInLead(lead)
      .map((id) => byId.get(id))
      .filter((r): r is SendLedgerRecord => Boolean(r));

    // 2) 主库 email 与收件地址一致
    if (linked.length === 0 && email && byRecipient.has(email)) linked = [...(byRecipient.get(email) ?? [])];

    // 3) 收件域名与主库 website 域名一致
    if (linked.length === 0 && domain && byDomain.has(domain)) linked = [...(byDomain.get(domain) ?? [])];

    linked.forEach((r) => claimed.add(r.resend_id.toLowerCase()));

    const actions: LedgerAction[] = [];
    const reasons: string[] = [];

    if (linked.length === 0) {
      // 只有「声称已触达」的行才算 unmatched；还没发的行本来就该没有记录
      const claimsContact = Boolean(lead.first_contacted_at || lead.last_contacted_at);
      if (!claimsContact) continue;
      entries.push({
        lead_id: lead.lead_id,
        website: lead.website,
        status: lead.status,
        emailBefore: email,
        ledgerRecipient: "",
        ledgerIds: [],
        actions: ["unmatched"],
        reason: "主库记载了触达时间，但 ledger 里找不到任何对应发送记录 —— 需人工核对，不得反向补 Contacted",
        writes: false,
        reconciled: false,
      });
      continue;
    }

    const real = linked[0];
    const realEmail = normalizeEmail(real.recipient);
    const realDomain = recipientDomain(real.recipient);

    if (!email) {
      actions.push("backfill-email");
      reasons.push(`主库 email 为空，按 ledger 回填真实收件地址（resend_id=${real.resend_id}）`);
    } else if (email === realEmail) {
      actions.push("matched");
    } else {
      // 理论上经过 email 匹配不会走到这里；保留分支避免静默
      actions.push("unmatched");
      reasons.push(`主库 email 与 ledger 收件地址不一致（主库=${email}）`);
    }

    if (realDomain && realDomain !== domain) {
      actions.push("domain-mismatch");
      reasons.push(`收件域名与主库 website 域名不一致（主库 website=${domain || "(空)"}，实际收件域=${realDomain}）—— 只记录，不改 website`);
    }

    const dupes = linked.length > 1;
    if (dupes) {
      actions.push("duplicate-send");
      reasons.push(`同一收件地址被发送 ${linked.length} 次（重复发送，ledger 计数不合并）`);
    }

    // 退信是真实发生过的投递结果 → 记进 reply_status（enum 内合法值），只在空着时写
    const bounced = linked.some((r) => r.status === "bounced");
    if (bounced && !lead.reply_status.trim()) {
      actions.push("bounce");
      reasons.push("Resend 记录为退信 → 记 reply_status=bounced");
    }

    // 投诉是最高优先级的合规事实：必须已被 Suppressed。
    // 这里的压制动作由 `suppress-complaint` 走状态机完成，本对账只负责**暴露**它（并进 notes 留痕）。
    if (linked.some((r) => r.status === "complained")) {
      actions.push("complaint");
      reasons.push("Resend 记录该收件人把邮件标为垃圾邮件 → 必须 Suppressed 并永久停止联系");
    }

    // 幂等：已带对账标记的行不再写入（重跑的 `会写库行数` 必须归零，否则报告会骗人）
    const reconciled = lead.notes.includes(LEDGER_NOTE_MARKER);
    if (reconciled) {
      actions.push("already-reconciled");
      reasons.push("已带 ledger 对账标记，重跑不重复写入（幂等）");
    }

    entries.push({
      lead_id: lead.lead_id,
      website: lead.website,
      status: lead.status,
      emailBefore: email,
      ledgerRecipient: realEmail,
      ledgerIds: linked.map((r) => r.resend_id),
      actions,
      reason: reasons.join("；") || "与 ledger 一致",
      // 需要落库的真实事实：回填缺失 email、退信、收件域名不一致、重复发送。
      // 纯 matched / complaint（由 suppress-complaint 单独处理）不触发写库。
      writes:
        !reconciled &&
        (actions.includes("backfill-email") ||
          actions.includes("bounce") ||
          actions.includes("domain-mismatch") ||
          actions.includes("duplicate-send")),
      reconciled,
    });
  }

  const unmatchedRecipients = [...byRecipient.keys()].filter(
    (r) => !claimed.has((byRecipient.get(r) ?? [])[0]?.resend_id.toLowerCase() ?? "")
  );

  const countEntries = (a: LedgerAction) => entries.filter((e) => e.actions.includes(a)).length;
  const duplicateRecipients = [...byRecipient.values()].filter((arr) => arr.length > 1).length;
  const summary: LedgerSummary = {
    records: records.length,
    outreachSends: outreach.length,
    distinctRecipients: byRecipient.size,
    matched: countEntries("matched"),
    backfilledEmail: countEntries("backfill-email"),
    domainMismatch: countEntries("domain-mismatch"),
    unmatched: countEntries("unmatched"),
    duplicate: duplicateRecipients,
    complaint: outreach.filter((r) => r.status === "complained").length,
    bounce: outreach.filter((r) => r.status === "bounced").length,
    writable: entries.filter((e) => e.writes).length,
  };

  return { entries, summary, unmatchedRecipients };
}

// ---------- 应用计划 ----------

export interface LedgerApplyOptions {
  /** 写进 notes 的日期（`YYYY-MM-DD`），由调用方注入以保证可确定性测试 */
  noteDate: string;
  /** 写入 `updated_at` 的时间戳（ISO）。不传则用当前时间 */
  nowIso?: string;
}

/**
 * 生成对账注记。
 * 措辞刻意**不含** `outreach sent` / `sent via resend` 等发送证据短语 ——
 * 否则会把「没发过的行」算进发送计数（`countOutboundSendRecords` 会被污染）。
 */
export function buildLedgerNote(entry: LedgerEntry, noteDate: string): string {
  const head = `${LEDGER_NOTE_MARKER} ${noteDate} Resend 权威发件记录对账`;
  const parts: string[] = [];
  if (entry.actions.includes("backfill-email")) {
    parts.push(`回填真实收件地址（主库原为空；来自 resend_id=${entry.ledgerIds.join(",")}）`);
  }
  if (entry.actions.includes("domain-mismatch")) {
    parts.push(`收件域名与主库 website 域名不一致：主库 website=${normalizeDomain(entry.website) || "(空)"}，实际收件域=${recipientDomain(entry.ledgerRecipient)}（未修改 website）`);
  }
  if (entry.actions.includes("duplicate-send")) {
    parts.push(`同一收件地址被发送 ${entry.ledgerIds.length} 次（重复发送）`);
  }
  if (entry.actions.includes("bounce")) {
    parts.push("Resend 记录为退信，已记 reply_status=bounced");
  }
  if (entry.actions.includes("complaint")) {
    parts.push("Resend 记录为垃圾邮件投诉，已按投诉压制（永久停止联系）");
  }
  parts.push("未改动 first/last_contacted_at、未新增触达、未填 template");
  return `${head}：${parts.join("；")}。`;
}

/**
 * 把计划落到数据上（**纯函数**，返回新数组）。
 * 只改三件事：缺失的 `email`、退信行的 `reply_status`、`notes` 追加对账注记（+ `updated_at`）。
 * `website` / `status` / `template` / `first_contacted_at` / `last_contacted_at` /
 * `next_followup_at` / `last_action` 一律不动。
 */
export function applyLedgerReconciliation(
  leads: readonly Lead[],
  plan: LedgerPlan,
  opts: LedgerApplyOptions
): Lead[] {
  const byId = new Map(plan.entries.filter((e) => e.writes).map((e) => [e.lead_id, e]));
  const stamp = opts.nowIso ?? new Date().toISOString();

  return leads.map((lead) => {
    const entry = byId.get(lead.lead_id);
    if (!entry) return lead; // 未列入计划的行走原对象，保证「数据不变」

    if (lead.notes.includes(LEDGER_NOTE_MARKER)) return lead; // 幂等：已对账过就不重复追加

    const notes = `${lead.notes}${lead.notes ? " " : ""}${buildLedgerNote(entry, opts.noteDate)}`;
    return {
      ...lead,
      email: entry.actions.includes("backfill-email") ? entry.ledgerRecipient : lead.email,
      reply_status: entry.actions.includes("bounce") ? "bounced" : lead.reply_status,
      notes,
      updated_at: stamp,
    };
  });
}

/** 主库里已完成 ledger 对账的行数（只读，供报告 / doctor 使用） */
export function countLedgerReconciledLeads(leads: readonly Lead[]): number {
  return leads.filter((l) => l.notes.includes(LEDGER_NOTE_MARKER)).length;
}
