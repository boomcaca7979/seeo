// ===== 营销同意策略（合规护栏）=====
//
// 背景（2026-10-09 审计）
// ----------------------
// - `email_preferences` 原本只有退订字段（`marketing_unsubscribed_at`），**没有 opt-in**；
//   全部 7 个 lifecycle 模板都是 `category: "marketing"`，即「只要没退订就一直发」的 opt-out 模型。
// - 生产 30 个注册用户里**没有任何可核验的营销同意记录**，但 lifecycle 仍在自动发送。
// - 结论：把「未退订」当作同意是错的。**营销邮件必须有可核验的显式同意**才允许发送。
//
// 本模块只放**策略常量与判定**（纯函数 / 零网络 / 零副作用），真正的 DB 读取在
// `preferences.ts`（`getMarketingConsent`），发送收口在 `service.ts`。
//
// 两层防线（缺一不可）
// -------------------
// 1) `MARKETING_SEND_HOLD`：**运营级总闸**，暂停一切自动营销发送（lifecycle sweep / welcome）。
//    置位 / 复位**只能由 owner 显式操作**（与 `OUTREACH_SEND_HOLD` 同一纪律）。
// 2) `getMarketingConsent()`：**逐用户同意校验**，在发送收口 `service.ts` 强制执行。
//    这一层不依赖总闸，即使总闸被放开，没有同意的用户依然发不出去。

/**
 * 营销发送总闸。`active: true` 时：
 *   - `runLifecycleEmailSweep()` 直接停下（不枚举、不发送）；
 *   - `sendWelcomeEmail()` 直接变为 no-op；
 *   - `sendTemplateEmail()` 对 `category: "marketing"` 的模板直接返回 `skipped_marketing_hold`。
 *
 * 事务性邮件（密码/登录验证、账单通知、用户主动请求的报告）**不受本总闸影响**。
 * 复位条件：所有收件人都已有可核验的显式营销同意记录（`marketing_opt_in_at`）。
 */
export const MARKETING_SEND_HOLD: { active: boolean; since: string; reason: string } = {
  active: true,
  since: "2026-10-09",
  reason:
    "No verifiable marketing opt-in exists for any registered user; all lifecycle templates are category=marketing. " +
    "Automated marketing sends are halted until explicit, verifiable opt-in records exist. Release requires an explicit owner decision.",
};

/** 总闸是否生效 */
export function isMarketingSendHeld(): boolean {
  return MARKETING_SEND_HOLD.active;
}

/** 营销同意口径（文档 / 测试共用的唯一一句话，避免措辞漂移） */
export const MARKETING_CONSENT_POLICY =
  "营销邮件必须先有可核验的显式同意（email_preferences.marketing_opt_in_at 非空）且未退订；" +
  "注册、登录、试用、付费或「尚未退订」都不构成同意。";

/** 营销发送被拦下的原因分类（用于日志 / 报告） */
export type MarketingBlockReason = "hold" | "no_consent" | "unsubscribed";
