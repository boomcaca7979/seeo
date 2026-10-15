// ===== 审计问题处理状态领域（Action Center 的技术问题来源） =====
//
// 核心原则（SeeO 产品承诺）：
//   1. **检测结果与处理状态完全分离** —— audit_issues 只描述"系统检测到了什么"，
//      本表只描述"用户处理到哪一步"。二者互不覆盖。
//   2. **标记完成 ≠ 已验证解决** —— 用户只能把状态置为 fixed_claimed；
//      `verified_resolved` 只能由服务端在校验流程中写入（再次审计的真实检测证据）。
//   3. 主键是 (user_id, domain, rule_id)：重新审计不重置处理状态，历史可延续、可对比。
//
// 状态机（用户可置位 → 服务端可置位）：
//   open → in_progress → fixed_claimed → verified_resolved
//   open/in_progress/fixed_claimed → dismissed（用户判定不适用）
//   fixed_claimed → fixed_claimed（校验未通过时保持，并记录失败证据）

import { getAdapter } from "./migrations";
import type { DBParam } from "./adapter";

/** 用户可见的处理状态 */
export type IssueResolutionStatus =
  | "open"
  | "in_progress"
  | "fixed_claimed"
  | "verified_resolved"
  | "dismissed";

/** 校验结果（服务端写入）
 *  - pass          本次审计已执行该规则且不再失败 → 可判定"已验证解决"
 *  - fail          本次审计仍检出该问题 → 保持 fixed_claimed
 *  - inconclusive  本次审计未执行该规则（如 quick 深度不跑站点级规则）→ **不下结论**
 */
export type IssueVerifyStatus = "pass" | "fail" | "inconclusive";

export const USER_SETTABLE_STATUSES: readonly IssueResolutionStatus[] = [
  "open",
  "in_progress",
  "fixed_claimed",
  "dismissed",
] as const;

/** 服务端专属状态：客户端不得直接置位（防"自证已解决"） */
export const SERVER_ONLY_STATUSES: readonly IssueResolutionStatus[] = [
  "verified_resolved",
] as const;

export interface IssueResolutionRow {
  id: number;
  user_id: string;
  domain: string;
  rule_id: string;
  status: IssueResolutionStatus;
  note: string | null;
  claimed_at: string | null;
  verified_at: string | null;
  verified_audit_id: number | null;
  verify_status: IssueVerifyStatus | null;
  verify_detail: string | null;
  verify_attempts: number;
  evidence_json: string | null;
  created_at: string;
  updated_at: string;
}

export function isUserSettableStatus(value: string): value is IssueResolutionStatus {
  return (USER_SETTABLE_STATUSES as readonly string[]).includes(value);
}

/** 某个 domain 下的全部处理记录，按 rule_id 建立索引（供审计页/Action Center 合并） */
export async function listResolutionsByDomain(
  userId: string,
  domain: string
): Promise<Map<string, IssueResolutionRow>> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT * FROM audit_issue_resolutions WHERE user_id = ? AND domain = ?`,
    [userId, domain]
  )) as IssueResolutionRow[];
  const map = new Map<string, IssueResolutionRow>();
  for (const r of rows) map.set(r.rule_id, r);
  return map;
}

/** 当前用户的全部处理记录（供总览页做工作区级计数） */
export async function listResolutionsForUser(userId: string): Promise<IssueResolutionRow[]> {
  const db = await getAdapter();
  return (await db.query(
    `SELECT * FROM audit_issue_resolutions WHERE user_id = ?`,
    [userId]
  )) as IssueResolutionRow[];
}

/**
 * 用户置位处理状态。**拒绝 verified_resolved**（只有校验流程可以写入）。
 * @returns 是否写入成功；非法状态返回 { ok:false, reason }
 */
export async function setUserResolutionStatus(
  userId: string,
  domain: string,
  ruleId: string,
  status: IssueResolutionStatus,
  note?: string | null
): Promise<{ ok: boolean; reason?: string }> {
  if (!isUserSettableStatus(status)) {
    return { ok: false, reason: "status_not_user_settable" };
  }
  const db = await getAdapter();
  // claimed_at 只在首次进入 fixed_claimed 时写入（保留第一次声称修复的时间）
  const claimedAt = status === "fixed_claimed" ? new Date().toISOString() : null;
  await db.run(
    `INSERT INTO audit_issue_resolutions (user_id, domain, rule_id, status, note, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, domain, rule_id) DO UPDATE SET
       status = excluded.status,
       note = COALESCE(excluded.note, audit_issue_resolutions.note),
       claimed_at = COALESCE(excluded.claimed_at, audit_issue_resolutions.claimed_at),
       updated_at = datetime('now')`,
    [userId, domain, ruleId, status, note ?? null, claimedAt]
  );
  return { ok: true };
}

/**
 * 校验结果写入（服务端专属）。只有这里能把状态推进到 verified_resolved。
 *   pass          → verified_resolved（并记录 verified_at / verified_audit_id）
 *   fail          → 保持 fixed_claimed，记录失败证据与检出数字
 *   inconclusive  → **不改变处理状态**，只记录"本次审计未执行该规则"，避免误判已解决
 */
export async function recordResolutionVerification(
  userId: string,
  domain: string,
  ruleId: string,
  result: {
    status: IssueVerifyStatus;
    auditId: number;
    detail: string;
  }
): Promise<void> {
  const db = await getAdapter();
  const passed = result.status === "pass";
  const finalStatus: IssueResolutionStatus = passed ? "verified_resolved" : "fixed_claimed";
  // inconclusive 时保持原状态：先用当前状态兜底（行必然存在，因为只有已有记录才校验）
  const nextStatusExpr = result.status === "inconclusive" ? "status" : "?";
  const params: DBParam[] = [];
  if (result.status !== "inconclusive") params.push(finalStatus);
  params.push(
    result.status,
    result.detail,
    result.auditId,
    passed ? 1 : 0,
    userId,
    domain,
    ruleId
  );
  await db.run(
    `UPDATE audit_issue_resolutions SET
       status = ${nextStatusExpr},
       verify_status = ?,
       verify_detail = ?,
       verified_audit_id = ?,
       verified_at = CASE WHEN ? = 1 THEN datetime('now') ELSE verified_at END,
       verify_attempts = verify_attempts + 1,
       updated_at = datetime('now')
     WHERE user_id = ? AND domain = ? AND rule_id = ?`,
    params
  );
}

/** 记录证据快照（检测证据，便于审计页与 Action Center 展示同源证据） */
export async function saveResolutionEvidence(
  userId: string,
  domain: string,
  ruleId: string,
  evidence: unknown
): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE audit_issue_resolutions SET evidence_json = ?, updated_at = datetime('now')
     WHERE user_id = ? AND domain = ? AND rule_id = ?`,
    [JSON.stringify(evidence), userId, domain, ruleId]
  );
}
