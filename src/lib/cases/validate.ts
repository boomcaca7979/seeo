// ===== I｜Case 校验：真实数据 / 证据 / 同意 / 匿名 =====
// 纯函数。所有门槛集中在这里，测试与 CLI 共用。
//
// 设计要点：
//   - 「有数字」与「有证据」必须同时成立；数字没有证据 → 拒绝（不许估算冒充真实）
//   - Approved / Published 有硬门槛，缺一项就拦下来
//   - 没有明确同意 → 不得带可识别身份（网站/公司标识）
//   - 任何联系信息（邮箱/手机/凭据）一律拒绝 —— 那是 E 的字段，不进案例库

import {
  APPROVAL_REQUIRED_STATUS,
  BANNED_CLAIM_PHRASES,
  FORBIDDEN_PII_PATTERNS,
  NO_RESULT_MARKERS,
  NUMERIC_EVIDENCE_TYPES,
  isCaseChannel,
  isCaseSource,
  isCaseStatus,
  isCaseType,
  isEvidenceType,
  isYesNo,
  splitList,
  type CaseRecord,
} from "./schema.ts";

export interface CaseIssue {
  field: string;
  message: string;
}

const NARRATIVE_FIELDS = [
  "subject_type",
  "challenge",
  "initial_state",
  "seeo_used",
  "actions_taken",
  "result",
  "metric",
  "before_value",
  "after_value",
  "before_issue",
  "after_issue",
  "evidence_type",
  "evidence_location",
  "quote",
  "quote_original",
  "notes",
] as const;

function allText(c: CaseRecord): string {
  return NARRATIVE_FIELDS.map((f) => c[f] ?? "").join("\n");
}

/** 记录里是否出现了数字型结果（用于真实数据规则） */
export function hasNumericClaims(c: CaseRecord): boolean {
  const numeric = [c.before_value, c.after_value].some((v) => /\d/.test(v ?? ""));
  const inResult = /\d/.test(c.result ?? "");
  return numeric || inResult;
}

/** 是否已明确标记「本次没有可量化结果」 */
export function declaresNoResult(c: CaseRecord): boolean {
  const text = `${c.result}\n${c.before_issue}\n${c.after_issue}\n${c.notes}`.toLowerCase();
  return NO_RESULT_MARKERS.some((m) => text.includes(m.toLowerCase()));
}

export function validateCase(c: CaseRecord): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const push = (field: string, message: string) => issues.push({ field, message });

  // ---- 身份与枚举 ----
  if (!c.case_id.trim()) push("case_id", "case_id 不能为空");
  if (!isCaseStatus(c.status)) push("status", `status 非法：${c.status || "(空)"}`);
  if (c.source && !isCaseSource(c.source)) push("source", `source 非法：${c.source}`);
  if (c.subject_type && !isCaseType(c.subject_type)) {
    push("subject_type", `subject_type 必须是 ${"技术/内容/关键词/排名/竞品/站点/收录/内链/Other"} 之一，当前：${c.subject_type}`);
  }
  for (const f of ["anonymize_required", "site_consent", "logo_consent", "quote_consent", "published"] as const) {
    if (!isYesNo(c[f])) push(f, `${f} 只能为空 / yes / no，当前：${c[f]}`);
  }
  if (c.quote_edited && !isYesNo(c.quote_edited)) {
    push("quote_edited", `quote_edited 只能为空 / yes / no，当前：${c.quote_edited}`);
  }
  if (c.evidence_type && !isEvidenceType(c.evidence_type)) {
    push("evidence_type", `evidence_type 非法：${c.evidence_type}`);
  }
  for (const ch of splitList(c.channels)) {
    if (!isCaseChannel(ch)) push("channels", `未知渠道：${ch}`);
  }

  // ---- 没有真实案例时不得凭空讨论 ----
  if (!c.challenge.trim()) push("challenge", "challenge 不能为空（要写清用户遇到的具体问题）");
  if (!c.seeo_used.trim()) push("seeo_used", "seeo_used 不能为空（用了 SeeO 的哪个真实能力）");

  // ---- 真实数据规则（§4）----
  if (hasNumericClaims(c)) {
    if (!isEvidenceType(c.evidence_type) || !NUMERIC_EVIDENCE_TYPES.includes(c.evidence_type)) {
      push("evidence_type", "出现数字时，evidence_type 必须是可支撑数字的类型（Audit/GSC/Analytics/User Screenshot/Before-After/Public Data）");
    }
    if (!c.evidence_location.trim()) {
      push("evidence_location", "出现数字时必须写明证据位置（截图/报告/数据源链接等）");
    }
  }
  if ((c.metric.trim() || c.before_value.trim() || c.after_value.trim()) && !c.result_period.trim() && !declaresNoResult(c)) {
    push("result_period", "填写了 metric / before / after 时，必须写 result_period（统计周期）");
  }

  // ---- 引用处理（§11）----
  // 有引用时同意状态必须是显式的 yes / no —— 留空代表「还没问过」，不允许
  if (c.quote.trim() && c.quote_consent !== "yes" && c.quote_consent !== "no") {
    push("quote_consent", "有引用时必须明确 quote_consent=yes/no（留空 = 未取得同意，不得公开）");
  }
  if (c.quote_edited === "yes" && !c.quote_original.trim()) {
    push("quote_original", "润色过的引用必须保留原始 quote（quote_original）");
  }
  if (c.quote_edited === "no" && c.quote_original.trim() && c.quote_original.trim() !== c.quote.trim()) {
    push("quote_edited", "quote 与 quote_original 不一致时必须标记 quote_edited=yes");
  }

  // ---- 同意与匿名（§6）----
  if (c.anonymize_required === "yes" && c.website.trim()) {
    push("website", "anonymize_required=yes 时不得记录可识别网站（应留空或写匿名描述如「B2B SaaS website」）");
  }

  // ---- 发布门槛 ----
  const published = c.published === "yes";
  if (published) {
    if (!isEvidenceType(c.evidence_type) || !c.evidence_location.trim()) {
      push("evidence_location", "published=yes 必须有有效证据与证据位置");
    }
    if (c.website.trim() && c.site_consent !== "yes") {
      push("site_consent", "公开可识别网站必须取得 site_consent=yes");
    }
    if (c.quote.trim() && c.quote_consent !== "yes") {
      push("quote_consent", "公开引用必须取得 quote_consent=yes");
    }
    if (c.status !== "Published") {
      push("status", "published=yes 时 status 应为 Published");
    }
  }

  // ---- Approved 门槛（§16）----
  if (c.status === "Approved" || c.status === "Published") {
    if (!isCaseSource(c.source)) push("source", "Approved/Published 必须有真实 source");
    if (!isEvidenceType(c.evidence_type) || !c.evidence_location.trim()) {
      push("evidence_location", "Approved/Published 必须有有效 evidence_type 与 evidence_location");
    }
    if (!c.result.trim() && !declaresNoResult(c)) {
      push("result", "Approved/Published 必须写明 result，或明确标记「无结果」（如 no-result / 未产生可量化结果）");
    }
    if (!c.subject_type.trim()) push("subject_type", "Approved/Published 必须写明案例类型");
  }
  if (c.status === "Evidence Pending" && isEvidenceType(c.evidence_type) && c.evidence_location.trim()) {
    // 证据已补齐却仍停在 Evidence Pending：提示可以推进，但不视为错误
  }
  if (c.status === "Approved" && c.published === "yes") {
    push("status", "已在公开渠道发布时 status 应为 Published，而不是 Approved");
  }
  void APPROVAL_REQUIRED_STATUS;

  // ---- 禁止话术 ----
  const lower = allText(c).toLowerCase();
  for (const p of BANNED_CLAIM_PHRASES) {
    if (lower.includes(p.toLowerCase())) push("result", `命中无证据宣传话术：「${p}」`);
  }

  // ---- 隐私（E 的字段不得进入案例库）----
  const full = [...NARRATIVE_FIELDS.map((f) => c[f] ?? ""), c.website, c.industry, c.quote_original].join("\n");
  for (const { re, why } of FORBIDDEN_PII_PATTERNS) {
    const hit = full.match(re);
    if (hit) push("notes", `案例库${why}：${hit[0].slice(0, 24)}…（联系信息属于 E 的 Lead Master）`);
  }

  return issues;
}

/** 重复 case_id */
export function findDuplicateCaseIds(cases: readonly CaseRecord[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of cases) {
    const id = c.case_id.trim();
    if (!id) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}
