// ===== Lifecycle Email 模板注册表 =====
// 每个 template：key（版本化）+ category + campaign（UTM）+ 必需变量 + build(subject/html)。
// 规则：
//   - 变量缺失时 build 抛错（绝不发送内容错误的邮件）
//   - 所有营销模板必须包含 unsubscribeUrl 变量（build 强制校验）
//   - 链接统一携带 UTM：utm_source=email & utm_medium=lifecycle & utm_campaign=<key>
//   - 文案克制：不夸大、不制造焦虑、只描述真实产品能力

import { buildCtaUrl, renderEmailShell } from "../render";

export type EmailCategory = "marketing" | "transactional";

export interface LifecycleTemplate {
  key: string;
  category: EmailCategory;
  /** 邮件中所有链接的 utm_campaign */
  campaign: string;
  /** build 必需变量（缺一即抛错） */
  requiredVars: readonly string[];
  build: (vars: Record<string, string>) => { subject: string; html: string };
}

function requireVars(template: LifecycleTemplate, vars: Record<string, string>): void {
  const missing = template.requiredVars.filter((k) => !vars[k]);
  if (missing.length > 0) {
    throw new Error(`[${template.key}] 缺少必需变量: ${missing.join(", ")}`);
  }
}

export const LIFECYCLE_TEMPLATES: Record<string, LifecycleTemplate> = {
  // ---- EMAIL 01 · Welcome：注册后立即，引导完成第一次审计 ----
  welcome_v1: {
    key: "welcome_v1",
    category: "marketing",
    campaign: "welcome",
    requiredVars: ["firstName", "auditUrl", "unsubscribeUrl"],
    build(vars) {
      requireVars(this, vars);
      const html = renderEmailShell({
        eyebrow: "WELCOME",
        title: `Hi ${vars.firstName}, welcome to SeeO`,
        body: [
          "Your account is ready. SeeO gives you technical SEO audits, daily rank tracking, keyword research, competitor and backlink analysis — all in one workbench.",
          "The fastest way to start: run a free SEO audit on your site. It crawls your pages, runs 20+ technical checks, and shows a health score with prioritized fixes.",
        ],
        cta: { label: "Run your first SEO audit", url: vars.auditUrl },
        footerNote: "You are receiving this because you created a SeeO account.",
        unsubscribeUrl: vars.unsubscribeUrl,
      });
      return { subject: "Welcome to SeeO — start with a free SEO audit", html };
    },
  },

  // ---- EMAIL 02 · Audit Reminder：注册 24h 后仍未完成核心动作 ----
  audit_reminder_v1: {
    key: "audit_reminder_v1",
    category: "marketing",
    campaign: "audit_reminder",
    requiredVars: ["firstName", "auditUrl", "unsubscribeUrl"],
    build(vars) {
      requireVars(this, vars);
      const html = renderEmailShell({
        eyebrow: "GETTING STARTED",
        title: `${vars.firstName}, your first audit takes about a minute`,
        body: [
          "You created a SeeO account but haven't run your first SEO audit yet.",
          "A quick audit crawls your homepage, checks titles, meta descriptions, canonicals, response times and more, then shows what to fix first. No credit card needed — it is part of the free plan.",
        ],
        cta: { label: "Run your SEO audit", url: vars.auditUrl },
        footerNote: "You are receiving this because you signed up but haven't completed your first audit.",
        unsubscribeUrl: vars.unsubscribeUrl,
      });
      return { subject: "Your first SEO audit is ready when you are", html };
    },
  },

  // ---- EMAIL 03 · SEO Education：注册约 3 天 ----
  seo_education_v1: {
    key: "seo_education_v1",
    category: "marketing",
    campaign: "seo_education",
    requiredVars: ["firstName", "auditUrl", "unsubscribeUrl"],
    build(vars) {
      requireVars(this, vars);
      const html = renderEmailShell({
        eyebrow: "SEO BASICS",
        title: "Why pages get traffic but no rankings",
        body: [
          "A page can load fine and still not rank. The usual technical reasons:",
          "· Title tags that don't match search intent, or are duplicated across pages\n· Missing or conflicting canonicals, so Google indexes the wrong version\n· Thin content that doesn't cover what searchers actually ask\n· Slow responses on the pages Google crawls most often",
          "A technical audit surfaces exactly which of these apply to your site, with affected pages listed. You can run one on the free plan.",
        ],
        cta: { label: "Check your site", url: vars.auditUrl },
        footerNote: "You are receiving this because you have a SeeO account.",
        unsubscribeUrl: vars.unsubscribeUrl,
      });
      return { subject: "Pages load fine but don't rank? Check these 4 things", html };
    },
  },

  // ---- EMAIL 04 · Feature Education：注册约 5 天，只介绍真实存在的功能 ----
  feature_education_v1: {
    key: "feature_education_v1",
    category: "marketing",
    campaign: "feature_education",
    requiredVars: ["firstName", "appUrl", "unsubscribeUrl"],
    build(vars) {
      requireVars(this, vars);
      const html = renderEmailShell({
        eyebrow: "INSIDE SEE0",
        title: "What you can do in your SeeO workbench",
        body: [
          "A quick tour of what is included in your plan:",
          "· Technical Audit — crawl your site and get a prioritized fix list\n· Keyword Research — expand a seed keyword into related terms with volume and difficulty\n· Rank Tracking — follow positions daily, by location and device\n· Competitor Analysis — compare rankings and share of voice side by side\n· Content Optimization — check a page against the current top results\n· Backlink Analysis — see referring domains and anchor text distribution",
          "Everything lives in one workbench, so data moves between modules without exports.",
        ],
        cta: { label: "Open SeeO", url: vars.appUrl },
        footerNote: "You are receiving this because you have a SeeO account.",
        unsubscribeUrl: vars.unsubscribeUrl,
      });
      return { subject: "Six things your SeeO workbench can do today", html };
    },
  },

  // ---- EMAIL 05 · Re-engagement：约 10 天未使用，无制造焦虑话术 ----
  reengagement_v1: {
    key: "reengagement_v1",
    category: "marketing",
    campaign: "reengagement",
    requiredVars: ["firstName", "appUrl", "unsubscribeUrl"],
    build(vars) {
      requireVars(this, vars);
      const html = renderEmailShell({
        eyebrow: "YOUR WORKBENCH",
        title: `${vars.firstName}, your SeeO workbench is waiting`,
        body: [
          "It has been a while since you last signed in.",
          "Your workbench keeps your projects, audit history and tracking setup — you can pick up where you left off, or run a fresh audit to see how your site is doing today.",
        ],
        cta: { label: "Continue in SeeO", url: vars.appUrl },
        footerNote: "You are receiving this because you have a SeeO account.",
        unsubscribeUrl: vars.unsubscribeUrl,
      });
      return { subject: "Pick up where you left off in SeeO", html };
    },
  },

  // ---- EMAIL 06 · Upgrade：真实使用 + 出现合理升级信号，解释真实差异 ----
  upgrade_v1: {
    key: "upgrade_v1",
    category: "marketing",
    campaign: "upgrade",
    requiredVars: ["firstName", "pricingUrl", "unsubscribeUrl"],
    build(vars) {
      requireVars(this, vars);
      const html = renderEmailShell({
        eyebrow: "PLANS",
        title: "Free, Lite or Pro — which fits your workload?",
        body: [
          "You have been using SeeO, so here is what changes between plans:",
          "· Free — 2 projects, 3 tracked keywords, 3 audits per day. Good for evaluating.\n· Lite — 3 projects, 30 keywords, 10 audits per day. For an ongoing single-site focus.\n· Pro — 10 projects, 200 keywords, 50 audits per day, plus PDF/CSV report exports. For practitioners managing several sites.",
          "You can compare the full list on the pricing page and change plans at any time.",
        ],
        cta: { label: "Compare plans", url: vars.pricingUrl },
        footerNote: "You are receiving this because you use SeeO on the free plan.",
        unsubscribeUrl: vars.unsubscribeUrl,
      });
      return { subject: "Free vs Lite vs Pro: what changes", html };
    },
  },

  // ---- EMAIL 07 · Dormant：长期未使用，低频一次性唤醒 ----
  dormant_v1: {
    key: "dormant_v1",
    category: "marketing",
    campaign: "dormant",
    requiredVars: ["firstName", "appUrl", "unsubscribeUrl"],
    build(vars) {
      requireVars(this, vars);
      const html = renderEmailShell({
        eyebrow: "STILL HERE",
        title: `${vars.firstName}, SeeO is still set up for your sites`,
        body: [
          "Your SeeO account and any saved projects are still active.",
          "If you want to check in on your site's technical health, a fresh audit takes about a minute and the free plan covers it.",
        ],
        cta: { label: "Continue in SeeO", url: vars.appUrl },
        footerNote: "You are receiving this because you have a SeeO account.",
        unsubscribeUrl: vars.unsubscribeUrl,
      });
      return { subject: "Your SeeO account is still active", html };
    },
  },
};

/** 供测试 / 校验使用 */
export function getLifecycleTemplate(key: string): LifecycleTemplate | null {
  return LIFECYCLE_TEMPLATES[key] ?? null;
}

export { buildCtaUrl };
