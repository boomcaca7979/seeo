// ===== 共享网页抓取库（服务端专用） =====
// cheerio 解析 HTML，fetch 抓取，遵守爬虫礼仪

import * as cheerio from "cheerio";

const TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; SeeO-SEO-Bot/1.0; +https://www.seeo.asia/bot)";

export interface CrawlResult {
  url: string; // 最终 URL（跟踪重定向后）
  html: string;
  status: number;
  responseTimeMs: number;
}

/** 一次重定向跳转记录（用于 Redirect Chain / Loop 检测） */
export interface RedirectHop {
  /** 发起跳转的 URL */
  url: string;
  /** 重定向状态码（301/302/307/308 等） */
  status: number;
  /** Location 头原始值（可能为相对路径） */
  location: string | null;
}

/** 带重定向链信息的抓取结果（Audit Engine V2 使用） */
export interface DetailedFetchResult {
  requestedUrl: string;
  /** 最终 URL（重定向跟随到底，或环/超限时的最后一个 URL） */
  finalUrl: string;
  /** 最终 HTTP 状态（环/超限时为最后一条重定向状态） */
  status: number;
  /** 2xx 时为响应体，否则为空串 */
  html: string;
  /** 全程（含所有 hop）总耗时 */
  responseTimeMs: number;
  redirectChain: RedirectHop[];
  /** 跟随的重定向次数 */
  hops: number;
  isLoop: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const MAX_REDIRECT_HOPS = 10;

export class CrawlError extends Error {
  code: "TIMEOUT" | "NETWORK" | "HTTP_ERROR" | "INVALID_URL";
  constructor(
    code: "TIMEOUT" | "NETWORK" | "HTTP_ERROR" | "INVALID_URL",
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = "CrawlError";
  }
}

/** SSRF 防护：校验 URL 协议与 hostname 安全性 */
export function validateUrlSafety(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CrawlError("INVALID_URL", `URL 格式无效：${rawUrl}`);
  }
  // 协议白名单：只允许 http/https
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrawlError("INVALID_URL", `不允许的协议：${url.protocol}`);
  }
  const hostname = url.hostname.toLowerCase();
  // 禁止 localhost 及常见本地回环
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    throw new CrawlError("INVALID_URL", `禁止访问本地地址：${hostname}`);
  }
  // 禁止 IPv4 回环 / 私网 / 链路本地 / 保留段
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number) as unknown as number[];
    const first = a;
    const second = b;
    if (
      first === 127 || // 127.0.0.0/8 回环
      first === 10 || // 10.0.0.0/8 A 类私网
      (first === 172 && second >= 16 && second <= 31) || // 172.16.0.0/12 B 类私网
      (first === 192 && second === 168) || // 192.168.0.0/16 C 类私网
      (first === 169 && second === 254) || // 169.254.0.0/16 链路本地
      first === 0 || // 0.0.0.0/8 本机网络
      first >= 224 // 224.0.0.0/4 组播、240.0.0.0/4 保留
    ) {
      throw new CrawlError("INVALID_URL", `禁止访问私有/保留 IP：${hostname}`);
    }
  }
  // 禁止 .local / .internal 等 mDNS / 本地域名
  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) {
    throw new CrawlError("INVALID_URL", `禁止访问本地域名：${hostname}`);
  }
  return url;
}

/**
 * 抓取页面并手动跟随重定向，记录完整重定向链（hop 数 / Location / 环检测）。
 * - 301/302/303/307/308 跟随，最多 maxHops 次
 * - 链中出现重复 URL → isLoop = true（不再继续请求）
 * - 非 2xx 最终响应：status 原样返回、html 为空串（由调用方决定如何归类）
 * - 超时 / 网络错误抛 CrawlError（与 fetchPage 一致）
 */
export async function fetchPageWithRedirects(
  rawUrl: string,
  timeoutMs: number = TIMEOUT_MS,
  maxHops: number = MAX_REDIRECT_HOPS
): Promise<DetailedFetchResult> {
  const startUrl = validateUrlSafety(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  const chain: RedirectHop[] = [];
  const seen = new Set<string>([startUrl.toString()]);
  let current = startUrl.toString();

  try {
    for (;;) {
      const res = await fetch(current, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "manual",
        cache: "no-store",
      });

      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get("location");
        // 重定向响应体无价值，尽早取消以节省带宽
        try { await res.body?.cancel(); } catch { /* ignore */ }

        const terminalRec = (finalUrl: string, isLoop: boolean): DetailedFetchResult => ({
          requestedUrl: startUrl.toString(),
          finalUrl,
          status: res.status,
          html: "",
          responseTimeMs: Date.now() - t0,
          redirectChain: chain,
          hops: chain.length,
          isLoop,
        });

        if (!location) {
          // 重定向状态但无 Location：按终态处理
          return terminalRec(current, false);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return terminalRec(current, false);
        }
        chain.push({ url: current, status: res.status, location });

        if (seen.has(next.toString())) {
          // 重定向环：A → B → A
          return terminalRec(next.toString(), true);
        }
        seen.add(next.toString());
        if (chain.length >= maxHops) {
          // 超过最大跳数：停止跟随，按链终态处理
          return terminalRec(next.toString(), false);
        }
        current = next.toString();
        continue;
      }

      // 终态响应
      const html = res.ok ? await res.text() : "";
      return {
        requestedUrl: startUrl.toString(),
        finalUrl: current,
        status: res.status,
        html,
        responseTimeMs: Date.now() - t0,
        redirectChain: chain,
        hops: chain.length,
        isLoop: false,
      };
    }
  } catch (e) {
    if (e instanceof CrawlError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new CrawlError("TIMEOUT", `抓取超时（${timeoutMs / 1000}s）：${rawUrl}`);
    }
    throw new CrawlError("NETWORK", `网络错误：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 抓取单个页面（跟随重定向；HTTP 错误抛 CrawlError） */
export async function fetchPage(rawUrl: string, timeoutMs: number = TIMEOUT_MS): Promise<CrawlResult> {
  const r = await fetchPageWithRedirects(rawUrl, timeoutMs);
  if (r.status >= 400) {
    throw new CrawlError("HTTP_ERROR", `HTTP ${r.status}`);
  }
  return {
    url: r.finalUrl,
    html: r.html,
    status: r.status,
    responseTimeMs: r.responseTimeMs,
  };
}

/**
 * 仅获取 URL 的 HTTP 状态（GET + 拿到响应头即取消，不下载正文）。
 * 用于 sitemap URL 抽检（4xx/5xx/redirect 检测），返回 Location 便于识别重定向。
 */
export async function fetchUrlStatus(
  rawUrl: string,
  timeoutMs: number = 6000
): Promise<{ status: number; location: string | null }> {
  const url = validateUrlSafety(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
      cache: "no-store",
    });
    const location = res.headers.get("location");
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { status: res.status, location };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new CrawlError("TIMEOUT", `抓取超时（${timeoutMs / 1000}s）：${rawUrl}`);
    }
    throw new CrawlError("NETWORK", `网络错误：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 解析结果 ----------

export interface PageLink {
  href: string;
  text: string;
  isExternal: boolean;
}

export interface PageData {
  url: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  images: { src: string; alt: string | null }[];
  links: PageLink[];
  bodyText: string;
  wordCount: number;
  responseTimeMs?: number;
  status?: number;
  finalUrl?: string;
  htmlLang: string | null;
  viewport: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
  favicon: string | null;
  hasStructuredData: boolean;
  structuredDataRaw: string[];
  inlineStyleLength: number;

  // ===== Audit Engine V2 扩展（均为可选，兼容既有构造方） =====
  /** 爬取深度（起始页 0，每跟随一次内链 +1） */
  depth?: number;
  /** 本次抓取实际请求的 URL（可能经重定向到 finalUrl） */
  requestedUrl?: string;
  /** 跟随的重定向次数 */
  redirectHops?: number;
  /** 重定向链 */
  redirectChain?: RedirectHop[];
  /** 是否检测到重定向环 */
  isRedirectLoop?: boolean;
  /** 原始 HTML 大小（字符数） */
  htmlSize?: number;
  /** <style> 内容 + style 属性总大小（字符数） */
  cssSize?: number;
  /** <script> 内容总大小（字符数） */
  scriptSize?: number;
  /** 排除 boilerplate 后的可见正文字符数 */
  visibleTextSize?: number;
  /** 语义化标签存在情况 */
  semantic?: {
    main: boolean;
    nav: boolean;
    article: boolean;
    header: boolean;
    footer: boolean;
    section: boolean;
  };
  /** 主内容区语义标签（main/article/section）命中数 */
  semanticMainCount?: number;
  /** 完整标题大纲（h1-h6，按文档顺序） */
  headings?: Array<{ level: number; text: string }>;
}

/** 用 cheerio 解析 HTML */
export function parsePage(html: string, baseUrl: string): PageData {
  const $ = cheerio.load(html);
  const base = (() => {
    try {
      return new URL(baseUrl);
    } catch {
      return null;
    }
  })();

  const title = $("title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const robotsMeta =
    $('meta[name="robots"]').attr("content")?.trim() || null;

  const h1: string[] = [];
  $("h1").each((_, el) => {
    const t = $(el).text().trim();
    if (t) h1.push(t);
  });
  const h2: string[] = [];
  $("h2").each((_, el) => {
    const t = $(el).text().trim();
    if (t) h2.push(t);
  });
  const h3: string[] = [];
  $("h3").each((_, el) => {
    const t = $(el).text().trim();
    if (t) h3.push(t);
  });

  // 新增字段：lang / viewport / OG / Twitter / favicon / 结构化数据 / 内联样式 / JS 重定向
  const htmlLang = $("html").attr("lang")?.trim() || null;
  const viewport = $('meta[name="viewport"]').attr("content")?.trim() || null;
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
  const ogDescription = $('meta[property="og:description"]').attr("content")?.trim() || null;
  const twitterCard = $('meta[name="twitter:card"]').attr("content")?.trim() || null;
  const favicon =
    $('link[rel="icon"]').attr("href")?.trim() ||
    $('link[rel="shortcut icon"]').attr("href")?.trim() ||
    null;
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || null;

  const structuredDataRaw: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (raw) structuredDataRaw.push(raw.trim());
  });
  const hasStructuredData = structuredDataRaw.length > 0;

  let inlineStyleLength = 0;
  $("style").each((_, el) => {
    inlineStyleLength += $(el).html()?.length ?? 0;
  });
  let styleAttrLength = 0;
  $("[style]").each((_, el) => {
    styleAttrLength += ($(el).attr("style") || "").length;
  });
  const cssSize = inlineStyleLength + styleAttrLength;
  let scriptSize = 0;
  $("script").each((_, el) => {
    scriptSize += $(el).html()?.length ?? 0;
  });
  const htmlSize = html.length;

  // 语义化 HTML 检测（在移除 boilerplate 前统计）
  const semantic = {
    main: $("main").length > 0,
    nav: $("nav").length > 0,
    article: $("article").length > 0,
    header: $("header").length > 0,
    footer: $("footer").length > 0,
    section: $("section").length > 0,
  };
  const semanticMainCount =
    (semantic.main ? 1 : 0) + (semantic.article ? 1 : 0) + (semantic.section ? 1 : 0);

  // 完整标题大纲 h1-h6（逗号选择器按文档顺序返回，用于标题层级检测）
  const headings: Array<{ level: number; text: string }> = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "";
    const level = Number(tag.replace("h", ""));
    const t = $(el).text().trim();
    if (level >= 1 && level <= 6 && t) headings.push({ level, text: t });
  });

  const images: { src: string; alt: string | null }[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src) return;
    let abs = src;
    if (base) {
      try {
        abs = new URL(src, base).toString();
      } catch {
        // keep raw
      }
    }
    const alt = $(el).attr("alt");
    images.push({ src: abs, alt: alt === undefined ? null : alt });
  });

  const links: PageLink[] = [];
  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href") || "";
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) return;
    if (!base) return;
    let abs: string;
    try {
      abs = new URL(rawHref, base).toString();
    } catch {
      return;
    }
    const linkUrl = new URL(abs);
    const isExternal = linkUrl.hostname !== base.hostname;
    links.push({
      href: abs,
      text: $(el).text().trim().slice(0, 120),
      isExternal,
    });
  });

  // 正文提取：移除脚本/样式/导航类 boilerplate 后取正文
  // nav/footer/header/aside 属于布局重复内容；cookie/consent 类横幅按常见命名兜底排除
  $(
    "script, style, noscript, template, svg, iframe, nav, footer, header, aside"
  ).remove();
  try {
    $(
      '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="banner" i]'
    ).remove();
  } catch {
    // 选择器不受支持时忽略（不影响正文提取）
  }
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  // 字数估算：中文按字符数 + 英文按单词数
  const cjk = (bodyText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (bodyText.match(/[a-zA-Z]+/g) || []).length;
  const wordCount = cjk + en;
  const visibleTextSize = bodyText.length;

  return {
    url: baseUrl,
    title,
    metaDescription,
    canonical,
    robotsMeta,
    h1,
    h2,
    h3,
    images,
    links,
    bodyText,
    wordCount,
    htmlLang,
    viewport,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    favicon,
    hasStructuredData,
    structuredDataRaw,
    inlineStyleLength,
    htmlSize,
    cssSize,
    scriptSize,
    visibleTextSize,
    semantic,
    semanticMainCount,
    headings,
  };
}

// ---------- 检测项 ----------

export interface CheckItem {
  name: string;
  passed: boolean;
  current: string;
  suggested: string;
}

/** 输入解析结果，输出检测项数组 */
export function detectIssues(page: PageData): CheckItem[] {
  const items: CheckItem[] = [];

  // Title
  if (!page.title) {
    items.push({
      name: "Title 标签",
      passed: false,
      current: "缺失",
      suggested: "每个页面必须有唯一的 title，30-60 字符",
    });
  } else {
    const len = page.title.length;
    items.push({
      name: "Title 标签",
      passed: len >= 10 && len <= 60,
      current: `${len} 字符 · ${page.title.slice(0, 40)}${len > 40 ? "…" : ""}`,
      suggested: "30-60 字符，主关键词靠前",
    });
  }

  // Meta 描述
  if (!page.metaDescription) {
    items.push({
      name: "Meta 描述",
      passed: false,
      current: "缺失",
      suggested: "70-160 字符，包含主关键词与卖点",
    });
  } else {
    const len = page.metaDescription.length;
    items.push({
      name: "Meta 描述",
      passed: len >= 50 && len <= 160,
      current: `${len} 字符`,
      suggested: "70-160 字符",
    });
  }

  // H1 唯一性
  if (page.h1.length === 0) {
    items.push({
      name: "H1 标题",
      passed: false,
      current: "缺失",
      suggested: "每个页面保留一个 H1",
    });
  } else if (page.h1.length > 1) {
    items.push({
      name: "H1 标题",
      passed: false,
      current: `${page.h1.length} 个 H1`,
      suggested: "每个页面仅一个 H1",
    });
  } else {
    items.push({
      name: "H1 标题",
      passed: true,
      current: page.h1[0].slice(0, 40),
      suggested: "唯一且包含主关键词",
    });
  }

  // 图片 Alt
  const imgTotal = page.images.length;
  const imgMissingAlt = page.images.filter((i) => i.alt === null || i.alt === "").length;
  items.push({
    name: "图片 Alt 文本",
    passed: imgTotal === 0 ? true : imgMissingAlt === 0,
    current: imgTotal === 0 ? "无图片" : `${imgMissingAlt}/${imgTotal} 缺失 Alt`,
    suggested: "所有信息性图片必须有描述性 alt",
  });

  // 字数
  items.push({
    name: "正文字数",
    passed: page.wordCount >= 300,
    current: `${page.wordCount.toLocaleString()} 字`,
    suggested: "建议 ≥ 300 字，深度内容建议 1500+",
  });

  // canonical
  items.push({
    name: "Canonical",
    passed: !!page.canonical,
    current: page.canonical ?? "缺失",
    suggested: "设置 canonical 避免重复内容",
  });

  // 内链
  const internalLinks = page.links.filter((l) => !l.isExternal).length;
  items.push({
    name: "内链数量",
    passed: internalLinks >= 3,
    current: `${internalLinks} 个内链`,
    suggested: "建议 ≥ 3 个内链，帮助权重传递",
  });

  return items;
}

// ---------- 关键词分析 ----------

export interface KeywordAnalysis {
  keyword: string;
  inTitle: boolean;
  inH1: boolean;
  inMetaDescription: boolean;
  inBody: boolean;
  /** 关键词密度（百分比，子串出现次数 / 总字数） */
  density: number;
  occurrences: number;
}

/** 计算关键词在 title/H1/正文的出现情况与密度 */
export function keywordAnalysis(page: PageData, keyword: string): KeywordAnalysis {
  const kw = keyword.trim().toLowerCase();
  if (!kw) {
    return {
      keyword,
      inTitle: false,
      inH1: false,
      inMetaDescription: false,
      inBody: false,
      density: 0,
      occurrences: 0,
    };
  }

  const titleLower = (page.title ?? "").toLowerCase();
  const h1Lower = page.h1.join(" ").toLowerCase();
  const metaLower = (page.metaDescription ?? "").toLowerCase();
  const bodyLower = page.bodyText.toLowerCase();

  // 子串出现次数（适用于中英文混合）
  const countOccurrences = (text: string, sub: string): number => {
    if (!sub) return 0;
    let count = 0;
    let idx = 0;
    while ((idx = text.indexOf(sub, idx)) !== -1) {
      count++;
      idx += sub.length;
    }
    return count;
  };

  const occurrences = countOccurrences(bodyLower, kw);
  const density = page.wordCount > 0 ? (occurrences / page.wordCount) * 100 : 0;

  return {
    keyword,
    inTitle: titleLower.includes(kw),
    inH1: h1Lower.includes(kw),
    inMetaDescription: metaLower.includes(kw),
    inBody: bodyLower.includes(kw),
    density: Math.round(density * 100) / 100,
    occurrences,
  };
}

// ---------- 工具：补全 URL ----------

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** 判断两个 URL 是否同域名 */
export function isSameDomain(url1: string, url2: string): boolean {
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);
    return u1.hostname === u2.hostname;
  } catch {
    return false;
  }
}

/** 简单 robots.txt 检查（仅 Disallow 前缀匹配） */
export async function isAllowedByRobots(targetUrl: string): Promise<boolean> {
  try {
    const u = new URL(targetUrl);
    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (!res.ok) return true; // 无 robots.txt 视为全部允许
      const text = await res.text();
      // 仅处理 User-agent: * 段
      const lines = text.split("\n");
      let inUniversal = false;
      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.startsWith("user-agent:")) {
          const agent = trimmed.slice("user-agent:".length).trim();
          inUniversal = agent === "*";
          continue;
        }
        if (inUniversal && trimmed.startsWith("disallow:")) {
          const rule = trimmed.slice("disallow:".length).trim();
          if (rule === "") continue;
          if (u.pathname.startsWith(rule)) {
            return false;
          }
        }
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return true; // robots.txt 读取失败视为允许
  }
}
