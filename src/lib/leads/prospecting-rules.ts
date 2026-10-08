// ===== E｜潜客获取规则：只允许官网公开邮箱 + 候选池来源 + 发送硬门槛 =====
//
// 为什么要有这一份
// ----------------
// 2026-10-08 的全量发件核查发现，2026-09-29 批次里至少有 2 封是**凭空构造**的地址
// （`info@` + 域名模式）—— 对方站点上完全没有公开邮箱（只有 web form）。
// 这与 `src/lib/email/templates/cold-outreach.ts` 开头自己写下的边界
// 「不买名单、不爬邮箱：一次一封，面向真实收集到的联系人」直接冲突。
//
// 所以把「邮箱必须来自官网公开显示」从口头约定升级成**机器可读规则 + 医生自检**：
// 规则只写一处，文档与 CLI 都引用这里（`OPERATING_SYSTEM.md` / `LEAD_MASTER.md`）。
//
// 纪律：本模块**纯函数、零网络、零 import 副作用**。

import type { Lead } from "./schema.ts";
import { EMAIL_FROM_DEFAULT } from "../email/config.ts";

/**
 * Outreach 使用的发件人。显示名是 `SeeO Team`（2026-09-29 批次实际使用的发件人），
 * 地址则**取自 C 阶段唯一配置** `EMAIL_FROM_DEFAULT` —— 不在这里重复写一遍地址，避免两处漂移。
 */
export const OUTREACH_SENDER = `SeeO Team <${EMAIL_FROM_DEFAULT.replace(/^[^<]*</, "").replace(/>$/, "")}>`;

/** 规则一句话（文档与 CLI 共用同一句，避免两处措辞漂移） */
export const PUBLIC_EMAIL_RULE =
  "只能发送到「对方官网真实公开显示」的邮箱；地址本身没在公开网页上出现，就不得发送。";

/** 允许的来源（必须是「公开可核验」的） */
export const ALLOWED_EMAIL_EVIDENCE_SOURCES: readonly string[] = [
  "官网公开的 mailto: 链接",
  "官网 Contact / About / Support 页面明确显示的邮箱",
  "官网公开的企业联系人信息（含 Imprint / Legal notice）",
];

/** 禁止的来源（构造 / 购买 / 抓取 / 推测） */
export const FORBIDDEN_EMAIL_SOURCES: readonly string[] = [
  "按域名模式推测（info@domain、hello@domain、sales@domain …）",
  "根据域名或公司名猜测联系人姓名生成邮箱",
  "第三方邮箱数据库 / 买名单",
  "爬取邮箱（scrape / harvest）",
  "任何未在公开网页上真实显示过的地址",
];

/**
 * 「通用角色邮箱」前缀。**不是禁止这些地址** —— 而是说：
 * 一旦用了这些前缀，就必须能拿出「它在公开网页上真的显示过」的证据。
 * 官网自己把 info@ 印在 Contact 页上，完全合规。
 */
export const GENERIC_EMAIL_LOCALPARTS: readonly string[] = [
  "info",
  "hello",
  "sales",
  "contact",
  "support",
  "hi",
  "team",
  "help",
  "admin",
  "mail",
  "office",
  "enquiries",
  "inquiries",
];

/**
 * `notes` 里记录「该邮箱在哪个公开页面可见」的标记。
 * 格式：`public-email:<url>`（此标记是机器判定「公开来源」的唯一依据 —— 无证据即视为猜测）
 */
export const PUBLIC_EMAIL_EVIDENCE_PATTERN = /public-email:\s*(\S+)/i;

/** 从 notes 里取出所有公开来源证据 URL */
export function publicEmailEvidence(notes: string): string[] {
  const re = new RegExp(PUBLIC_EMAIL_EVIDENCE_PATTERN.source, "gi");
  const out: string[] = [];
  for (const m of notes.matchAll(re)) out.push(m[1]);
  return out;
}

/** 邮箱前缀是否是通用角色前缀 */
export function isGenericEmail(email: string): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return false;
  return (GENERIC_EMAIL_LOCALPARTS as readonly string[]).includes(e.slice(0, at));
}

/** `notes` 里是否已记录了公开来源证据 */
export function hasPublicEmailEvidence(lead: Lead): boolean {
  return publicEmailEvidence(lead.notes).length > 0;
}

/**
 * 规则对哪些行生效。
 * - 发送前状态（New / Researching / Ready to Contact）：**始终**生效（它们就是下一批要发的）
 * - 已触达状态：只有在生效日（含）之后才生效；此前的是历史遗留，不追溯判红
 */
export const PUBLIC_EMAIL_RULE_EFFECTIVE_FROM = "2026-10-09";
export const PRE_SEND_STATUSES: readonly string[] = ["New", "Researching", "Ready to Contact"];

export interface LeadRuleIssue {
  lead_id: string;
  website: string;
  field: "website" | "email" | "source" | "notes";
  message: string;
}

/** 单条 Lead 是否满足「公开邮箱」规则 */
export function checkPublicEmailRule(lead: Lead): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const email = (lead.email ?? "").trim();

  // 没邮箱 → 不是违规，只是还没准备好发（但也不能进 Ready to Contact）
  if (!email) return { ok: true, reasons: [] };

  // ⚠️ 通用角色前缀（info@ / hello@ / sales@ …）**本身不违规** ——
  // 官网把 info@ 印在 Contact 页上，是完全合规的允许来源（见 ALLOWED_EMAIL_EVIDENCE_SOURCES）。
  // 因此这里只在「拿不出公开来源证据」时才把通用前缀作为**补充说明**，
  // 绝不单独因为前缀是 info@ 就判红（那会把官网公开的邮箱也一起拦掉）。
  if (!hasPublicEmailEvidence(lead)) {
    reasons.push(
      `email 已填写但 notes 里没有公开来源证据。必须记录 \`public-email:<url>\`（该地址在官网哪一个公开页面真实显示过）；` +
        `${PUBLIC_EMAIL_RULE}`
    );
    if (isGenericEmail(email)) {
      reasons.push(
        `email 使用通用角色前缀（${email.split("@")[0]}@…）且没有公开来源证据 —— ` +
          `禁止由域名模式推测（${FORBIDDEN_EMAIL_SOURCES[0]}）`
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export interface PublicEmailAudit {
  /** 本次纳入检查的行数 */
  checked: number;
  /** 历史豁免（生效日之前已触达）的行数 */
  grandfathered: number;
  issues: LeadRuleIssue[];
}

/** 批量自检：只判「即将发送」与「规则生效日之后已发送」的行 */
export function auditPublicEmailRule(leads: readonly Lead[]): PublicEmailAudit {
  const issues: LeadRuleIssue[] = [];
  let checked = 0;
  let grandfathered = 0;

  for (const lead of leads) {
    const isPreSend = PRE_SEND_STATUSES.includes(lead.status);
    const isHistoricalContact = !isPreSend && (lead.first_contacted_at || "") < PUBLIC_EMAIL_RULE_EFFECTIVE_FROM;

    if (!isPreSend && isHistoricalContact) {
      grandfathered++;
      continue;
    }
    // 没邮箱且还没发送 → 不判红（属于「待补联系方式」的正常状态）
    if (!(lead.email ?? "").trim() && isPreSend) continue;

    checked++;
    const r = checkPublicEmailRule(lead);
    for (const m of r.reasons) {
      issues.push({ lead_id: lead.lead_id, website: lead.website, field: "email", message: m });
    }
  }

  return { checked, grandfathered, issues };
}

// ---------- 投诉处理 ----------

/**
 * 投诉标记。`complained`（收件人把邮件标成垃圾邮件）等同于「明确拒绝」：
 * 必须立即 `Suppressed` 并永久排除出一切队列（follow-up / due / candidate 查询）。
 */
export const COMPLAINT_NOTE_MARKER = "[complaint]";

/** 投诉压制时写入 notes 的标准句子（不可改写，审计要能精确匹配） */
export const COMPLAINT_SUPPRESSION_NOTE =
  "[complaint] Recipient marked message as spam; permanently suppress future outreach.";

/** 该 Lead 是否被标记过投诉 */
export function isComplaintSuppressed(lead: Lead): boolean {
  return lead.notes.includes(COMPLAINT_NOTE_MARKER) && lead.status === "Suppressed";
}

// ---------- 候选池来源 ----------

/**
 * 候选公司来源的强制前缀。用户要求：目录只负责「发现公司」，不负责提供邮箱，
 * 且 source 必须可追溯，例如 `public-directory:awesome-selfhosted`。
 */
export const CANDIDATE_SOURCE_PREFIX = "public-directory:";

/** 该 source 是否是合规的「公开目录」来源 */
export function isPublicDirectorySource(source: string): boolean {
  return (source ?? "").trim().toLowerCase().startsWith(CANDIDATE_SOURCE_PREFIX);
}

/** 候选公司进入 `Ready to Contact` 之前必须逐项通过的核验 */
export const CANDIDATE_VERIFICATION_STEPS: readonly string[] = [
  "website：官网可访问，且确实是对方的站点（不是同名/被抢注域）",
  "public email：官网**公开显示**的邮箱，并记下 public-email:<url> 证据（禁止任何推测）",
  "specific SEO issue：亲眼确认的具体问题（不是泛泛而谈）",
  "issue evidence：把证据（URL + 实测结论）写进 notes",
  "sitemap verification：按 SITEMAP_VERIFICATION_STEPS 走完，禁止用 /sitemap.xml 404 断言无 sitemap",
  "dedupe against Lead Master：域名与邮箱都不得与主库已有行冲突",
  "dedupe against authoritative Resend send history：域名与收件地址都不得出现在 send-ledger.csv",
];

/** 恢复发送前必须全部达成的硬门槛 */
export const DAY2_SEND_GATES: readonly { id: string; requirement: string }[] = [
  { id: "dedupe", requirement: "Lead Master + Resend ledger dedupe = PASS" },
  { id: "complaint", requirement: "Complaint suppression = PASS（投诉方已 Suppressed，且不进入任何队列）" },
  { id: "public-email", requirement: "Public-email-only rule = PASS（无证据不发）" },
  { id: "sitemap", requirement: "Sitemap verification = PASS（按 6 步走完）" },
  { id: "issue-evidence", requirement: "Specific issue evidence = PASS（每条都有实测证据）" },
];

/** 每封新邮件必须满足的形式要求（人工项，doctor 只能提示） */
export const DAY2_SEND_CHECKLIST: readonly string[] = [
  "一次一封（不群发、不抄送、不密送）",
  "真实公开邮箱（见 PUBLIC_EMAIL_RULE）",
  "个性化具体问题（引用对方的真实问题，不是模板空话）",
  `使用既有 sender：${OUTREACH_SENDER}`,
  "保留退订机制 / List-Unsubscribe 头",
  "发送后立即把真实 recipient 与 Resend message id 记入 Lead Master 与 send-ledger.csv",
];
