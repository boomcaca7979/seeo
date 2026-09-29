// ===== H｜SEO 获客基地：高意图落地页（内容单一来源）=====
//
// 定位：一组「问题型」搜索入口。与既有页面刻意分工，不复制：
//   - /features/*   → 功能说明（这是什么、怎么用）
//   - /guides/*     → 操作教程（一步步怎么做）
//   - /tools/*      → 免登录即时工具
//   - /seo-issues/* → **症状与诊断**（我的站出现了这个现象，怎么确认、怎么排顺序）
// 因此本模块每个页面回答的是「我网站上的这个现象是什么原因、怎么确认」，
// 而不是「SeeO 有什么功能」。这是与既有 20 条营销路径不重叠的关键。
//
// 事实纪律：
//   - relatedChecks 只能引用 src/lib/seo/audit-checks.ts 中真实存在的检查 id（有测试强制）
//   - 不写任何虚构的搜索量 / KD / 流量提升数字（项目没有关键词数据源）
//   - 不写总检查数之类的未核实数字；只引用具体检查项名称
//
// Master（清单/状态/负责人视角）在 seo-growth/seo-landing-master.csv，
// 与本模块通过 pageId 双向同步（有测试强制）。

import type { Locale } from "@/i18n/config";

export type LandingPageType =
  | "Tool landing"
  | "Problem landing"
  | "Feature landing"
  | "Use case landing";

/** 一个 locale 下的页面文案 */
export interface LocaleCopy {
  metaTitle: string;
  metaDescription: string;
  h1: string;
  /** 用户搜索时真正想问的问题 */
  lead: string;
  /** 这个症状通常由哪些真实检查项暴露 */
  detectedBy: string[];
  /** 具体、可验证的例子（不含虚构数字） */
  example: string;
  faqs: Array<{ q: string; a: string }>;
  ctaLabel: string;
}

export interface LandingPage {
  pageId: string;
  /** EN 路径（无前缀）；ZH 路径由 localePath 派生 */
  path: string;
  pageType: LandingPageType;
  primaryKeyword: string;
  searchIntent: string;
  /** 用户遇到的问题（中文速记，供 Master 与人工评审用） */
  problem: string;
  /** 本页解决什么（区别于「SeeO 有什么功能」） */
  coreValue: string;
  /** 关联的真实功能页 */
  relatedFeature: string;
  /** 真实存在的 audit check id */
  relatedChecks: string[];
  /** 站内相关页（内链，避免孤岛） */
  internalLinks: string[];
  /** CTA 指向真实的免费审计入口；href 为营销路径，渲染时按 locale 派生 */
  ctaHref: string;
  en: LocaleCopy;
  zh: LocaleCopy;
}

const AUDIT_ENTRY = "/features/seo-audit";
const KEYWORD_FEATURE = "/features/keyword-research";
const RANK_FEATURE = "/features/rank-tracking";
const CONTENT_FEATURE = "/features/content-optimization";
const DOCS = "/docs";

export const LANDING_PAGES: readonly LandingPage[] = [
  // ---------- 0. Hub：诊断入口 ----------
  {
    pageId: "seo_issues_hub",
    path: "/seo-issues",
    pageType: "Tool landing",
    primaryKeyword: "seo issues checker",
    searchIntent: "诊断（我网站到底有哪些问题，先看什么）",
    problem: "感觉网站有问题，但不知道该从哪一类查起",
    coreValue: "按「先挡抓取 / 再成片重复 / 后单页细节」给出检查顺序，并把每类问题接到免费审计",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["robots-blocks-important", "robots-unreachable", "no-sitemap", "duplicate-title", "broken-links", "orphan-pages", "missing-canonical", "slow-page", "low-content"],
    internalLinks: [
      "/seo-issues/pages-not-indexed",
      "/seo-issues/duplicate-title-tags",
      "/seo-issues/broken-internal-links",
      "/seo-issues/sitemap-errors",
      "/seo-issues/missing-canonical",
      "/seo-issues/thin-content",
      "/seo-issues/orphan-pages",
      "/seo-issues/slow-pages",
      "/seo-issues/keyword-cannibalization",
      AUDIT_ENTRY,
    ],
    ctaHref: "/",
    en: {
      metaTitle: "SEO Issues Checker: Find What's Actually Wrong With Your Site",
      metaDescription: "A practical order for checking SEO issues on a site: crawl access first, then site-wide patterns, then single pages. Each issue links to how it is detected.",
      h1: "Find out what is actually wrong with your site",
      lead: "Something is off with your search visibility, but the audit report lists dozens of items and nothing tells you where to start.",
      detectedBy: [
        "Crawl access problems — the site or its robots rules block pages from being fetched at all",
        "Site-wide patterns — the same issue repeated across a template (duplicate titles, missing canonicals)",
        "Structure problems — sitemap errors, orphan pages and pages buried too deep",
        "Single-page problems — slow responses and thin content on a specific URL",
      ],
      example: "Take the first two groups before the last two: a robots rule that blocks a section makes every other fix in that section pointless until it is lifted.",
      faqs: [
        {
          q: "Is there a fixed order I should check in?",
          a: "Yes, and it matters: anything that blocks crawling or indexing comes first, because it invalidates the rest. Site-wide patterns come second because one template fix covers many URLs. Single-page issues come last.",
        },
        {
          q: "Do I need an account to check my site?",
          a: "No. You can run a free audit without signing up, and it reports the affected pages per issue.",
        },
      ],
      ctaLabel: "Run a free SEO audit",
    },
    zh: {
      metaTitle: "SEO 问题检查：先搞清楚网站到底哪里不对",
      metaDescription: "检查网站 SEO 问题的实用顺序：先看抓取访问，再看成片重复的模板问题，最后才是单页细节。每类问题都说明它由哪些检查暴露。",
      h1: "先搞清楚网站到底哪里不对",
      lead: "搜索表现不对劲，但审计报告列出几十条，没人告诉你该从哪一条开始。",
      detectedBy: [
        "抓取访问问题 —— 站点或 robots 规则让页面根本抓不到",
        "全站模式问题 —— 同一问题在某个模板上成片出现（重复标题、缺失 canonical）",
        "结构问题 —— sitemap 错误、孤立页、层级过深",
        "单页问题 —— 某个 URL 响应慢、内容不足",
      ],
      example: "前两组要排在后面两组之前：挡住某个目录的 robots 规则只要还在，那个目录里所有其他修改都白做。",
      faqs: [
        {
          q: "有固定的检查顺序吗？",
          a: "有，而且顺序很重要：先处理挡住抓取与收录的问题，因为它会让其他修改失去意义；其次是成片的模板问题，因为一次修改覆盖多个 URL；单页问题放最后。",
        },
        {
          q: "检查自己的网站需要先注册吗？",
          a: "不需要。可以直接跑一次免费审计，它会按问题列出受影响的页面。",
        },
      ],
      ctaLabel: "免费跑一次 SEO 审计",
    },
  },

  // ---------- 1. 重复标题 ----------
  {
    pageId: "seo_issues_duplicate_title_tags",
    path: "/seo-issues/duplicate-title-tags",
    pageType: "Problem landing",
    primaryKeyword: "duplicate title tags",
    searchIntent: "症状排查（两个页面标题一样，会怎样、怎么找）",
    problem: "站内多个页面共用同一个 title（或 H1 / meta description）",
    coreValue: "区分「症状」与「模板根因」，说明为什么必须改模板而不是逐页改文案",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["duplicate-title", "duplicate-description", "duplicate-h1", "title-length", "description-length"],
    internalLinks: ["/seo-issues", "/seo-issues/thin-content", "/seo-issues/keyword-cannibalization", AUDIT_ENTRY, DOCS],
    ctaHref: AUDIT_ENTRY,
    en: {
      metaTitle: "Duplicate Title Tags: Why They Happen and How to Find Them",
      metaDescription: "Duplicate title tags are usually a template problem, not a copy problem. What the duplicate-title check reports and why fixing the template is the real fix.",
      h1: "Duplicate title tags are a template problem, not a copy problem",
      lead: "Several pages on my site share the same title. Does it actually matter, and where do I even find all of them?",
      detectedBy: [
        "duplicate-title — pages that share an identical title tag",
        "duplicate-description — pages that share an identical meta description",
        "duplicate-h1 — pages whose main heading is identical",
        "title-length / description-length — the same fields outside the length they are usually shown at",
      ],
      example: "If every category page renders as \"Brand | Products\", the duplicate-title check will flag all of them at once — one template edit resolves the whole set rather than one edit per page.",
      faqs: [
        {
          q: "Does a duplicate title get a page penalised?",
          a: "The concrete effect is that search engines cannot tell the pages apart from the title alone, so they are left to choose which one to show. That choice is often not the page you would pick.",
        },
        {
          q: "Should I fix the page or the template?",
          a: "If the duplicates appear on pages generated by the same template, fix the template. Editing individual pages will come back on the next batch of generated pages.",
        },
      ],
      ctaLabel: "See which pages are affected",
    },
    zh: {
      metaTitle: "重复标题标签：为什么会重复、怎么找出全部",
      metaDescription: "重复 title 通常是模板问题而不是文案问题。duplicate-title 检查会报出哪些页面，以及为什么改模板才是真修复。",
      h1: "重复标题是模板问题，不是文案问题",
      lead: "站里好几个页面标题一模一样。这真的会有影响吗？就算要改，我上哪找出全部重复的页面？",
      detectedBy: [
        "duplicate-title —— 共用完全相同 title 的页面",
        "duplicate-description —— 共用完全相同 meta description 的页面",
        "duplicate-h1 —— 主标题完全相同的页面",
        "title-length / description-length —— 同类字段超出常见展示长度",
      ],
      example: "如果所有分类页都渲染成「品牌 | 产品」，duplicate-title 会一次把它们全部标出来——改一次模板就解决整批，而不是逐页改文案。",
      faqs: [
        {
          q: "重复标题会被惩罚吗？",
          a: "确定的影响是：搜索引擎仅凭标题无法区分这些页面，只能自己挑一个展示，而它挑的常常不是你想展示的那一页。",
        },
        {
          q: "应该改页面还是改模板？",
          a: "如果重复出现在同一个模板生成的页面上，就改模板。逐页修改会在下一批生成时复发。",
        },
      ],
      ctaLabel: "看哪些页面受影响",
    },
  },

  // ---------- 2. 缺失 canonical ----------
  {
    pageId: "seo_issues_missing_canonical",
    path: "/seo-issues/missing-canonical",
    pageType: "Problem landing",
    primaryKeyword: "missing canonical tag",
    searchIntent: "症状排查（页面没有 canonical，会有什么后果）",
    problem: "页面缺少 canonical，或同一内容的多个 URL 没有指向规范版本",
    coreValue: "说明 canonical 缺失的实际后果（选择权交给搜索引擎），以及哪些 URL 形态最容易出问题",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["missing-canonical", "redirected-urls", "duplicate-description"],
    internalLinks: ["/seo-issues", "/seo-issues/pages-not-indexed", "/seo-issues/duplicate-title-tags", AUDIT_ENTRY, DOCS],
    ctaHref: AUDIT_ENTRY,
    en: {
      metaTitle: "Missing Canonical Tag: What It Actually Changes",
      metaDescription: "A missing canonical tag hands the version choice to search engines. Which URL patterns break most often and how the missing-canonical check reports affected pages.",
      h1: "A missing canonical hands the choice to search engines",
      lead: "My pages do not declare a canonical URL. Is that a real problem, or is it only worth adding on duplicates?",
      detectedBy: [
        "missing-canonical — pages that declare no canonical URL at all",
        "redirected-urls — URLs still being served that redirect elsewhere, blurring which version is canonical",
        "duplicate-description — a signal that several URLs are presenting the same content",
      ],
      example: "A listing page that accepts ?sort= creates several URLs for the same content. Without a canonical, each one is free to be treated as its own page.",
      faqs: [
        {
          q: "Is a self-referencing canonical redundant?",
          a: "No. It is an explicit statement that this URL is the canonical one. Leaving it out means nobody has stated it, which is a different situation.",
        },
        {
          q: "Which pages need one most?",
          a: "Pages reachable through more than one URL: anything with tracking parameters, sorting or filtering, pagination, print views, and case-variant paths.",
        },
      ],
      ctaLabel: "See which pages are affected",
    },
    zh: {
      metaTitle: "缺失 canonical 标签：到底会改变什么",
      metaDescription: "缺少 canonical 等于把「哪个 URL 是规范版本」的决定权交给搜索引擎。哪些 URL 形态最容易出问题，以及 missing-canonical 如何列出受影响页面。",
      h1: "缺少 canonical，等于把选择权交给搜索引擎",
      lead: "我的页面没有声明 canonical。这算真问题吗？还是只有重复内容才需要加？",
      detectedBy: [
        "missing-canonical —— 完全没有声明 canonical 的页面",
        "redirected-urls —— 仍在被访问但会跳转的 URL，让「哪个才是规范版本」更模糊",
        "duplicate-description —— 多个 URL 呈现同一内容的信号",
      ],
      example: "一个接受 ?sort= 的列表页会产生多份指向同一内容的 URL。没有 canonical，每一个都可以被当成独立页面处理。",
      faqs: [
        { q: "自指 canonical 是多余的吗？", a: "不是。它是明确声明「这个 URL 才是规范版本」。不写则等于没人声明过，这是两种不同的状态。" },
        { q: "哪些页面最需要它？", a: "能通过多个 URL 访问到的页面：带追踪参数、排序筛选、分页、打印视图，以及大小写不一致的路径。" },
      ],
      ctaLabel: "看哪些页面受影响",
    },
  },

  // ---------- 3. 页面不被收录 ----------
  {
    pageId: "seo_issues_pages_not_indexed",
    path: "/seo-issues/pages-not-indexed",
    pageType: "Problem landing",
    primaryKeyword: "pages not indexed by google",
    searchIntent: "症状排查（站点搜不到 / 页面不收录）",
    problem: "整站或部分页面在搜索结果里找不到，写再多内容也没用",
    coreValue: "把「不收录」拆成抓取访问、sitemap 覆盖、孤立页、层级过深四类可排查的原因",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["robots-blocks-important", "robots-unreachable", "sitemap-coverage", "orphan-pages", "deep-pages"],
    internalLinks: ["/seo-issues", "/seo-issues/sitemap-errors", "/seo-issues/orphan-pages", "/seo-issues/missing-canonical", AUDIT_ENTRY],
    ctaHref: AUDIT_ENTRY,
    en: {
      metaTitle: "Pages Not Indexed: Check Crawl Access Before Writing More Content",
      metaDescription: "When pages are missing from search results the cause is usually crawl access, sitemap coverage, orphan pages or depth — not content volume. How to check each one.",
      h1: "Pages not showing up is usually a crawl problem, not a content problem",
      lead: "Almost none of my pages appear in search results. I assumed I needed more content — is that right?",
      detectedBy: [
        "robots-blocks-important — robots rules that block paths you clearly want indexed",
        "robots-unreachable — a robots file that returns an error, leaving the rules unknown",
        "sitemap-coverage — a sitemap that does not list pages that should be discoverable",
        "orphan-pages — pages with no internal links pointing at them",
        "deep-pages — pages that sit so many clicks from the homepage they are rarely reached",
      ],
      example: "A Disallow rule written years ago for a test folder can block a section you moved there later. The pages still load fine in a browser, so nothing looks broken.",
      faqs: [
        {
          q: "How do I check this without Search Console?",
          a: "A crawl of the site shows which pages are reachable and which are blocked, plus whether each page is linked from somewhere. That covers the four causes above.",
        },
        {
          q: "Should I just publish more pages meanwhile?",
          a: "It will not help the existing pages. If crawling is blocked, new pages inherit the same problem.",
        },
      ],
      ctaLabel: "Check your site",
    },
    zh: {
      metaTitle: "页面不被收录：先查抓取访问，再谈写内容",
      metaDescription: "搜索结果里找不到页面，原因通常是抓取访问、sitemap 覆盖、孤立页或层级过深，而不是内容不够。逐项说明怎么查。",
      h1: "页面搜不到，通常是抓取问题而不是内容问题",
      lead: "我的页面几乎都搜不到。我以为是内容太少——这个判断对吗？",
      detectedBy: [
        "robots-blocks-important —— robots 规则挡住了你明显想收录的路径",
        "robots-unreachable —— robots 文件返回错误，规则等于未知",
        "sitemap-coverage —— sitemap 没有列出本应可被发现的页面",
        "orphan-pages —— 没有任何站内链接指向的页面",
        "deep-pages —— 距首页点击次数过深、很少被走到的页面",
      ],
      example: "多年前为拦截测试目录写的 Disallow 规则，可能挡住你后来搬进去的正式栏目。页面在浏览器里照常打开，所以看不出哪里坏了。",
      faqs: [
        { q: "没有 Search Console 怎么查？", a: "爬一遍站就能看出哪些页面可达、哪些被挡，以及每个页面是否有站内链接指向——上述四类原因都能覆盖。" },
        { q: "要不要先多发一些页面？", a: "对已有页面没有帮助。抓取被挡住时，新页面会继承同一个问题。" },
      ],
      ctaLabel: "检查你的网站",
    },
  },

  // ---------- 4. 内链断链与重定向链 ----------
  {
    pageId: "seo_issues_broken_internal_links",
    path: "/seo-issues/broken-internal-links",
    pageType: "Problem landing",
    primaryKeyword: "broken internal links",
    searchIntent: "症状排查（站内链接 404 / 跳转链太长）",
    problem: "站内链接指向 404 或经过多次跳转，浪费抓取并削弱权重传递",
    coreValue: "区分断链、指向跳转的链接与跳转链，说明为什么改内链比加跳转更划算",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["broken-links", "broken-crawled-pages", "links-to-redirects", "redirect-chain", "redirect-loop"],
    internalLinks: ["/seo-issues", "/seo-issues/pages-not-indexed", "/seo-issues/sitemap-errors", AUDIT_ENTRY, "/guides/how-to-do-a-technical-seo-audit"],
    ctaHref: AUDIT_ENTRY,
    en: {
      metaTitle: "Broken Internal Links and Redirect Chains: What to Fix First",
      metaDescription: "Broken internal links, links pointing at redirects, and multi-hop redirect chains each cost crawl effort. How the audit separates the three.",
      h1: "Broken links and redirect chains cost more than they look",
      lead: "Some internal links 404, and some paths redirect twice before reaching the final page. Which of these actually matters?",
      detectedBy: [
        "broken-links — internal links pointing at URLs that return an error",
        "broken-crawled-pages — pages that themselves fail to load",
        "links-to-redirects — internal links pointing at a URL that then redirects",
        "redirect-chain — a URL that redirects to another URL that redirects again",
        "redirect-loop — redirects that never reach a destination",
      ],
      example: "After a domain move, old URLs redirect to the new ones while http still upgrades to https — so a single internal link is followed across two hops instead of one.",
      faqs: [
        {
          q: "Is a redirect worse than a 404?",
          a: "It depends on intent. A 404 on a link you control is a mistake with a clear fix. A redirect chain is quieter: the page still works, but every visit costs extra requests and dilutes the signal.",
        },
        {
          q: "Should I just add another redirect?",
          a: "That usually lengthens the chain. Point internal links straight at the destination and update the old rule so it goes there in one hop.",
        },
      ],
      ctaLabel: "See which pages are affected",
    },
    zh: {
      metaTitle: "内链断链与重定向链：先修哪一个",
      metaDescription: "断链、指向跳转的内链、多跳重定向链各自消耗抓取。审计如何把这三类分开报告。",
      h1: "断链与重定向链的代价比看上去大",
      lead: "有些内链是 404，有些路径要跳两次才到终点。这两件事哪个才真正要紧？",
      detectedBy: [
        "broken-links —— 指向报错 URL 的站内链接",
        "broken-crawled-pages —— 本身就无法正常加载的页面",
        "links-to-redirects —— 站内链接指向一个会跳转的 URL",
        "redirect-chain —— 一个 URL 跳到另一个 URL 再跳一次",
        "redirect-loop —— 永远到不了终点的跳转",
      ],
      example: "域名迁移后，旧 URL 跳到新 URL，同时 http 还要升级到 https——一条内链要走两跳而不是一跳。",
      faqs: [
        { q: "跳转比 404 更糟吗？", a: "看意图。可控链接上的 404 是一个有明确修法的错误；重定向链更隐蔽：页面照常可用，但每次访问都多花请求、信号也被稀释。" },
        { q: "再加一条跳转不行吗？", a: "那通常会让链更长。正确做法是让内链直接指向终点，并把旧规则改成一步到位。" },
      ],
      ctaLabel: "看哪些页面受影响",
    },
  },

  // ---------- 5. sitemap 错误 ----------
  {
    pageId: "seo_issues_sitemap_errors",
    path: "/seo-issues/sitemap-errors",
    pageType: "Problem landing",
    primaryKeyword: "sitemap errors",
    searchIntent: "症状排查（sitemap 无效 / 包含坏 URL）",
    problem: "sitemap 打不开、格式无效，或其中包含错误 URL 与跳转 URL",
    coreValue: "把 sitemap 失效拆成四种可分别修复的形态，而不是笼统说「sitemap 有问题」",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["no-sitemap", "sitemap-invalid", "sitemap-bad-urls", "sitemap-redirects", "sitemap-coverage"],
    internalLinks: ["/seo-issues", "/seo-issues/pages-not-indexed", "/seo-issues/broken-internal-links", AUDIT_ENTRY, "/guides/how-to-do-a-technical-seo-audit"],
    ctaHref: AUDIT_ENTRY,
    en: {
      metaTitle: "Sitemap Errors: The Four Failure Modes and How to Check Them",
      metaDescription: "A sitemap can fail in four separate ways: missing, invalid, containing error URLs, or containing redirecting URLs. Each has a different fix.",
      h1: "A sitemap fails in four different ways",
      lead: "I submitted a sitemap but pages still are not being discovered. Is the file itself wrong?",
      detectedBy: [
        "no-sitemap — no sitemap could be found at all",
        "sitemap-invalid — the file exists but is not valid sitemap XML",
        "sitemap-bad-urls — entries that return a client or server error",
        "sitemap-redirects — entries that redirect instead of resolving directly",
        "sitemap-coverage — pages that should be listed but are not",
      ],
      example: "Listing the same page twice, once with a trailing slash and once without, produces a duplicate entry and a redirect entry in the same file.",
      faqs: [
        {
          q: "Do I need a sitemap if my site is linked well?",
          a: "It is still useful for discovery, but it is not a substitute for internal links. A page that only exists in the sitemap is an orphan page.",
        },
        {
          q: "Which of the four should I fix first?",
          a: "Availability and validity first — until the file can be read, the other three cannot be evaluated.",
        },
      ],
      ctaLabel: "Check your site",
    },
    zh: {
      metaTitle: "sitemap 错误：四种失效形态与检查方法",
      metaDescription: "sitemap 有四种独立失效形态：缺失、格式无效、包含报错 URL、包含跳转 URL。每一种的修法都不同。",
      h1: "sitemap 会以四种不同的方式失效",
      lead: "我提交了 sitemap，但页面还是没被发现。是文件本身写错了吗？",
      detectedBy: [
        "no-sitemap —— 完全找不到 sitemap",
        "sitemap-invalid —— 文件存在但不是合法的 sitemap XML",
        "sitemap-bad-urls —— 返回 4xx / 5xx 的条目",
        "sitemap-redirects —— 会跳转而不是直接解析的条目",
        "sitemap-coverage —— 本应列出却没有列出的页面",
      ],
      example: "同一个页面带尾斜杠与不带尾斜杠各写一次，会在同一个文件里同时产生重复条目与跳转条目。",
      faqs: [
        { q: "站内链接做得好就不需要 sitemap 了吧？", a: "它仍然有助于发现，但不能替代内链。只存在于 sitemap 里的页面就是孤立页。" },
        { q: "四种里应该先修哪个？", a: "先修可用性与格式：文件读不出来时，另外三种根本无法评估。" },
      ],
      ctaLabel: "检查你的网站",
    },
  },

  // ---------- 6. 慢页面 ----------
  {
    pageId: "seo_issues_slow_pages",
    path: "/seo-issues/slow-pages",
    pageType: "Problem landing",
    primaryKeyword: "slow pages seo",
    searchIntent: "症状排查（哪些慢页面真的要紧）",
    problem: "站点整体偏慢，但不知道该优化哪几个页面",
    coreValue: "按「被抓取频率 × 业务重要性」挑选页面，而不是按性能评分低分排序",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["slow-page", "inline-css"],
    internalLinks: ["/seo-issues", "/seo-issues/pages-not-indexed", "/seo-issues/thin-content", AUDIT_ENTRY, "/features/rank-tracking"],
    ctaHref: AUDIT_ENTRY,
    en: {
      metaTitle: "Slow Pages: Working Out Which Ones Actually Matter",
      metaDescription: "Page speed work spreads thin if you optimise by lowest score. Pick pages by crawl frequency and business importance instead — and how the slow-page check reports them.",
      h1: "Which slow pages actually matter",
      lead: "The whole site feels slow. I cannot rewrite everything — which pages should I fix first?",
      detectedBy: [
        "slow-page — specific URLs with a slow response, reported with the page rather than as a site-wide score",
        "inline-css — a common contributor when large stylesheets are embedded in every response",
      ],
      example: "A slow homepage affects every visit and every crawl; a slow archive page from years ago affects almost nothing. The check reports both, but you decide the order.",
      faqs: [
        {
          q: "Should I optimise the lowest-scoring page?",
          a: "Not automatically. Score is one input. A page nobody visits and no crawler prioritises can wait behind a slightly faster page that is on the main path.",
        },
        {
          q: "Does page speed affect ranking directly?",
          a: "It affects crawl behaviour and user experience, which is what we can measure. We would not claim a specific ranking effect we cannot verify.",
        },
      ],
      ctaLabel: "Check your site",
    },
    zh: {
      metaTitle: "慢页面：先搞清楚哪些才真的要紧",
      metaDescription: "只按最低分排序做性能优化会摊得太薄。应该按「被抓取频率 × 业务重要性」挑页面——以及 slow-page 检查如何报告。",
      h1: "哪些慢页面才真的要紧",
      lead: "整站都慢。我不可能全站重写——应该先修哪几个页面？",
      detectedBy: [
        "slow-page —— 按页面报告响应较慢的具体 URL，而不是给全站一个分数",
        "inline-css —— 每次响应都内嵌大体积样式时的常见成因",
      ],
      example: "首页慢会影响每一次访问与每一次抓取；几年前归档页慢几乎不影响任何事。检查两者都会报，但先后由你决定。",
      faqs: [
        { q: "应该优化分数最低的页面吗？", a: "不一定。分数只是其中一个输入。没人访问、抓取器也不优先的页面，可以排在主干路径上稍快一点的页面之后。" },
        { q: "页面速度会直接影响排名吗？", a: "它影响抓取行为与用户体验，这是我们能测量的部分。我们不会声称无法验证的具体排名效果。" },
      ],
      ctaLabel: "检查你的网站",
    },
  },

  // ---------- 7. 薄内容 ----------
  {
    pageId: "seo_issues_thin_content",
    path: "/seo-issues/thin-content",
    pageType: "Problem landing",
    primaryKeyword: "thin content pages",
    searchIntent: "症状排查（内容太少 / 页面没有回答到问题）",
    problem: "页面字数是够了，但没有回答搜索者真正问的问题",
    coreValue: "说明薄内容的判断标准是覆盖度而不是字数，并区分两个不同的检查信号",
    relatedFeature: CONTENT_FEATURE,
    relatedChecks: ["low-content", "low-text-html-ratio", "no-h2-h3", "semantic-html"],
    internalLinks: ["/seo-issues", "/seo-issues/duplicate-title-tags", "/seo-issues/keyword-cannibalization", CONTENT_FEATURE, AUDIT_ENTRY],
    ctaHref: CONTENT_FEATURE,
    en: {
      metaTitle: "Thin Content: Why Length Alone Is Not the Problem",
      metaDescription: "Thin content is about coverage, not word count. Two different checks report it, and the fix is adding the missing information rather than padding paragraphs.",
      h1: "Thin content is about coverage, not word count",
      lead: "A tool told me some pages are too short, so I added words. They still do not rank. What was I supposed to fix?",
      detectedBy: [
        "low-content — a page with very little text content relative to what it is trying to rank for",
        "low-text-html-ratio — pages where the response is mostly markup rather than readable content",
        "no-h2-h3 — no subheadings, so the page has no visible structure for its subtopics",
        "semantic-html — content not marked up in a way that groups the page into sections",
      ],
      example: "A category page that only lists product names still offers nothing to someone deciding between them — regardless of how many words are on it.",
      faqs: [
        {
          q: "How long should a page be?",
          a: "There is no universal number, and we would not invent one. The useful question is whether the page answers the sub-questions someone searching that phrase would ask.",
        },
        {
          q: "Is adding paragraphs harmful?",
          a: "It is not harmful, it is just not the fix. Repeating existing points increases length without increasing coverage.",
        },
      ],
      ctaLabel: "Score a page against the current top results",
    },
    zh: {
      metaTitle: "薄内容：为什么问题不在字数",
      metaDescription: "薄内容说的是覆盖度而不是字数。两个不同的检查会报出它，修法是补上缺失的信息，而不是把段落灌长。",
      h1: "薄内容是覆盖度问题，不是字数问题",
      lead: "工具说我有几个页面太短，我就加了字数。排名还是没动。到底该修什么？",
      detectedBy: [
        "low-content —— 相对其想排的词，页面正文内容明显过少",
        "low-text-html-ratio —— 响应里大部分是标记而不是可读内容",
        "no-h2-h3 —— 没有任何小标题，页面的子主题没有可见结构",
        "semantic-html —— 内容没有被标记成分节结构",
      ],
      example: "只罗列商品名的分类页，对一个正在比较商品的人依然没有提供任何信息——无论上面有多少字。",
      faqs: [
        { q: "页面应该写多长？", a: "没有通用数字，我们也不会编一个。真正有用的问题是：这个页面有没有回答搜索这句话的人会追问的子问题。" },
        { q: "多写几段有害吗？", a: "没有害处，只是不是这个问题的修法。重复已有观点会增加长度，但不增加覆盖度。" },
      ],
      ctaLabel: "把页面和当前头部结果比一比",
    },
  },

  // ---------- 8. 孤立页 ----------
  {
    pageId: "seo_issues_orphan_pages",
    path: "/seo-issues/orphan-pages",
    pageType: "Problem landing",
    primaryKeyword: "orphan pages seo",
    searchIntent: "症状排查（页面没有内链、发现不了）",
    problem: "有些页面没有任何站内链接指向，只能靠 sitemap 被发现",
    coreValue: "说明孤立页同时缺失发现路径与权重路径，并给出补内链的最小做法",
    relatedFeature: AUDIT_ENTRY,
    relatedChecks: ["orphan-pages", "zero-internal-links", "deep-pages"],
    internalLinks: ["/seo-issues", "/seo-issues/pages-not-indexed", "/seo-issues/broken-internal-links", "/seo-issues/sitemap-errors", AUDIT_ENTRY],
    ctaHref: AUDIT_ENTRY,
    en: {
      metaTitle: "Orphan Pages: Pages Nothing Links To",
      metaDescription: "Orphan pages have no internal links pointing at them, so they are missing both a discovery path and a way to accumulate signals. How to find and fix them.",
      h1: "Orphan pages are missing both discovery and signals",
      lead: "Some of my pages never get traffic even though the content is fine. Could it be that nothing links to them?",
      detectedBy: [
        "orphan-pages — pages with no internal links pointing at them",
        "zero-internal-links — pages that themselves link out to nothing",
        "deep-pages — pages buried so far from the homepage they are rarely reached",
      ],
      example: "A comparison article published and never added to any list, category or related-posts block exists only in the sitemap — nothing on the site points at it.",
      faqs: [
        {
          q: "The sitemap lists it, so does that count?",
          a: "A sitemap entry helps discovery but provides no internal signal and no click path. Treat it as a fallback, not a substitute for linking.",
        },
        {
          q: "What is the smallest useful fix?",
          a: "Link to each orphan page from at least one relevant page that is itself linked. Category pages and related-content blocks are the usual places.",
        },
      ],
      ctaLabel: "See which pages are affected",
    },
    zh: {
      metaTitle: "孤立页：没有任何链接指向的页面",
      metaDescription: "孤立页没有任何站内链接指向它，既缺发现路径，也无法积累信号。如何找出并修复。",
      h1: "孤立页缺的是发现路径与信号两头",
      lead: "有几个页面内容不差，却一直没有流量。会不会是根本没有链接指向它们？",
      detectedBy: [
        "orphan-pages —— 没有任何站内链接指向的页面",
        "zero-internal-links —— 自身也不链向任何页面的页面",
        "deep-pages —— 距首页过深、很少被走到的页面",
      ],
      example: "一篇发出去后没被加进任何列表、分类或相关推荐的文章，只存在于 sitemap 里——站内没有任何地方指向它。",
      faqs: [
        { q: "sitemap 里列了，还算孤立吗？", a: "sitemap 条目有助于被发现，但不提供站内信号，也没有点击路径。它是兜底，不是内链的替代。" },
        { q: "最小的有效修法是什么？", a: "从至少一个「自身有入链的相关页面」链向每个孤立页。分类页与相关推荐位是最常用的位置。" },
      ],
      ctaLabel: "看哪些页面受影响",
    },
  },

  // ---------- 9. 关键词自相竞争 ----------
  {
    pageId: "seo_issues_keyword_cannibalization",
    path: "/seo-issues/keyword-cannibalization",
    pageType: "Problem landing",
    primaryKeyword: "keyword cannibalization",
    searchIntent: "症状排查（站点两页争同一个词，两边都不稳）",
    problem: "同一站点两篇内容争抢同一个查询，两边排名都不稳定",
    coreValue: "说明这是从排名数据诊断（不是爬虫检查），并给出合并/改写/内链三种收敛方式",
    relatedFeature: RANK_FEATURE,
    relatedChecks: ["duplicate-title", "duplicate-description"],
    internalLinks: ["/seo-issues", "/seo-issues/duplicate-title-tags", "/seo-issues/thin-content", KEYWORD_FEATURE, RANK_FEATURE],
    ctaHref: RANK_FEATURE,
    en: {
      metaTitle: "Keyword Cannibalization: Two Pages Competing for One Query",
      metaDescription: "Cannibalization is diagnosed from ranking data, not from a crawl. How to spot two of your own URLs alternating on one query, and the three ways to resolve it.",
      h1: "When two of your own pages compete for one query",
      lead: "I have two pages that target nearly the same phrase. Neither ranks well and I cannot tell which one to edit.",
      detectedBy: [
        "Ranking data — the same query showing two different URLs from your site over time",
        "duplicate-title / duplicate-description — the crawl-side symptom when the two pages also read as duplicates",
      ],
      example: "Your guide page and your feature page alternate on one phrase. Improving either one alone will not help, because the other stays in the way.",
      faqs: [
        {
          q: "Which page should I keep?",
          a: "Usually the one that matches the dominant intent for the query — a decision page or an explainer, depending on what the phrase asks for. Then point the other page at it.",
        },
        {
          q: "Is merging always right?",
          a: "No. If the two pages serve genuinely different intents, keep both and make each one unambiguously about its own phrase, with internal links separating them.",
        },
      ],
      ctaLabel: "Track the change after you fix it",
    },
    zh: {
      metaTitle: "关键词自相竞争：同站两个页面抢一个词",
      metaDescription: "自相竞争是从排名数据诊断的，不是爬虫检查项。如何看出同站两个 URL 在同一个查询上交替出现，以及三种收敛方式。",
      h1: "同站两个页面在抢同一个查询",
      lead: "我有两个页面目标短语几乎一样。两边排名都不好，我也不知道该改哪一个。",
      detectedBy: [
        "排名数据 —— 同一个查询在不同时间出现两个来自你站点的不同 URL",
        "duplicate-title / duplicate-description —— 这两页在爬虫侧也读起来像重复的旁证",
      ],
      example: "你的教程页与功能页在同一个短语上交替出现。只优化其中一页没有用，因为另一页仍在挡路。",
      faqs: [
        { q: "应该保留哪一页？", a: "通常保留与该查询主流意图一致的那一页——按短语在问什么决定是决策页还是解释页。然后把另一页指向它。" },
        { q: "合并永远是正确答案吗？", a: "不是。如果两页服务的是确实不同的意图，就都保留，但要让每一页明确只对应自己的短语，并用内链把两者分开。" },
      ],
      ctaLabel: "修完之后跟踪变化",
    },
  },
];

/** 按 path 取页面（EN 无前缀形式） */
export function landingPageByPath(path: string): LandingPage | undefined {
  return LANDING_PAGES.find((p) => p.path === path);
}

/** 按 pageId 取页面 */
export function landingPageById(pageId: string): LandingPage | undefined {
  return LANDING_PAGES.find((p) => p.pageId === pageId);
}

export function landingCopy(page: LandingPage, locale: Locale): LocaleCopy {
  return locale === "zh" ? page.zh : page.en;
}

/** 全部 H 路径（供 locale 白名单与 sitemap 同步） */
export const LANDING_PAGE_PATHS: readonly string[] = LANDING_PAGES.map((p) => p.path);
