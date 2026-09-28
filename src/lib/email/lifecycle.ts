// ===== Lifecycle Email 自动化 =====
// 基于 B 阶段 analytics 事件判定资格，每日 sweep 一次（Vercel cron / /api/email/sweep）。
// 幂等由 email_log 唯一键保证；退订用户全部跳过；已激活用户不再收「先去用 SeeO」提醒；
// 已付费用户不再收升级提醒。

import { getAdapter } from "@/lib/db/migrations";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendTemplateEmail } from "./service";
import { buildCtaUrl, getAppUrl } from "./render";
import { LIFECYCLE_TEMPLATES } from "./templates/lifecycle";
import { ensureUnsubscribeToken } from "./preferences";

export interface EmailTarget {
  userId: string;
  email: string;
}

export interface SweepResult {
  targets: number;
  processed: number;
  results: Array<{ userId: string; template: string; status: string }>;
}

interface UserFacts {
  signupAt: string | null; // UTC "YYYY-MM-DD HH:MM:SS"
  activated: boolean;
  paid: boolean;
  lastActivityAt: string | null;
  pricingViews: number;
}

/** 相对给定时刻的小时差（纯函数：now 显式传入，便于确定性测试） */
function hoursSince(ts: string | null, now: number): number | null {
  if (!ts) return null;
  const t = Date.parse(ts.endsWith("Z") ? ts : `${ts}Z`);
  if (Number.isNaN(t)) return null;
  return (now - t) / 3_600_000;
}

/** 获取发信目标：优先 Supabase admin（需 service key），回退 email_log 已知联系方式 */
export async function getEmailTargets(): Promise<EmailTarget[]> {
  // 1. Supabase admin（生产路径）
  const admin = getAdminClient();
  if (admin) {
    try {
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 500 });
      if (!error && data?.users) {
        const targets = data.users
          .filter((u) => !!u.email)
          .map((u) => ({ userId: u.id, email: u.email as string }));
        if (targets.length > 0) return targets;
      }
    } catch {
      // 回退到 email_log
    }
  }

  // 2. 回退：email_log 中已知联系方式（注册时 welcome 已登记）
  const db = await getAdapter();
  const rows = await db.query(
    `SELECT user_id, email FROM email_log
     WHERE (user_id, created_at) IN (
       SELECT user_id, MAX(created_at) FROM email_log GROUP BY user_id
     )`
  ) as Array<{ user_id: string; email: string }>;
  return rows.map((r) => ({ userId: r.user_id, email: r.email }));
}

/** 从 B 阶段事件推导用户事实 */
async function getUserFacts(userId: string): Promise<UserFacts> {
  const db = await getAdapter();
  const signup = await db.get(
    `SELECT created_at FROM analytics_events
     WHERE user_id = ? AND event_name = 'signup_completed'
     ORDER BY created_at ASC LIMIT 1`,
    [userId]
  ) as { created_at: string } | undefined;
  const fallbackFirst = await db.get(
    `SELECT MIN(created_at) AS created_at FROM analytics_events
     WHERE user_id = ? OR anonymous_id IN (SELECT anonymous_id FROM analytics_identities WHERE user_id = ?)`,
    [userId, userId]
  ) as { created_at: string | null } | undefined;

  const activated = !!(await db.get(
    `SELECT id FROM analytics_events WHERE event_name = 'activation_completed' AND user_id = ? LIMIT 1`,
    [userId]
  ));
  const paid = !!(await db.get(
    `SELECT id FROM analytics_events WHERE event_name = 'payment_completed' AND user_id = ? LIMIT 1`,
    [userId]
  ));
  const last = await db.get(
    `SELECT MAX(created_at) AS last_at FROM analytics_events
     WHERE user_id = ? OR anonymous_id IN (SELECT anonymous_id FROM analytics_identities WHERE user_id = ?)`,
    [userId, userId]
  ) as { last_at: string | null } | undefined;
  const pricing = await db.get(
    `SELECT COUNT(*) AS n FROM analytics_events
     WHERE event_name = 'pricing_viewed'
       AND (user_id = ? OR anonymous_id IN (SELECT anonymous_id FROM analytics_identities WHERE user_id = ?))`,
    [userId, userId]
  ) as { n: number } | undefined;

  return {
    signupAt: signup?.created_at ?? fallbackFirst?.created_at ?? null,
    activated,
    paid,
    lastActivityAt: last?.last_at ?? null,
    pricingViews: Number(pricing?.n ?? 0),
  };
}

/** firstName：取邮箱前缀（不做虚假亲昵个性化） */
function firstNameFromEmail(email: string): string {
  const prefix = email.split("@")[0] ?? "there";
  const cleaned = prefix.split(/[+._-]/)[0] || "there";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** 单个用户的模板资格判定（纯函数，可测试） */
export function eligibleTemplates(
  facts: Pick<UserFacts, "signupAt" | "activated" | "paid" | "lastActivityAt" | "pricingViews">,
  now: Date = new Date()
): string[] {
  const nowMs = now.getTime();
  const h = (ts: string | null) => hoursSince(ts, nowMs);
  const ageH = h(facts.signupAt);
  const idleH = h(facts.lastActivityAt);
  const due: string[] = [];

  if (ageH !== null) {
    if (ageH >= 24 && ageH < 24 * 7 && !facts.activated) due.push("audit_reminder_v1");
    if (ageH >= 72 && ageH < 24 * 10) due.push("seo_education_v1");
    if (ageH >= 120 && ageH < 24 * 14) due.push("feature_education_v1");
    if (ageH >= 24 * 10 && idleH !== null && idleH >= 24 * 10) due.push("reengagement_v1");
    if (ageH >= 24 * 30 && idleH !== null && idleH >= 24 * 30) due.push("dormant_v1");
  }
  // 升级：已激活、未付费、出现真实升级信号（多次查看 Pricing）
  if (facts.activated && !facts.paid && facts.pricingViews >= 3) due.push("upgrade_v1");
  return due;
}

/** 执行一轮 sweep；provider 未配置时按 dry-run 记录（status=skipped_no_provider） */
export async function runLifecycleEmailSweep(now: Date = new Date()): Promise<SweepResult> {
  const targets = await getEmailTargets();
  const results: SweepResult["results"] = [];
  let processed = 0;

  for (const target of targets) {
    try {
      const facts = await getUserFacts(target.userId);
      const due = eligibleTemplates(facts, now);
      if (due.length === 0) continue;
      processed++;

      const token = await ensureUnsubscribeToken(target.userId, target.email);
      const unsubscribeUrl = `${getAppUrl()}/api/email/unsubscribe?token=${token}`;
      const vars: Record<string, string> = {
        firstName: firstNameFromEmail(target.email),
        auditUrl: "",
        appUrl: "",
        pricingUrl: "",
        unsubscribeUrl,
      };

      for (const templateKey of due) {
        // 每个模板自己的 campaign UTM
        const campaign = LIFECYCLE_TEMPLATES[templateKey]?.campaign ?? templateKey;
        vars.auditUrl = buildCtaUrl({ path: "/app/audit", utmCampaign: campaign });
        vars.appUrl = buildCtaUrl({ path: "/app", utmCampaign: campaign });
        vars.pricingUrl = buildCtaUrl({ path: "/pricing", utmCampaign: campaign });

        const result = await sendTemplateEmail({
          userId: target.userId,
          email: target.email,
          templateKey,
          variables: vars,
        });
        results.push({ userId: target.userId, template: templateKey, status: result.status });
      }
    } catch {
      // 单用户失败不影响其他用户
    }
  }

  return { targets: targets.length, processed, results };
}

/**
 * Welcome 邮件（signup_completed 触发的唯一入口）。
 * 幂等：同一用户重复触发不会重复发送；失败不抛出。
 */
export async function sendWelcomeEmail(userId: string, email: string): Promise<void> {
  try {
    const token = await ensureUnsubscribeToken(userId, email);
    const prefix = email.split("@")[0].split(/[+._-]/)[0] || "there";
    await sendTemplateEmail({
      userId,
      email,
      templateKey: "welcome_v1",
      variables: {
        firstName: prefix.charAt(0).toUpperCase() + prefix.slice(1),
        auditUrl: buildCtaUrl({ path: "/app/audit", utmCampaign: "welcome" }),
        unsubscribeUrl: `${getAppUrl()}/api/email/unsubscribe?token=${token}`,
      },
    });
  } catch {
    // 邮件失败不阻塞注册流程
  }
}
