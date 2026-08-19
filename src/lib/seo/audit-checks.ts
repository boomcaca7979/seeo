// ===== 审计检查项：20+ 项单页 + 跨页检查 =====
// 每项检查返回统一结构 AuditIssue，null 表示通过
// 健康分基于权重总和计算
//
// 本地化（Phase 6）：用户可见文案（checkName / message / suggestion /
// CheckMeta.name / description）以 LText {en, zh} 输出，由渲染端按 UI locale
// 用 pickText() 选择；checkId / category / severity / weight 为机器协议值，
// 永不改变。历史存量数据中的纯中文 string 由 pickText 直接兼容返回。

import type { PageData } from "@/lib/crawl";

// ---------- 本地化文本 ----------

/** 双语文本：en / zh 各一份（渲染端按 locale 选取） */
export interface LText {
  en: string;
  zh: string;
}

/** 兼容类型：新数据为 LText，历史存量数据为纯文本 string */
export type LocalizedText = string | LText;

/** 按 locale 选取文本；string（历史数据）直接返回 */
export function pickText(t: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (t === null || t === undefined) return "";
  return typeof t === "string" ? t : t[locale];
}

export type CheckCategory = "critical" | "warning" | "info";
export type IssueSeverity = "error" | "warning" | "notice";

export interface AuditIssue {
  checkId: string;
  checkName: LocalizedText;
  message: LocalizedText;
  url: string;
  severity: IssueSeverity;
  suggestion: LocalizedText;
}

export interface AuditCheck {
  id: string;
  name: LText;
  category: CheckCategory;
  weight: number;
  description: LText;
  /** 单页检查：返回 AuditIssue 或 null（通过） */
  check(page: PageData, baseUrl: string): AuditIssue | null;
}

export interface CrossPageCheck {
  id: string;
  name: LText;
  category: CheckCategory;
  weight: number;
  description: LText;
  /** 跨页检查：接收所有页面数据，返回 AuditIssue 数组 */
  crossCheck(pages: PageData[], baseUrl: string, extra: CrossPageExtra): AuditIssue[];
}

export interface CrossPageExtra {
  robotsText: string | null;
  brokenLinks: Array<{ url: string; statusCode: number }>;
}

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 120;
const DESC_MAX = 160;
const SLOW_PAGE_MS = 3000;
const INLINE_CSS_LIMIT = 5000;

function categoryToSeverity(cat: CheckCategory): IssueSeverity {
  if (cat === "critical") return "error";
  if (cat === "warning") return "warning";
  return "notice";
}

type IssueCheckMeta = Omit<AuditCheck, "check">;

function makeIssue(
  check: IssueCheckMeta,
  page: PageData,
  message: LText,
  suggestion: LText
): AuditIssue {
  return {
    checkId: check.id,
    checkName: check.name,
    message,
    url: page.url,
    severity: categoryToSeverity(check.category),
    suggestion,
  };
}

// ---------- 单页检查（20 项）----------

export const perPageChecks: AuditCheck[] = [
  {
    id: "missing-title",
    name: { en: "Missing title", zh: "缺失标题" },
    category: "critical",
    weight: 5,
    description: {
      en: "Every page must have a unique <title> tag",
      zh: "每个页面必须有唯一的 <title> 标签",
    },
    check: (page) => {
      if (!page.title) {
        return makeIssue(
          { id: "missing-title", name: { en: "Missing title", zh: "缺失标题" }, category: "critical", weight: 5, description: { en: "", zh: "" } },
          page,
          { en: "Page has no <title> tag", zh: "页面缺少 <title> 标签" },
          { en: "Add a 30-60 character title containing the primary keyword", zh: "添加 30-60 字符的标题，包含主关键词" }
        );
      }
      return null;
    },
  },
  {
    id: "missing-description",
    name: { en: "Missing description", zh: "缺失描述" },
    category: "critical",
    weight: 5,
    description: {
      en: "Every page should have a meta description",
      zh: "每个页面应有 meta description",
    },
    check: (page) => {
      if (!page.metaDescription) {
        return makeIssue(
          { id: "missing-description", name: { en: "Missing description", zh: "缺失描述" }, category: "critical", weight: 5, description: { en: "", zh: "" } },
          page,
          { en: "Page has no meta description tag", zh: "页面缺少 meta description 标签" },
          { en: "Add a 120-160 character description with primary keyword and value proposition", zh: "添加 120-160 字符的描述，包含主关键词与卖点" }
        );
      }
      return null;
    },
  },
  {
    id: "missing-h1",
    name: { en: "Missing H1", zh: "缺失 H1" },
    category: "critical",
    weight: 5,
    description: {
      en: "Every page should have an H1 tag",
      zh: "每个页面应有一个 H1 标签",
    },
    check: (page) => {
      if (page.h1.length === 0) {
        return makeIssue(
          { id: "missing-h1", name: { en: "Missing H1", zh: "缺失 H1" }, category: "critical", weight: 5, description: { en: "", zh: "" } },
          page,
          { en: "Page has no H1 tag", zh: "页面缺少 H1 标签" },
          { en: "Keep one unique H1 per page containing the primary keyword", zh: "每个页面保留一个唯一的 H1，包含主关键词" }
        );
      }
      return null;
    },
  },
  {
    id: "missing-alt",
    name: { en: "Images missing alt", zh: "图片无 alt" },
    category: "warning",
    weight: 3,
    description: {
      en: "Informative images must have descriptive alt text",
      zh: "信息性图片必须有描述性 alt",
    },
    check: (page) => {
      const total = page.images.length;
      if (total === 0) return null;
      const missing = page.images.filter((i) => i.alt === null || i.alt === "").length;
      if (missing > 0) {
        return makeIssue(
          { id: "missing-alt", name: { en: "Images missing alt", zh: "图片无 alt" }, category: "warning", weight: 3, description: { en: "", zh: "" } },
          page,
          { en: `${missing}/${total} images missing alt attribute`, zh: `${missing}/${total} 张图片缺少 alt 属性` },
          { en: "Add descriptive alt to informative images; leave alt empty for decorative ones", zh: "为信息性图片添加描述性 alt，装饰性图片留空 alt" }
        );
      }
      return null;
    },
  },
  {
    id: "missing-canonical",
    name: { en: "Missing canonical", zh: "缺失 canonical" },
    category: "warning",
    weight: 3,
    description: {
      en: "Set canonical to avoid duplicate content",
      zh: "设置 canonical 避免重复内容",
    },
    check: (page) => {
      if (!page.canonical) {
        return makeIssue(
          { id: "missing-canonical", name: { en: "Missing canonical", zh: "缺失 canonical" }, category: "warning", weight: 3, description: { en: "", zh: "" } },
          page,
          { en: "Page has no canonical tag", zh: "页面缺少 canonical 标签" },
          { en: "Set canonical to avoid duplicate-content penalties", zh: "设置 canonical 避免重复内容惩罚" }
        );
      }
      return null;
    },
  },
  {
    id: "no-ssl",
    name: { en: "Not HTTPS", zh: "非 HTTPS" },
    category: "critical",
    weight: 5,
    description: {
      en: "The site must support HTTPS",
      zh: "站点必须支持 HTTPS",
    },
    check: (page, baseUrl) => {
      const checkUrl = page.finalUrl ?? page.url ?? baseUrl;
      if (!checkUrl.startsWith("https://")) {
        return makeIssue(
          { id: "no-ssl", name: { en: "Not HTTPS", zh: "非 HTTPS" }, category: "critical", weight: 5, description: { en: "", zh: "" } },
          page,
          { en: "Page is not served over HTTPS", zh: "页面未使用 HTTPS 协议" },
          { en: "Install an SSL certificate and enforce HTTPS redirects", zh: "部署 SSL 证书并强制 HTTPS 重定向" }
        );
      }
      return null;
    },
  },
  {
    id: "title-length",
    name: { en: "Title length out of range", zh: "标题过长或过短" },
    category: "warning",
    weight: 1,
    description: {
      en: `Title length is recommended between ${TITLE_MIN}-${TITLE_MAX} characters (reference only; Google truncates by pixel width)`,
      zh: `标题长度建议在 ${TITLE_MIN}-${TITLE_MAX} 字符之间（仅供参考，Google 按像素宽度截断）`,
    },
    check: (page) => {
      if (!page.title) return null;
      const len = page.title.length;
      if (len < TITLE_MIN || len > TITLE_MAX) {
        return makeIssue(
          { id: "title-length", name: { en: "Title length out of range", zh: "标题过长或过短" }, category: "warning", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: `Title length ${len} characters (recommended ${TITLE_MIN}-${TITLE_MAX})`, zh: `标题长度 ${len} 字符（建议 ${TITLE_MIN}-${TITLE_MAX}）` },
          { en: "Adjust title length to 30-60 characters with the primary keyword up front", zh: "调整标题长度至 30-60 字符，主关键词靠前" }
        );
      }
      return null;
    },
  },
  {
    id: "description-length",
    name: { en: "Description length out of range", zh: "描述过长或过短" },
    category: "warning",
    weight: 1,
    description: {
      en: `Description length is recommended between ${DESC_MIN}-${DESC_MAX} characters (reference only; Google truncates dynamically)`,
      zh: `描述长度建议在 ${DESC_MIN}-${DESC_MAX} 字符之间（仅供参考，Google 会动态截断）`,
    },
    check: (page) => {
      if (!page.metaDescription) return null;
      const len = page.metaDescription.length;
      if (len < DESC_MIN || len > DESC_MAX) {
        return makeIssue(
          { id: "description-length", name: { en: "Description length out of range", zh: "描述过长或过短" }, category: "warning", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: `Description length ${len} characters (recommended ${DESC_MIN}-${DESC_MAX})`, zh: `描述长度 ${len} 字符（建议 ${DESC_MIN}-${DESC_MAX}）` },
          { en: `Adjust description length to ${DESC_MIN}-${DESC_MAX} characters`, zh: `调整描述长度至 ${DESC_MIN}-${DESC_MAX} 字符` }
        );
      }
      return null;
    },
  },
  {
    id: "missing-lang",
    name: { en: "Missing lang attribute", zh: "缺失语言属性" },
    category: "info",
    weight: 1,
    description: {
      en: "The <html> tag should have a lang attribute",
      zh: "<html> 标签应有 lang 属性",
    },
    check: (page) => {
      if (!page.htmlLang) {
        return makeIssue(
          { id: "missing-lang", name: { en: "Missing lang attribute", zh: "缺失语言属性" }, category: "info", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: "The <html> tag has no lang attribute", zh: "<html> 标签缺少 lang 属性" },
          { en: "Add a lang attribute, e.g. <html lang=\"zh-CN\">", zh: "添加 lang 属性，如 <html lang=\"zh-CN\">" }
        );
      }
      return null;
    },
  },
  {
    id: "missing-viewport",
    name: { en: "Missing viewport", zh: "缺失 viewport" },
    category: "warning",
    weight: 3,
    description: {
      en: "Mobile readiness requires a viewport meta tag",
      zh: "移动端适配必须有 viewport meta",
    },
    check: (page) => {
      if (!page.viewport) {
        return makeIssue(
          { id: "missing-viewport", name: { en: "Missing viewport", zh: "缺失 viewport" }, category: "warning", weight: 3, description: { en: "", zh: "" } },
          page,
          { en: "Page has no viewport meta tag", zh: "页面缺少 viewport meta 标签" },
          { en: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">", zh: "添加 <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" }
        );
      }
      return null;
    },
  },
  {
    id: "no-robots-meta",
    name: { en: "Robots blocks indexing", zh: "robots 阻止索引" },
    category: "warning",
    weight: 3,
    description: {
      en: "robots meta contains directives such as noindex/nofollow/none that block search engine behavior",
      zh: "robots meta 包含 noindex/nofollow/none 等阻止搜索引擎行为的指令",
    },
    check: (page) => {
      if (!page.robotsMeta) return null; // 缺失 robots meta 不是问题（默认 index,follow）
      const directives = page.robotsMeta.toLowerCase();
      const blocking = ["noindex", "nofollow", "none", "noarchive"];
      const hit = blocking.filter((d) => directives.includes(d));
      if (hit.length > 0) {
        return makeIssue(
          { id: "no-robots-meta", name: { en: "Robots blocks indexing", zh: "robots 阻止索引" }, category: "warning", weight: 3, description: { en: "", zh: "" } },
          page,
          { en: `robots meta contains blocking directives: ${hit.join(", ")}`, zh: `robots meta 包含阻止指令：${hit.join(", ")}` },
          { en: "Confirm whether this page should be blocked; remove the directives if not", zh: "确认是否需要阻止搜索引擎索引此页面；如不需要，移除对应指令" }
        );
      }
      return null;
    },
  },
  {
    id: "slow-page",
    name: { en: "Slow page load", zh: "页面加载慢" },
    category: "info",
    weight: 1,
    description: {
      en: `Pages slower than ${SLOW_PAGE_MS / 1000}s are flagged`,
      zh: `响应时间超过 ${SLOW_PAGE_MS / 1000}s 标记为慢页面`,
    },
    check: (page) => {
      const ms = page.responseTimeMs ?? 0;
      if (ms > SLOW_PAGE_MS) {
        return makeIssue(
          { id: "slow-page", name: { en: "Slow page load", zh: "页面加载慢" }, category: "info", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: `Response time ${(ms / 1000).toFixed(1)}s (>${SLOW_PAGE_MS / 1000}s)`, zh: `响应时间 ${(ms / 1000).toFixed(1)}s（>${SLOW_PAGE_MS / 1000}s）` },
          { en: "Compress images, enable caching, and reduce blocking JS", zh: "压缩图片、启用缓存、减少 JS 阻塞" }
        );
      }
      return null;
    },
  },
  {
    id: "no-structured-data",
    name: { en: "Structured data", zh: "结构化数据" },
    category: "info",
    weight: 1,
    description: {
      en: "Detects whether JSON-LD structured data exists and is valid",
      zh: "检测 JSON-LD 结构化数据是否存在且格式有效",
    },
    check: (page) => {
      if (!page.hasStructuredData) {
        return makeIssue(
          { id: "no-structured-data", name: { en: "No structured data", zh: "无结构化数据" }, category: "info", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: "No JSON-LD structured data detected", zh: "页面未检测到 JSON-LD 结构化数据" },
          { en: "Add <script type=\"application/ld+json\"> to enrich search results", zh: "添加 <script type=\"application/ld+json\"> 提升搜索结果展示" }
        );
      }
      // 校验已存在的 JSON-LD 是否格式有效
      for (const raw of page.structuredDataRaw) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return makeIssue(
            { id: "no-structured-data", name: { en: "Invalid structured data", zh: "结构化数据格式错误" }, category: "warning", weight: 1, description: { en: "", zh: "" } },
            page,
            { en: "JSON-LD present but JSON is malformed and cannot be parsed", zh: "JSON-LD 存在但 JSON 格式错误，无法解析" },
            { en: "Fix the JSON syntax inside <script type=\"application/ld+json\">", zh: "修正 <script type=\"application/ld+json\"> 内的 JSON 语法" }
          );
        }
        // 支持 @graph 数组结构
        const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const node of nodes) {
          if (node === null || typeof node !== "object") continue;
          const obj = node as Record<string, unknown>;
          if (obj["@graph"] && Array.isArray(obj["@graph"])) {
            for (const g of obj["@graph"]) {
              if (g && typeof g === "object") {
                const gObj = g as Record<string, unknown>;
                if (!gObj["@context"] || !gObj["@type"]) {
                  return makeIssue(
                    { id: "no-structured-data", name: { en: "Incomplete structured data", zh: "结构化数据不完整" }, category: "warning", weight: 1, description: { en: "", zh: "" } },
                    page,
                    { en: "A JSON-LD @graph node is missing @context or @type", zh: "JSON-LD @graph 节点缺少 @context 或 @type" },
                    { en: "Ensure every JSON-LD node includes @context and @type", zh: "确保每个 JSON-LD 节点包含 @context 和 @type 字段" }
                  );
                }
              }
            }
          } else if (!obj["@context"] || !obj["@type"]) {
            return makeIssue(
              { id: "no-structured-data", name: { en: "Incomplete structured data", zh: "结构化数据不完整" }, category: "warning", weight: 1, description: { en: "", zh: "" } },
              page,
              { en: "JSON-LD is missing @context or @type", zh: "JSON-LD 缺少 @context 或 @type 字段" },
              { en: "Ensure JSON-LD includes @context (e.g. https://schema.org) and @type", zh: "确保 JSON-LD 包含 @context（如 https://schema.org）和 @type 字段" }
            );
          }
        }
      }
      return null;
    },
  },
  {
    id: "missing-og-tags",
    name: { en: "Missing Open Graph", zh: "缺失 Open Graph" },
    category: "info",
    weight: 1,
    description: {
      en: "Social sharing needs OG tags",
      zh: "社交分享需要 OG 标签",
    },
    check: (page) => {
      if (!page.ogTitle || !page.ogDescription) {
        return makeIssue(
          { id: "missing-og-tags", name: { en: "Missing Open Graph", zh: "缺失 Open Graph" }, category: "info", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: `Missing og:title${page.ogDescription ? "" : " and og:description"}`, zh: `缺少 og:title${page.ogDescription ? "" : " 和 og:description"}` },
          { en: "Add og:title, og:description and og:image to improve social sharing", zh: "添加 og:title、og:description、og:image 标签优化社交分享" }
        );
      }
      return null;
    },
  },
  {
    id: "missing-twitter-card",
    name: { en: "Missing Twitter Card", zh: "缺失 Twitter Card" },
    category: "info",
    weight: 1,
    description: {
      en: "Adding Twitter Card tags is recommended",
      zh: "建议添加 Twitter Card 标签",
    },
    check: (page) => {
      if (!page.twitterCard) {
        return makeIssue(
          { id: "missing-twitter-card", name: { en: "Missing Twitter Card", zh: "缺失 Twitter Card" }, category: "info", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: "Page has no twitter:card tag", zh: "页面缺少 twitter:card 标签" },
          { en: "Add <meta name=\"twitter:card\" content=\"summary_large_image\">", zh: "添加 <meta name=\"twitter:card\" content=\"summary_large_image\">" }
        );
      }
      return null;
    },
  },
  {
    id: "no-favicon",
    name: { en: "No favicon", zh: "无 favicon" },
    category: "info",
    weight: 1,
    description: {
      en: "Setting a favicon is recommended",
      zh: "建议设置 favicon",
    },
    check: (page) => {
      if (!page.favicon) {
        return makeIssue(
          { id: "no-favicon", name: { en: "No favicon", zh: "无 favicon" }, category: "info", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: "Page has no favicon reference", zh: "页面缺少 favicon 引用" },
          { en: "Add <link rel=\"icon\" href=\"/favicon.ico\">", zh: "添加 <link rel=\"icon\" href=\"/favicon.ico\">" }
        );
      }
      return null;
    },
  },
  {
    id: "inline-css",
    name: { en: "Excessive inline CSS", zh: "内联样式过多" },
    category: "warning",
    weight: 3,
    description: {
      en: `<style> tag content exceeds ${INLINE_CSS_LIMIT} characters`,
      zh: `<style> 标签内容超过 ${INLINE_CSS_LIMIT} 字符`,
    },
    check: (page) => {
      if (page.inlineStyleLength > INLINE_CSS_LIMIT) {
        return makeIssue(
          { id: "inline-css", name: { en: "Excessive inline CSS", zh: "内联样式过多" }, category: "warning", weight: 3, description: { en: "", zh: "" } },
          page,
          { en: `Inline styles ${page.inlineStyleLength.toLocaleString()} characters (>${INLINE_CSS_LIMIT})`, zh: `内联样式 ${page.inlineStyleLength.toLocaleString()} 字符（>${INLINE_CSS_LIMIT}）` },
          { en: "Extract inline styles into an external CSS file", zh: "将内联样式提取到外部 CSS 文件" }
        );
      }
      return null;
    },
  },
  {
    id: "no-h2-h3",
    name: { en: "No heading structure", zh: "无副标题结构" },
    category: "info",
    weight: 1,
    description: {
      en: "Using H2/H3 to organize content is recommended",
      zh: "建议使用 H2/H3 组织内容结构",
    },
    check: (page) => {
      if (page.h2.length === 0 && page.h3.length === 0) {
        return makeIssue(
          { id: "no-h2-h3", name: { en: "No heading structure", zh: "无副标题结构" }, category: "info", weight: 1, description: { en: "", zh: "" } },
          page,
          { en: "Page has no H2 or H3 tags", zh: "页面无 H2 和 H3 标签" },
          { en: "Use H2/H3 to structure content for readability and SEO", zh: "使用 H2/H3 分层组织内容，提升可读性与 SEO" }
        );
      }
      return null;
    },
  },
];

// ---------- 跨页检查（5 项）----------

export const crossPageChecks: CrossPageCheck[] = [
  {
    id: "duplicate-title",
    name: { en: "Duplicate titles", zh: "重复标题" },
    category: "critical",
    weight: 5,
    description: {
      en: "Multiple pages share the same title on the same domain",
      zh: "同一域名下多个页面 title 相同",
    },
    crossCheck: (pages) => {
      const map = new Map<string, PageData[]>();
      for (const p of pages) {
        if (!p.title) continue;
        const arr = map.get(p.title) ?? [];
        arr.push(p);
        map.set(p.title, arr);
      }
      const issues: AuditIssue[] = [];
      for (const [title, ps] of map.entries()) {
        if (ps.length > 1) {
          issues.push({
            checkId: "duplicate-title",
            checkName: { en: "Duplicate titles", zh: "重复标题" },
            message: { en: `"${title.slice(0, 60)}" duplicated across ${ps.length} pages`, zh: `"${title.slice(0, 60)}" 在 ${ps.length} 个页面重复` },
            url: ps[0].url,
            severity: "error",
            suggestion: { en: "Write a unique title for every page", zh: "为每个页面编写唯一的 title" },
          });
        }
      }
      return issues;
    },
  },
  {
    id: "duplicate-description",
    name: { en: "Duplicate descriptions", zh: "重复描述" },
    category: "critical",
    weight: 5,
    description: {
      en: "Multiple pages share the same meta description on the same domain",
      zh: "同一域名下多个页面 description 相同",
    },
    crossCheck: (pages) => {
      const map = new Map<string, PageData[]>();
      for (const p of pages) {
        if (!p.metaDescription) continue;
        const arr = map.get(p.metaDescription) ?? [];
        arr.push(p);
        map.set(p.metaDescription, arr);
      }
      const issues: AuditIssue[] = [];
      for (const [desc, ps] of map.entries()) {
        if (ps.length > 1) {
          issues.push({
            checkId: "duplicate-description",
            checkName: { en: "Duplicate descriptions", zh: "重复描述" },
            message: { en: `"${desc.slice(0, 60)}" duplicated across ${ps.length} pages`, zh: `"${desc.slice(0, 60)}" 在 ${ps.length} 个页面重复` },
            url: ps[0].url,
            severity: "error",
            suggestion: { en: "Write a unique meta description for every page", zh: "为每个页面编写唯一的 meta description" },
          });
        }
      }
      return issues;
    },
  },
  {
    id: "duplicate-h1",
    name: { en: "Duplicate H1", zh: "重复 H1" },
    category: "warning",
    weight: 3,
    description: {
      en: "Multiple pages share the same H1 on the same domain",
      zh: "同一域名下多个页面 H1 相同",
    },
    crossCheck: (pages) => {
      const map = new Map<string, PageData[]>();
      for (const p of pages) {
        if (p.h1.length === 0) continue;
        const h1 = p.h1[0];
        const arr = map.get(h1) ?? [];
        arr.push(p);
        map.set(h1, arr);
      }
      const issues: AuditIssue[] = [];
      for (const [h1, ps] of map.entries()) {
        if (ps.length > 1) {
          issues.push({
            checkId: "duplicate-h1",
            checkName: { en: "Duplicate H1", zh: "重复 H1" },
            message: { en: `"${h1.slice(0, 60)}" duplicated across ${ps.length} pages`, zh: `"${h1.slice(0, 60)}" 在 ${ps.length} 个页面重复` },
            url: ps[0].url,
            severity: "warning",
            suggestion: { en: "Write a unique H1 for every page", zh: "为每个页面编写唯一的 H1" },
          });
        }
      }
      return issues;
    },
  },
  {
    id: "no-sitemap",
    name: { en: "No sitemap reference", zh: "无 sitemap 引用" },
    category: "info",
    weight: 1,
    description: {
      en: "robots.txt should declare the sitemap",
      zh: "robots.txt 中应声明 sitemap",
    },
    crossCheck: (_pages, _baseUrl, extra) => {
      const robots = extra.robotsText ?? "";
      if (!robots.toLowerCase().includes("sitemap:")) {
        return [{
          checkId: "no-sitemap",
          checkName: { en: "No sitemap reference", zh: "无 sitemap 引用" },
          message: { en: "robots.txt does not declare a Sitemap", zh: "robots.txt 中未声明 Sitemap" },
          url: _baseUrl,
          severity: "notice",
          suggestion: { en: "Add Sitemap: https://example.com/sitemap.xml to robots.txt", zh: "在 robots.txt 中添加 Sitemap: https://example.com/sitemap.xml" },
        }];
      }
      return [];
    },
  },
  {
    id: "broken-links",
    name: { en: "Broken internal links", zh: "站内死链" },
    category: "warning",
    weight: 3,
    description: {
      en: "Internal links returning non-200 HTTP status during crawl",
      zh: "爬取过程中 HTTP 非 200 的内部链接",
    },
    crossCheck: (_pages, _baseUrl, extra) => {
      return extra.brokenLinks.map((bl) => ({
        checkId: "broken-links",
        checkName: { en: "Broken internal links", zh: "站内死链" },
        message: `HTTP ${bl.statusCode}`,
        url: bl.url,
        severity: bl.statusCode === 404 ? ("error" as const) : ("warning" as const),
        suggestion: bl.statusCode === 404
          ? { en: "Add a 301 redirect to a relevant page or restore the missing content", zh: "添加 301 重定向到相关页面，或恢复缺失内容" }
          : { en: "Check server status and page availability", zh: "检查服务器状态与页面可用性" },
      }));
    },
  },
];

// ---------- 检查项元数据（供 UI 展示）----------

export interface CheckMeta {
  id: string;
  name: LText;
  category: CheckCategory;
  weight: number;
  description: LText;
}

export const allCheckMeta: CheckMeta[] = [
  ...perPageChecks.map((c) => ({
    id: c.id, name: c.name, category: c.category, weight: c.weight, description: c.description,
  })),
  ...crossPageChecks.map((c) => ({
    id: c.id, name: c.name, category: c.category, weight: c.weight, description: c.description,
  })),
];

export const checkMetaMap: Record<string, CheckMeta> = Object.fromEntries(
  allCheckMeta.map((m) => [m.id, m])
);

/**
 * 不参与评分、但会以 issue 形式写入 DB 的 checkId（如 startpage-unparsed）。
 * 仅用于读取层展示名映射，不得加入 allCheckMeta（会改变 MAX_SCORE）。
 */
export const nonCatalogCheckNames: Record<string, LText> = {
  "startpage-unparsed": {
    en: "Start page could not be parsed",
    zh: "起始页未能解析",
  },
  // 旧版（v1.0）检查项：已从评分 catalog 移除，但历史 DB 行仍会按 checkId 查展示名
  "js-redirect": {
    en: "JS redirect",
    zh: "JS 重定向",
  },
};

// ---------- 健康分计算 ----------

/** 所有检查项权重总和 */
export const MAX_SCORE: number = allCheckMeta.reduce((s, c) => s + c.weight, 0);

/** 单页检查项权重总和 */
export const PER_PAGE_SCORE: number = perPageChecks.reduce((s, c) => s + c.weight, 0);

/** 跨页检查项权重总和 */
export const CROSS_PAGE_SCORE: number = crossPageChecks.reduce((s, c) => s + c.weight, 0);

/**
 * 基于命中的检查项计算健康分
 * 评分只能基于实际执行的检查项：
 *   totalWeight = 已执行检查项权重总和
 *   failedWeight = 已触发检查项权重
 *   score = 100 - (failedWeight / totalWeight * 100)
 * 每个 checkId 只扣一次。
 * executedCheckIds 传入实际执行的检查项 ID 集合；未传则使用全部检查项（向后兼容）。
 */
export function calculateHealthScore(
  issues: AuditIssue[],
  executedCheckIds?: Set<string>
): number {
  const hitCheckIds = new Set(issues.map((i) => i.checkId));
  const totalWeight = executedCheckIds
    ? Array.from(executedCheckIds).reduce(
        (sum, id) => sum + (checkMetaMap[id]?.weight ?? 0),
        0
      )
    : MAX_SCORE;
  let deduction = 0;
  for (const id of hitCheckIds) {
    const meta = checkMetaMap[id];
    if (meta) deduction += meta.weight;
  }
  if (totalWeight === 0) return 100;
  return Math.max(0, Math.round(100 - (deduction / totalWeight) * 100));
}

/** 运行所有单页检查 */
export function runPerPageChecks(page: PageData, baseUrl: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const check of perPageChecks) {
    const issue = check.check(page, baseUrl);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** 运行所有跨页检查 */
export function runCrossPageChecks(
  pages: PageData[],
  baseUrl: string,
  extra: CrossPageExtra
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const check of crossPageChecks) {
    const results = check.crossCheck(pages, baseUrl, extra);
    issues.push(...results);
  }
  return issues;
}
