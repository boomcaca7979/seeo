// ===== 访客审计认领：后台触发（不阻塞注册 / 登录跳转）=====
// 背景：注册成功后需要把本 IP 近 24h 内的访客审计转移到新账号（先审计 → 后注册的衔接）。
// 这一步与「用户能不能立刻进入产品」无关，因此**不得**挂在跳转前的等待链上。
//
// 可靠性：使用 fetch keepalive —— router.push 触发的导航不会取消该请求，
// 与 src/lib/analytics/client.ts 的 track() 是同一模式。不引入队列系统。
//
// 约束：失败静默。认领失败绝不影响注册结果、登录结果与页面导航。

/** 从 redirect 目标里取出 domain（仅用于 claim 的精确过滤；取不到则全量认领） */
export function domainFromRedirect(redirectTarget: string | null | undefined): string | undefined {
  const query = redirectTarget?.split("?")[1];
  if (!query) return undefined;
  const domain = new URLSearchParams(query).get("domain");
  return domain && domain.trim() ? domain : undefined;
}

export interface ClaimGuestAuditsOptions {
  /** 当前登录 / 注册页的 redirect 参数（可能带 ?domain=...） */
  redirectTarget?: string | null;
  /** 仅供测试注入；生产使用全局 fetch */
  fetchImpl?: typeof fetch;
}

/**
 * 触发访客审计认领。**同步返回**，调用方不得 await 它来决定是否跳转 ——
 * 返回 void 是刻意的：避免它再被放回等待链。
 */
export function startGuestAuditClaim(options: ClaimGuestAuditsOptions = {}): void {
  const { redirectTarget = null, fetchImpl = fetch } = options;
  const domain = domainFromRedirect(redirectTarget);

  try {
    void fetchImpl("/api/audit/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(domain ? { domain } : {}),
      // 导航后请求仍会完成（与 analytics track 一致）
      keepalive: true,
    }).catch(() => {
      // 认领失败静默：不影响注册 / 登录与导航
    });
  } catch {
    // fetch 同步抛错（极少见）同样静默
  }
}
