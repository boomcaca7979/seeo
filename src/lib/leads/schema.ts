// ===== E｜潜客数据库（Lead Master）数据模型 =====
// 设计原则：
//   - 免费、无 CRM SaaS、无 CRM UI、无公开 URL —— 主库就是一个 CSV，可直接用表格软件打开
//   - 状态与类型必须标准化，禁止每天自由发挥写法
//   - specific_issue 必须是「亲眼确认过的」真实问题；未填不得进入 Contacted
//   - 模板 ID 单一事实来源：直接复用 C 阶段 cold-outreach 注册表，不在 E 再造一套
//
// 隐私：本模块只被服务端/脚本使用；不得被任何客户端组件或公开页面引用
//（由 src/lib/leads/leads.test.ts 的访问控制守卫测试强制）。

import { COLD_EMAIL_TEMPLATES } from "../email/templates/cold-outreach.ts";

/** Lead 类型（标准化，禁止自由填写） */
export const LEAD_TYPES = [
  "SaaS",
  "Agency",
  "SEO Freelancer",
  "Blog",
  "Affiliate",
  "Ecommerce",
  "Content Site",
  "Startup",
  "Other",
] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

/** Lead 状态（标准化）。含义在 LEAD_MASTER.md 中逐条写明 */
export const LEAD_STATUSES = [
  "New",
  "Researching",
  "Ready to Contact",
  "Contacted",
  "Follow-up 1",
  "Follow-up 2",
  "Replied",
  "Interested",
  "Trial",
  "Activated",
  "Paid",
  "Not Interested",
  "No Response",
  "Suppressed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** 回复状态（小枚举，避免自由文本） */
export const REPLY_STATUSES = ["", "no_reply", "replied", "auto_reply", "bounced"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

/** 三态布尔："" = 未知，yes / no */
export type TriBool = "" | "yes" | "no";

/** 邮件模板：直接取 C 阶段注册表，E 不再维护第二份 */
export const LEAD_TEMPLATE_IDS = COLD_EMAIL_TEMPLATES.map((t) => t.id) as string[];

/** CSV 列顺序（Lead Master 的唯一 schema） */
export const LEAD_FIELDS = [
  // identity
  "lead_id",
  "website",
  "company",
  "contact_name",
  "email",
  "role",
  // classification
  "lead_type",
  "company_size",
  "industry",
  // seo
  "specific_issue",
  "issue_type",
  "audit_url",
  "audit_date",
  // marketing
  "source",
  "campaign",
  "template",
  "utm_content",
  // pipeline
  "status",
  "reply_status",
  "interest",
  "signup",
  "activation",
  "paid",
  "first_contacted_at",
  "last_contacted_at",
  "next_followup_at",
  // notes
  "last_action",
  "next_action",
  "notes",
  "created_at",
  "updated_at",
] as const;

export type LeadField = (typeof LEAD_FIELDS)[number];

export type Lead = Record<LeadField, string>;

/** 允许的状态迁移（有向图）。未列出的迁移一律拒绝 */
export const STATUS_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  New: ["Researching", "Ready to Contact", "Not Interested", "Suppressed"],
  Researching: ["Ready to Contact", "New", "Not Interested", "Suppressed"],
  "Ready to Contact": ["Contacted", "New", "Not Interested", "Suppressed"],
  Contacted: ["Follow-up 1", "Replied", "Not Interested", "No Response", "Suppressed"],
  "Follow-up 1": ["Follow-up 2", "Replied", "Not Interested", "No Response", "Suppressed"],
  "Follow-up 2": ["Replied", "Not Interested", "No Response", "Suppressed"],
  Replied: ["Interested", "Not Interested", "No Response", "Suppressed"],
  Interested: ["Trial", "Not Interested", "No Response", "Suppressed"],
  Trial: ["Activated", "Not Interested", "No Response", "Suppressed"],
  Activated: ["Paid", "Not Interested", "No Response", "Suppressed"],
  Paid: ["Suppressed"],
  "Not Interested": ["Suppressed"],
  "No Response": ["Ready to Contact", "Suppressed"],
  // Suppressed 是终态：一旦被要求不再联系，任何自动化都不得再碰
  Suppressed: [],
};

/** 永不进入 cold follow-up 队列的状态 */
export const NEVER_FOLLOWUP_STATUSES: readonly LeadStatus[] = [
  "New",
  "Researching",
  "Ready to Contact",
  "Replied",
  "Interested",
  "Trial",
  "Activated",
  "Paid",
  "Not Interested",
  "No Response",
  "Suppressed",
];

/** 会产生 cold follow-up 的状态 → 下一次跟进后应进入的状态 */
export const FOLLOWUP_NEXT_STATUS: Partial<Record<LeadStatus, LeadStatus>> = {
  Contacted: "Follow-up 1",
  "Follow-up 1": "Follow-up 2",
};

/**
 * 「已经发生过 outbound contact」及之后的状态集合。
 *
 * 用法（历史对账 / 守卫）：状态已经落在这个集合里，说明库里已经记录了这次触达；
 * 对账（`backfill-contacted`）不得把这些行降级或改写。
 * 注意 `Not Interested` / `No Response` **不在**此集合：它们可以由未发信的分支直接到达
 * （`New → Not Interested` 是合法迁移），因此不能当作「已发过邮件」的证据。
 */
export const CONTACTED_OR_LATER_STATUSES: readonly LeadStatus[] = [
  "Contacted",
  "Follow-up 1",
  "Follow-up 2",
  "Replied",
  "Interested",
  "Trial",
  "Activated",
  "Paid",
];

/**
 * 唯一被允许进入 `Contacted` 的路径（状态机口径）。
 * 历史遗留的批量写入属于已被登记的豁免，**不得**再用它作为新代码的理由。
 */
export const CONTACTED_ENTRY_PATH: readonly LeadStatus[] = ["New", "Ready to Contact", "Contacted"];

/** 用户主动要求停止联系时写入的状态 */
export const SUPPRESSED_STATUS: LeadStatus = "Suppressed";

export function isLeadStatus(v: string): v is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(v);
}

/** 状态是否已经是「已触达或更靠后」（对账时不得改写这些行） */
export function isContactedOrLater(v: string): boolean {
  return (CONTACTED_OR_LATER_STATUSES as readonly string[]).includes(v);
}

export function isLeadType(v: string): v is LeadType {
  return (LEAD_TYPES as readonly string[]).includes(v);
}

export function isTemplateId(v: string): boolean {
  return LEAD_TEMPLATE_IDS.includes(v);
}

export function isTriBool(v: string): v is TriBool {
  return v === "" || v === "yes" || v === "no";
}

export function isReplyStatus(v: string): v is ReplyStatus {
  return (REPLY_STATUSES as readonly string[]).includes(v);
}

/** 日期字段统一 YYYY-MM-DD；created_at/updated_at 用完整 ISO 时间戳 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

export function emptyLead(): Lead {
  const out = {} as Lead;
  for (const f of LEAD_FIELDS) out[f] = "";
  return out;
}
