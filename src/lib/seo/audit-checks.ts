// ===== Audit Engine V2：统一规则架构（rule catalog） =====
//
// 架构（相对 V1 的变化）：
// 1. 每条 Rule 统一包含 id / category / severity / title / description /
//    pageLevel / scoreWeight / check / recommendation
// 2. 全部规则消费同一份 NormalizedPageData（一次抓取、一次解析、多规则复用）
// 3. 每条规则返回统一结构：ruleId / status / severity / affectedPages /
//    findings / metrics / recommendation
// 4. severity 由规则定义（前端不得自行决定）；category 采用新九类分组
// 5. 健康分由 audit-score.ts（V2 引擎）基于 severity × weight × affectedPageRatio 计算
//
// 本地化：用户可见文案（name / description / message / recommendation）以
// LText {en, zh} 输出；ruleId / category / severity / scoreWeight 为机器协议值。
// 历史存量数据中的纯中文 string 由 pickText 直接兼容返回。

import type { PageData, RedirectHop } from "@/lib/crawl";
import { LText, LocalizedText, pickText } from "./audit-ltext";
import {
  detectPageType,
  contentVolumeStatus,
  CONTENT_THRESHOLDS,
  type PageType,
} from "./page-type";
import {
  analyzeStructuredData,
  type StructuredDataReport,
} from "./structured-data";
import type { RobotsReport, SitemapReport, LlmsTxtReport } from "./site-reports";

export { pickText };
export type { LText, LocalizedText };

// ---------- 基础类型 ----------

export type CheckCategory = "critical" | "warning" | "info";
export type IssueSeverity = "error" | "warning" | "notice";

/** 规则分组（新九类） */
export type RuleCategory =
  | "crawlability"
  | "indexability"
  | "onpage"
  | "content"
  | "links"
  | "structured-data"
  | "performance"
  | "sitemap"
  | "ai-search";

export type RuleSeverity = IssueSeverity;
/** page：对每个页面执行；site：站点级（sitemap/robots/llms/重定向拓扑等） */
export type RulePageLevel = "page" | "site";

export interface AuditIssue {
  checkId: string;
  checkName: LocalizedText;
  message: LocalizedText;
  url: string;
  severity: IssueSeverity;
  suggestion: LocalizedText;
}

export interface RuleFinding {
  url: string;
  message: LocalizedText;
  /** 覆盖规则默认 severity（如 404 error / 5xx warning） */
  severity?: RuleSeverity;
  metrics?: Record<string, string | number | boolean>;
}

/** 爬取过程的一次抓取记录（含重定向/错误信息，供 redirect/broken 规则复用） */
export interface FetchRecord {
  /** 实际请求的 URL */
  url: string;
  finalUrl: string;
  status: number;
  responseTimeMs: number;
  hops: number;
  redirectChain: RedirectHop[];
  isLoop: boolean;
  /** 最终 2xx 且取得 HTML */
  ok: boolean;
  errorCode?: "TIMEOUT" | "NETWORK" | "HTTP_ERROR";
  /** 发现来源：start = 起始页；link = 站内链接；sitemap = sitemap 降级 */
  source: "start" | "link" | "sitemap";
  depth: number;
}

/** 规范化页面数据：一次抓取 + 一次解析的完整产物 */
export interface NormalizedPage {
  page: PageData;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  responseTimeMs: number;
  depth: number;
  hops: number;
  redirectChain: RedirectHop[];
  isLoop: boolean;
  contentType: PageType;
  wordCount: number;
  /** 该页面类型的内容阈值 */
  threshold: number;
  /** 内容量状态：normal / low / very-low */
  contentStatus: "normal" | "low" | "very-low";
  /** 可见文本 / HTML 大小（0-1） */
  textHtmlRatio: number;
  structuredData: StructuredDataReport;
  internalLinkCount: number;
  externalLinkCount: number;
  /** 指向该页面（去重后）的站内链接来源数 */
  inLinkCount: number;
}

export interface AuditContext {
  baseUrl: string;
  origin: string;
  depth: "quick" | "full";
  crawlLimit: number;
  /** 成功解析（2xx）的页面 */
  pages: NormalizedPage[];
  /** 全部抓取尝试（含 4xx/5xx/超时/网络错误/重定向） */
  fetchRecords: FetchRecord[];
  /** 规范化目标 URL → 来源页面集合（站内链接图） */
  linkGraph: Map<string, Set<string>>;
  robots: RobotsReport;
  sitemap: SitemapReport | null;
  llmsTxt: LlmsTxtReport | null;
  /** 分母：成功解析的页面数 */
  indexablePages: number;
}

export interface AuditRule {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  category: RuleCategory;
  severity: RuleSeverity;
  pageLevel: RulePageLevel;
  /** 分数权重（默认 1；站点级致命问题更高） */
  scoreWeight: number;
  recommendation: LocalizedText;
  check: (ctx: AuditContext) => RuleFinding[];
}

export interface RuleExecution {
  rule: AuditRule;
  status: "pass" | "fail";
  severity: RuleSeverity;
  findings: RuleFinding[];
  /** 至少存在一个 finding 的页面数（distinct URL） */
  affectedPages: number;
}

// ---------- 常量 ----------

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 120;
const DESC_MAX = 160;
const SLOW_PAGE_MS = 3000;
const INLINE_CSS_LIMIT = 5000;
/** text/HTML 比例低于此值标记 notice */
const TEXT_HTML_RATIO_LOW = 0.1;
/** text/HTML 比例低于此值标记 warning */
const TEXT_HTML_RATIO_VERY_LOW = 0.05;
/** 爬取深度超过该值标记 deep page */
const DEEP_PAGE_DEPTH = 4;
/** 站点级规则单条 findings 上限（防止 DB 爆炸） */
const SITE_FINDING_CAP = 20;

function distinctUrls(findings: RuleFinding[]): number {
  return new Set(findings.map((f) => f.url)).size;
}

/** 页面级规则工厂：对每个成功解析页面执行，返回命中 findings（单个或数组均可） */
function pageRule(
  def: Omit<AuditRule, "check" | "pageLevel">,
  checkPage: (np: NormalizedPage, ctx: AuditContext) => RuleFinding | RuleFinding[] | null
): AuditRule {
  return {
    ...def,
    pageLevel: "page",
    check: (ctx) => {
      const findings: RuleFinding[] = [];
      for (const np of ctx.pages) {
        const f = checkPage(np, ctx);
        if (!f) continue;
        if (Array.isArray(f)) findings.push(...f);
        else findings.push(f);
      }
      return findings;
    },
  };
}

// ---------- 单页规则（quick + full 均执行） ----------

const pageRules: AuditRule[] = [
  pageRule(
    {
      id: "missing-title",
      name: { en: "Missing title", zh: "缺失标题" },
      description: { en: "Every page must have a unique <title> tag", zh: "每个页面必须有唯一的 <title> 标签" },
      category: "onpage",
      severity: "error",
      scoreWeight: 1.2,
      recommendation: { en: "Add a 30-60 character title containing the primary keyword", zh: "添加 30-60 字符的标题，包含主关键词" },
    },
    (np) =>
      np.page.title
        ? null
        : {
            url: np.finalUrl,
            message: { en: "Page has no <title> tag", zh: "页面缺少 <title> 标签" },
          }
  ),
  pageRule(
    {
      id: "missing-description",
      name: { en: "Missing description", zh: "缺失描述" },
      description: { en: "Every page should have a meta description", zh: "每个页面应有 meta description" },
      category: "onpage",
      severity: "error",
      scoreWeight: 1.2,
      recommendation: { en: "Add a 120-160 character description with primary keyword and value proposition", zh: "添加 120-160 字符的描述，包含主关键词与卖点" },
    },
    (np) =>
      np.page.metaDescription
        ? null
        : {
            url: np.finalUrl,
            message: { en: "Page has no meta description tag", zh: "页面缺少 meta description 标签" },
          }
  ),
  pageRule(
    {
      id: "missing-h1",
      name: { en: "Missing H1", zh: "缺失 H1" },
      description: { en: "Every page should have an H1 tag", zh: "每个页面应有一个 H1 标签" },
      category: "onpage",
      severity: "error",
      scoreWeight: 1.2,
      recommendation: { en: "Keep one unique H1 per page containing the primary keyword", zh: "每个页面保留一个唯一的 H1，包含主关键词" },
    },
    (np) =>
      np.page.h1.length === 0
        ? { url: np.finalUrl, message: { en: "Page has no H1 tag", zh: "页面缺少 H1 标签" } }
        : null
  ),
  pageRule(
    {
      id: "missing-alt",
      name: { en: "Images missing alt", zh: "图片无 alt" },
      description: { en: "Informative images must have descriptive alt text", zh: "信息性图片必须有描述性 alt" },
      category: "onpage",
      severity: "warning",
      scoreWeight: 1,
      recommendation: { en: "Add descriptive alt to informative images; leave alt empty for decorative ones", zh: "为信息性图片添加描述性 alt，装饰性图片留空 alt" },
    },
    (np) => {
      const total = np.page.images.length;
      if (total === 0) return null;
      const missing = np.page.images.filter((i) => i.alt === null || i.alt === "").length;
      if (missing === 0) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `${missing}/${total} images missing alt attribute`,
          zh: `${missing}/${total} 张图片缺少 alt 属性`,
        },
        metrics: { images: total, missingAlt: missing },
      };
    }
  ),
  pageRule(
    {
      id: "missing-canonical",
      name: { en: "Missing canonical", zh: "缺失 canonical" },
      description: { en: "Set canonical to avoid duplicate content", zh: "设置 canonical 避免重复内容" },
      category: "indexability",
      severity: "warning",
      scoreWeight: 1,
      recommendation: { en: "Set canonical to avoid duplicate-content confusion", zh: "设置 canonical 避免重复内容混淆" },
    },
    (np) =>
      np.page.canonical
        ? null
        : { url: np.finalUrl, message: { en: "Page has no canonical tag", zh: "页面缺少 canonical 标签" } }
  ),
  pageRule(
    {
      id: "no-ssl",
      name: { en: "Not HTTPS", zh: "非 HTTPS" },
      description: { en: "The site must support HTTPS", zh: "站点必须支持 HTTPS" },
      category: "crawlability",
      severity: "error",
      scoreWeight: 1,
      recommendation: { en: "Install an SSL certificate and enforce HTTPS redirects", zh: "部署 SSL 证书并强制 HTTPS 重定向" },
    },
    (np) =>
      np.finalUrl.startsWith("https://")
        ? null
        : { url: np.finalUrl, message: { en: "Page is not served over HTTPS", zh: "页面未使用 HTTPS 协议" } }
  ),
  pageRule(
    {
      id: "title-length",
      name: { en: "Title length out of range", zh: "标题过长或过短" },
      description: {
        en: `Title length is recommended between ${TITLE_MIN}-${TITLE_MAX} characters (reference only; Google truncates by pixel width)`,
        zh: `标题长度建议在 ${TITLE_MIN}-${TITLE_MAX} 字符之间（仅供参考，Google 按像素宽度截断）`,
      },
      category: "onpage",
      severity: "warning",
      scoreWeight: 0.6,
      recommendation: { en: "Adjust title length to 30-60 characters with the primary keyword up front", zh: "调整标题长度至 30-60 字符，主关键词靠前" },
    },
    (np) => {
      if (!np.page.title) return null;
      const len = np.page.title.length;
      if (len >= TITLE_MIN && len <= TITLE_MAX) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `Title length ${len} characters (recommended ${TITLE_MIN}-${TITLE_MAX})`,
          zh: `标题长度 ${len} 字符（建议 ${TITLE_MIN}-${TITLE_MAX}）`,
        },
        metrics: { titleLength: len },
      };
    }
  ),
  pageRule(
    {
      id: "description-length",
      name: { en: "Description length out of range", zh: "描述过长或过短" },
      description: {
        en: `Description length is recommended between ${DESC_MIN}-${DESC_MAX} characters (reference only; Google truncates dynamically)`,
        zh: `描述长度建议在 ${DESC_MIN}-${DESC_MAX} 字符之间（仅供参考，Google 会动态截断）`,
      },
      category: "onpage",
      severity: "warning",
      scoreWeight: 0.6,
      recommendation: { en: `Adjust description length to ${DESC_MIN}-${DESC_MAX} characters`, zh: `调整描述长度至 ${DESC_MIN}-${DESC_MAX} 字符` },
    },
    (np) => {
      if (!np.page.metaDescription) return null;
      const len = np.page.metaDescription.length;
      if (len >= DESC_MIN && len <= DESC_MAX) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `Description length ${len} characters (recommended ${DESC_MIN}-${DESC_MAX})`,
          zh: `描述长度 ${len} 字符（建议 ${DESC_MIN}-${DESC_MAX}）`,
        },
        metrics: { descriptionLength: len },
      };
    }
  ),
  pageRule(
    {
      id: "missing-lang",
      name: { en: "Missing lang attribute", zh: "缺失语言属性" },
      description: { en: "The <html> tag should have a lang attribute", zh: "<html> 标签应有 lang 属性" },
      category: "onpage",
      severity: "notice",
      scoreWeight: 1,
      recommendation: { en: `Add a lang attribute, e.g. <html lang="zh-CN">`, zh: `添加 lang 属性，如 <html lang="zh-CN">` },
    },
    (np) =>
      np.page.htmlLang
        ? null
        : {
            url: np.finalUrl,
            message: { en: "The <html> tag has no lang attribute", zh: "<html> 标签缺少 lang 属性" },
          }
  ),
  pageRule(
    {
      id: "missing-viewport",
      name: { en: "Missing viewport", zh: "缺失 viewport" },
      description: { en: "Mobile readiness requires a viewport meta tag", zh: "移动端适配必须有 viewport meta" },
      category: "onpage",
      severity: "warning",
      scoreWeight: 1,
      recommendation: {
        en: `Add <meta name="viewport" content="width=device-width, initial-scale=1">`,
        zh: `添加 <meta name="viewport" content="width=device-width, initial-scale=1">`,
      },
    },
    (np) =>
      np.page.viewport
        ? null
        : { url: np.finalUrl, message: { en: "Page has no viewport meta tag", zh: "页面缺少 viewport meta 标签" } }
  ),
  pageRule(
    {
      id: "no-robots-meta",
      name: { en: "Robots blocks indexing", zh: "robots 阻止索引" },
      description: {
        en: "robots meta contains directives such as noindex/nofollow/none that block search engine behavior",
        zh: "robots meta 包含 noindex/nofollow/none 等阻止搜索引擎行为的指令",
      },
      category: "indexability",
      severity: "warning",
      scoreWeight: 1,
      recommendation: { en: "Confirm whether this page should be blocked; remove the directives if not", zh: "确认是否需要阻止搜索引擎索引此页面；如不需要，移除对应指令" },
    },
    (np) => {
      if (!np.page.robotsMeta) return null;
      const directives = np.page.robotsMeta.toLowerCase();
      const blocking = ["noindex", "nofollow", "none", "noarchive"];
      const hit = blocking.filter((d) => directives.includes(d));
      if (hit.length === 0) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `robots meta contains blocking directives: ${hit.join(", ")}`,
          zh: `robots meta 包含阻止指令：${hit.join(", ")}`,
        },
        metrics: { directives: hit.join(",") },
      };
    }
  ),
  pageRule(
    {
      id: "slow-page",
      name: { en: "Slow page load", zh: "页面加载慢" },
      description: {
        en: `Pages slower than ${SLOW_PAGE_MS / 1000}s are flagged`,
        zh: `响应时间超过 ${SLOW_PAGE_MS / 1000}s 标记为慢页面`,
      },
      category: "performance",
      severity: "notice",
      scoreWeight: 1,
      recommendation: { en: "Compress images, enable caching, and reduce blocking JS", zh: "压缩图片、启用缓存、减少 JS 阻塞" },
    },
    (np) => {
      const ms = np.responseTimeMs;
      if (ms <= SLOW_PAGE_MS) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `Response time ${(ms / 1000).toFixed(1)}s (>${SLOW_PAGE_MS / 1000}s)`,
          zh: `响应时间 ${(ms / 1000).toFixed(1)}s（>${SLOW_PAGE_MS / 1000}s）`,
        },
        metrics: { responseTimeMs: ms },
      };
    }
  ),
  pageRule(
    {
      id: "no-structured-data",
      name: { en: "No structured data", zh: "无结构化数据" },
      description: { en: "No JSON-LD structured data detected on the page", zh: "页面未检测到 JSON-LD 结构化数据" },
      category: "structured-data",
      severity: "notice",
      scoreWeight: 1,
      recommendation: {
        en: `Add <script type="application/ld+json"> to enrich search results`,
        zh: `添加 <script type="application/ld+json"> 提升搜索结果展示`,
      },
    },
    (np) =>
      np.structuredData.status === "none"
        ? {
            url: np.finalUrl,
            message: { en: "No JSON-LD structured data detected", zh: "页面未检测到 JSON-LD 结构化数据" },
          }
        : null
  ),
  pageRule(
    {
      id: "invalid-structured-data",
      name: { en: "Invalid structured data", zh: "结构化数据无效" },
      description: {
        en: "JSON-LD is malformed or structurally invalid (missing @type, broken @graph)",
        zh: "JSON-LD 格式错误或结构无效（缺少 @type、@graph 损坏等）",
      },
      category: "structured-data",
      severity: "error",
      scoreWeight: 1,
      recommendation: {
        en: `Fix the JSON syntax and required fields inside <script type="application/ld+json">`,
        zh: `修正 <script type="application/ld+json"> 内的 JSON 语法与必填字段`,
      },
    },
    (np) => {
      const invalid = np.structuredData.findings.filter((f) =>
        ["malformed", "invalid-node", "graph-not-array", "missing-type"].includes(f.kind)
      );
      if (invalid.length === 0) return null;
      const kinds = Array.from(new Set(invalid.map((f) => f.kind)));
      return {
        url: np.finalUrl,
        message: {
          en: `Invalid JSON-LD (${kinds.join(", ")}) in ${invalid.length} node(s)`,
          zh: `JSON-LD 无效（${kinds.join("、")}），共 ${invalid.length} 处`,
        },
        metrics: { invalidFindings: invalid.length },
      };
    }
  ),
  pageRule(
    {
      id: "incomplete-structured-data",
      name: { en: "Incomplete structured data", zh: "结构化数据不完整" },
      description: {
        en: "JSON-LD nodes are missing @context, @id or common schema fields",
        zh: "JSON-LD 节点缺少 @context、@id 或常见 Schema 基础字段",
      },
      category: "structured-data",
      severity: "warning",
      scoreWeight: 1,
      recommendation: {
        en: "Ensure JSON-LD includes @context and required fields for each schema type",
        zh: "确保 JSON-LD 包含 @context 及各 Schema 类型的必填字段",
      },
    },
    (np) => {
      const incomplete = np.structuredData.findings.filter((f) =>
        ["missing-context", "missing-id", "missing-fields"].includes(f.kind)
      );
      if (incomplete.length === 0) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `Potential JSON-LD issues (${incomplete.length})`,
          zh: `JSON-LD 存在潜在问题（${incomplete.length} 处）`,
        },
        metrics: { potentialFindings: incomplete.length },
      };
    }
  ),
  pageRule(
    {
      id: "duplicate-structured-data",
      name: { en: "Duplicate structured data", zh: "结构化数据重复" },
      description: {
        en: "The same schema type is declared in multiple JSON-LD blocks",
        zh: "同一 Schema 类型在多个 JSON-LD 块中重复声明",
      },
      category: "structured-data",
      severity: "notice",
      scoreWeight: 1,
      recommendation: {
        en: "Merge duplicated schema types into a single JSON-LD block",
        zh: "将重复的 Schema 类型合并到单个 JSON-LD 块",
      },
    },
    (np) => {
      const dup = np.structuredData.findings.filter((f) => f.kind === "duplicate-type");
      if (dup.length === 0) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `${dup.length} schema type(s) declared more than once`,
          zh: `${dup.length} 个 Schema 类型重复声明`,
        },
      };
    }
  ),
  pageRule(
    {
      id: "missing-og-tags",
      name: { en: "Missing Open Graph", zh: "缺失 Open Graph" },
      description: { en: "Social sharing needs OG tags", zh: "社交分享需要 OG 标签" },
      category: "onpage",
      severity: "notice",
      scoreWeight: 1,
      recommendation: { en: "Add og:title, og:description and og:image to improve social sharing", zh: "添加 og:title、og:description、og:image 标签优化社交分享" },
    },
    (np) => {
      if (np.page.ogTitle && np.page.ogDescription) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `Missing og:title${np.page.ogDescription ? "" : " and og:description"}`,
          zh: `缺少 og:title${np.page.ogDescription ? "" : " 和 og:description"}`,
        },
      };
    }
  ),
  pageRule(
    {
      id: "missing-twitter-card",
      name: { en: "Missing Twitter Card", zh: "缺失 Twitter Card" },
      description: { en: "Adding Twitter Card tags is recommended", zh: "建议添加 Twitter Card 标签" },
      category: "onpage",
      severity: "notice",
      scoreWeight: 1,
      recommendation: {
        en: `Add <meta name="twitter:card" content="summary_large_image">`,
        zh: `添加 <meta name="twitter:card" content="summary_large_image">`,
      },
    },
    (np) =>
      np.page.twitterCard
        ? null
        : { url: np.finalUrl, message: { en: "Page has no twitter:card tag", zh: "页面缺少 twitter:card 标签" } }
  ),
  pageRule(
    {
      id: "no-favicon",
      name: { en: "No favicon", zh: "无 favicon" },
      description: { en: "Setting a favicon is recommended", zh: "建议设置 favicon" },
      category: "onpage",
      severity: "notice",
      scoreWeight: 1,
      recommendation: { en: `Add <link rel="icon" href="/favicon.ico">`, zh: `添加 <link rel="icon" href="/favicon.ico">` },
    },
    (np) =>
      np.page.favicon
        ? null
        : { url: np.finalUrl, message: { en: "Page has no favicon reference", zh: "页面缺少 favicon 引用" } }
  ),
  pageRule(
    {
      id: "inline-css",
      name: { en: "Excessive inline CSS", zh: "内联样式过多" },
      description: { en: `<style> tag content exceeds ${INLINE_CSS_LIMIT} characters`, zh: `<style> 标签内容超过 ${INLINE_CSS_LIMIT} 字符` },
      category: "performance",
      severity: "warning",
      scoreWeight: 1,
      recommendation: { en: "Extract inline styles into an external CSS file", zh: "将内联样式提取到外部 CSS 文件" },
    },
    (np) => {
      const len = np.page.inlineStyleLength;
      if (len <= INLINE_CSS_LIMIT) return null;
      return {
        url: np.finalUrl,
        message: {
          en: `Inline styles ${len.toLocaleString()} characters (>${INLINE_CSS_LIMIT})`,
          zh: `内联样式 ${len.toLocaleString()} 字符（>${INLINE_CSS_LIMIT}）`,
        },
        metrics: { inlineStyleLength: len },
      };
    }
  ),
  pageRule(
    {
      id: "no-h2-h3",
      name: { en: "No heading structure", zh: "无副标题结构" },
      description: { en: "Using H2/H3 to organize content is recommended", zh: "建议使用 H2/H3 组织内容结构" },
      category: "content",
      severity: "notice",
      scoreWeight: 1,
      recommendation: { en: "Use H2/H3 to structure content for readability and SEO", zh: "使用 H2/H3 分层组织内容，提升可读性与 SEO" },
    },
    (np) =>
      np.page.h2.length === 0 && np.page.h3.length === 0
        ? { url: np.finalUrl, message: { en: "Page has no H2 or H3 tags", zh: "页面无 H2 和 H3 标签" } }
        : null
  ),
  pageRule(
    {
      id: "low-content",
      name: { en: "Low content volume", zh: "内容量不足" },
      description: {
        en: "Word count is below the threshold for this page type (thresholds vary by type)",
        zh: "正文字数低于该页面类型的阈值（阈值按页面类型区分）",
      },
      category: "content",
      severity: "warning",
      scoreWeight: 1,
      recommendation: {
        en: "Expand the main content to the threshold for this page type",
        zh: "针对该页面类型补充正文内容至阈值以上",
      },
    },
    (np) => {
      if (np.contentStatus === "normal") return null;
      const veryLow = np.contentStatus === "very-low";
      return {
        url: np.finalUrl,
        severity: veryLow ? "warning" : "notice",
        message: {
          en: `${veryLow ? "Very low" : "Low"} content: ${np.wordCount} words on page type "${np.contentType}" (threshold ${np.threshold})`,
          zh: `内容量${veryLow ? "极低" : "偏低"}：${np.contentType} 页面 ${np.wordCount} 词（阈值 ${np.threshold}）`,
        },
        metrics: {
          wordCount: np.wordCount,
          contentType: np.contentType,
          threshold: np.threshold,
          status: np.contentStatus,
        },
      };
    }
  ),
  pageRule(
    {
      id: "low-text-html-ratio",
      name: { en: "Low text-to-HTML ratio", zh: "文本/HTML 比例过低" },
      description: {
        en: `Visible text is less than ${Math.round(TEXT_HTML_RATIO_LOW * 100)}% of the HTML size; the page markup is heavy relative to its content`,
        zh: `可见文本低于 HTML 大小的 ${Math.round(TEXT_HTML_RATIO_LOW * 100)}%；页面结构相对于有效文本较大`,
      },
      category: "content",
      severity: "notice",
      scoreWeight: 1,
      recommendation: {
        en: "Reduce HTML/script bloat or add meaningful visible content",
        zh: "精简 HTML/脚本体积，或补充有价值的可见内容",
      },
    },
    (np) => {
      const ratio = np.textHtmlRatio;
      if (ratio >= TEXT_HTML_RATIO_LOW) return null;
      const veryLow = ratio < TEXT_HTML_RATIO_VERY_LOW;
      const htmlSize = np.page.htmlSize ?? 0;
      const text = np.page.visibleTextSize ?? 0;
      return {
        url: np.finalUrl,
        severity: veryLow ? "warning" : "notice",
        message: {
          en: `Visible text ${text.toLocaleString()} chars vs HTML ${htmlSize.toLocaleString()} chars (${(ratio * 100).toFixed(1)}%)`,
          zh: `可见文本 ${text.toLocaleString()} 字符 / HTML ${htmlSize.toLocaleString()} 字符（${(ratio * 100).toFixed(1)}%）`,
        },
        metrics: { visibleTextSize: text, htmlSize, ratio: Math.round(ratio * 1000) / 1000 },
      };
    }
  ),
  pageRule(
    {
      id: "semantic-html",
      name: { en: "Low semantic HTML", zh: "语义化 HTML 不足" },
      description: {
        en: "Main content should use semantic tags (main/article/section) with a proper heading hierarchy",
        zh: "主内容应使用语义化标签（main/article/section）并保持标题层级",
      },
      category: "ai-search",
      severity: "notice",
      scoreWeight: 1,
      recommendation: {
        en: "Wrap main content in <main>/<article>/<section> and keep heading levels in order",
        zh: "用 <main>/<article>/<section> 包裹主内容，并保持标题层级连续",
      },
    },
    (np) => {
      const findings: RuleFinding[] = [];
      const hasContent = np.wordCount >= 100;
      if (hasContent && (np.page.semanticMainCount ?? 0) === 0) {
        findings.push({
          url: np.finalUrl,
          message: {
            en: "Main content is not wrapped in semantic tags (main/article/section)",
            zh: "主内容未使用语义化标签包裹（main/article/section）",
          },
        });
      }
      // 标题层级跳跃（如 h1 → h3）
      const headings = np.page.headings ?? [];
      for (let i = 1; i < headings.length; i++) {
        if (headings[i].level - headings[i - 1].level > 1) {
          findings.push({
            url: np.finalUrl,
            message: {
              en: `Heading hierarchy skips from h${headings[i - 1].level} to h${headings[i].level}`,
              zh: `标题层级跳跃：h${headings[i - 1].level} → h${headings[i].level}`,
            },
          });
          break; // 每页最多报一次
        }
      }
      if (np.page.h1.length > 1) {
        findings.push({
          url: np.finalUrl,
          message: {
            en: `Page has ${np.page.h1.length} H1 tags`,
            zh: `页面存在 ${np.page.h1.length} 个 H1`,
          },
        });
      }
      return findings.length > 0 ? findings : null;
    }
  ),
  pageRule(
    {
      id: "zero-internal-links",
      name: { en: "No internal links", zh: "无站内链接" },
      description: { en: "Pages should link to other relevant internal pages", zh: "页面应链接到其他相关站内页面" },
      category: "links",
      severity: "notice",
      scoreWeight: 1,
      recommendation: { en: "Add internal links to related pages to spread link equity", zh: "添加指向相关页面的内链，传递权重" },
    },
    (np) =>
      np.internalLinkCount === 0
        ? {
            url: np.finalUrl,
            message: { en: "Page has no internal links to other pages", zh: "页面没有任何指向其他页面的内链" },
          }
        : null
  ),
];

// ---------- 站点级规则（仅 full 深度执行） ----------

interface BrokenLikeRecord {
  rec: FetchRecord;
  severity: RuleSeverity;
}

function classifyBroken(rec: FetchRecord): BrokenLikeRecord {
  // 404/410/网络错误 → error；其他 4xx → error；5xx → warning
  if (rec.status >= 500) return { rec, severity: "warning" };
  return { rec, severity: "error" };
}

function isBrokenRecord(rec: FetchRecord): boolean {
  return (rec.status >= 400 || rec.errorCode === "NETWORK") && !rec.isLoop;
}

const siteRules: AuditRule[] = [
  {
    id: "duplicate-title",
    name: { en: "Duplicate titles", zh: "重复标题" },
    description: { en: "Multiple pages share the same title on the same domain", zh: "同一域名下多个页面 title 相同" },
    category: "content",
    severity: "error",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Write a unique title for every page", zh: "为每个页面编写唯一的 title" },
    check: (ctx) => {
      const map = new Map<string, NormalizedPage[]>();
      for (const np of ctx.pages) {
        if (!np.page.title) continue;
        const arr = map.get(np.page.title) ?? [];
        arr.push(np);
        map.set(np.page.title, arr);
      }
      const findings: RuleFinding[] = [];
      for (const [title, ps] of map.entries()) {
        if (ps.length > 1) {
          findings.push({
            url: ps[0].finalUrl,
            message: {
              en: `"${title.slice(0, 60)}" duplicated across ${ps.length} pages`,
              zh: `"${title.slice(0, 60)}" 在 ${ps.length} 个页面重复`,
            },
            metrics: { pages: ps.length },
          });
        }
      }
      return findings;
    },
  },
  {
    id: "duplicate-description",
    name: { en: "Duplicate descriptions", zh: "重复描述" },
    description: { en: "Multiple pages share the same meta description on the same domain", zh: "同一域名下多个页面 description 相同" },
    category: "content",
    severity: "error",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Write a unique meta description for every page", zh: "为每个页面编写唯一的 meta description" },
    check: (ctx) => {
      const map = new Map<string, NormalizedPage[]>();
      for (const np of ctx.pages) {
        if (!np.page.metaDescription) continue;
        const arr = map.get(np.page.metaDescription) ?? [];
        arr.push(np);
        map.set(np.page.metaDescription, arr);
      }
      const findings: RuleFinding[] = [];
      for (const [desc, ps] of map.entries()) {
        if (ps.length > 1) {
          findings.push({
            url: ps[0].finalUrl,
            message: {
              en: `"${desc.slice(0, 60)}" duplicated across ${ps.length} pages`,
              zh: `"${desc.slice(0, 60)}" 在 ${ps.length} 个页面重复`,
            },
            metrics: { pages: ps.length },
          });
        }
      }
      return findings;
    },
  },
  {
    id: "duplicate-h1",
    name: { en: "Duplicate H1", zh: "重复 H1" },
    description: { en: "Multiple pages share the same H1 on the same domain", zh: "同一域名下多个页面 H1 相同" },
    category: "content",
    severity: "warning",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Write a unique H1 for every page", zh: "为每个页面编写唯一的 H1" },
    check: (ctx) => {
      const map = new Map<string, NormalizedPage[]>();
      for (const np of ctx.pages) {
        if (np.page.h1.length === 0) continue;
        const h1 = np.page.h1[0];
        const arr = map.get(h1) ?? [];
        arr.push(np);
        map.set(h1, arr);
      }
      const findings: RuleFinding[] = [];
      for (const [h1, ps] of map.entries()) {
        if (ps.length > 1) {
          findings.push({
            url: ps[0].finalUrl,
            message: {
              en: `"${h1.slice(0, 60)}" duplicated across ${ps.length} pages`,
              zh: `"${h1.slice(0, 60)}" 在 ${ps.length} 个页面重复`,
            },
            metrics: { pages: ps.length },
          });
        }
      }
      return findings;
    },
  },
  {
    id: "broken-crawled-pages",
    name: { en: "Broken crawled pages", zh: "抓取到的失效页面" },
    description: {
      en: "Pages discovered via the start URL or sitemap that return 4xx/5xx or fail to connect",
      zh: "起始页或 sitemap 发现的页面返回 4xx/5xx 或无法连接",
    },
    category: "links",
    severity: "error",
    pageLevel: "site",
    scoreWeight: 1.2,
    recommendation: {
      en: "Restore the page or redirect it (301) to a relevant live page",
      zh: "恢复页面内容，或将其 301 重定向到相关有效页面",
    },
    check: (ctx) => {
      const findings: RuleFinding[] = [];
      for (const rec of ctx.fetchRecords) {
        if (!isBrokenRecord(rec)) continue;
        if (rec.source !== "start" && rec.source !== "sitemap") continue;
        const { severity } = classifyBroken(rec);
        findings.push({
          url: rec.url,
          severity,
          message: rec.errorCode === "NETWORK"
            ? { en: "Page failed to connect (network error)", zh: "页面无法连接（网络错误）" }
            : { en: `Page returns HTTP ${rec.status}`, zh: `页面返回 HTTP ${rec.status}` },
          metrics: { status: rec.status },
        });
      }
      return findings;
    },
  },
  {
    id: "broken-links",
    name: { en: "Broken internal links", zh: "站内死链" },
    description: {
      en: "Internal links pointing to pages returning 4xx/5xx during the crawl",
      zh: "爬取过程中返回 4xx/5xx 的站内链接",
    },
    category: "links",
    severity: "error",
    pageLevel: "site",
    scoreWeight: 1.2,
    recommendation: {
      en: "Add a 301 redirect to a relevant page or restore the missing content",
      zh: "添加 301 重定向到相关页面，或恢复缺失内容",
    },
    check: (ctx) => {
      const findings: RuleFinding[] = [];
      for (const rec of ctx.fetchRecords) {
        if (!isBrokenRecord(rec)) continue;
        if (rec.source !== "link") continue;
        const { severity } = classifyBroken(rec);
        findings.push({
          url: rec.url,
          severity,
          message: rec.errorCode === "NETWORK"
            ? { en: "Link target failed to connect (network error)", zh: "链接目标无法连接（网络错误）" }
            : { en: `Link target returns HTTP ${rec.status}`, zh: `链接目标返回 HTTP ${rec.status}` },
          metrics: { status: rec.status },
        });
      }
      return findings;
    },
  },
  {
    id: "redirect-loop",
    name: { en: "Redirect loops", zh: "重定向环" },
    description: { en: "A URL redirects in a circle and never resolves", zh: "URL 重定向形成环，永远无法到达最终页面" },
    category: "crawlability",
    severity: "error",
    pageLevel: "site",
    scoreWeight: 1.2,
    recommendation: { en: "Fix the redirect rules so each URL resolves in a single hop", zh: "修正重定向规则，确保每个 URL 一跳到达" },
    check: (ctx) =>
      ctx.fetchRecords
        .filter((rec) => rec.isLoop)
        .map((rec) => ({
          url: rec.url,
          message: {
            en: `Redirect loop detected (back to ${rec.finalUrl})`,
            zh: `检测到重定向环（回到 ${rec.finalUrl}）`,
          },
          metrics: { hops: rec.hops },
        })),
  },
  {
    id: "redirect-chain",
    name: { en: "Redirect chains", zh: "重定向链" },
    description: {
      en: "URLs resolving through 2+ redirects waste crawl budget and add latency",
      zh: "经过 2 次及以上重定向的 URL 浪费抓取预算并增加延迟",
    },
    category: "crawlability",
    severity: "warning",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Point redirects directly at the final destination URL", zh: "将重定向直接指向最终目标 URL" },
    check: (ctx) =>
      ctx.fetchRecords
        .filter((rec) => rec.hops >= 2 && rec.ok && !rec.isLoop)
        .map((rec) => ({
          url: rec.url,
          message:
            rec.hops >= 3
              ? {
                  en: `${rec.hops} redirects before reaching ${rec.finalUrl} (high impact)`,
                  zh: `经过 ${rec.hops} 次重定向才到达 ${rec.finalUrl}（影响较大）`,
                }
              : {
                  en: `${rec.hops} redirects before reaching ${rec.finalUrl}`,
                  zh: `经过 ${rec.hops} 次重定向才到达 ${rec.finalUrl}`,
                },
          metrics: { hops: rec.hops },
        })),
  },
  {
    id: "redirected-urls",
    name: { en: "Redirected URLs", zh: "重定向 URL" },
    description: { en: "URLs that resolve through a single redirect (informational)", zh: "经过一次重定向的 URL（信息提示）" },
    category: "crawlability",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Update internal links to point directly at the final URL", zh: "更新内链直接指向最终 URL" },
    check: (ctx) =>
      ctx.fetchRecords
        .filter((rec) => rec.hops === 1 && rec.ok && !rec.isLoop)
        .map((rec) => ({
          url: rec.url,
          message: {
            en: `Redirects to ${rec.finalUrl} (HTTP ${rec.redirectChain[0]?.status ?? ""})`,
            zh: `重定向到 ${rec.finalUrl}（HTTP ${rec.redirectChain[0]?.status ?? ""}）`,
          },
          metrics: { hops: 1 },
        })),
  },
  {
    id: "links-to-redirects",
    name: { en: "Internal links to redirects", zh: "内链指向重定向" },
    description: {
      en: "Internal links point at URLs that redirect instead of the final destination",
      zh: "站内链接指向会重定向的 URL，而非最终目标",
    },
    category: "links",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Update the link href to the final destination URL", zh: "将链接 href 更新为最终目标 URL" },
    check: (ctx) =>
      ctx.fetchRecords
        .filter((rec) => rec.hops >= 1 && rec.ok && !rec.isLoop && rec.source === "link")
        .map((rec) => ({
          url: rec.url,
          message: {
            en: `Linked URL redirects to ${rec.finalUrl} (${rec.hops} hop${rec.hops > 1 ? "s" : ""})`,
            zh: `被链接的 URL 重定向到 ${rec.finalUrl}（${rec.hops} 跳）`,
          },
          metrics: { hops: rec.hops },
        })),
  },
  {
    id: "orphan-pages",
    name: { en: "Possible orphan pages", zh: "疑似孤岛页面" },
    description: {
      en: "Crawled pages that no other crawled internal page links to (possible orphans; may be a crawl-scope artifact)",
      zh: "已抓取页面没有任何其他已抓取站内页面指向（疑似孤岛；也可能受抓取范围影响）",
    },
    category: "links",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Add internal links to these pages from relevant content", zh: "从相关内容页面添加指向这些页面的内链" },
    check: (ctx) => {
      const startKey = urlDedupKey(ctx.baseUrl);
      const findings: RuleFinding[] = [];
      for (const np of ctx.pages) {
        if (np.depth === 0) continue; // 起始页天然可能无入链
        if (urlDedupKey(np.finalUrl) === startKey) continue;
        if (np.inLinkCount === 0) {
          findings.push({
            url: np.finalUrl,
            message: {
              en: "No internal links from other crawled pages point to this page",
              zh: "没有其他已抓取页面的内链指向该页面",
            },
          });
        }
      }
      return findings.slice(0, SITE_FINDING_CAP);
    },
  },
  {
    id: "deep-pages",
    name: { en: "Pages deep in site", zh: "层级过深页面" },
    description: {
      en: `Pages more than ${DEEP_PAGE_DEPTH} internal-link clicks away from the start page`,
      zh: `距离起始页超过 ${DEEP_PAGE_DEPTH} 次内链点击的页面`,
    },
    category: "links",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Flatten the internal linking structure to important pages", zh: "扁平化重要页面的内链结构" },
    check: (ctx) =>
      ctx.pages
        .filter((np) => np.depth > DEEP_PAGE_DEPTH)
        .map((np) => ({
          url: np.finalUrl,
          message: {
            en: `Page is ${np.depth} clicks away from the start page`,
            zh: `页面距起始页 ${np.depth} 次点击`,
          },
          metrics: { depth: np.depth },
        })),
  },
  {
    id: "no-sitemap",
    name: { en: "No sitemap reference", zh: "无 sitemap 引用" },
    description: { en: "robots.txt does not declare a sitemap and no sitemap was found", zh: "robots.txt 未声明 sitemap，且未发现可用 sitemap" },
    category: "sitemap",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Publish a sitemap.xml and reference it in robots.txt", zh: "发布 sitemap.xml 并在 robots.txt 中声明" },
    check: (ctx) => {
      const sitemap = ctx.sitemap;
      if (sitemap?.found) return [];
      if (sitemap && sitemap.httpStatus !== null) return []; // 有响应但无效 → sitemap-invalid 负责
      const declared = ctx.robots.sitemapUrls.length > 0;
      if (declared) return []; // 已声明但完全不可达 → sitemap-invalid 负责
      return [
        {
          url: `${ctx.origin}/robots.txt`,
          message: { en: "robots.txt does not declare a Sitemap", zh: "robots.txt 中未声明 Sitemap" },
        },
      ];
    },
  },
  {
    id: "sitemap-invalid",
    name: { en: "Invalid or unreachable sitemap", zh: "sitemap 无效或不可达" },
    description: {
      en: "The sitemap is referenced but unreachable, or its XML structure is invalid",
      zh: "sitemap 已声明但不可达，或 XML 结构无效",
    },
    category: "sitemap",
    severity: "warning",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Fix the sitemap URL or regenerate a valid XML sitemap", zh: "修正 sitemap 地址，或重新生成有效的 XML sitemap" },
    check: (ctx) => {
      const sitemap = ctx.sitemap;
      if (!sitemap || sitemap.found) return [];
      const declared = ctx.robots.sitemapUrls.length > 0;
      if (sitemap.httpStatus !== null && sitemap.httpStatus >= 400) {
        return [
          {
            url: sitemap.sitemapUrls[0] ?? `${ctx.origin}/sitemap.xml`,
            message: {
              en: `Sitemap returns HTTP ${sitemap.httpStatus}${declared ? " (declared in robots.txt)" : ""}`,
              zh: `Sitemap 返回 HTTP ${sitemap.httpStatus}${declared ? "（robots.txt 已声明）" : ""}`,
            },
            metrics: { httpStatus: sitemap.httpStatus },
          },
        ];
      }
      if (sitemap.httpStatus !== null) {
        return [
          {
            url: sitemap.sitemapUrls[0] ?? `${ctx.origin}/sitemap.xml`,
            message: {
              en: "Sitemap responds but does not contain a valid urlset/sitemapindex structure",
              zh: "Sitemap 可访问但不包含有效的 urlset/sitemapindex 结构",
            },
          },
        ];
      }
      return [];
    },
  },
  {
    id: "sitemap-bad-urls",
    name: { en: "Sitemap contains broken URLs", zh: "sitemap 含失效 URL" },
    description: { en: "URLs listed in the sitemap return 4xx/5xx", zh: "sitemap 中列出的 URL 返回 4xx/5xx" },
    category: "sitemap",
    severity: "warning",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Remove broken URLs from the sitemap and fix or redirect them", zh: "从 sitemap 移除失效 URL，并修复或重定向这些地址" },
    check: (ctx) => {
      const sitemap = ctx.sitemap;
      if (!sitemap?.found) return [];
      return sitemap.urlStatuses
        .filter((u) => u.status >= 400)
        .slice(0, SITE_FINDING_CAP)
        .map((u) => ({
          url: u.url,
          message: {
            en: `Sitemap URL returns HTTP ${u.status}`,
            zh: `sitemap 中的 URL 返回 HTTP ${u.status}`,
          },
          metrics: { status: u.status },
        }));
    },
  },
  {
    id: "sitemap-redirects",
    name: { en: "Sitemap contains redirected URLs", zh: "sitemap 含重定向 URL" },
    description: { en: "URLs listed in the sitemap redirect to another location", zh: "sitemap 中列出的 URL 发生重定向" },
    category: "sitemap",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "List the final destination URLs in the sitemap", zh: "在 sitemap 中列出最终目标 URL" },
    check: (ctx) => {
      const sitemap = ctx.sitemap;
      if (!sitemap?.found) return [];
      return sitemap.urlStatuses
        .filter((u) => u.redirect)
        .slice(0, SITE_FINDING_CAP)
        .map((u) => ({
          url: u.url,
          message: {
            en: `Sitemap URL redirects${u.location ? ` to ${u.location}` : ""}`,
            zh: `sitemap 中的 URL 发生重定向${u.location ? `到 ${u.location}` : ""}`,
          },
        }));
    },
  },
  {
    id: "sitemap-coverage",
    name: { en: "Sitemap coverage", zh: "sitemap 覆盖情况" },
    description: {
      en: "Crawled pages missing from the sitemap (informational; crawler scope is limited)",
      zh: "已抓取页面未列入 sitemap（信息提示；抓取范围有限，不代表 sitemap 错误）",
    },
    category: "sitemap",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Consider listing all indexable pages in the sitemap", zh: "考虑将所有可索引页面列入 sitemap" },
    check: (ctx) => {
      const sitemap = ctx.sitemap;
      if (!sitemap?.found || sitemap.urls.length === 0) return [];
      const set = new Set(sitemap.urls.map(urlDedupKey));
      const missing = ctx.pages.filter((np) => !set.has(urlDedupKey(np.finalUrl)));
      if (missing.length === 0) return [];
      return [
        {
          url: ctx.origin,
          message: {
            en: `${missing.length} of ${ctx.pages.length} crawled pages are not listed in the sitemap`,
            zh: `${ctx.pages.length} 个已抓取页面中有 ${missing.length} 个未列入 sitemap`,
          },
          metrics: { crawled: ctx.pages.length, notListed: missing.length },
        },
      ];
    },
  },
  {
    id: "robots-unreachable",
    name: { en: "robots.txt unreachable", zh: "robots.txt 不可达" },
    description: { en: "robots.txt could not be fetched (server error or network failure)", zh: "robots.txt 无法获取（服务器错误或网络故障）" },
    category: "crawlability",
    severity: "warning",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: { en: "Ensure robots.txt is reachable and returns a valid response", zh: "确保 robots.txt 可访问并返回有效响应" },
    check: (ctx) =>
      ctx.robots.status === "unreachable"
        ? [
            {
              url: `${ctx.origin}/robots.txt`,
              message: {
                en: `robots.txt could not be fetched${ctx.robots.httpStatus ? ` (HTTP ${ctx.robots.httpStatus})` : ""}`,
                zh: `robots.txt 无法获取${ctx.robots.httpStatus ? `（HTTP ${ctx.robots.httpStatus}）` : ""}`,
              },
            },
          ]
        : [],
  },
  {
    id: "robots-blocks-important",
    name: { en: "robots.txt blocks important pages", zh: "robots.txt 阻断重要页面" },
    description: {
      en: "robots.txt rules block the whole site or pages listed in the sitemap",
      zh: "robots.txt 规则阻断了整站或 sitemap 中列出的页面",
    },
    category: "indexability",
    severity: "error",
    pageLevel: "site",
    scoreWeight: 2,
    recommendation: { en: "Narrow the Disallow rules so important pages are crawlable", zh: "收窄 Disallow 规则，确保重要页面可被抓取" },
    check: (ctx) => {
      const robots = ctx.robots;
      if (robots.status !== "ok") return [];
      if (robots.disallowAll) {
        return [
          {
            url: `${ctx.origin}/robots.txt`,
            message: {
              en: 'robots.txt contains "Disallow: /" which blocks the entire site',
              zh: 'robots.txt 包含 "Disallow: /"，阻断整个站点',
            },
          },
        ];
      }
      // sitemap 中被 Disallow 阻断的 URL
      const sitemap = ctx.sitemap;
      if (!sitemap?.found || robots.universalDisallow.length === 0) return [];
      const findings: RuleFinding[] = [];
      for (const u of sitemap.urls.slice(0, SITE_FINDING_CAP)) {
        let pathname = "/";
        try {
          pathname = new URL(u).pathname;
        } catch {
          continue;
        }
        if (isPathBlocked(pathname, robots.universalDisallow)) {
          findings.push({
            url: u,
            message: {
              en: "URL is listed in the sitemap but blocked by robots.txt",
              zh: "URL 在 sitemap 中列出，但被 robots.txt 阻断",
            },
          });
        }
      }
      return findings;
    },
  },
  {
    id: "ai-crawler-access",
    name: { en: "AI crawler access", zh: "AI 爬虫访问" },
    description: {
      en: "robots.txt rules for AI crawlers (OAI-SearchBot, ChatGPT-User, GPTBot, ClaudeBot, Google-Extended). Informational for AI search visibility, not a traditional SEO error",
      zh: "robots.txt 中对 AI 爬虫（OAI-SearchBot、ChatGPT-User、GPTBot、ClaudeBot、Google-Extended）的规则。仅作 AI 搜索可见性参考，不是传统 SEO 错误",
    },
    category: "ai-search",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: {
      en: "If AI search visibility matters, allow the AI crawlers in robots.txt",
      zh: "如需 AI 搜索可见性，可在 robots.txt 中允许 AI 爬虫",
    },
    check: (ctx) => {
      const findings: RuleFinding[] = [];
      const metrics: Record<string, string | number | boolean> = {};
      for (const [agent, access] of Object.entries(ctx.robots.aiCrawlers)) {
        metrics[agent] = access;
        if (access === "disallowed") {
          findings.push({
            url: `${ctx.origin}/robots.txt`,
            message: {
              en: `${agent} is disallowed in robots.txt`,
              zh: `robots.txt 阻止了 ${agent}`,
            },
            metrics: { agent, access },
          });
        }
      }
      if (findings.length === 0) {
        return [];
      }
      return findings.map((f) => ({ ...f, metrics: { ...f.metrics, ...metrics } }));
    },
  },
  {
    id: "llms-txt",
    name: { en: "llms.txt", zh: "llms.txt 文件" },
    description: {
      en: "/llms.txt helps AI systems understand site content. Missing or invalid llms.txt is an opportunity, not a traditional SEO error",
      zh: "/llms.txt 帮助 AI 系统理解站点内容。缺失或无效属于优化机会，不是传统 SEO 错误",
    },
    category: "ai-search",
    severity: "notice",
    pageLevel: "site",
    scoreWeight: 1,
    recommendation: {
      en: "Publish a structured llms.txt at the site root for AI assistants",
      zh: "在站点根目录发布结构化的 llms.txt，供 AI 助手读取",
    },
    check: (ctx) => {
      const llms = ctx.llmsTxt;
      if (!llms) return [];
      if (llms.status === "found") return [];
      return [
        {
          url: `${ctx.origin}/llms.txt`,
          message:
            llms.status === "invalid"
              ? { en: "llms.txt exists but lacks required structure (heading + list)", zh: "llms.txt 存在但缺少必需结构（标题 + 列表）" }
              : { en: "llms.txt is missing (opportunity for AI search visibility)", zh: "缺少 llms.txt（AI 搜索可见性优化机会）" },
          metrics: { status: llms.status },
        },
      ];
    },
  },
];

// ---------- 规则目录 ----------

/** 全部规则（页面级在前，站点级在后） */
export const auditRules: AuditRule[] = [...pageRules, ...siteRules];

export const pageRuleIds: Set<string> = new Set(pageRules.map((r) => r.id));
export const siteRuleIds: Set<string> = new Set(siteRules.map((r) => r.id));

// ---------- 兼容层：CheckMeta（coverage UI 使用 legacy category） ----------

function severityToLegacyCategory(severity: RuleSeverity): CheckCategory {
  if (severity === "error") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

export interface CheckMeta {
  id: string;
  name: LocalizedText;
  category: CheckCategory;
  weight: number;
  description: LocalizedText;
}

export const allCheckMeta: CheckMeta[] = auditRules.map((r) => ({
  id: r.id,
  name: r.name,
  category: severityToLegacyCategory(r.severity),
  weight: Math.max(1, Math.round(r.scoreWeight * 5)),
  description: r.description,
}));

export const checkMetaMap: Record<string, CheckMeta> = Object.fromEntries(
  allCheckMeta.map((m) => [m.id, m])
);

/** 站点级规则 ID 集合（对应 V1 的 crossPageCheckIds 语义） */
export const crossPageCheckIds: Set<string> = siteRuleIds;

/**
 * 某审计深度下实际执行的规则 ID 集合。
 * quick：页面级规则（爬首页 1 页）；full：全部规则。
 * runAudit 健康分与 /api/audit/latest 的检查项覆盖共用此定义。
 */
export function getExecutedCheckIds(depth: "quick" | "full"): Set<string> {
  return depth === "full"
    ? new Set(auditRules.map((r) => r.id))
    : new Set(pageRules.map((r) => r.id));
}

/** 从 issues（checkId 列表）重建检查项覆盖（历史报告快照回退） */
export function buildCoverageFromIssues(
  issueCheckIds: string[],
  locale: "en" | "zh",
  depth?: "quick" | "full"
): Array<{ id: string; name: string; passed: boolean }> {
  const hit = new Set(issueCheckIds);
  const executed = depth
    ? getExecutedCheckIds(depth)
    : new Set(allCheckMeta.map((m) => m.id));
  return allCheckMeta
    .filter((m) => executed.has(m.id))
    .map((m) => ({
      id: m.id,
      name: pickText(m.name, locale),
      passed: !hit.has(m.id),
    }));
}

/**
 * 不参与评分、但会以 issue 形式写入 DB 的 checkId（如 startpage-unparsed）。
 */
export const nonCatalogCheckNames: Record<string, LocalizedText> = {
  "startpage-unparsed": {
    en: "Start page could not be parsed",
    zh: "起始页未能解析",
  },
  "js-redirect": { en: "JS redirect", zh: "JS 重定向" },
};

// ---------- 规则执行 ----------

/** 对全部适用规则执行检查，返回统一结构 */
export function runAuditRules(ctx: AuditContext): RuleExecution[] {
  const executions: RuleExecution[] = [];
  for (const rule of auditRules) {
    // quick 深度只执行页面级规则
    if (ctx.depth === "quick" && rule.pageLevel === "site") continue;
    let findings: RuleFinding[] = [];
    try {
      findings = rule.check(ctx) ?? [];
    } catch {
      findings = [];
    }
    executions.push({
      rule,
      status: findings.length > 0 ? "fail" : "pass",
      severity: rule.severity,
      findings,
      affectedPages: distinctUrls(findings),
    });
  }
  return executions;
}

/** RuleExecution → AuditIssue[]（写库结构，severity 允许 finding 级覆盖） */
export function executionToIssues(execution: RuleExecution): AuditIssue[] {
  return execution.findings.map((f) => ({
    checkId: execution.rule.id,
    checkName: execution.rule.name,
    message: f.message,
    url: f.url,
    severity: f.severity ?? execution.rule.severity,
    suggestion: execution.rule.recommendation,
  }));
}

// ---------- 规范化页面构建 ----------

/** URL 去重键：去 hash、去末尾斜杠（根路径保留） */
export function urlDedupKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const pathname =
      u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return `${u.protocol}//${u.host}${pathname}${u.search}`;
  } catch {
    return rawUrl;
  }
}

function isPathBlocked(pathname: string, rules: string[]): boolean {
  return rules.some((rule) => pathname.startsWith(rule));
}

/**
 * 将爬取产物 PageData + 抓取记录规范化为 NormalizedPage。
 * linkGraph：规范化目标 URL → 来源页面集合（用于 inLinkCount / orphan 判定）
 */
export function normalizePage(
  page: PageData,
  rec: FetchRecord,
  linkGraph: Map<string, Set<string>>
): NormalizedPage {
  const contentType = detectPageType(page);
  const contentStatus = contentVolumeStatus(page.wordCount, contentType);
  const htmlSize = page.htmlSize ?? 0;
  const visibleTextSize = page.visibleTextSize ?? page.bodyText.length;
  const textHtmlRatio = htmlSize > 0 ? visibleTextSize / htmlSize : 1;
  const key = urlDedupKey(rec.finalUrl);
  return {
    page,
    requestedUrl: rec.url,
    finalUrl: rec.finalUrl,
    status: rec.status,
    responseTimeMs: rec.responseTimeMs,
    depth: rec.depth,
    hops: rec.hops,
    redirectChain: rec.redirectChain,
    isLoop: rec.isLoop,
    contentType,
    wordCount: page.wordCount,
    threshold: contentThresholdOf(contentType),
    contentStatus,
    textHtmlRatio,
    structuredData: analyzeStructuredData(page.structuredDataRaw),
    internalLinkCount: page.links.filter((l) => !l.isExternal).length,
    externalLinkCount: page.links.filter((l) => l.isExternal).length,
    inLinkCount: linkGraph.get(key)?.size ?? 0,
  };
}

function contentThresholdOf(type: PageType): number {
  return CONTENT_THRESHOLDS[type].low;
}
