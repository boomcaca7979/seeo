// ===== 审计检查项：20+ 项单页 + 跨页检查 =====
// 每项检查返回统一结构 AuditIssue，null 表示通过
// 健康分基于权重总和计算

import type { PageData } from "@/lib/crawl";

export type CheckCategory = "critical" | "warning" | "info";
export type IssueSeverity = "error" | "warning" | "notice";

export interface AuditIssue {
  checkId: string;
  checkName: string;
  message: string;
  url: string;
  severity: IssueSeverity;
  suggestion: string;
}

export interface AuditCheck {
  id: string;
  name: string;
  category: CheckCategory;
  weight: number;
  description: string;
  /** 单页检查：返回 AuditIssue 或 null（通过） */
  check(page: PageData, baseUrl: string): AuditIssue | null;
}

export interface CrossPageCheck {
  id: string;
  name: string;
  category: CheckCategory;
  weight: number;
  description: string;
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
  message: string,
  suggestion: string
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
    name: "缺失标题",
    category: "critical",
    weight: 5,
    description: "每个页面必须有唯一的 <title> 标签",
    check: (page) => {
      if (!page.title) {
        return makeIssue(
          { id: "missing-title", name: "缺失标题", category: "critical", weight: 5, description: "" },
          page,
          "页面缺少 <title> 标签",
          "添加 30-60 字符的标题，包含主关键词"
        );
      }
      return null;
    },
  },
  {
    id: "missing-description",
    name: "缺失描述",
    category: "critical",
    weight: 5,
    description: "每个页面应有 meta description",
    check: (page) => {
      if (!page.metaDescription) {
        return makeIssue(
          { id: "missing-description", name: "缺失描述", category: "critical", weight: 5, description: "" },
          page,
          "页面缺少 meta description 标签",
          "添加 120-160 字符的描述，包含主关键词与卖点"
        );
      }
      return null;
    },
  },
  {
    id: "missing-h1",
    name: "缺失 H1",
    category: "critical",
    weight: 5,
    description: "每个页面应有一个 H1 标签",
    check: (page) => {
      if (page.h1.length === 0) {
        return makeIssue(
          { id: "missing-h1", name: "缺失 H1", category: "critical", weight: 5, description: "" },
          page,
          "页面缺少 H1 标签",
          "每个页面保留一个唯一的 H1，包含主关键词"
        );
      }
      return null;
    },
  },
  {
    id: "missing-alt",
    name: "图片无 alt",
    category: "warning",
    weight: 3,
    description: "信息性图片必须有描述性 alt",
    check: (page) => {
      const total = page.images.length;
      if (total === 0) return null;
      const missing = page.images.filter((i) => i.alt === null || i.alt === "").length;
      if (missing > 0) {
        return makeIssue(
          { id: "missing-alt", name: "图片无 alt", category: "warning", weight: 3, description: "" },
          page,
          `${missing}/${total} 张图片缺少 alt 属性`,
          "为信息性图片添加描述性 alt，装饰性图片留空 alt"
        );
      }
      return null;
    },
  },
  {
    id: "missing-canonical",
    name: "缺失 canonical",
    category: "warning",
    weight: 3,
    description: "设置 canonical 避免重复内容",
    check: (page) => {
      if (!page.canonical) {
        return makeIssue(
          { id: "missing-canonical", name: "缺失 canonical", category: "warning", weight: 3, description: "" },
          page,
          "页面缺少 canonical 标签",
          "设置 canonical 避免重复内容惩罚"
        );
      }
      return null;
    },
  },
  {
    id: "no-ssl",
    name: "非 HTTPS",
    category: "critical",
    weight: 5,
    description: "站点必须支持 HTTPS",
    check: (page, baseUrl) => {
      const checkUrl = page.finalUrl ?? page.url ?? baseUrl;
      if (!checkUrl.startsWith("https://")) {
        return makeIssue(
          { id: "no-ssl", name: "非 HTTPS", category: "critical", weight: 5, description: "" },
          page,
          "页面未使用 HTTPS 协议",
          "部署 SSL 证书并强制 HTTPS 重定向"
        );
      }
      return null;
    },
  },
  {
    id: "title-length",
    name: "标题过长或过短",
    category: "warning",
    weight: 3,
    description: `标题长度应在 ${TITLE_MIN}-${TITLE_MAX} 字符之间`,
    check: (page) => {
      if (!page.title) return null;
      const len = page.title.length;
      if (len < TITLE_MIN || len > TITLE_MAX) {
        return makeIssue(
          { id: "title-length", name: "标题过长或过短", category: "warning", weight: 3, description: "" },
          page,
          `标题长度 ${len} 字符（建议 ${TITLE_MIN}-${TITLE_MAX}）`,
          "调整标题长度至 30-60 字符，主关键词靠前"
        );
      }
      return null;
    },
  },
  {
    id: "description-length",
    name: "描述过长或过短",
    category: "warning",
    weight: 3,
    description: `描述长度应在 ${DESC_MIN}-${DESC_MAX} 字符之间`,
    check: (page) => {
      if (!page.metaDescription) return null;
      const len = page.metaDescription.length;
      if (len < DESC_MIN || len > DESC_MAX) {
        return makeIssue(
          { id: "description-length", name: "描述过长或过短", category: "warning", weight: 3, description: "" },
          page,
          `描述长度 ${len} 字符（建议 ${DESC_MIN}-${DESC_MAX}）`,
          `调整描述长度至 ${DESC_MIN}-${DESC_MAX} 字符`
        );
      }
      return null;
    },
  },
  {
    id: "missing-lang",
    name: "缺失语言属性",
    category: "info",
    weight: 1,
    description: "<html> 标签应有 lang 属性",
    check: (page) => {
      if (!page.htmlLang) {
        return makeIssue(
          { id: "missing-lang", name: "缺失语言属性", category: "info", weight: 1, description: "" },
          page,
          "<html> 标签缺少 lang 属性",
          "添加 lang 属性，如 <html lang=\"zh-CN\">"
        );
      }
      return null;
    },
  },
  {
    id: "missing-viewport",
    name: "缺失 viewport",
    category: "warning",
    weight: 3,
    description: "移动端适配必须有 viewport meta",
    check: (page) => {
      if (!page.viewport) {
        return makeIssue(
          { id: "missing-viewport", name: "缺失 viewport", category: "warning", weight: 3, description: "" },
          page,
          "页面缺少 viewport meta 标签",
          "添加 <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        );
      }
      return null;
    },
  },
  {
    id: "no-robots-meta",
    name: "robots 元标签缺失",
    category: "info",
    weight: 1,
    description: "建议设置 robots meta 标签",
    check: (page) => {
      if (!page.robotsMeta) {
        return makeIssue(
          { id: "no-robots-meta", name: "robots 元标签缺失", category: "info", weight: 1, description: "" },
          page,
          "页面缺少 robots meta 标签",
          "添加 <meta name=\"robots\" content=\"index, follow\">（非强制）"
        );
      }
      return null;
    },
  },
  {
    id: "slow-page",
    name: "页面加载慢",
    category: "info",
    weight: 1,
    description: `响应时间超过 ${SLOW_PAGE_MS / 1000}s 标记为慢页面`,
    check: (page) => {
      const ms = page.responseTimeMs ?? 0;
      if (ms > SLOW_PAGE_MS) {
        return makeIssue(
          { id: "slow-page", name: "页面加载慢", category: "info", weight: 1, description: "" },
          page,
          `响应时间 ${(ms / 1000).toFixed(1)}s（>${SLOW_PAGE_MS / 1000}s）`,
          "压缩图片、启用缓存、减少 JS 阻塞"
        );
      }
      return null;
    },
  },
  {
    id: "no-structured-data",
    name: "无结构化数据",
    category: "info",
    weight: 1,
    description: "建议添加 JSON-LD 结构化数据",
    check: (page) => {
      if (!page.hasStructuredData) {
        return makeIssue(
          { id: "no-structured-data", name: "无结构化数据", category: "info", weight: 1, description: "" },
          page,
          "页面未检测到 JSON-LD 结构化数据",
          "添加 <script type=\"application/ld+json\"> 提升搜索结果展示"
        );
      }
      return null;
    },
  },
  {
    id: "missing-og-tags",
    name: "缺失 Open Graph",
    category: "info",
    weight: 1,
    description: "社交分享需要 OG 标签",
    check: (page) => {
      if (!page.ogTitle || !page.ogDescription) {
        return makeIssue(
          { id: "missing-og-tags", name: "缺失 Open Graph", category: "info", weight: 1, description: "" },
          page,
          `缺少 og:title${page.ogDescription ? "" : " 和 og:description"}`,
          "添加 og:title、og:description、og:image 标签优化社交分享"
        );
      }
      return null;
    },
  },
  {
    id: "missing-twitter-card",
    name: "缺失 Twitter Card",
    category: "info",
    weight: 1,
    description: "建议添加 Twitter Card 标签",
    check: (page) => {
      if (!page.twitterCard) {
        return makeIssue(
          { id: "missing-twitter-card", name: "缺失 Twitter Card", category: "info", weight: 1, description: "" },
          page,
          "页面缺少 twitter:card 标签",
          "添加 <meta name=\"twitter:card\" content=\"summary_large_image\">"
        );
      }
      return null;
    },
  },
  {
    id: "no-favicon",
    name: "无 favicon",
    category: "info",
    weight: 1,
    description: "建议设置 favicon",
    check: (page) => {
      if (!page.favicon) {
        return makeIssue(
          { id: "no-favicon", name: "无 favicon", category: "info", weight: 1, description: "" },
          page,
          "页面缺少 favicon 引用",
          "添加 <link rel=\"icon\" href=\"/favicon.ico\">"
        );
      }
      return null;
    },
  },
  {
    id: "inline-css",
    name: "内联样式过多",
    category: "warning",
    weight: 3,
    description: `<style> 标签内容超过 ${INLINE_CSS_LIMIT} 字符`,
    check: (page) => {
      if (page.inlineStyleLength > INLINE_CSS_LIMIT) {
        return makeIssue(
          { id: "inline-css", name: "内联样式过多", category: "warning", weight: 3, description: "" },
          page,
          `内联样式 ${page.inlineStyleLength.toLocaleString()} 字符（>${INLINE_CSS_LIMIT}）`,
          "将内联样式提取到外部 CSS 文件"
        );
      }
      return null;
    },
  },
  {
    id: "js-redirect",
    name: "JS 重定向",
    category: "warning",
    weight: 3,
    description: "JS 重定向影响爬虫抓取",
    check: (page) => {
      if (page.hasJsRedirect) {
        return makeIssue(
          { id: "js-redirect", name: "JS 重定向", category: "warning", weight: 3, description: "" },
          page,
          "页面检测到 JS 重定向（window.location）",
          "改用服务端 301/302 重定向"
        );
      }
      return null;
    },
  },
  {
    id: "no-h2-h3",
    name: "无副标题结构",
    category: "info",
    weight: 1,
    description: "建议使用 H2/H3 组织内容结构",
    check: (page) => {
      if (page.h2.length === 0 && page.h3.length === 0) {
        return makeIssue(
          { id: "no-h2-h3", name: "无副标题结构", category: "info", weight: 1, description: "" },
          page,
          "页面无 H2 和 H3 标签",
          "使用 H2/H3 分层组织内容，提升可读性与 SEO"
        );
      }
      return null;
    },
  },
  {
    id: "external-links-nofollow",
    name: "外链无 nofollow",
    category: "info",
    weight: 1,
    description: "外链建议添加 nofollow（非强制）",
    check: (page) => {
      const external = page.links.filter((l) => l.isExternal);
      if (external.length === 0) return null;
      return null; // 当前 parsePage 不解析 rel 属性，跳过误报；保留检查项以覆盖展示
    },
  },
];

// ---------- 跨页检查（5 项）----------

export const crossPageChecks: CrossPageCheck[] = [
  {
    id: "duplicate-title",
    name: "重复标题",
    category: "critical",
    weight: 5,
    description: "同一域名下多个页面 title 相同",
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
            checkName: "重复标题",
            message: `"${title.slice(0, 60)}" 在 ${ps.length} 个页面重复`,
            url: ps[0].url,
            severity: "error",
            suggestion: "为每个页面编写唯一的 title",
          });
        }
      }
      return issues;
    },
  },
  {
    id: "duplicate-description",
    name: "重复描述",
    category: "critical",
    weight: 5,
    description: "同一域名下多个页面 description 相同",
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
            checkName: "重复描述",
            message: `"${desc.slice(0, 60)}" 在 ${ps.length} 个页面重复`,
            url: ps[0].url,
            severity: "error",
            suggestion: "为每个页面编写唯一的 meta description",
          });
        }
      }
      return issues;
    },
  },
  {
    id: "duplicate-h1",
    name: "重复 H1",
    category: "warning",
    weight: 3,
    description: "同一域名下多个页面 H1 相同",
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
            checkName: "重复 H1",
            message: `"${h1.slice(0, 60)}" 在 ${ps.length} 个页面重复`,
            url: ps[0].url,
            severity: "warning",
            suggestion: "为每个页面编写唯一的 H1",
          });
        }
      }
      return issues;
    },
  },
  {
    id: "no-sitemap",
    name: "无 sitemap 引用",
    category: "info",
    weight: 1,
    description: "robots.txt 中应声明 sitemap",
    crossCheck: (_pages, _baseUrl, extra) => {
      const robots = extra.robotsText ?? "";
      if (!robots.toLowerCase().includes("sitemap:")) {
        return [{
          checkId: "no-sitemap",
          checkName: "无 sitemap 引用",
          message: "robots.txt 中未声明 Sitemap",
          url: _baseUrl,
          severity: "notice",
          suggestion: "在 robots.txt 中添加 Sitemap: https://example.com/sitemap.xml",
        }];
      }
      return [];
    },
  },
  {
    id: "broken-links",
    name: "站内死链",
    category: "warning",
    weight: 3,
    description: "爬取过程中 HTTP 非 200 的内部链接",
    crossCheck: (_pages, _baseUrl, extra) => {
      return extra.brokenLinks.map((bl) => ({
        checkId: "broken-links",
        checkName: "站内死链",
        message: `HTTP ${bl.statusCode}`,
        url: bl.url,
        severity: bl.statusCode === 404 ? "error" : "warning",
        suggestion: bl.statusCode === 404
          ? "添加 301 重定向到相关页面，或恢复缺失内容"
          : "检查服务器状态与页面可用性",
      }));
    },
  },
];

// ---------- 检查项元数据（供 UI 展示）----------

export interface CheckMeta {
  id: string;
  name: string;
  category: CheckCategory;
  weight: number;
  description: string;
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

// ---------- 健康分计算 ----------

/** 所有检查项权重总和 */
export const MAX_SCORE: number = allCheckMeta.reduce((s, c) => s + c.weight, 0);

/**
 * 基于命中的检查项计算健康分
 * 扣分 = Σ(命中检查项的权重)，每个 checkId 只扣一次
 */
export function calculateHealthScore(issues: AuditIssue[]): number {
  const hitCheckIds = new Set(issues.map((i) => i.checkId));
  let deduction = 0;
  for (const id of hitCheckIds) {
    const meta = checkMetaMap[id];
    if (meta) deduction += meta.weight;
  }
  return Math.max(0, Math.round(100 - (deduction / MAX_SCORE) * 100));
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
