// ===== 审计问题「再次检测验证」服务 =====
//
// 产品承诺：用户标记"已修复"只是声称；**只有重新审计的真实检测结果**才能把它推进到
// "已验证解决"。本模块在每次审计完成后运行，把 fixed_claimed 的记录与本次快照比对：
//
//   规则本次执行且不再失败 → pass          → verified_resolved
//   规则本次仍失败         → fail          → 保持 fixed_claimed（附检出数字）
//   规则本次未执行         → inconclusive  → 不改状态（"没检测"不等于"已解决"）
//
// 失败绝不影响审计本身（fire-and-forget，全部 try/catch）。

import type { DashboardSnapshot } from "./audit-dashboard";
import { evaluateRuleVerification } from "./work-queue";
import {
  listResolutionsByDomain,
  recordResolutionVerification,
  saveResolutionEvidence,
} from "@/lib/db/issue-resolutions";

export interface ReverifySummary {
  evaluated: number;
  verified: number;
  stillFailing: number;
  inconclusive: number;
}

export const EMPTY_REVERIFY_SUMMARY: ReverifySummary = {
  evaluated: 0,
  verified: 0,
  stillFailing: 0,
  inconclusive: 0,
};

/**
 * 用本次审计结果校验所有 fixed_claimed 的问题。
 * @param snapshot 本次审计的 Dashboard 快照（规则级 status / findings / affectedPages）
 */
export async function reverifyClaimedIssues(
  userId: string,
  domain: string,
  auditId: number,
  snapshot: DashboardSnapshot
): Promise<ReverifySummary> {
  const summary: ReverifySummary = { ...EMPTY_REVERIFY_SUMMARY };
  const resolutions = await listResolutionsByDomain(userId, domain);
  if (resolutions.size === 0) return summary;

  const ruleById = new Map(snapshot.rules.map((r) => [r.ruleId, r]));

  for (const [ruleId, row] of resolutions) {
    const rule = ruleById.get(ruleId) ?? null;

    // 证据刷新：把最新检测证据写回，供审计页与 Action Center 同源展示
    if (rule) {
      await saveResolutionEvidence(userId, domain, ruleId, {
        auditId,
        findings: rule.findings,
        affectedPages: rule.affectedPages,
        sampleUrl: rule.sampleUrl,
        severity: rule.severity,
        capturedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }

    // 只校验"用户已声称修复"的记录；open/in_progress/dismissed/已验证 不重复校验
    if (row.status !== "fixed_claimed") continue;

    const outcome = evaluateRuleVerification({
      currentStatus: rule ? rule.status : null,
      findings: rule?.findings ?? 0,
      affectedPages: rule?.affectedPages ?? 0,
      auditId,
    });

    await recordResolutionVerification(userId, domain, ruleId, {
      status: outcome.status,
      auditId,
      detail: JSON.stringify({
        auditId,
        depth: snapshot.depth,
        findings: outcome.findings,
        affectedPages: outcome.affectedPages,
      }),
    });

    summary.evaluated++;
    if (outcome.status === "pass") summary.verified++;
    else if (outcome.status === "fail") summary.stillFailing++;
    else summary.inconclusive++;
  }

  return summary;
}
