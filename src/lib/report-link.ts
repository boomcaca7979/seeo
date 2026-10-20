// ===== 打印版审计报告链接构建（client-safe，纯函数）=====
// BUG-07：报告中心的「浏览器打印版报告」入口必须携带「当前项目」域名，
// 而当前项目是异步确认的。这里把「确认」与「拼链接」两步收敛成纯函数，
// 保证未确认项目时不会把过期或猜测的域名写进 URL。

/** 审计报告页路径（也是未确认项目时的降级链接：由报告页按既有契约处理） */
export const AUDIT_REPORT_PATH = "/app/reports/audit";

/** /api/projects 结果中链接构建需要的字段 */
export interface ProjectDomainRef {
  id: string;
  domain: string;
}

/**
 * 按项目 id 在项目列表中命中域名。
 * 未命中（id 为空、列表缺项、域名空白）一律返回 null——绝不回退列表第一个项目，
 * 也不使用任何默认域名，避免把上一个项目的残留写进报告链接。
 */
export function resolveProjectDomain(
  projects: ProjectDomainRef[] | null | undefined,
  projectId: string | null
): string | null {
  if (!projectId) return null;
  const hit = (projects ?? []).find((p) => p.id === projectId);
  const domain = hit?.domain?.trim();
  return domain ? domain : null;
}

/**
 * 构建打印版报告入口链接：仅在域名已确认时追加 `?domain=`（URL 编码）。
 * 域名未确认返回无参数链接，交给报告页的「URL > localStorage > 空状态」既有优先级。
 */
export function buildAuditReportHref(domain: string | null): string {
  const trimmed = domain?.trim();
  if (!trimmed) return AUDIT_REPORT_PATH;
  return `${AUDIT_REPORT_PATH}?domain=${encodeURIComponent(trimmed)}`;
}

/** 报表中心的四类报表 */
export type ScopedReportType = "ranking" | "audit" | "content" | "weekly";

/**
 * 哪些报表必须按「当前项目」取数。
 * 内容报表的身份是被检测的那条 URL（与项目域名无关），其余三类都按项目域名聚合，
 * 因此只有它们需要已确认的域名，缺域名时应禁用生成而不是伪造一个项目。
 */
export function reportNeedsProject(type: ScopedReportType): boolean {
  return type !== "content";
}
