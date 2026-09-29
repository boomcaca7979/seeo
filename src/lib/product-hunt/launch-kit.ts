// ===== J｜Product Hunt 基地：Launch Kit 单一事实来源 =====
//
// 本模块是 **唯一** canonical source。seo-growth/product-hunt/LAUNCH_KIT.md 由它渲染生成
// （`npm run product-hunt -- render`），G 阶段那份精简素材已降级为指针，不再维护第二套文案。
//
// 事实纪律（§5）：
//   - 只描述真实存在的能力（6 个模块 / 真实套餐 / 免费额度），不写 AI 自动修复、自动生成内容、
//     虚假 integrations、未完成功能
//   - 不做"最好/第一/唯一/革命性"这类无证据断言
//   - 没有真实案例（I 的 Case Master = 0）时，kit 里**不得出现**任何客户案例、quote、增幅数字
//
// 身份纪律（§8）：maker 身份一律留占位，绝不编造姓名/职业/公司/经历。

export const KIT_VERSION = "launch_2026_v1";

export const PRODUCT = {
  name: "SeeO",
  /** 唯一的产品入口：真实存在、公开可访问的首页（免费审计在首页即可直接跑） */
  productUrl: "https://www.seeo.asia/",
  /** 短的 slogan（与站上一致：all-in-one SEO analytics platform） */
  positioning: "Affordable SEO tools for site owners, founders, and SEO practitioners.",
} as const;

/** §6：三个候选，必须给出唯一推荐并说明理由（理由基于可核验事实，不做市场预测） */
export const TAGLINES = [
  {
    id: "A",
    text: "SEO audits, rank tracking and keyword research in one place",
    why: "三个词就是产品里真实存在的三个模块，读得懂、可核对；不含比较级断言。",
  },
  {
    id: "B",
    text: "Audit a site, then track the fixes and research keywords",
    why: "以工作流顺序表述（审计 → 跟踪 → 关键词），强调一步接一步而不是功能堆叠。",
  },
  {
    id: "C",
    text: "Free SEO audit plus rank tracking and keyword research",
    why: "把免费入口放在最前；但「Free」容易让人以为是免费产品，与实际付费档位有落差。",
  },
] as const;

/** 唯一主文案 */
export const TAGLINE_RECOMMENDED_ID = "A";

export function recommendedTagline(): string {
  return TAGLINES.find((t) => t.id === TAGLINE_RECOMMENDED_ID)!.text;
}

/** §7：短描述与完整描述。长描述必须与站上 meta.siteDescription 逐字一致（有测试强制）。 */
export const DESCRIPTIONS = {
  /** Product Hunt 列表页的一句话 */
  short:
    "An SEO workbench for site owners and small teams: technical audit, rank tracking, keyword research, competitor and backlink analysis.",
  /** 与 messages/en.json → meta.siteDescription 完全一致 */
  siteLong:
    "SeeO is an all-in-one SEO analytics platform: keyword research, rank tracking, technical SEO audits, competitor analysis, content optimization, and backlink analysis.",
  /** 补充段：说明它解决什么问题（不夸大） */
  why:
    "Most SEO work is split across separate tools — a crawler here, a rank tracker there, a keyword tool somewhere else. SeeO puts those steps in one workbench so the output of one feeds the next.",
} as const;

/** §7：完整描述的固定结构 Problem → Product → Core workflow → Capabilities → Free entry → CTA */
export const FULL_DESCRIPTION_SECTIONS = [
  {
    heading: "Problem",
    body: "Running a technical audit, checking rankings, and deciding what to write next usually means three different tools and a spreadsheet in between.",
  },
  {
    heading: "Product",
    body: "SeeO is an SEO analytics workbench. Audits, rank tracking, keyword research, competitor and backlink analysis live in one place, on one data set.",
  },
  {
    heading: "Core workflow",
    body: "Run an audit to find what is wrong, pick the issues that affect real pages, expand the keywords you want, track the positions you care about, and compare against competitors — without moving data between tools.",
  },
  {
    heading: "Main capabilities",
    body: "Technical SEO audit with per-issue affected pages; rank tracking over time by location and device; keyword research from a seed term; competitor ranking comparison; content optimisation against current results; backlink analysis with referring domains.",
  },
  {
    heading: "Free entry",
    body: "You can run a free audit without an account. The free plan includes 2 projects, 3 tracked keywords and 3 audits per day; paid plans raise the limits and add report exports.",
  },
  {
    heading: "CTA",
    body: "Try it on your own site.",
  },
] as const;

/**
 * §8：maker bio —— **必须人工填写**。
 * 这里刻意只放占位符；测试会阻止任何看起来像"已填好的真实身份"的内容混进来。
 */
export const MAKER_BIO = {
  status: "NEED MANUAL" as const,
  placeholders: {
    name: "[FILL IN: your real name]",
    background: "[FILL IN: what you actually do — e.g. \"independent developer, building SeeO\"]",
    contact: "[FILL IN: your public contact — the contact page https://www.seeo.asia/contact]",
  },
  forbidden: [
    "虚构姓名或公司主体",
    "员工数量 / 客户数量 / 收入 / 融资",
    "奖项或媒体背书",
    '"ex-Google" 之类未核实的头衔',
  ],
} as const;

/** §9：launch 当天第一条 maker comment。不是广告，不索取投票。 */
export const FIRST_COMMENT = `Hi — maker here.

I built SeeO because I kept repeating the same loop: run an audit in one tool, check rankings in another, then dig through keyword tools to decide what to write next. SeeO puts those steps in one workbench so the output of one step feeds the next.

What it does today:
- Technical audit: crawls a site, runs the checks (titles, descriptions, canonicals, redirects, sitemap, internal links, structured data and more) and lists the affected pages per issue
- Rank tracking: positions over time, by location and device
- Keyword research: expand a seed keyword into related terms
- Competitor analysis: compare rankings and share of voice
- Content optimisation: check a page against the current top results
- Backlink analysis: referring domains and anchor text distribution

There is a free plan that covers the audit, and a free audit you can run without an account.

Where I would most like feedback: whether the audit output is actually readable when you are not an SEO specialist, and which module you would want next. Happy to answer anything about how the checks work or where the data comes from — it is documented on the site.`;

/** §10：FAQ（8 条，全部与真实产品一致） */
export const FAQ = [
  {
    q: "What is SeeO?",
    a: "An SEO analytics platform that puts technical audits, rank tracking, keyword research, competitor analysis, content optimisation and backlink analysis in one workbench.",
  },
  {
    q: "Who is it for?",
    a: "Site owners, founders and small SEO teams who need the audit → fix → track loop in one place, plus SEO practitioners who want a first pass before a deeper crawl.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. The free plan includes 2 projects, 3 tracked keywords and 3 audits per day.",
  },
  {
    q: "What can I do without paying?",
    a: "You can run a free audit without an account at all. With a free account you get the plan limits above and the audit results are saved to your projects.",
  },
  {
    q: "How does SEO Audit work?",
    a: "It crawls the site, runs the technical checks (titles, descriptions, H1s, canonicals, redirects, sitemap, internal links, structured data, page speed and more) and reports the affected pages for each issue so you know what to fix and where.",
  },
  {
    q: "What makes SeeO different?",
    a: "The modules share one data set, so the audit, keyword, ranking, competitor and content steps hand off to each other instead of requiring exports. Pricing is published on the pricing page.",
  },
  {
    q: "What happens after the audit?",
    a: "Fix the issues you choose, then track the target rankings over time and re-run the audit to confirm the checks come back clean.",
  },
  {
    q: "How can I give feedback?",
    a: "Leave a comment on the launch page or use the contact page on the site — both reach me directly.",
  },
] as const;

/** 关联的真实 CTA（id 取自 F 的 CTA 库；此处只存 id，测试期与 F 的真实注册表比对） */
export const PRIMARY_CTA = {
  ctaId: "try_on_your_site",
  label: "Try it on your own site",
  target: PRODUCT.productUrl,
} as const;

/** §14：内容引用（只建立引用关系，不复制正文） */
export const CONTENT_REFERENCES = {
  /** F 的内容主题（launch 文案的观察来源，不是副本） */
  launchContentSource: ["F:C005", "F:C007", "F:C008"],
  /** C 的邮件模板口径（功能清单同一套） */
  featureEducationTemplate: "feature_education_v1",
} as const;

/** §13：I 的案例使用情况 —— 没有 Approved/Published 案例时不得出现任何客户证据 */
export const CASE_USAGE = {
  approvedCasesUsed: 0,
  note: "No customer proof available yet. Do not add testimonials, customer quotes or result numbers until the Case Master has an Approved case (seo-growth/case-studies.csv).",
} as const;

/**
 * §11：截图清单 —— **只保留结构，不引用任何实体文件**。
 *
 * 本仓库刻意不再保留任何截图文件（历史截图与验收截图已全部清除）。
 * 因此这里只声明「需要哪 6 张截图」，状态一律为 NEED MANUAL，
 * **不写路径、不引用已删除的 PNG、不用空文件冒充素材**。
 * 真正 Launch 前由人工按 slot 与 purpose 现场准备并逐项确认。
 */
export interface ScreenshotSlot {
  slot: number;
  purpose: string;
  status: "NEED MANUAL";
}

export const SCREENSHOTS: readonly ScreenshotSlot[] = [
  { slot: 1, purpose: "Homepage / free audit entry", status: "NEED MANUAL" },
  { slot: 2, purpose: "Technical SEO audit", status: "NEED MANUAL" },
  { slot: 3, purpose: "Rank tracking", status: "NEED MANUAL" },
  { slot: 4, purpose: "Competitor analysis", status: "NEED MANUAL" },
  { slot: 5, purpose: "Content optimisation", status: "NEED MANUAL" },
  { slot: 6, purpose: "SEO report / pricing", status: "NEED MANUAL" },
];

/** 截图素材的总体状态（不允许写成 PASS：没有任何截图实体存在于仓库中） */
export const SCREENSHOT_ASSET_STATUS = {
  status: "NEED MANUAL" as const,
  note: "仓库内不存在任何截图文件（已按用户要求全部清除）。Launch 前需人工准备 6 张截图并逐项确认，测试只校验清单结构，不校验文件是否存在。",
} as const;

export interface ChecklistItem {
  text: string;
  /** 需要人工确认且**尚未**确认的项 */
  manual?: boolean;
}

/** §11：截图使用前必须人工确认的条件 */
export const SCREENSHOT_MANUAL_CHECKS: readonly ChecklistItem[] = [
  { text: "每张图不含真实用户邮箱、域名或客户数据", manual: true },
  { text: "图里的数字与真实产品一致（不得用演示数字冒充真实数据）", manual: true },
  { text: "尺寸符合 Product Hunt 当天的展示要求", manual: true },
];

/** §12：Demo checklist */
export const DEMO_CHECKLIST = {
  status: "NEED MANUAL" as const,
  note: "DEMO ACCOUNT = NEED MANUAL — 没有稳定的演示账号，不得编造演示数据。",
  steps: [
    { text: "打开首页，确认免费审计入口可用（无需登录）", manual: true },
    { text: "用公开可访问的站点跑一次真实审计并确认结果可读", manual: true },
    { text: "确认审计结果页不含他人隐私数据", manual: true },
    { text: "走一遍注册 → 进入工作台 → 看到已保存的审计", manual: true },
    { text: "确认 pricing 页档位与文案一致（Free / Lite / Pro / Custom Service）", manual: true },
  ],
} as const;

/** §17：Launch Day 时间线 checklist（是清单，不是自动化） */
export const LAUNCH_TIMELINE = [
  {
    when: "T-7",
    items: [
      "Product page 文案定稿（本 kit 的 tagline / description / FAQ）",
      "截图按本 kit 的 6 个槽位准备好并完成人工确认",
      "Product URL 与 CTA 链接复查（必须指向真实可访问入口）",
      "Demo 流程按 checklist 走通一次",
    ],
  },
  {
    when: "T-1",
    items: [
      "所有外链逐个点一遍（含 UTM 参数）",
      "pricing 页与注册流程复查",
      "analytics 能收到 producthunt 来源（含漏斗事件）",
      "生产健康检查：首页、审计、登录、邮件解订阅等关键路由",
    ],
  },
  {
    when: "Launch Day",
    items: [
      "按当天规则核对后发布（见 rules tracking）",
      "发布后立即验证页面可访问、链接正确",
      "监控评论区并逐条回复（用 comment guidance）",
      "记录来源数据，不做任何刷票动作",
    ],
  },
  {
    when: "T+1",
    items: [
      "看流量与来源（utm_source=producthunt）",
      "看注册与激活（signup_completed / activation_completed）",
      "收集反馈与问题清单",
      "记录改进项，必要时同步进 F 的内容库",
    ],
  },
] as const;

/** §4-13：评论/回复指引 */
export const COMMENT_GUIDANCE = [
  "先回答问题，再谈产品；能一句话答完就不要写成一段营销文案。",
  "被问到真实限制（例如免费额度、数据来源、某模块边界）时照实说，不回避、不夸大。",
  "没有真实案例就直说还没有；不要用「某客户」『典型场景』编造例子。",
  "不索取投票、不要求帮忙冲榜、不承诺回投。",
  "遇到 bug 或负面反馈：先确认现象、给可复现路径，再说明处理方式。",
] as const;

/** §16：归因。source 必须复用 B 的 canonical source（producthunt），不新建平行来源。 */
export const ANALYTICS_ATTRIBUTION = {
  utmSource: "producthunt",
  utmMedium: "community",
  utmCampaign: "launch",
  utmContent: KIT_VERSION,
  /** 由参数拼出的 canonical launch URL（渲染时写入 kit） */
  get url(): string {
    return `${PRODUCT.productUrl}?utm_source=${this.utmSource}&utm_medium=${this.utmMedium}&utm_campaign=${this.utmCampaign}&utm_content=${this.utmContent}`;
  },
  /** 必须由现有 analytics 承接，不新增第二套 */
  reusesExistingAnalytics: true,
} as const;

/**
 * §16 与 G 的已知冲突：G 的 `campaignFor("product_hunt")` 目前输出 medium=launch。
 * 本 kit 按 J 的规定使用 medium=community。**这是一处必须人工收敛的分歧**，
 * 在 launch 前必须让两者一致（改哪一边由你决定，我不擅自改已验收的 G）。
 */
export const ATTRIBUTION_OPEN_ITEM = {
  status: "NEEDS RECONCILIATION" as const,
  detail:
    "src/lib/community/utm.ts 的 campaignFor('product_hunt') 目前返回 medium=launch / campaign=launch，而本 kit 使用 medium=community。两者必须一致后才可 Launch。",
} as const;

/** §18：动态规则跟踪。不得把未来当天的规则写成永久 PASS。 */
export const RULES_TRACKING = {
  rulesCheckedAt: "",
  rulesSource: "",
  rulesStatus: "Needs Manual Check" as const,
} as const;

/** §19：反作弊边界 */
export const ANTI_ABUSE = {
  mode: "Organic launch only" as const,
  forbidden: [
    "购买 upvotes / 评论 / 账号",
    "群体互投、互赞组织",
    "机器人或自动化脚本",
    "伪造 maker 身份",
    "伪造客户、案例、testimonial",
    "伪造 launch 数据或排名",
  ],
  /** 结构性保证：本模块与渲染脚本里不存在任何网络调用 */
  hasNetworkCapability: false,
} as const;

/** §4-15：Launch 前最终检查清单 */
export const FINAL_PRE_LAUNCH_CHECKLIST: readonly ChecklistItem[] = [
  { text: "Tagline 采用推荐的 " + TAGLINE_RECOMMENDED_ID + "（或已明确换过并同步）" },
  { text: "长描述与站上 meta.siteDescription 逐字一致" },
  { text: "Maker bio 已由本人填写真实身份（不得留占位符就发布）", manual: true },
  { text: "截图 6 个槽位齐全，且完成人工确认项", manual: true },
  { text: "Product URL 与 CTA 指向真实可访问入口，且不带内部/测试路径" },
  { text: "所有外链带正确的 UTM（source=producthunt）" },
  { text: "规则已人工核对（rules_status 从 Needs Manual Check 变为 Checked）", manual: true },
  { text: "归因分歧已收敛（见 attribution open item）", manual: true },
  { text: "没有出现任何未获授权的客户案例或引用", manual: true },
];
