// ===== Lead pipeline：状态迁移 / 跟进资格 / suppression / 归因链接 =====
// 规则要点（与 LEAD_MASTER.md 一致）：
//   - 状态只能按 STATUS_TRANSITIONS 前进，非法迁移直接拒绝
//   - Suppressed 是终态：任何自动化都不再触碰
//   - Not Interested / No Response / Replied / Interested / Trial / Activated / Paid 不进普通 cold follow-up
//   - 未记录 specific_issue 不得进入 Contacted（没检查过就不能发）
//   - 归因链接复用 C 阶段的 outbound UTM，不造第二套 tracking

import {
  FOLLOWUP_NEXT_STATUS,
  NEVER_FOLLOWUP_STATUSES,
  STATUS_TRANSITIONS,
  isDateOnly,
  isLeadStatus,
  isLeadType,
  isReplyStatus,
  isTemplateId,
  isTriBool,
  type Lead,
  type LeadStatus,
} from "./schema.ts";
import { normalizeDomain, normalizeEmail } from "./normalize.ts";
import { buildColdAuditUrl } from "../email/templates/cold-outreach.ts";

export interface ValidationIssue {
  field: string;
  message: string;
}

/** 字段级校验（不写库，纯函数） */
export function validateLead(lead: Lead): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (field: string, message: string) => issues.push({ field, message });

  if (!normalizeDomain(lead.website)) push("website", "website 不能为空");
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    push("email", "email 格式不正确（留空表示尚未拿到联系方式）");
  }
  if (!isLeadType(lead.lead_type)) push("lead_type", `lead_type 必须是标准值之一，当前：${lead.lead_type || "(空)"}`);
  if (!isLeadStatus(lead.status)) push("status", `status 必须是标准值之一，当前：${lead.status || "(空)"}`);
  if (!isReplyStatus(lead.reply_status)) push("reply_status", `reply_status 非法：${lead.reply_status}`);
  for (const f of ["interest", "signup", "activation", "paid"] as const) {
    if (!isTriBool(lead[f])) push(f, `${f} 只能为空 / yes / no，当前：${lead[f]}`);
  }
  if (lead.template && !isTemplateId(lead.template)) {
    push("template", `template 必须是 C 阶段已注册的模板 ID，当前：${lead.template}`);
  }
  for (const f of ["first_contacted_at", "last_contacted_at", "next_followup_at", "audit_date"] as const) {
    if (lead[f] && !isDateOnly(lead[f])) push(f, `${f} 必须是 YYYY-MM-DD`);
  }
  return issues;
}

/** 状态迁移是否允许（相同状态视为允许，便于幂等更新） */
export function canTransition(from: string, to: string): boolean {
  if (!isLeadStatus(from) || !isLeadStatus(to)) return false;
  if (from === to) return true;
  return STATUS_TRANSITIONS[from].includes(to);
}

export interface TransitionCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * 检查一次状态更新是否合法 + 业务前置条件。
 * 例：Contacted 要求已记录 specific_issue（没亲眼确认过问题就不能发首封）。
 */
export function checkTransition(lead: Lead, to: string): TransitionCheck {
  const reasons: string[] = [];
  if (!isLeadStatus(to)) return { ok: false, reasons: [`未知状态：${to}`] };
  if (!canTransition(lead.status, to)) {
    reasons.push(`不允许的状态迁移：${lead.status || "(空)"} → ${to}`);
  }
  if (to === "Ready to Contact" && !lead.specific_issue.trim()) {
    reasons.push("进入 Ready to Contact 前必须记录 specific_issue（没有真实问题就不要发）");
  }
  if (to === "Contacted" && !lead.specific_issue.trim()) {
    reasons.push("进入 Contacted 前必须记录 specific_issue");
  }
  if (to === "Contacted" && !lead.template.trim()) {
    reasons.push("进入 Contacted 前应记录使用的模板 template");
  }
  if (lead.status === "Suppressed" && to !== "Suppressed") {
    reasons.push("Suppressed 是终态：被要求停止联系的 Lead 不得再进入任何流程");
  }
  return { ok: reasons.length === 0, reasons };
}

/** 是否已被抑制（永不再联系） */
export function isSuppressed(lead: Lead): boolean {
  return lead.status === "Suppressed";
}

/** 是否应进入 cold follow-up 队列 */
export function isFollowUpEligible(lead: Lead): boolean {
  if (isSuppressed(lead)) return false;
  if (NEVER_FOLLOWUP_STATUSES.includes(lead.status as LeadStatus)) return false;
  // 只有已发首封 / 已发第一次跟进、且序列未走完的 Lead 才需要跟进
  return Object.prototype.hasOwnProperty.call(FOLLOWUP_NEXT_STATUS, lead.status);
}

/** 下一次跟进后应进入的状态（序列走到 Follow-up 2 即结束） */
export function nextFollowUpStatus(lead: Lead): LeadStatus | null {
  if (!isFollowUpEligible(lead)) return null;
  return FOLLOWUP_NEXT_STATUS[lead.status as LeadStatus] ?? null;
}

/**
 * 今天是否该跟进：状态合格 且 next_followup_at 已到期（<= today）。
 * today 显式传入，便于确定性测试。
 */
export function isFollowUpDue(lead: Lead, today: string): boolean {
  if (!isFollowUpEligible(lead)) return false;
  if (!lead.next_followup_at) return false;
  if (!isDateOnly(lead.next_followup_at)) return false;
  return lead.next_followup_at <= today;
}

/** 从 Lead 列表中筛出今天该跟进的 Lead */
export function dueFollowUps(leads: readonly Lead[], today: string): Lead[] {
  return leads.filter((l) => isFollowUpDue(l, today));
}

/**
 * 该 Lead 的审计链接：复用 C 阶段的 outbound UTM
 * （utm_source=email & utm_medium=outbound & utm_campaign=cold_email），
 * 再按模板或 lead_id 补 utm_content —— 不创建第二套 tracking。
 */
export function buildLeadAuditUrl(lead: Lead): string {
  const base = buildColdAuditUrl();
  try {
    const url = new URL(base);
    if (lead.utm_content) url.searchParams.set("utm_content", lead.utm_content);
    else if (lead.template) url.searchParams.set("utm_content", lead.template);
    else if (lead.lead_id) url.searchParams.set("utm_content", lead.lead_id);
    return url.toString();
  } catch {
    return base;
  }
}

/** 按模板回填标准 UTM 内容，保证 E 与 B 归因一致 */
export function fillAttribution(lead: Lead): Lead {
  const next: Lead = { ...lead };
  if (next.template && !next.campaign) next.campaign = "cold_email";
  if (next.template && !next.utm_content) next.utm_content = next.template;
  if (!next.audit_url) next.audit_url = buildLeadAuditUrl(next);
  return next;
}

/** 用于去重的业务键（域名 + 邮箱） */
export function dedupeKeyOf(lead: Lead): string {
  return `${normalizeDomain(lead.website)}|${normalizeEmail(lead.email)}`;
}
