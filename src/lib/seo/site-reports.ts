// ===== 站点级报告：robots.txt / sitemap / llms.txt（Audit Engine V2） =====
// 每个资源在一次审计中只请求一次（robots 一次、sitemap 一次、llms.txt 一次），
// 供全部站点级规则复用，避免 N× 请求。

import { fetchUrlStatus } from "@/lib/crawl";

// ---------- robots.txt ----------

export type RobotsStatus = "ok" | "missing" | "unreachable" | "invalid";

/** AI 爬虫访问状态（不作为传统 SEO Error，仅作 AI Search 参考） */
export type AiCrawlerAccess = "allowed" | "disallowed" | "not-specified";

export const AI_CRAWLER_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
] as const;

export interface RobotsReport {
  status: RobotsStatus;
  httpStatus: number | null;
  text: string | null;
  /** User-agent: * 组的 Disallow 规则（路径前缀） */
  universalDisallow: string[];
  /** 是否存在 Disallow: /（整站阻断） */
  disallowAll: boolean;
  /** 声明的 Sitemap URL */
  sitemapUrls: string[];
  /** AI 爬虫访问状态 */
  aiCrawlers: Record<string, AiCrawlerAccess>;
}

const ROBOTS_TIMEOUT_MS = 6000;

/** 解析 robots.txt 为按 agent 分组的 Disallow 规则 */
export function parseRobotsGroups(
  text: string
): Map<string, { disallow: string[]; hasGroup: boolean }> {
  const groups = new Map<string, { disallow: string[]; hasGroup: boolean }>();
  let currentAgents: string[] = [];
  let sawDirective = false;

  const ensureGroup = (agent: string) => {
    if (!groups.has(agent)) groups.set(agent, { disallow: [], hasGroup: true });
    else groups.get(agent)!.hasGroup = true;
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) {
      // 空行结束一个组
      if (currentAgents.length > 0 && sawDirective) currentAgents = [];
      continue;
    }
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (sawDirective) currentAgents = []; // 新组开始
      sawDirective = false;
      if (value) currentAgents.push(value.toLowerCase());
      continue;
    }
    if (currentAgents.length === 0) continue;
    if (key === "disallow") {
      sawDirective = true;
      for (const agent of currentAgents) {
        ensureGroup(agent);
        if (value) groups.get(agent)!.disallow.push(value);
      }
    } else if (key === "allow") {
      // 显式 Allow 也算该 agent 拥有规则（AI 爬虫访问状态：显式允许 → allowed）
      sawDirective = true;
      for (const agent of currentAgents) ensureGroup(agent);
    } else if (key === "sitemap") {
      sawDirective = true;
    }
  }
  return groups;
}

function extractSitemapUrls(text: string): string[] {
  const urls: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^sitemap:/i.test(line)) {
      const url = line.replace(/^sitemap:/i, "").trim();
      if (url) urls.push(url);
    }
  }
  return urls;
}

/** 读取并解析 robots.txt（一次请求） */
export async function fetchRobotsReport(origin: string): Promise<RobotsReport> {
  const robotsUrl = `${origin}/robots.txt`;
  let httpStatus: number | null = null;
  let text: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    try {
      const res = await fetch(robotsUrl, {
        signal: controller.signal,
        cache: "no-store",
      });
      httpStatus = res.status;
      if (res.ok) text = await res.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return {
      status: "unreachable",
      httpStatus,
      text: null,
      universalDisallow: [],
      disallowAll: false,
      sitemapUrls: [],
      aiCrawlers: {},
    };
  }

  if (!text) {
    // 404 等：robots.txt 缺失视为"全部允许"，不是错误
    return {
      status: httpStatus === 404 || httpStatus === 410 ? "missing" : "unreachable",
      httpStatus,
      text: null,
      universalDisallow: [],
      disallowAll: false,
      sitemapUrls: [],
      aiCrawlers: {},
    };
  }

  const groups = parseRobotsGroups(text);
  const universal = groups.get("*");
  const universalDisallow = universal?.disallow ?? [];
  const disallowAll = universalDisallow.some((r) => r === "/" || r === "/*");

  const aiCrawlers: Record<string, AiCrawlerAccess> = {};
  for (const agent of AI_CRAWLER_AGENTS) {
    const g = groups.get(agent.toLowerCase());
    if (!g) {
      // 未指定：回退 * 组语义（无组或 * 无阻断 → 默认允许）
      aiCrawlers[agent] = disallowAll ? "disallowed" : "not-specified";
    } else {
      const fullBlock = g.disallow.some((r) => r === "/" || r === "/*");
      aiCrawlers[agent] = fullBlock ? "disallowed" : "allowed";
    }
  }

  const status: RobotsStatus = universalDisallow.length > 0 || text.trim().length > 0 ? "ok" : "invalid";

  return {
    status,
    httpStatus,
    text,
    universalDisallow,
    disallowAll,
    sitemapUrls: extractSitemapUrls(text),
    aiCrawlers,
  };
}

/** 路径是否被 Disallow 规则（前缀匹配）阻断 */
export function isDisallowedPath(pathname: string, rules: string[]): boolean {
  return rules.some((rule) => pathname.startsWith(rule));
}

// ---------- sitemap ----------

export interface SitemapUrlStatus {
  url: string;
  status: number;
  /** 是否为重定向（301/302/307/308） */
  redirect: boolean;
  location: string | null;
}

export interface SitemapReport {
  /** 是否找到可访问的 sitemap */
  found: boolean;
  /** 尝试过的 sitemap URL（robots 声明的 + 默认 /sitemap.xml） */
  sitemapUrls: string[];
  /** 成功抓取的 sitemap 的 HTTP 状态 */
  httpStatus: number | null;
  /** XML 结构是否有效（urlset / sitemapindex） */
  xmlValid: boolean;
  isIndex: boolean;
  /** sitemap index 中的子 sitemap */
  childSitemaps: string[];
  /** sitemap 中的页面 URL（同域） */
  urls: string[];
  /** 抽检了 HTTP 状态的 URL（未抽检的不在此列） */
  urlStatuses: SitemapUrlStatus[];
}

const SITEMAP_TIMEOUT_MS = 8000;
/** sitemap URL 状态抽检上限（未爬取过的 URL 才抽检；已爬取的直接复用抓取状态） */
const SITEMAP_STATUS_CHECK_LIMIT = 100;
const SITEMAP_STATUS_CONCURRENCY = 5;
/** sitemap index 子 sitemap 抓取上限 */
const SITEMAP_CHILD_LIMIT = 10;

async function fetchText(url: string, timeoutMs: number): Promise<{ status: number; text: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SeeO-SEO-Bot/1.0; +https://www.seeo.asia/bot)" },
        cache: "no-store",
        redirect: "follow",
      });
      if (!res.ok) return { status: res.status, text: "" };
      return { status: res.status, text: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function extractLoc(text: string): { urls: string[]; childSitemaps: string[] } {
  const urls: string[] = [];
  const childSitemaps: string[] = [];
  for (const m of text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const u = m[1].trim();
    if (!u) continue;
    // 区分子 sitemap 与页面 URL：sitemapindex 中只有 <sitemap><loc>
    urls.push(u);
  }
  return { urls, childSitemaps };
}

/**
 * 抓取并解析 sitemap（一次请求；index 则跟随子 sitemap，有上限）。
 * @param knownStatuses 已爬取页面的状态（url → {status, hops}），避免重复抽检
 */
export async function fetchSitemapReport(
  origin: string,
  robots: RobotsReport,
  knownStatuses: Map<string, { status: number; hops: number }>
): Promise<SitemapReport> {
  const candidates = robots.sitemapUrls.length > 0
    ? robots.sitemapUrls
    : [`${origin}/sitemap.xml`];

  const collected = new Set<string>();
  const childSitemaps: string[] = [];
  let found = false;
  let httpStatus: number | null = null;
  let xmlValid = false;
  let isIndex = false;

  for (const candidate of candidates) {
    const res = await fetchText(candidate, SITEMAP_TIMEOUT_MS);
    if (!res) continue;
    // 记录首个有响应的候选状态（4xx/5xx 也记录，供 sitemap-invalid 规则判定"已声明但不可达"）
    if (httpStatus === null) httpStatus = res.status;
    if (res.status >= 400 || !res.text) continue;
    const text = res.text;
    const isUrlset = /<urlset/i.test(text);
    const isSitemapIndex = /<sitemapindex/i.test(text);
    if (!isUrlset && !isSitemapIndex) continue;

    found = true;
    xmlValid = true;
    isIndex = isSitemapIndex;
    const { urls } = extractLoc(text);
    for (const u of urls) collected.add(u);

    if (isSitemapIndex) {
      // sitemap index：子 sitemap 也在 <loc> 中，按上限跟随
      const children = urls.slice(0, SITEMAP_CHILD_LIMIT);
      childSitemaps.push(...children);
      for (const child of children) {
        const childRes = await fetchText(child, SITEMAP_TIMEOUT_MS);
        if (!childRes || childRes.status >= 400 || !childRes.text) continue;
        if (!/<urlset/i.test(childRes.text)) continue;
        const { urls: childUrls } = extractLoc(childRes.text);
        for (const u of childUrls) collected.add(u);
      }
    }
    break; // 只采用第一个可用的 sitemap 声明
  }

  // 同域过滤 + 规范化
  const urls: string[] = [];
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  for (const u of collected) {
    try {
      const parsed = new URL(u);
      if (originHost && parsed.host !== originHost) continue;
      urls.push(`${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`);
    } catch {
      // 无效 URL 忽略
    }
  }

  // 状态抽检：只检查未爬取过的 URL（有上限、小并发）
  const urlStatuses: SitemapUrlStatus[] = [];
  const toCheck = urls.filter((u) => !knownStatuses.has(u)).slice(0, SITEMAP_STATUS_CHECK_LIMIT);
  for (let i = 0; i < toCheck.length; i += SITEMAP_STATUS_CONCURRENCY) {
    const batch = toCheck.slice(i, i + SITEMAP_STATUS_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (u) => ({ u, r: await fetchUrlStatus(u) }))
    );
    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      const { u, r } = res.value;
      urlStatuses.push({
        url: u,
        status: r.status,
        redirect: [301, 302, 307, 308].includes(r.status),
        location: r.location,
      });
    }
  }
  // 已爬取过的 URL：复用抓取状态
  for (const u of urls) {
    const known = knownStatuses.get(u);
    if (known) {
      urlStatuses.push({ url: u, status: known.status, redirect: known.hops > 0, location: null });
    }
  }

  return {
    found,
    sitemapUrls: candidates,
    httpStatus,
    xmlValid,
    isIndex,
    childSitemaps,
    urls,
    urlStatuses,
  };
}

// ---------- llms.txt ----------

export interface LlmsTxtReport {
  status: "found" | "missing" | "invalid";
  httpStatus: number | null;
  size: number;
}

const LLMS_TIMEOUT_MS = 6000;

/** 检测 /llms.txt（AI Search 参考；缺失不是传统 SEO Error） */
export async function fetchLlmsTxtReport(origin: string): Promise<LlmsTxtReport> {
  const url = `${origin}/llms.txt`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLMS_TIMEOUT_MS);
    let status: number;
    let text: string;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SeeO-SEO-Bot/1.0; +https://www.seeo.asia/bot)" },
        cache: "no-store",
        redirect: "follow",
      });
      status = res.status;
      text = res.ok ? await res.text() : "";
    } finally {
      clearTimeout(timer);
    }
    if (status >= 400) {
      return { status: "missing", httpStatus: status, size: 0 };
    }
    const size = text.length;
    const hasHeading = /^#\s+\S/m.test(text);
    const hasList = /^\s*[-*]\s*\S/m.test(text);
    if (!hasHeading || !hasList) {
      return { status: "invalid", httpStatus: status, size };
    }
    return { status: "found", httpStatus: status, size };
  } catch {
    return { status: "missing", httpStatus: null, size: 0 };
  }
}
