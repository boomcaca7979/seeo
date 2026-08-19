// ===== 历史 Audit 存量文案双语化（读取层兼容）=====
//
// 背景：LText 化（{en, zh}）之前的历史 audit_issues 行，detail / suggestion
// 存的是旧版纯中文模板文本（旧 audit-checks.ts 与当前 zh 文案一致）。
// DB 不做迁移，读取时把旧纯文本按模板映射到当前双语 catalog：
//   - 精确匹配（静态文案）→ 直接替换为当前 locale 文本
//   - 正则匹配（动态文案，如 "标题长度 45 字符（建议 30-60）"）→ 提取动态值后按 locale 重渲染
//   - 未匹配（机器值如 "HTTP 404"、未来新增文案）→ 原样返回，绝不返回空白
//
// 双向映射（Phase 7）：已保存的 reports 快照 / 历史 DB 文本可能是中文或英文
// 纯文本（取决于保存时的 locale）。resolveAuditDetail / resolveAuditSuggestion
// 作为统一读取层 resolver：LText JSON → pickText；已知中文模板 → 目标 locale；
// 已知英文模板 → 目标 locale；未知 → 原文保留。
//
// 所有英文文案均取自 audit-checks.ts 现有 LText catalog，不新造自然语言。
// 本模块为纯函数，服务端（/api/audit/latest）与客户端（reports 快照渲染）共用。

export type UiLocale = "en" | "zh";

interface StaticEntry {
  zh: string;
  en: string;
}

interface PatternEntry {
  /** 匹配旧中文文本（含捕获组） */
  pattern: RegExp;
  /** 用捕获组渲染英文 */
  en: (m: RegExpMatchArray) => string;
}

// ---------- detail（message）静态模板 ----------

const legacyDetailStatic: StaticEntry[] = [
  { zh: "页面缺少 <title> 标签", en: "Page has no <title> tag" },
  { zh: "页面缺少 meta description 标签", en: "Page has no meta description tag" },
  { zh: "页面缺少 H1 标签", en: "Page has no H1 tag" },
  { zh: "页面缺少 canonical 标签", en: "Page has no canonical tag" },
  { zh: "页面未使用 HTTPS 协议", en: "Page is not served over HTTPS" },
  { zh: "<html> 标签缺少 lang 属性", en: "The <html> tag has no lang attribute" },
  { zh: "页面缺少 viewport meta 标签", en: "Page has no viewport meta tag" },
  // 旧版（v1.0）no-robots-meta：缺失 robots meta 曾被视为问题，现已改为仅阻止指令触发
  { zh: "页面缺少 robots meta 标签", en: "Page has no robots meta tag" },
  // 旧版（v1.0）js-redirect：该检查项已从 catalog 移除，历史行仍需读取层映射
  { zh: "页面检测到 JS 重定向（window.location）", en: "JS redirect detected on the page (window.location)" },
  { zh: "页面未检测到 JSON-LD 结构化数据", en: "No JSON-LD structured data detected" },
  { zh: "JSON-LD 存在但 JSON 格式错误，无法解析", en: "JSON-LD present but JSON is malformed and cannot be parsed" },
  { zh: "JSON-LD @graph 节点缺少 @context 或 @type", en: "A JSON-LD @graph node is missing @context or @type" },
  { zh: "JSON-LD 缺少 @context 或 @type 字段", en: "JSON-LD is missing @context or @type" },
  { zh: "缺少 og:title", en: "Missing og:title" },
  { zh: "缺少 og:title 和 og:description", en: "Missing og:title and og:description" },
  { zh: "页面缺少 twitter:card 标签", en: "Page has no twitter:card tag" },
  { zh: "页面缺少 favicon 引用", en: "Page has no favicon reference" },
  { zh: "页面无 H2 和 H3 标签", en: "Page has no H2 or H3 tags" },
  { zh: "robots.txt 中未声明 Sitemap", en: "robots.txt does not declare a Sitemap" },
  { zh: "抓取超时（10s）", en: "Fetch timed out (10s)" },
  { zh: "首页抓取超时（重试 12s 仍失败）", en: "Homepage fetch timed out (retry at 12s still failed)" },
  { zh: "未知错误", en: "Unknown error" },
  {
    zh: "起始页未能解析，单页检查项未执行，本次审计结果不可用",
    en: "The start page could not be parsed; per-page checks were not executed and this audit is unusable",
  },
];

// ---------- detail（message）动态模板 ----------

const legacyDetailPatterns: PatternEntry[] = [
  { pattern: /^(\d+)\/(\d+) 张图片缺少 alt 属性$/, en: (m) => `${m[1]}/${m[2]} images missing alt attribute` },
  { pattern: /^标题长度 (\d+) 字符（建议 30-60）$/, en: (m) => `Title length ${m[1]} characters (recommended 30-60)` },
  { pattern: /^描述长度 (\d+) 字符（建议 120-160）$/, en: (m) => `Description length ${m[1]} characters (recommended 120-160)` },
  { pattern: /^robots meta 包含阻止指令：(.+)$/, en: (m) => `robots meta contains blocking directives: ${m[1]}` },
  { pattern: /^响应时间 ([\d.]+)s（>3s）$/, en: (m) => `Response time ${m[1]}s (>3s)` },
  { pattern: /^内联样式 ([\d,]+) 字符（>5000）$/, en: (m) => `Inline styles ${m[1]} characters (>5000)` },
  { pattern: /^"(.*)" 在 (\d+) 个页面重复$/, en: (m) => `"${m[1]}" duplicated across ${m[2]} pages` },
  { pattern: /^网络错误：(.+)$/, en: (m) => `Network error: ${m[1]}` },
];

// ---------- suggestion 静态模板 ----------

const legacySuggestionStatic: StaticEntry[] = [
  { zh: "添加 30-60 字符的标题，包含主关键词", en: "Add a 30-60 character title containing the primary keyword" },
  { zh: "添加 120-160 字符的描述，包含主关键词与卖点", en: "Add a 120-160 character description with primary keyword and value proposition" },
  { zh: "每个页面保留一个唯一的 H1，包含主关键词", en: "Keep one unique H1 per page containing the primary keyword" },
  { zh: "为信息性图片添加描述性 alt，装饰性图片留空 alt", en: "Add descriptive alt to informative images; leave alt empty for decorative ones" },
  { zh: "设置 canonical 避免重复内容惩罚", en: "Set canonical to avoid duplicate-content penalties" },
  { zh: "部署 SSL 证书并强制 HTTPS 重定向", en: "Install an SSL certificate and enforce HTTPS redirects" },
  { zh: "调整标题长度至 30-60 字符，主关键词靠前", en: "Adjust title length to 30-60 characters with the primary keyword up front" },
  { zh: "调整描述长度至 120-160 字符", en: "Adjust description length to 120-160 characters" },
  { zh: '添加 lang 属性，如 <html lang="zh-CN">', en: 'Add a lang attribute, e.g. <html lang="zh-CN">' },
  { zh: '添加 <meta name="viewport" content="width=device-width, initial-scale=1">', en: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">' },
  { zh: '添加 <meta name="robots" content="index, follow">（非强制）', en: 'Add <meta name="robots" content="index, follow"> (optional)' },
  { zh: "改用服务端 301/302 重定向", en: "Use server-side 301/302 redirects instead" },
  { zh: "确认是否需要阻止搜索引擎索引此页面；如不需要，移除对应指令", en: "Confirm whether this page should be blocked; remove the directives if not" },
  { zh: "压缩图片、启用缓存、减少 JS 阻塞", en: "Compress images, enable caching, and reduce blocking JS" },
  { zh: '添加 <script type="application/ld+json"> 提升搜索结果展示', en: 'Add <script type="application/ld+json"> to enrich search results' },
  { zh: '修正 <script type="application/ld+json"> 内的 JSON 语法', en: 'Fix the JSON syntax inside <script type="application/ld+json">' },
  { zh: "确保每个 JSON-LD 节点包含 @context 和 @type 字段", en: "Ensure every JSON-LD node includes @context and @type" },
  { zh: "确保 JSON-LD 包含 @context（如 https://schema.org）和 @type 字段", en: "Ensure JSON-LD includes @context (e.g. https://schema.org) and @type" },
  { zh: "添加 og:title、og:description、og:image 标签优化社交分享", en: "Add og:title, og:description and og:image to improve social sharing" },
  { zh: '添加 <meta name="twitter:card" content="summary_large_image">', en: 'Add <meta name="twitter:card" content="summary_large_image">' },
  { zh: '添加 <link rel="icon" href="/favicon.ico">', en: 'Add <link rel="icon" href="/favicon.ico">' },
  { zh: "将内联样式提取到外部 CSS 文件", en: "Extract inline styles into an external CSS file" },
  { zh: "使用 H2/H3 分层组织内容，提升可读性与 SEO", en: "Use H2/H3 to structure content for readability and SEO" },
  { zh: "为每个页面编写唯一的 title", en: "Write a unique title for every page" },
  { zh: "为每个页面编写唯一的 meta description", en: "Write a unique meta description for every page" },
  { zh: "为每个页面编写唯一的 H1", en: "Write a unique H1 for every page" },
  { zh: "在 robots.txt 中添加 Sitemap: https://example.com/sitemap.xml", en: "Add Sitemap: https://example.com/sitemap.xml to robots.txt" },
  { zh: "添加 301 重定向到相关页面，或恢复缺失内容", en: "Add a 301 redirect to a relevant page or restore the missing content" },
  { zh: "检查服务器状态与页面可用性", en: "Check server status and page availability" },
  { zh: "优化服务器响应时间，检查后端服务状态", en: "Improve server response time and check backend health" },
  { zh: "检查域名解析与服务器可达性", en: "Check DNS resolution and server reachability" },
  { zh: "检查 URL 是否可访问", en: "Check that the URL is reachable" },
  {
    zh: "请稍后重试，或检查目标站点是否可访问。冷启动场景下重试一次通常可成功",
    en: "Retry later or verify the target site is reachable; a single retry usually succeeds after cold start",
  },
];

function mapStatic(catalog: StaticEntry[], text: string, locale: UiLocale): string | null {
  for (const entry of catalog) {
    if (text === entry.zh) return locale === "en" ? entry.en : entry.zh;
  }
  return null;
}

function mapPatterns(catalog: PatternEntry[], text: string, locale: UiLocale): string | null {
  for (const entry of catalog) {
    const m = text.match(entry.pattern);
    if (m) return locale === "en" ? entry.en(m) : text;
  }
  return null;
}

/** 反向静态映射：英文模板 → 中文（用于以英文保存的快照/结果在 ZH 下回读） */
function mapStaticReverse(catalog: StaticEntry[], text: string, locale: UiLocale): string | null {
  for (const entry of catalog) {
    if (text === entry.en) return locale === "zh" ? entry.zh : entry.en;
  }
  return null;
}

// ---------- 反向动态模板（英文 → 中文） ----------

const legacyDetailPatternsReverse: Array<{ pattern: RegExp; zh: (m: RegExpMatchArray) => string }> = [
  { pattern: /^(\d+)\/(\d+) images missing alt attribute$/, zh: (m) => `${m[1]}/${m[2]} 张图片缺少 alt 属性` },
  { pattern: /^Title length (\d+) characters \(recommended 30-60\)$/, zh: (m) => `标题长度 ${m[1]} 字符（建议 30-60）` },
  { pattern: /^Description length (\d+) characters \(recommended 120-160\)$/, zh: (m) => `描述长度 ${m[1]} 字符（建议 120-160）` },
  { pattern: /^robots meta contains blocking directives: (.+)$/, zh: (m) => `robots meta 包含阻止指令：${m[1]}` },
  { pattern: /^Response time ([\d.]+)s \(>3s\)$/, zh: (m) => `响应时间 ${m[1]}s（>3s）` },
  { pattern: /^Inline styles ([\d,]+) characters \(>5000\)$/, zh: (m) => `内联样式 ${m[1]} 字符（>5000）` },
  { pattern: /^"(.*)" duplicated across (\d+) pages$/, zh: (m) => `"${m[1]}" 在 ${m[2]} 个页面重复` },
  { pattern: /^Network error: (.+)$/, zh: (m) => `网络错误：${m[1]}` },
];

function mapPatternsReverse(text: string, locale: UiLocale): string | null {
  for (const entry of legacyDetailPatternsReverse) {
    const m = text.match(entry.pattern);
    if (m) return locale === "zh" ? entry.zh(m) : text;
  }
  return null;
}

/**
 * 历史 detail（message）纯文本 → 按 locale 展示文本。
 * 未匹配任何模板时原样返回（机器值 / 未知文案兜底）。
 */
export function localizeLegacyDetail(text: string, locale: UiLocale): string {
  if (locale === "zh") return text;
  return mapStatic(legacyDetailStatic, text, locale) ?? mapPatterns(legacyDetailPatterns, text, locale) ?? text;
}

/**
 * 历史 suggestion 纯文本 → 按 locale 展示文本。
 * 未匹配任何模板时原样返回。
 */
export function localizeLegacySuggestion(text: string, locale: UiLocale): string {
  if (locale === "zh") return text;
  return mapStatic(legacySuggestionStatic, text, locale) ?? text;
}

// ---------- 统一读取层 resolver（LText JSON + 双向模板映射） ----------

/**
 * 判断字符串是否为序列化的 LText（{en, zh} JSON），是则解析返回。
 * 兼容旧数据：非 JSON 或字段不完整时返回 null。
 */
function parseLTextJson(raw: string): { en: string; zh: string } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes('"en"') || !trimmed.includes('"zh"')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { en?: unknown; zh?: unknown };
    if (parsed && typeof parsed.en === "string" && typeof parsed.zh === "string") {
      return { en: parsed.en, zh: parsed.zh };
    }
  } catch {
    // 非 JSON LText，按原文处理
  }
  return null;
}

/**
 * 统一 Audit detail/message 读取层 resolver：
 * 1. LText JSON（新数据）→ 按 locale 选取
 * 2. 已知中文模板（历史 DB / ZH 保存的快照）→ 映射为当前 locale
 * 3. 已知英文模板（EN 保存的快照）→ 映射为当前 locale
 * 4. 未知文本 / 机器值（HTTP 404、用户原始数据）→ 原样返回，绝不返回空白
 */
export function resolveAuditDetail(raw: string | null | undefined, locale: UiLocale): string | null {
  if (raw === null || raw === undefined) return null;
  const ltext = parseLTextJson(raw);
  if (ltext) return ltext[locale];
  if (locale === "en") {
    return mapStatic(legacyDetailStatic, raw, locale) ?? mapPatterns(legacyDetailPatterns, raw, locale) ?? raw;
  }
  return mapStaticReverse(legacyDetailStatic, raw, locale) ?? mapPatternsReverse(raw, locale) ?? raw;
}

/**
 * 统一 Audit suggestion 读取层 resolver（规则同 resolveAuditDetail）。
 */
export function resolveAuditSuggestion(raw: string | null | undefined, locale: UiLocale): string | null {
  if (raw === null || raw === undefined) return null;
  const ltext = parseLTextJson(raw);
  if (ltext) return ltext[locale];
  if (locale === "en") {
    return mapStatic(legacySuggestionStatic, raw, locale) ?? raw;
  }
  return mapStaticReverse(legacySuggestionStatic, raw, locale) ?? raw;
}

// ---------- 报告标题读取层双语化 ----------

/**
 * 已保存报告的标题由保存时的 locale 模板生成（如 "Audit Report · x.com" /
 * "审计报告 · x.com"）。列表展示时按当前 locale 双向映射；
 * 未知标题（用户数据）原样返回。
 */
const REPORT_TITLE_PREFIXES: Array<{ en: string; zh: string }> = [
  { en: "Audit Report", zh: "审计报告" },
  { en: "Ranking Report", zh: "排名报告" },
  { en: "Content Report", zh: "内容报告" },
  { en: "Weekly Report", zh: "周报" },
];

export function localizeReportTitle(title: string, locale: UiLocale): string {
  for (const p of REPORT_TITLE_PREFIXES) {
    if (title.startsWith(`${p.en} · `)) {
      return locale === "zh" ? `${p.zh} · ${title.slice(p.en.length + 3)}` : title;
    }
    if (title.startsWith(`${p.zh} · `)) {
      return locale === "en" ? `${p.en} · ${title.slice(p.zh.length + 3)}` : title;
    }
  }
  return title;
}
