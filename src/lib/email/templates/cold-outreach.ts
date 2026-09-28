// ===== Cold Email 模板基地 =====
// 用途：人工精准 outreach —— 找到潜客 → 复制模板 → 填入真实内容 → 手动发出 → 按 follow-up 序列跟进。
// 明确边界（与使用规则一致，违反即失去使用前提）：
//   - 不批量发送、不买名单、不爬邮箱：一次一封，面向真实收集到的联系人
//   - 不冒充已完成人工审计：没有检查过对方网站，就不能暗示检查过
//   - 不使用无法验证的数字与恐吓话术（"losing thousands of visitors" 等禁止）
//   - 对方明确拒绝 → 停止联系
//
// 序列：首封（Day 0）→ Follow-up 1（Day 3–4，新角度）→ Follow-up 2（Day 7–10，新角度）
// UTM：链接统一 utm_source=email & utm_medium=outbound & utm_campaign=cold_email & utm_content=<template id>

export interface ColdEmailVariable {
  key: string;
  description: string;
  example: string;
}

export interface ColdEmailTemplate {
  id: string;
  /** A–G 用途分组 */
  group:
    | "website_issue"
    | "free_audit"
    | "followup"
    | "saas_founder"
    | "agency"
    | "content_site";
  name: string;
  /** 序列位置：0 = 首封，1/2 = follow-up */
  sequenceStep: number;
  /** 建议发出时间（相对首封的天数） */
  dayOffset: number;
  /** 使用前提说明 */
  whenToUse: string;
  variables: ColdEmailVariable[];
  subject: string;
  body: string;
}

const COMMON_VARS: ColdEmailVariable[] = [
  { key: "[First Name]", description: "对方名字（真实查证，不要猜）", example: "Yuki" },
  { key: "[Website]", description: "对方网站域名", example: "example.com" },
  { key: "[Your Name]", description: "你的署名", example: "Qiu" },
  { key: "[Audit URL]", description: "带 UTM 的 SeeO 审计入口链接（见下）", example: "https://www.seeo.asia/app/audit?utm_source=email&utm_medium=outbound&utm_campaign=cold_email" },
];

const BASE_VARIABLES_NOTE =
  "所有模板共用变量：[First Name] [Website] [Specific Issue] [Audit URL] [Your Name]。" +
  "[Specific Issue] 必须是你亲眼确认的问题（打开网站看到的真实情况），禁止编造。";

export const COLD_EMAIL_TEMPLATES: ColdEmailTemplate[] = [
  // ---- A. Website issue outreach（首封：指出一个真实存在的问题）----
  {
    id: "A_website_issue_v1",
    group: "website_issue",
    name: "Website issue outreach",
    sequenceStep: 0,
    dayOffset: 0,
    whenToUse:
      "你亲自打开对方网站，确认了一个具体技术 SEO 问题（如缺 canonical、首页 title 过长、sitemap 404）。问题必须真实可见，写不出具体问题就不要用这个模板。",
    variables: [
      ...COMMON_VARS,
      { key: "[Specific Issue]", description: "亲眼确认的具体问题（一句话，可验证）", example: "your homepage title tag is identical to your /pricing page" },
    ],
    subject: "Quick note on [Website]",
    body: `Hi [First Name],

I was looking at [Website] and noticed one technical thing: [Specific Issue].

If it's useful, SeeO (a tool I work on) runs a free technical audit that lists this kind of issue with affected pages — here's the link if you want to check it yourself: [Audit URL]

Either way, hope it helps.

[Your Name]`,
  },

  // ---- B. Free SEO audit outreach（首封：以免费审计入口为价值点）----
  {
    id: "B_free_audit_v1",
    group: "free_audit",
    name: "Free SEO audit outreach",
    sequenceStep: 0,
    dayOffset: 0,
    whenToUse:
      "没有发现具体问题、但对方网站明显在做内容/SEO 时使用。只提供免费工具入口，不假装做过任何检查。",
    variables: COMMON_VARS,
    subject: "Free technical audit for [Website]",
    body: `Hi [First Name],

Quick one — I build SeeO, a technical SEO tool. It runs a free audit of any site: health score, 20+ technical checks, affected pages, and what to fix first.

You can run it on [Website] here (no signup needed): [Audit URL]

No catch — the audit is part of the free plan.

[Your Name]`,
  },

  // ---- C. Follow-up #1（换角度：给一个真实的新信息点）----
  {
    id: "C_followup1_v1",
    group: "followup",
    name: "Follow-up #1（Day 3–4）",
    sequenceStep: 1,
    dayOffset: 4,
    whenToUse:
      "首封发出后 3–4 天无回复时使用。必须包含一个首封没有的新信息（例如你注意到的新问题、或对方某个页面的具体观察）。禁止只写 just bumping this up。",
    variables: [
      ...COMMON_VARS,
      { key: "[Specific Issue 2]", description: "第二个真实观察点（与首封不同角度）", example: "your blog posts don't have meta descriptions" },
    ],
    subject: "Re: Quick note on [Website]",
    body: `Hi [First Name],

Following up with one more observation: [Specific Issue 2].

If you want a full list of this kind of issue, the free audit covers it: [Audit URL]

If this isn't relevant for you right now, no problem — just say the word and I won't follow up again.

[Your Name]`,
  },

  // ---- D. Follow-up #2（最后跟进：低姿态收尾 + 明确退出选项）----
  {
    id: "D_followup2_v1",
    group: "followup",
    name: "Follow-up #2（Day 7–10）",
    sequenceStep: 2,
    dayOffset: 10,
    whenToUse:
      "Follow-up 1 后 3–6 天仍无回复时使用。这是本序列最后一封；之后不再联系（除非对方主动回复）。明确表达不再打扰。",
    variables: COMMON_VARS,
    subject: "Last one from me, [First Name]",
    body: `Hi [First Name],

Last note from me — I don't want to clutter your inbox.

The free audit link is here if you ever want it: [Audit URL]. It takes about a minute and needs no signup.

Wishing you well with [Website].

[Your Name]`,
  },

  // ---- E. SaaS / founder version ----
  {
    id: "E_saas_founder_v1",
    group: "saas_founder",
    name: "SaaS / founder version",
    sequenceStep: 0,
    dayOffset: 0,
    whenToUse: "对方是 SaaS 创始人/产品负责人。角度：产品驱动的网站常有程序化页面（模板页、参数页）带来的索引问题。需亲眼看过后再写 [Specific Issue]。",
    variables: [
      ...COMMON_VARS,
      { key: "[Product Context]", description: "对方产品的一句话定位（真实了解后填写）", example: "your invoicing tool for freelancers" },
      { key: "[Specific Issue]", description: "亲眼确认的程序化页面/索引问题", example: "your template-generated landing pages all share one canonical" },
    ],
    subject: "[Website] — indexing question for [Product Context]",
    body: `Hi [First Name],

I've been using [Product Context] and had a look at how the site is indexed. One thing stood out: [Specific Issue].

With programmatic pages this is common, and it usually means search engines pick a version you didn't intend. SeeO (my tool) has a free audit that shows exactly which pages are affected: [Audit URL]

Hope that's useful.

[Your Name]`,
  },

  // ---- F. Agency / SEO freelancer version ----
  {
    id: "F_agency_v1",
    group: "agency",
    name: "Agency / SEO freelancer version",
    sequenceStep: 0,
    dayOffset: 0,
    whenToUse: "对方是代理公司/自由职业 SEO，管理多个客户站点。角度：给一个可以服务其客户的工具入口，不谈合作分成等未落实的事。",
    variables: COMMON_VARS,
    subject: "A free audit tool for your client sites",
    body: `Hi [First Name],

I came across [Website] and saw you work on SEO for clients — you probably already have a stack for audits, but if you want a fast second opinion tool, SeeO runs a free technical audit on any domain (about a minute, no signup): [Audit URL]

It covers 20+ checks with affected pages and priorities. Some folks use it as a quick pre-audit before deeper crawls.

[Your Name]`,
  },

  // ---- G. Content / affiliate site version ----
  {
    id: "G_content_site_v1",
    group: "content_site",
    name: "Content / affiliate site version",
    sequenceStep: 0,
    dayOffset: 0,
    whenToUse: "对方运营内容站/联盟站。角度：内容站的收录与重复内容问题。需基于真实观察填写 [Specific Issue]。",
    variables: [
      ...COMMON_VARS,
      { key: "[Specific Issue]", description: "亲眼确认的内容站典型问题", example: "several of your listicles return 200 with near-identical titles" },
    ],
    subject: "[Website] — content pages worth a look",
    body: `Hi [First Name],

Content sites live and die by how cleanly pages get indexed. Looking at [Website], one thing I noticed: [Specific Issue].

If you want the full technical picture, SeeO runs a free audit — health score, duplicate titles, canonicals, response times, with affected pages listed: [Audit URL]

Hope it's handy.

[Your Name]`,
  },
];

/** Follow-up 序列说明（供人工执行时参考） */
export const COLD_SEQUENCE = [
  { step: 0, label: "首封（Day 0）", note: "用 A/B/E/F/G 之一，按对方身份选择角度" },
  { step: 1, label: "Follow-up 1（Day 3–4）", note: "用 C：必须带一个首封没有的新观察点" },
  { step: 2, label: "Follow-up 2（Day 7–10）", note: "用 D：收尾并明确不再打扰" },
] as const;

export { BASE_VARIABLES_NOTE };

/** 构建带 outbound UTM 的审计链接（Cold Email 专用） */
export function buildColdAuditUrl(): string {
  const base = `${process.env.NEXT_PUBLIC_APP_URL || "https://www.seeo.asia"}/app/audit`;
  const url = new URL(base);
  url.searchParams.set("utm_source", "email");
  url.searchParams.set("utm_medium", "outbound");
  url.searchParams.set("utm_campaign", "cold_email");
  return url.toString();
}
