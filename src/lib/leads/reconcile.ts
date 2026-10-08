// ===== E｜历史 Contacted 回填 / 状态机对账（`leads backfill-contacted`）=====
//
// 为什么需要这个模块
// ------------------
// 2026-09-29 的 Day 1 批次是把 76 条 Lead **批量直接写入** `status = Contacted` 的，
// 没有走 `New → Ready to Contact → Contacted` 这条正式路径。发送这件事是真的
// （Resend 有 delivered / bounced 记录，`last_action` 里也写了），但库里没有任何证据
// 说明这次写入经过了状态机；而且这批行全部没有 `template`（`checkTransition` 对
// `Contacted` 的硬性前置之一）。于是「真实数据」与「状态机模型」对不上。
//
// 本模块只做一件事：**对账**（reconcile），不做任何发送、不做任何推断性补值。
//   - 有 outbound contact 事实、状态还没到 Contacted 的 → 补成 `Contacted`
//     （补的是状态，不是发送 —— 发送次数、触达时间一律不动）
//   - 有事实、状态已经在 Contacted 及之后、但没有 `template` 的 → 登记为**历史豁免**
//     （回填 provenance：把「这行是批量写入的、当时没有记录模板」记录在案。
//      **绝不虚构 template 值** —— 无证据就是无证据）
//   - 没有任何发送事实的 `New` → 一律不动（禁止自动升级）
//   - `Suppressed` / `Not Interested` / `No Response` → 一律不动（终态 / 已明确拒绝）
//
// 硬约束（有测试强制，见 leads.test.ts 的 E13 组）
// -------------------------------------------------
//   1. **绝不修改** `first_contacted_at` / `last_contacted_at` / `next_followup_at`
//   2. **绝不新增一次触达**：不改写发送记录，不产生新的 send 计数
//   3. **幂等**：重跑不产生第二次写入（靠 `RECONCILE_NOTE_MARKER` 判断）
//   4. 本模块**没有任何网络调用**（与 L 层同一条纪律：E/L 都不是发送机器人）

import { isContactedOrLater, isDateOnly, type Lead } from "./schema.ts";

/** 写进 `notes` 的对账标记。这是幂等判定的**唯一**依据（不要用日期判断） */
export const RECONCILE_NOTE_MARKER = "[reconcile-contacted]";

/**
 * 判定「确实存在 outbound contact 事实」的文本证据。
 * 只认「我们真的把信发出去了」这一类记录；「准备发」「草稿」不算。
 */
export const OUTBOUND_SEND_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /outreach sent/i,
  /follow-?up\s*\d?\s*sent/i,
  /sent via resend/i,
  /已发首封/,
  /已发跟进/,
];

/**
 * 对账一律不碰的状态：
 *   - `Suppressed`：对方要求停止联系，终态
 *   - `Not Interested`：已明确拒绝，改回 Contacted 等于否认对方的回复
 *   - `No Response`：序列已走完的结论，不是「未触达」，不能降级
 */
export const RECONCILE_FROZEN_STATUSES: readonly string[] = ["Suppressed", "Not Interested", "No Response"];

export interface ContactFact {
  /** 是否构成「确实存在 outbound contact 事实」 */
  hasFact: boolean;
  /** 构成事实的证据（审计展示用；不要用它做逻辑分支） */
  evidence: string[];
  /** 不构成事实的原因（dry-run 展示用） */
  missing: string[];
}

/**
 * 检查一条 Lead 是否真的有过 outbound contact。
 * 判定必须**同时**满足：两个触达日期都是合法 `YYYY-MM-DD`、时序不倒挂、
 * 且在 `last_action` / `notes` 里能找到真实的发送记录。
 */
export function inspectContactFact(lead: Lead): ContactFact {
  const evidence: string[] = [];
  const missing: string[] = [];

  const first = lead.first_contacted_at.trim();
  const last = lead.last_contacted_at.trim();

  if (!first || !isDateOnly(first)) missing.push("first_contacted_at 缺失或不是 YYYY-MM-DD");
  else evidence.push(`first_contacted_at=${first}`);

  if (!last || !isDateOnly(last)) missing.push("last_contacted_at 缺失或不是 YYYY-MM-DD");
  else evidence.push(`last_contacted_at=${last}`);

  if (first && last && isDateOnly(first) && isDateOnly(last) && last < first) {
    missing.push("last_contacted_at 早于 first_contacted_at");
  }

  const haystack = `${lead.last_action} ${lead.notes}`;
  const hit = OUTBOUND_SEND_EVIDENCE_PATTERNS.find((re) => re.test(haystack));
  if (!hit) missing.push("last_action / notes 中没有 outbound 发送记录");
  else evidence.push(`send-evidence=/${hit.source}/`);

  return { hasFact: missing.length === 0, evidence, missing };
}

export function hasOutboundContactFact(lead: Lead): boolean {
  return inspectContactFact(lead).hasFact;
}

/** 该行是否已经被对账过（幂等判定的唯一依据） */
export function isReconciled(lead: Lead): boolean {
  return lead.notes.includes(RECONCILE_NOTE_MARKER);
}

/**
 * 统计「有 outbound 发送记录」的行数。
 * 对账前后这个数字必须**完全一致** —— 这是「回填不增加发送次数」的可断言口径。
 */
export function countOutboundSendRecords(leads: readonly Lead[]): number {
  return leads.filter((l) =>
    OUTBOUND_SEND_EVIDENCE_PATTERNS.some((re) => re.test(`${l.last_action} ${l.notes}`))
  ).length;
}

// ---------- 对账计划（纯函数，不写库） ----------

export type ReconcileAction =
  | "promote-to-contacted"
  | "record-grandfather"
  | "already-consistent"
  | "already-reconciled"
  | "blocked-missing-issue"
  | "skipped-no-fact"
  | "skipped-frozen";

export interface ReconcileEntry {
  lead_id: string;
  website: string;
  statusBefore: string;
  statusAfter: string;
  action: ReconcileAction;
  /** 人类可读依据（dry-run / 报告用） */
  reason: string;
  /** 本次是否真的会写这一行 */
  writes: boolean;
}

export interface ReconcileSummary {
  total: number;
  promoteToContacted: number;
  recordGrandfather: number;
  alreadyConsistent: number;
  alreadyReconciled: number;
  blockedMissingIssue: number;
  skippedNoFact: number;
  skippedFrozen: number;
  /** 会写库的行数 */
  writable: number;
  /** 会改变 status 的行数（对真实数据运行时应当很小，且绝不包含「升级 New」） */
  statusChanges: number;
}

export interface ReconcilePlan {
  entries: ReconcileEntry[];
  summary: ReconcileSummary;
}

/**
 * 生成对账计划。**纯函数**：不读文件、不写文件、不发网络请求。
 * 判定顺序（先命中先归类）：
 *   无发送事实 → 冻结状态 → 已对账 → 已在 Contacted 及之后 → 可推进
 */
export function planContactedBackfill(leads: readonly Lead[]): ReconcilePlan {
  const entries: ReconcileEntry[] = [];

  for (const lead of leads) {
    const fact = inspectContactFact(lead);
    const base = { lead_id: lead.lead_id, website: lead.website, statusBefore: lead.status };

    if (!fact.hasFact) {
      entries.push({
        ...base,
        statusAfter: lead.status,
        action: "skipped-no-fact",
        reason: `没有 outbound contact 事实（${fact.missing.join("；")}）—— 不升级`,
        writes: false,
      });
      continue;
    }

    if (RECONCILE_FROZEN_STATUSES.includes(lead.status)) {
      entries.push({
        ...base,
        statusAfter: lead.status,
        action: "skipped-frozen",
        reason: `${lead.status} 是对账冻结状态（终态 / 已明确拒绝）—— 一字不改`,
        writes: false,
      });
      continue;
    }

    if (isReconciled(lead)) {
      entries.push({
        ...base,
        statusAfter: lead.status,
        action: "already-reconciled",
        reason: "已带对账标记，重跑不重复写入（幂等）",
        writes: false,
      });
      continue;
    }

    if (isContactedOrLater(lead.status)) {
      if (lead.template.trim()) {
        entries.push({
          ...base,
          statusAfter: lead.status,
          action: "already-consistent",
          reason: `${lead.status} 且已记录 template=${lead.template}：与状态机模型一致`,
          writes: false,
        });
      } else {
        entries.push({
          ...base,
          statusAfter: lead.status,
          action: "record-grandfather",
          reason: `历史批量写入 ${lead.status}：有真实发送事实（${fact.evidence.join("，")}）但无 template，登记为历史豁免（不虚构模板值）`,
          writes: true,
        });
      }
      continue;
    }

    // 到这里只剩「未触达」的前段状态（New / Researching / Ready to Contact）
    if (!lead.specific_issue.trim()) {
      entries.push({
        ...base,
        statusAfter: lead.status,
        action: "blocked-missing-issue",
        reason: "有发送事实但缺 specific_issue（状态机对 Contacted 的硬性前置）—— 拒绝推进，交人工补录",
        writes: false,
      });
      continue;
    }
    entries.push({
      ...base,
      statusAfter: "Contacted",
      action: "promote-to-contacted",
      reason: `有真实发送事实（${fact.evidence.join("，")}）但状态仍是 ${lead.status} —— 按事实补状态（不新增发送）`,
      writes: true,
    });
  }

  const count = (a: ReconcileAction) => entries.filter((e) => e.action === a).length;
  const summary: ReconcileSummary = {
    total: entries.length,
    promoteToContacted: count("promote-to-contacted"),
    recordGrandfather: count("record-grandfather"),
    alreadyConsistent: count("already-consistent"),
    alreadyReconciled: count("already-reconciled"),
    blockedMissingIssue: count("blocked-missing-issue"),
    skippedNoFact: count("skipped-no-fact"),
    skippedFrozen: count("skipped-frozen"),
    writable: entries.filter((e) => e.writes).length,
    statusChanges: count("promote-to-contacted"),
  };

  return { entries, summary };
}

// ---------- 应用计划 ----------

export interface ReconcileApplyOptions {
  /** 写进 notes 的日期（`YYYY-MM-DD`），由调用方注入以保证可确定性测试 */
  noteDate: string;
  /** 写入 `updated_at` 的时间戳（ISO）。不传则用当前时间 */
  nowIso?: string;
}

/** 生成对账注记（幂等标记 + 依据；不含发送字样，避免污染发送记录统计） */
export function buildReconcileNote(entry: ReconcileEntry, noteDate: string): string {
  const head = `${RECONCILE_NOTE_MARKER} ${noteDate} 历史批量写入状态对账`;
  if (entry.action === "promote-to-contacted") {
    return `${head}：由真实 outbound contact 事实补记 status=${entry.statusAfter}（原 ${entry.statusBefore}）；first/last_contacted_at 原样保留，未新增触达。`;
  }
  return `${head}：${entry.statusBefore} 由历史批量写入（未经过状态机），已按事实复核；first/last_contacted_at 原样保留，未新增触达；template 无证据可回填，登记为历史豁免。`;
}

/**
 * 把计划落到数据上（**纯函数**，返回新的数组，不改原对象）。
 * 只有 `entry.writes` 为真的行会被修改，且只改两件事：
 *   - `promote-to-contacted`：`status` → `Contacted`
 *   - 所有写入行：`notes` 追加对账注记
 * `first_contacted_at` / `last_contacted_at` / `next_followup_at` / `last_action` 一律不动。
 */
export function applyContactedBackfill(
  leads: readonly Lead[],
  plan: ReconcilePlan,
  opts: ReconcileApplyOptions
): Lead[] {
  const byId = new Map(plan.entries.filter((e) => e.writes).map((e) => [e.lead_id, e]));
  const stamp = opts.nowIso ?? new Date().toISOString();

  return leads.map((lead) => {
    const entry = byId.get(lead.lead_id);
    if (!entry) return lead; // 未列入写入计划的行走原对象，保证「数据不变」

    const notes = `${lead.notes}${lead.notes ? " " : ""}${buildReconcileNote(entry, opts.noteDate)}`;
    return {
      ...lead,
      status: entry.action === "promote-to-contacted" ? "Contacted" : lead.status,
      notes,
      updated_at: stamp,
    };
  });
}
