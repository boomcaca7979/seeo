// ===== I｜用户案例基地：数据模型 =====
// 定位：把「真实用户 → 真实问题 → 使用 SeeO → 真实修改 → 真实结果」沉淀为可复用资产。
//
// 最重要的三条纪律（有测试强制）：
//   1. 真实数据规则：任何数字（分数 / 排名 / 流量 / 点击 / 收录 / 转化 / 节省时间）
//      必须有真实来源与 evidence_location；没有就不填，**不许估算冒充真实**（§4/§16）。
//   2. 同意模型：没有明确同意，默认不得公开身份（§6）。
//   3. 不许编造：没有真实案例时，Case Master 允许为 0 条（§19）。

export const CASE_STATUSES = [
  "Lead",
  "Consent Pending",
  "Evidence Pending",
  "Draft",
  "Review",
  "Approved",
  "Published",
  "Archived",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** 案例来源（必须写明是「谁提供的」这一类事实，不得写「某客户」） */
export const CASE_SOURCES = [
  "User Provided",
  "SeeO Audit",
  "GSC",
  "Product Analytics",
  "Public Data",
  "Public Review",
] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

/** 证据类型（§5）。Approved 必须至少有一条有效证据。 */
export const EVIDENCE_TYPES = [
  "Audit",
  "GSC",
  "Analytics",
  "User Screenshot",
  "User Quote",
  "Before/After",
  "Public Data",
  "Other",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** 案例类型（§9，刻意保持少量） */
export const CASE_TYPES = [
  "Technical SEO",
  "Content SEO",
  "Keyword Research",
  "Rank Tracking",
  "Competitor SEO",
  "Site Audit",
  "Indexing",
  "Internal Linking",
  "Other",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** 复用渠道（§12）：同一份 Case 可派生到这些渠道，但不复制成多份案例库 */
export const CASE_CHANNELS = [
  "website",
  "email",
  "reddit",
  "indie_hackers",
  "linkedin",
  "x",
  "product_hunt",
  "sales_outreach",
] as const;
export type CaseChannel = (typeof CASE_CHANNELS)[number];

/** 三态：空 = 尚未取得（默认视为未同意，不得公开） */
export type TriConsent = "" | "yes" | "no";

/**
 * Case Master 列顺序（唯一 schema）。
 * 注意：**不含**姓名 / 邮箱 / 电话 / 职位等联系信息 —— 那是 E（Lead Master）的职责。
 */
export const CASE_FIELDS = [
  "case_id",
  "status",
  "source",
  "subject_type",
  // 公开身份相关
  "website",
  "industry",
  "anonymize_required",
  "site_consent",
  "logo_consent",
  "quote_consent",
  // 叙事
  "challenge",
  "initial_state",
  "seeo_used",
  "actions_taken",
  "result",
  "result_period",
  // before / after（§10）：有数字填数字，没数字填 issue 描述
  "metric",
  "before_value",
  "after_value",
  "before_issue",
  "after_issue",
  // 证据
  "evidence_type",
  "evidence_location",
  // 引用（§11）
  "quote",
  "quote_original",
  "quote_edited",
  // 发布与复用
  "published",
  "channels",
  "related_content",
  "related_seo_page",
  "community_posts",
  "notes",
] as const;
export type CaseField = (typeof CASE_FIELDS)[number];
export type CaseRecord = Record<CaseField, string>;

export const LIST_SEPARATOR = " | ";

export function splitList(v: string): string[] {
  return (v ?? "")
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function joinList(items: readonly string[]): string {
  return items.map((s) => s.trim()).join(LIST_SEPARATOR);
}

export function emptyCase(): CaseRecord {
  const out = {} as CaseRecord;
  for (const f of CASE_FIELDS) out[f] = "";
  return out;
}

export function isCaseStatus(v: string): v is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(v);
}
export function isCaseSource(v: string): v is CaseSource {
  return (CASE_SOURCES as readonly string[]).includes(v);
}
export function isEvidenceType(v: string): v is EvidenceType {
  return (EVIDENCE_TYPES as readonly string[]).includes(v);
}
export function isCaseType(v: string): v is CaseType {
  return (CASE_TYPES as readonly string[]).includes(v);
}
export function isCaseChannel(v: string): v is CaseChannel {
  return (CASE_CHANNELS as readonly string[]).includes(v);
}
export function isTriConsent(v: string): v is TriConsent {
  return v === "" || v === "yes" || v === "no";
}
export function isYesNo(v: string): v is "" | "yes" | "no" {
  return v === "" || v === "yes" || v === "no";
}

/** 能支撑「数字型结果」的证据类型（其余类型不得承载数字） */
export const NUMERIC_EVIDENCE_TYPES: readonly EvidenceType[] = [
  "Audit",
  "GSC",
  "Analytics",
  "User Screenshot",
  "Before/After",
  "Public Data",
];

/** 进入 Approved 所需的最低状态（必须先有证据与明确同意） */
export const APPROVAL_REQUIRED_STATUS = "Review";

/** 明确标记「本次没有可量化结果」的写法（避免把无结果写成成功案例） */
export const NO_RESULT_MARKERS: readonly string[] = ["no-result", "no result", "无结果", "未产生可量化结果", "audit example"];

/** 禁止出现的无证据宣传话术（与 G 保持同一红线） */
export const BANNED_CLAIM_PHRASES: readonly string[] = [
  "best seo tool",
  "#1",
  "number one",
  "revolutionary",
  "guaranteed",
  "10x traffic",
  "十倍流量",
  "保证排名",
  "效果保证",
];

/** 禁止出现在案例库里的个人身份信息（属于 E 的职责） */
export const FORBIDDEN_PII_PATTERNS: readonly { re: RegExp; why: string }[] = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, why: "不得存放邮箱" },
  { re: /(?:\+?86[-\s]?)?1[3-9]\d{9}/, why: "不得存放手机号" },
  { re: /(api[_-]?key|token|secret|password)\s*[:=]/i, why: "不得存放凭据" },
];
