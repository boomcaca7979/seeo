// ===== 审计完成后的自动机会扫描（fire-and-forget）=====
//
// 目的：修复"机会引擎对新用户实际关闭"的产品断点——
// 旧动线：注册 → 审计 → 看到 issue list（机会要手动去 /app/opportunities 点扫描）。
// 新动线：真实审计完成且产生有效快照后，**复用现有 scanner** 自动生成机会，
//         用户回到 /app 即可直接看到有证据的 Search Growth Opportunities。
//
// 硬约束：
//   - 复用 scanOpportunities，不新增 scanner、不改 scanner 规则、不加付费 API；
//   - 无数据时 scanner 正常返回 data gaps（不伪造机会）；
//   - **任何失败都不能影响审计结果**：本函数吞掉一切异常（graceful failure）；
//   - 只处理登录用户（游客审计按 IP 归属，无项目可挂机会）。

import { getProjectByDomain } from "@/lib/db";
import { scanOpportunities } from "./opportunity-service";
import type { PlanTier } from "@/lib/auth";

export async function autoScanOpportunitiesAfterAudit(
  userId: string,
  plan: PlanTier,
  domain: string
): Promise<void> {
  try {
    const project = await getProjectByDomain(userId, domain);
    if (!project?.id) return; // 域名未建项目 → 无处挂机会，静默跳过（不是错误）
    await scanOpportunities(userId, plan, Number(project.id), { includeCtr: true });
  } catch (err) {
    // 扫描失败绝不让审计失败；只记日志，用户下次审计/手动扫描仍可补齐
    console.error(`[opportunity auto-scan] ${domain} failed (audit result unaffected):`, err);
  }
}
