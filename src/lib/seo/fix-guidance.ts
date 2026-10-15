// ===== 规则级修复指导（纯数据 + 纯函数，client/server 共享，零依赖）=====
//
// 纪律：
// - 每条指导必须与 audit-checks.ts 中该规则的真实检测逻辑对应（检测什么，就指导什么），
//   不编造任何 CMS/框架的具体设置路径——SeeO 不知道用户的建站工具，
//   不知道的部分在 notKnown 中如实说明。
// - 本模块不参与任何评分/排序；优先级唯一来源仍是 issue-priority.ts。
// - 无指导的规则返回 null，UI 回退到规则自带 recommendation（不虚构步骤）。

export type LocalizedText = string | { en: string; zh: string };

export interface FixGuidanceStep {
  /** 行动语言的步骤标题 */
  title: LocalizedText;
  /** 具体说明：看什么、改什么 */
  detail: LocalizedText;
}

export interface FixGuidance {
  /** 到哪里找问题（页面 head / 页面内容 / 图片 / 链接 / 全站模板层面） */
  where: LocalizedText;
  steps: FixGuidanceStep[];
  /** 改完后的自查方法（在重新审计前就能自己确认） */
  checkAfter: LocalizedText;
  /** SeeO 再审计会检查什么、依据什么证据判定 */
  verifyNote: LocalizedText;
  /** SeeO 无法确定、需要用户自行确认的部分（诚实边界） */
  notKnown?: LocalizedText;
}

const pair = (e: string, z: string): LocalizedText => ({ en: e, zh: z });

/** 各规则的具体修复指导；仅覆盖有把握给出可执行步骤的规则 */
const GUIDES: Record<string, FixGuidance> = {
  "missing-title": {
    where: pair(
      "Each affected page's <head> section (in a CMS or site builder this is usually the page's “SEO title” field)",
      "每个受影响页面的 <head> 区域（如果用 CMS 或建站工具，通常是页面的「SEO 标题」字段）"
    ),
    steps: [
      {
        title: pair("Open the first affected URL from the list below", "从下方列表打开第一个受影响页面"),
        detail: pair(
          "Right-click → View page source, search for <title>; if you find none, the page really has no title",
          "右键「查看网页源代码」，搜索 <title>；找不到即确认缺失"
        ),
      },
      {
        title: pair("Write a 30-60 character title", "为页面补一个 30-60 字符的标题"),
        detail: pair(
          "Say what the page is about, put the main keyword near the front, avoid stacking keywords",
          "说明这页是关于什么的，把主要关键词放在靠前位置，不要堆砌关键词"
        ),
      },
      {
        title: pair("Do the same for the remaining affected pages", "对其余受影响页面做同样处理"),
        detail: pair(
          "Each page gets its own title — copy-pasting the same title will trigger the duplicate-title issue instead",
          "每个页面单独写，不要互相复制——复制会造成「重复标题」问题"
        ),
      },
    ],
    checkAfter: pair(
      "View the page source again and confirm the <title> tag now exists and shows your new title",
      "重新查看源代码，确认 <title> 标签已存在且内容是刚写的标题"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls these pages and checks whether a <title> tag is present. If every affected page has one, the issue is marked verified resolved",
      "重新审计时 SeeO 会重新抓取这些页面并检查 <title> 是否存在。所有受影响页面都有了，问题就会标记为「已验证解决」"
    ),
    notKnown: pair(
      "SeeO knows which pages lack a title, but not which tool builds your pages — the exact editing screen depends on your CMS or site builder",
      "SeeO 知道哪些页面缺标题，但不知道你的页面由什么工具生成——具体在哪个界面编辑取决于你使用的 CMS 或建站工具"
    ),
  },

  "missing-description": {
    where: pair(
      "Each affected page's <head> section (in a CMS this is usually the page's “meta description / SEO description” field)",
      "每个受影响页面的 <head> 区域（如果用 CMS，通常是页面的「meta description / SEO 描述」字段）"
    ),
    steps: [
      {
        title: pair("Open an affected URL and confirm the gap", "打开一个受影响页面，确认缺失"),
        detail: pair(
          "View page source and search for name=\"description\"; missing means search engines pick a random snippet for this page",
          "查看源代码搜索 name=\"description\"；缺失时，搜索结果摘要会由搜索引擎随机截取"
        ),
      },
      {
        title: pair("Write a 120-160 character description", "写一段 120-160 字符的描述"),
        detail: pair(
          "Answer in one or two sentences: what this page offers and why it is worth clicking — like a free ad for the page",
          "用一两句话说清：这页提供什么、为什么值得点进来——相当于页面的免费广告位"
        ),
      },
      {
        title: pair("Fill it in for every affected page", "为每个受影响页面补齐"),
        detail: pair(
          "Prioritize pages that matter most (homepage, key landing pages), then work down the affected URL list",
          "优先处理重要页面（首页、核心落地页），再按受影响 URL 列表逐个补齐"
        ),
      },
    ],
    checkAfter: pair(
      "View the page source again and confirm the description meta tag exists with your new text",
      "重新查看源代码，确认 description meta 标签已存在且是新写的文案"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls the affected pages and checks the meta description tag. No missing descriptions left → verified resolved",
      "重新审计时 SeeO 会重新抓取受影响页面并检查 meta description。不再有缺失 → 标记为「已验证解决」"
    ),
    notKnown: pair(
      "SeeO cannot tell which field in your CMS feeds this tag — check your CMS documentation for “meta description”",
      "SeeO 无法判断你的 CMS 里哪个字段对应这个标签——请在你所用工具的帮助文档里查「meta description」"
    ),
  },

  "missing-h1": {
    where: pair(
      "The main content area of each affected page (the visually prominent headline, usually the biggest text at the top)",
      "每个受影响页面的正文主体区域（页面上最显眼的主标题，通常是顶部最大的那行字）"
    ),
    steps: [
      {
        title: pair("Open the page and find the main headline", "打开页面，找到页面的主标题"),
        detail: pair(
          "View source and search for <h1 — if there is none, the visual headline is probably just styled text (a <div> or <p>), not a real H1",
          "查看源代码搜索 <h1——如果没有，说明看到的“大标题”只是带样式的普通文本，不是真正的 H1"
        ),
      },
      {
        title: pair("Turn that headline into a real H1", "把那行主标题改成真正的 H1"),
        detail: pair(
          "In an editor, use the “Heading 1” style; in code, wrap the text in a single <h1> tag — one per page",
          "在编辑器里给它套用「标题 1 / Heading 1」样式；改代码则用一个 <h1> 标签包裹——每页只保留一个"
        ),
      },
    ],
    checkAfter: pair(
      "View source again and confirm exactly one <h1> containing the headline text",
      "重新查看源代码，确认恰好有一个 <h1> 且内容是主标题"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls and counts H1 tags per page. Pages with an H1 no longer fail",
      "重新审计时 SeeO 会重新抓取并统计每页的 H1 数量。有 H1 的页面不再被判失败"
    ),
  },

  "missing-alt": {
    where: pair(
      "The <img> tags on each affected page (every image the audit counted)",
      "受影响页面上的 <img> 标签（审计统计到的每一张图）"
    ),
    steps: [
      {
        title: pair("Open an affected page — the finding shows how many images lack alt", "打开受影响页面——发现信息里写明了几张图缺 alt"),
        detail: pair(
          "View source, search for <img, and find tags without an alt attribute (or with alt=\"\")",
          "查看源代码搜索 <img，找出没有 alt 属性或 alt 为空的标签"
        ),
      },
      {
        title: pair("Describe informative images; mark decorative ones as decorative", "信息性图片写描述，装饰性图片标记为装饰"),
        detail: pair(
          "Photos/charts/icons that carry meaning: write one short sentence describing what they show. Pure decoration (backgrounds, dividers): an empty alt=\"\" is correct — do not delete the alt attribute itself",
          "承载信息的照片/图表/图标：用一句话写清它展示的内容。纯装饰（背景、分隔线）：留空 alt=\"\" 是正确做法——但不要删掉 alt 属性本身"
        ),
      },
    ],
    checkAfter: pair(
      "Re-search <img in the source and confirm every tag has an alt attribute",
      "重新搜索源代码中的 <img，确认每个标签都有 alt 属性"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls and recounts images missing alt on the affected pages",
      "重新审计时 SeeO 会重新抓取并重新统计受影响页面上缺 alt 的图片数量"
    ),
  },

  "title-length": {
    where: pair(
      "The existing <title> tag of each affected page (the audit shows the current length)",
      "受影响页面上已有的 <title> 标签（发现信息里写明了当前长度）"
    ),
    steps: [
      {
        title: pair("Check the current length in the finding message", "从发现信息里看当前长度"),
        detail: pair(
          "Too long: search engines truncate it in results. Too short: it wastes the most prominent ranking surface",
          "过长：搜索结果里会被截断；过短：浪费了排名展示位里最显眼的位置"
        ),
      },
      {
        title: pair("Rewrite the title to 30-60 characters", "把标题改写到 30-60 字符"),
        detail: pair(
          "Keep the main keyword near the front; cut filler words from long titles, add what the page covers to short ones",
          "主关键词靠前；过长的删掉冗词，过短的补充页面实际覆盖的内容"
        ),
      },
    ],
    checkAfter: pair(
      "Confirm the new title length is within 30-60 characters",
      "确认新标题长度在 30-60 字符之间"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO measures title length again. Within range → the page no longer fails",
      "重新审计时 SeeO 会重新测量标题长度。在范围内 → 该页面不再判失败"
    ),
  },

  "description-length": {
    where: pair(
      "The existing meta description of each affected page (the audit shows the current length)",
      "受影响页面上已有的 meta description（发现信息里写明了当前长度）"
    ),
    steps: [
      {
        title: pair("Check the current length in the finding message", "从发现信息里看当前长度"),
        detail: pair(
          "Too long: Google truncates it. Too short: it underuses the snippet Google may show",
          "过长：会被截断；过短：没有充分利用搜索结果里可能展示的摘要位"
        ),
      },
      {
        title: pair("Rewrite it to 120-160 characters", "把描述改写到 120-160 字符"),
        detail: pair(
          "One or two complete sentences: what the page offers + who it is for + why click",
          "一到两个完整句子：提供什么 + 给谁看 + 为什么点进来"
        ),
      },
    ],
    checkAfter: pair(
      "Confirm the new description length is within 120-160 characters",
      "确认新描述长度在 120-160 字符之间"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO measures the description length again",
      "重新审计时 SeeO 会重新测量描述长度"
    ),
  },

  "low-content": {
    where: pair(
      "The main text content of each affected page (the finding shows the word count and threshold)",
      "受影响页面的正文文字内容（发现信息里写明了当前词数和阈值）"
    ),
    steps: [
      {
        title: pair("Open the page and read it as a visitor", "以访客视角打开并通读该页面"),
        detail: pair(
          "Ask yourself: can a visitor learn anything useful from this page? If it is nearly empty, that is the real problem",
          "自问：访客能从这页获得有用的信息吗？如果几乎为空，问题就在内容本身"
        ),
      },
      {
        title: pair("Add genuinely useful content — or merge the page", "补充真正有用的内容，或合并页面"),
        detail: pair(
          "Add answers to real questions your visitors have. If the page duplicates another one, redirect it to the better page instead of padding it with filler — padding does not help rankings",
          "补充能回答访客真实问题的内容。如果这页与其他页面重复，更应重定向到更好的那页，而不是硬凑字数——凑字数对排名没有帮助"
        ),
      },
    ],
    checkAfter: pair(
      "The page should read as a complete, self-sufficient answer to what a visitor searched for",
      "页面读起来应是一份完整、能独立回答访客问题的内容"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls and re-counts the page's word count against the threshold",
      "重新审计时 SeeO 会重新抓取并按阈值重新统计页面词数"
    ),
  },

  "low-text-html-ratio": {
    where: pair(
      "The whole page weight of each affected page: HTML markup, inline styles and scripts versus the visible text (the finding shows both sizes)",
      "受影响页面的整体体积构成：HTML 标记、内联样式和脚本相对于可见文本的比例（发现信息里给出了两个数值）"
    ),
    steps: [
      {
        title: pair("Look at the ratio first — it tells you which side is the problem", "先看比例——它告诉你问题出在哪一侧"),
        detail: pair(
          "Visible text far smaller than HTML size means the page carries a lot of markup/scripts relative to its readable content",
          "可见文本远小于 HTML 体积，说明页面承载了大量标记/脚本，而可读内容偏少"
        ),
      },
      {
        title: pair("Shrink the HTML side: reduce script and style bloat", "缩小 HTML 一侧：精简脚本与样式体积"),
        detail: pair(
          "Common culprits: large inline <style>/<script> blocks that could be external files, leftover code from removed features, minification not enabled",
          "常见原因：本可外置的大段内联 <style>/<script>、已删除功能残留的代码、未开启压缩/最小化"
        ),
      },
      {
        title: pair("Or grow the text side: add meaningful visible content", "或增大文本一侧：补充有价值的可见内容"),
        detail: pair(
          "Substantive copy that visitors actually read — not hidden text or keyword stuffing, which search engines penalize",
          "是访客真正会读的实质内容——不是隐藏文字或关键词堆砌，那些会被搜索引擎惩罚"
        ),
      },
    ],
    checkAfter: pair(
      "Compare page weight before/after your change (browser DevTools → Network → document size); the ratio should move toward balance",
      "对比改动前后的页面体积（浏览器开发者工具 → Network → 文档大小）；比例应向均衡方向变化"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls, re-measures visible text vs HTML size, and recomputes the ratio against the 10% threshold",
      "重新审计时 SeeO 会重新抓取、重新测量可见文本与 HTML 体积，并按 10% 阈值重新计算比例"
    ),
    notKnown: pair(
      "SeeO measures the sizes but does not parse how your site is built — which specific files or templates to slim down requires checking your own source",
      "SeeO 只测量体积，不解析你的站点构建方式——具体压缩哪些文件或模板需要你自己查看源码确认"
    ),
  },

  "broken-links": {
    where: pair(
      "The broken link targets listed below (SeeO found them by following internal links and receiving 4xx/5xx responses)",
      "下方列出的失效链接目标（SeeO 沿站内链接访问时收到了 4xx/5xx 响应）"
    ),
    steps: [
      {
        title: pair("Open each broken URL from the affected list and check the HTTP status", "逐个打开受影响列表中的失效 URL，确认 HTTP 状态"),
        detail: pair(
          "404 = page removed or URL typo; 5xx = server error; network error = DNS/domain problems",
          "404 = 页面已删除或 URL 写错；5xx = 服务器错误；网络错误 = 域名/DNS 问题"
        ),
      },
      {
        title: pair("If the content should still exist: restore it or redirect", "内容应该还在的：恢复页面或设置重定向"),
        detail: pair(
          "Restore the page at that URL, or add a 301 redirect from it to the most relevant existing page",
          "在该 URL 上恢复内容，或添加 301 重定向指向最相关的现存页面"
        ),
      },
      {
        title: pair("If the content is gone for good: fix the links pointing at it", "内容确定不要了的：修正指向它的链接"),
        detail: pair(
          "Search your site for the broken URL and update or remove those links",
          "在站内搜索这个失效 URL，更新或删除指向它的链接"
        ),
      },
    ],
    checkAfter: pair(
      "Visit each URL again — it should now return 200 (or redirect to a working page)",
      "再次访问每个 URL——应返回 200（或重定向到正常页面）"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO follows internal links again and re-checks each target's HTTP response",
      "重新审计时 SeeO 会重新沿站内链接访问并复查每个目标的 HTTP 响应"
    ),
    notKnown: pair(
      "SeeO records the broken target URL, but not which of your pages link to it — use your site search/CMS to locate the linking pages, or solve it site-wide with a 301 redirect",
      "SeeO 记录了失效的目标 URL，但没有记录是哪些页面链接到它——需要你在站内搜索该 URL 定位引用位置，或直接用全站 301 重定向解决"
    ),
  },

  "duplicate-title": {
    where: pair(
      "Site-wide: several pages share the exact same <title> (the finding shows the duplicated text and page count)",
      "全站层面：多个页面使用了完全相同的 <title>（发现信息里给出了重复的标题文本和页面数）"
    ),
    steps: [
      {
        title: pair("Open the affected URLs and see what the shared title is", "打开受影响 URL，看重复的标题是什么"),
        detail: pair(
          "Templates that print the same title everywhere (e.g. the site name only) are the usual cause — fixing the template fixes all pages at once",
          "常见原因是模板对所有页面输出同一个标题（比如只有站点名）——改模板一处即可修复全部页面"
        ),
      },
      {
        title: pair("Give each page a title that states its own topic", "为每个页面写明它自己的主题"),
        detail: pair(
          "Pattern that works: “page topic — section — site name”. Keep each unique",
          "可参考的结构：「页面主题 - 栏目 - 站点名」，保证每个页面唯一"
        ),
      },
    ],
    checkAfter: pair(
      "Check the affected pages' <title> tags are now different from each other",
      "确认受影响页面的 <title> 已互不相同"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls and re-groups pages by title. No duplicates left → verified resolved",
      "重新审计时 SeeO 会重新抓取并按标题分组。不再有重复 → 标记为「已验证解决」"
    ),
  },

  "duplicate-description": {
    where: pair(
      "Site-wide: several pages share the exact same meta description",
      "全站层面：多个页面使用了完全相同的 meta description"
    ),
    steps: [
      {
        title: pair("Open the affected URLs and compare their actual content", "打开受影响 URL，对比它们的实际内容"),
        detail: pair(
          "Same description on different pages usually means a template default was never customized per page",
          "不同页面同一描述，通常是模板默认值没有按页面定制"
        ),
      },
      {
        title: pair("Write a description that reflects each page's own content", "为每个页面写符合其内容的描述"),
        detail: pair(
          "120-160 characters, specific to what that page offers",
          "120-160 字符，写清该页面具体提供什么"
        ),
      },
    ],
    checkAfter: pair(
      "Confirm the affected pages' descriptions are now different from each other",
      "确认受影响页面的描述已互不相同"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls and re-groups pages by description",
      "重新审计时 SeeO 会重新抓取并按描述分组"
    ),
  },

  "no-h2-h3": {
    where: pair(
      "The body content of each affected page (its section structure)",
      "受影响页面的正文内容（章节结构）"
    ),
    steps: [
      {
        title: pair("Outline the page as if it were a document", "把页面当成一份文档来列提纲"),
        detail: pair(
          "One H1 for the topic; H2 for each major section; H3 for sub-points. If the page is one wall of text, readers and search engines cannot scan it",
          "一个 H1 定主题；每个大章节用 H2；细分点用 H3。如果整页是一大段文字，访客和搜索引擎都无法快速理解结构"
        ),
      },
      {
        title: pair("Turn section headings into real H2/H3 tags", "把章节标题改成真正的 H2/H3 标签"),
        detail: pair(
          "Use the editor's Heading 2 / Heading 3 styles, or wrap them in <h2>/<h3> in code",
          "在编辑器里用「标题 2 / 标题 3」样式，或改代码用 <h2>/<h3> 包裹"
        ),
      },
    ],
    checkAfter: pair(
      "View source: the page should have H1 → H2 → H3 in a tree, not just styled paragraphs",
      "查看源代码：页面应有 H1 → H2 → H3 的层级结构，而不是只有带样式的段落"
    ),
    verifyNote: pair(
      "Re-run the audit: SeeO re-crawls and recounts the page's H2/H3 headings",
      "重新审计时 SeeO 会重新抓取并统计页面的 H2/H3 数量"
    ),
  },
};

/**
 * 取某规则的修复指导；未覆盖的规则返回 null（UI 回退到规则自带 recommendation，
 * 并如实说明 SeeO 无法给出更具体的步骤）。
 */
export function getFixGuidance(ruleId: string): FixGuidance | null {
  return GUIDES[ruleId] ?? null;
}
