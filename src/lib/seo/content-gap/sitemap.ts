// ===== Sitemap 发现与解析（Website Content Gap） =====
//
// 支持：/sitemap.xml、robots.txt 声明、sitemap index（<sitemapindex> 递归一层）、
// gzip sitemap（Node fetch 自动解压 gzip；.gz 由 Content-Type/响应体判别）。
// 只输出 URL 清单，不做任何页面抓取决策。

import { safeFetch, fetchRobotsRules } from "./fetcher";

const MAX_SITEMAP_ENTRIES = 500;

export interface SitemapDiscovery {
  urls: string[];
  /** 实际使用的 sitemap 入口（诊断用） */
  usedSitemaps: string[];
  /** 发现失败的入口（诊断用） */
  failedSitemaps: string[];
  truncated: boolean;
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (loc) out.push(loc);
  }
  return out;
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url);
    if (!res || res.status !== 200 || !res.body) return null;
    return res.body;
  } catch {
    return null;
  }
}

/** 从 HTML/响应体提取 gzip sitemap 的 loc：Node fetch 已自动解压，直接按 XML 解析 */
async function fetchSitemapLocs(url: string, depth: number, used: string[], failed: string[]): Promise<string[]> {
  if (depth > 2) return [];
  const xml = await fetchXml(url);
  if (!xml) {
    failed.push(url);
    return [];
  }
  used.push(url);
  // sitemap index：递归一层子 sitemap
  if (/<sitemapindex/i.test(xml)) {
    const children = extractLocs(xml).filter((u) => /\.xml(\.gz)?($|\?)/i.test(u));
    const out: string[] = [];
    for (const child of children.slice(0, 10)) {
      out.push(...(await fetchSitemapLocs(child, depth + 1, used, failed)));
      if (out.length >= MAX_SITEMAP_ENTRIES) break;
    }
    return out;
  }
  // urlset：只取页面 URL（排除 .xml/.gz 自身）
  return extractLocs(xml).filter((u) => /^https?:\/\//i.test(u) && !/\.xml(\.gz)?($|\?)/i.test(u));
}

/**
 * 发现 sitemap 并返回页面 URL 清单。
 * 顺序：robots.txt 声明 → /sitemap.xml → 常见变体（sitemap_index.xml / sitemap.xml.gz）。
 */
export async function discoverSitemapUrls(origin: string): Promise<SitemapDiscovery> {
  const used: string[] = [];
  const failed: string[] = [];
  const candidates: string[] = [];

  const robots = await fetchRobotsRules(origin);
  if (robots.fetched) {
    try {
      const res = await safeFetch(`${origin}/robots.txt`);
      const body = res?.body ?? "";
      for (const line of body.split(/\r?\n/)) {
        const m = line.match(/^\s*sitemap:\s*(\S+)\s*$/i);
        if (m) candidates.push(m[1]);
      }
    } catch {
      /* robots 读取失败继续用默认候选 */
    }
  }
  candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml.gz`);

  const urls: string[] = [];
  const seenSitemap = new Set<string>();
  for (const candidate of candidates) {
    if (!seenSitemap.has(candidate)) {
      seenSitemap.add(candidate);
      const list = await fetchSitemapLocs(candidate, 0, used, failed);
      urls.push(...list);
      if (urls.length >= MAX_SITEMAP_ENTRIES) break;
    }
  }

  const unique = [...new Set(urls)].slice(0, MAX_SITEMAP_ENTRIES);
  return {
    urls: unique,
    usedSitemaps: [...new Set(used)],
    failedSitemaps: [...new Set(failed)],
    truncated: urls.length > MAX_SITEMAP_ENTRIES,
  };
}

// ---------- 页面清单提取（title / h1 / meta description / canonical / 内链计数） ----------

export interface PageInventory {
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  internalLinks: number;
}

function firstTag(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || null : null;
}

export function extractPageInventory(html: string, pageUrl: string): PageInventory {
  const title = firstTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = firstTag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const metaDescription =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim().slice(0, 300) ?? null;
  const canonicalRaw = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null;
  let canonicalUrl: string | null = null;
  if (canonicalRaw) {
    try {
      canonicalUrl = new URL(canonicalRaw, pageUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }
  // 内链计数（同 host 的 <a href>）
  let host = "";
  try {
    host = new URL(pageUrl).host;
  } catch {
    /* ignore */
  }
  let internalLinks = 0;
  const hrefRe = /<a\s[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    try {
      if (new URL(m[1], pageUrl).host === host) internalLinks += 1;
    } catch {
      /* 相对锚点等忽略 */
    }
  }
  return { title, h1, metaDescription, canonicalUrl, internalLinks };
}
