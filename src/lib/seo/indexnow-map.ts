// ===== IndexNow URL 归属映射 =====
//
// 职责：把「改了哪些文件」翻译成「哪些公开 URL 需要通知」。
//
// 设计约束（来自四轮审计）：
//   1. URL 一律从**真实 Sitemap 集合**派生，绝不按 page.tsx 目录名机械拼接。
//   2. 页面正文与 metadata 分属两棵树：
//        src/app/(default)/<path>/page.tsx   正文/UI（/ 例外，只有 [locale] 侧）
//        src/app/[locale]/<path>/page.tsx    generateMetadata + canonical/hreflang
//      两者都在 owner 集合里，因此"只改标题"与"只改正文"都能覆盖。
//   3. 依赖用**实际 import 闭包**求，不靠人工清单。
//   4. 共享文件分三档，语义不同（见 SHELL / SEO_SHARED / INFRA_FILES 注释）。
//   5. messages 按**顶层命名空间**归属，并且必须覆盖全部 36 个 key。
//
// 本模块只被 scripts/ 与测试引用；src/app/** 不得 import（有契约测试钉住）。

import fs from "node:fs";
import path from "node:path";
import { BACKLINK_CHECKER_PATH, FEATURE_BACKLINK_ANALYSIS_PATH } from "./public-tools.ts";

// ===== 站点常量（与 src/i18n/seo.ts 保持同值，契约测试比对）=====

export const SITE_ORIGIN = "https://www.seeo.asia";
export const INDEXNOW_HOST = "www.seeo.asia";
export const DEFAULT_LOCALE = "en";
export const SITE_LOCALES = ["en", "zh"] as const;
export type SiteLocale = (typeof SITE_LOCALES)[number];

// ===== 逻辑路径 ↔ 规范 URL =====

/** 逻辑路径（EN 无前缀）→ 某 locale 的规范 URL；与 localeUrl() 等价 */
export function canonicalUrl(locale: SiteLocale, logicalPath: string): string {
  const p = logicalPath.startsWith("/") ? logicalPath : `/${logicalPath}`;
  const trimmed = p.replace(/\/+$/, "") || "/";
  if (locale === DEFAULT_LOCALE) return trimmed === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${trimmed}`;
  return `${SITE_ORIGIN}${trimmed === "/" ? "/zh" : `/zh${trimmed}`}`;
}

/** 规范 URL → 逻辑路径；不属于本站或形态非法时返回 null */
export function urlToLogicalPath(url: string): string | null {
  if (!url.startsWith(`${SITE_ORIGIN}/`) && url !== SITE_ORIGIN) return null;
  let p = url.slice(SITE_ORIGIN.length);
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  p = p.replace(/\/+$/, "") || "/";
  if (p === "/zh") return "/";
  if (p.startsWith("/zh/")) p = p.slice(3) || "/";
  return p;
}

/** 每个逻辑路径在两种 locale 下都是 canonical，因此双语 URL 全部需要提交 */

// ===== 永不提交的路径（硬白名单之外的第二道闸）=====
// 这些路径即使出现在 Sitemap 里也禁止提交：它们是私有区或已主动关闭的公开页。

const NEVER_SUBMIT_EXACT = new Set<string>([
  "/login",
  "/signup",
  "/unsubscribe",
  BACKLINK_CHECKER_PATH, // /tools/backlink-checker（noindex，已停用）
  FEATURE_BACKLINK_ANALYSIS_PATH, // /features/backlink-analysis（noindex，已停用）
]);

const NEVER_SUBMIT_PREFIX = ["/app", "/payment", "/share", "/api"] as const;

export function isNeverSubmitPath(logicalPath: string): boolean {
  if (NEVER_SUBMIT_EXACT.has(logicalPath)) return true;
  return NEVER_SUBMIT_PREFIX.some((p) => logicalPath === p || logicalPath.startsWith(`${p}/`));
}

/** 单个 URL 是否可提交：必须是本站两种 canonical 形态之一，且不在永不提交名单 */
export function isSubmittableUrl(url: string): boolean {
  const p = urlToLogicalPath(url);
  if (p === null) return false;
  if (p === "/en" || p.startsWith("/en/")) return false;
  if (isNeverSubmitPath(p)) return false;
  return url === canonicalUrl("en", p) || url === canonicalUrl("zh", p);
}

// ===== 文件分档 =====

/**
 * SHELL：站点外壳。改导航/页脚会让 58 个页面的 HTML 全变，但那是"壳"不是"内容"，
 * 按审计结论不触发任何提交。
 */
export const SHELL_FILES: readonly string[] = [
  "src/components/Navbar.tsx",
  "src/components/Footer.tsx",
];

/**
 * SEO_SHARED：输出**可索引 HTML 的 SEO 相关标记**。改它们等于全站每个公开页的
 * canonical / hreflang / JSON-LD 都变了 → 必须按闭包覆盖的路径全量通知（29 路径 / 58 URL）。
 *
 * 与 SHELL 的区别是语义而非数量：SHELL 是版面装饰，SEO_SHARED 是搜索引擎读的内容。
 */
export const SEO_SHARED_FILES: readonly string[] = [
  "src/components/HreflangAlternates.tsx",
  "src/components/JsonLd.tsx",
  "src/lib/seo/schema.ts",
  "src/i18n/seo.ts",
];

/**
 * INFRA：仅因外壳/框架依赖被拉进闭包的基础设施，改动不改变任何公开页的可见内容
 * （鉴权、限流、Supabase 客户端、路由配置、404 文案工具等）→ 不触发。
 *
 * 这份清单是"显式豁免"，不是"因为覆盖广所以排除"的启发式：
 * 契约测试要求任何出现在 ≥24/29 个闭包里的文件必须在本表或上面三张表之一，
 * 否则测试失败（新增外壳必须登记，不能悄悄扩大触发面）。
 */
export const INFRA_FILES: readonly string[] = [
  "src/lib/auth.ts",
  "src/lib/auth-config.ts",
  "src/lib/rate-limit.ts",
  "src/lib/supabase/browser.ts",
  "src/lib/supabase/admin.ts",
  "src/lib/supabase/server.ts",
  "src/lib/not-found-meta.ts",
  "src/i18n/config.ts",
  "src/i18n/routing.ts",
  "src/i18n/locale-switch.ts",
  "src/i18n/locale-routed-paths.ts",
  "src/components/PublicPathsProvider.tsx",
];

/**
 * 显式覆盖：闭包会把它们算进"全部 29 条"（因为外壳也引用），但它们实际只影响某一页的
 * 公开内容。覆盖优先于闭包，避免一次调价就提交 58 条 URL。
 */
export const TRIGGER_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  // 套餐额度/价格同时驱动 /pricing 的卡片与 JSON-LD Offer
  "src/lib/billing.ts": ["/pricing"],
};

/** 构建期开关，不是内容；它变化时 Sitemap 集合本身会变，由快照差异覆盖，不需要单独触发 */
export const NEVER_TRIGGER_FILES: readonly string[] = ["src/lib/seo/public-tools.ts"];

// ===== messages 命名空间归属（36 个顶层 key，全部必须有归属）=====

/**
 * 已映射到公开路径的命名空间。值为逻辑路径（EN 无前缀）。
 *
 * 依据（审计实测）：对每条路径的 import 闭包 grep `useTranslations("x")` /
 * `getTranslations({ namespace: "x" })` / `namespace="x"`，再人工核对根用法
 * （例如 /pricing 用根 `useTranslations()` 读 `pricing.*`，grep 抓不到，靠 landing 断言补）。
 */
export const MESSAGE_NAMESPACE_PATHS: Readonly<Record<string, readonly string[]>> = {
  hero: ["/"],
  features: ["/"],
  homeUseCases: ["/"],
  preview: ["/"],

  plans: ["/pricing"],
  pricing: ["/pricing"],

  featureShared: [
    "/docs",
    "/about",
    "/features/seo-audit",
    "/features/rank-tracking",
    "/features/keyword-research",
    "/features/competitor-analysis",
    "/features/content-optimization",
  ],

  docsPage: ["/docs"],
  aboutPage: ["/about"],

  seoAudit: ["/features/seo-audit"],
  rankTracking: ["/features/rank-tracking"],
  keywordResearch: ["/features/keyword-research"],
  competitorAnalysis: ["/features/competitor-analysis"],
  contentOptimization: ["/features/content-optimization"],

  alternativesSemrush: ["/alternatives/semrush"],
  alternativesAhrefs: ["/alternatives/ahrefs"],

  guideTechnicalSeoAudit: ["/guides/how-to-do-a-technical-seo-audit"],
  guideKeywordRankings: ["/guides/how-to-track-keyword-rankings"],
  guideBacklinkAnalysis: ["/guides/how-to-analyze-backlinks"],
  // 该指南内嵌了已停用工具的介绍文案（CTA 区块），改它只影响这一页
  backlinkChecker: ["/guides/how-to-analyze-backlinks"],

  privacyPage: ["/privacy"],
  termsPage: ["/terms"],
  refundPage: ["/refund"],
  contactPage: ["/contact"],
  changelogPage: ["/changelog"],
};

/**
 * 明确不触发任何公开页提交的命名空间，逐条给理由（不是"暂时没想到"）。
 */
export const MESSAGE_NAMESPACE_NO_TRIGGER: Readonly<Record<string, string>> = {
  // 静态兜底文案：全仓 0 处引用 siteTitle/siteDescription，两个 root layout 都用硬编码字符串
  meta: "dead copy：src 内无任何引用，不参与 generateMetadata",
  nav: "站点外壳（Navbar）",
  footer: "站点外壳（Footer）",
  cookieBanner: "cookie 提示条，非页面内容",
  notFoundPage: "404 边界文案，不产出可索引页",
  apiErrors: "API 错误码文案，非 HTML 内容",
  dashboard: "工作台私有区",
  authPage: "/login 与 /signup 均为 noindex",
  unsubscribePage: "退订页，非公开索引页",
  paymentResult: "/payment/result 私有结果页",
  backlinks: "唯一消费者是已停用的 /features/backlink-analysis（noindex）",
};

// ===== Sitemap 解析与校验 =====

/** 从 sitemap.xml 文本提取 <loc>；按出现顺序去重 */
export function extractSitemapUrls(xml: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const raw = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export interface SitemapValidation {
  ok: boolean;
  reason?: string;
}

/** 快照校验：非空、全部为规范 origin、无 /en 前缀、无重复（extractSitemapUrls 已去重） */
export function validateSitemapUrls(urls: readonly string[]): SitemapValidation {
  if (urls.length === 0) return { ok: false, reason: "empty" };
  for (const u of urls) {
    if (u === SITE_ORIGIN) continue;
    if (!u.startsWith(`${SITE_ORIGIN}/`)) return { ok: false, reason: `foreign-origin:${u}` };
    const p = urlToLogicalPath(u);
    if (p === null) return { ok: false, reason: `unparsable:${u}` };
    if (urlToLogicalPath(u) === "/en" || p.startsWith("/en/")) return { ok: false, reason: `en-prefix:${u}` };
  }
  return { ok: true };
}

/** URL 集合 → 逻辑路径集合 */
export function urlsToPaths(urls: readonly string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const p = urlToLogicalPath(u);
    if (p !== null) out.add(p);
  }
  return [...out].sort();
}

// ===== import 闭包 =====

const IMPORT_SPEC = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

function resolveSpecifier(spec: string, fromFile: string, srcRoot: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(srcRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // 包依赖：不属于本站内容
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** 从若干入口文件出发求本地 import 闭包（跳过测试文件与包依赖） */
export function importClosure(entryFiles: readonly string[], srcRoot: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...entryFiles];
  while (stack.length) {
    const file = stack.pop() as string;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    if (/\.test\.(ts|tsx)$/.test(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(IMPORT_SPEC)) {
      const resolved = resolveSpecifier(m[1], file, srcRoot);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return seen;
}

/** 逻辑路径 → 该页的 owner 文件（可能 1 个或 2 个） */
export function pageOwnerFiles(logicalPath: string, root: string): string[] {
  const seg = logicalPath.replace(/^\/|\/$/g, "");
  const dir = seg ? path.join(seg) : "";
  const candidates = [
    path.join(root, "src/app/(default)", dir, "page.tsx"),
    path.join(root, "src/app/[locale]", dir, "page.tsx"),
  ];
  return candidates.filter((f) => fs.existsSync(f));
}

export interface PathIndexEntry {
  logicalPath: string;
  owners: string[];
  closure: string[];
}

/** 为每条逻辑路径建立 import 闭包索引 */
export function buildPathIndex(logicalPaths: readonly string[], root: string): Map<string, PathIndexEntry> {
  const srcRoot = path.join(root, "src");
  const index = new Map<string, PathIndexEntry>();
  for (const p of logicalPaths) {
    const owners = pageOwnerFiles(p, root);
    const closure = importClosure(owners, srcRoot);
    index.set(p, {
      logicalPath: p,
      owners: owners.map((f) => relPosix(root, f)),
      closure: [...closure].map((f) => relPosix(root, f)).sort(),
    });
  }
  return index;
}

export function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

// ===== 变更文件 → 受影响路径 =====

export type ChangeKind = "content" | "seo-shared" | "override" | "shell" | "infra" | "never-trigger" | "unrelated";

export interface FileImpact {
  file: string;
  kind: ChangeKind;
  paths: string[];
}

export interface ChangeSet {
  /** 需要通知的逻辑路径 → 触发它的文件（用于日志与回执） */
  paths: Map<string, string[]>;
  impacts: FileImpact[];
}

function classifyFile(file: string, closureIndex: Map<string, Set<string>>): { kind: ChangeKind; paths: string[] } {
  if (!file.startsWith("src/")) return { kind: "unrelated", paths: [] };
  if (/\.test\.(ts|tsx)$/.test(file)) return { kind: "unrelated", paths: [] };
  if (NEVER_TRIGGER_FILES.includes(file)) return { kind: "never-trigger", paths: [] };
  if (SHELL_FILES.includes(file)) return { kind: "shell", paths: [] };
  if (INFRA_FILES.includes(file)) return { kind: "infra", paths: [] };
  const override = TRIGGER_OVERRIDES[file];
  if (override) return { kind: "override", paths: [...override] };
  const hit = closureIndex.get(file);
  if (hit && hit.size > 0) {
    return { kind: SEO_SHARED_FILES.includes(file) ? "seo-shared" : "content", paths: [...hit] };
  }
  return { kind: "unrelated", paths: [] };
}

/** 变更文件集合 → 受影响逻辑路径（含每个文件的判定类别与理由） */
export function computeAffectedPaths(changedFiles: readonly string[], index: Map<string, PathIndexEntry>): ChangeSet {
  const closureIndex = new Map<string, Set<string>>();
  for (const entry of index.values()) {
    for (const f of entry.closure) {
      const set = closureIndex.get(f) ?? new Set<string>();
      set.add(entry.logicalPath);
      closureIndex.set(f, set);
    }
  }

  const paths = new Map<string, string[]>();
  const impacts: FileImpact[] = [];
  for (const file of [...changedFiles].sort()) {
    const { kind, paths: hit } = classifyFile(file, closureIndex);
    impacts.push({ file, kind, paths: hit });
    for (const p of hit) {
      // NEVER 名单里的路径即便被闭包命中也不进集合
      if (isNeverSubmitPath(p)) continue;
      const arr = paths.get(p) ?? [];
      if (!arr.includes(file)) arr.push(file);
      paths.set(p, arr);
    }
  }
  return { paths, impacts };
}

// ===== messages 差异 → 命名空间 =====

/** 比较两个 messages JSON，返回顶层 key 变化集合（新增/删除/深层修改都算） */
export function changedMessageNamespaces(prev: unknown, cur: unknown): string[] {
  const a = (prev && typeof prev === "object" ? prev : {}) as Record<string, unknown>;
  const b = (cur && typeof cur === "object" ? cur : {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k);
  }
  return changed.sort();
}

/** 命名空间集合 + locale → 受影响的 URL（en 只影响 EN，zh 只影响 ZH） */
export function urlsForNamespaces(namespaces: readonly string[], locale: SiteLocale): string[] {
  const out = new Set<string>();
  for (const ns of namespaces) {
    const paths = MESSAGE_NAMESPACE_PATHS[ns];
    if (!paths) continue;
    for (const p of paths) {
      if (isNeverSubmitPath(p)) continue;
      out.add(canonicalUrl(locale, p));
    }
  }
  return [...out].sort();
}

export function messageNamespaceKeys(): string[] {
  return [...Object.keys(MESSAGE_NAMESPACE_PATHS), ...Object.keys(MESSAGE_NAMESPACE_NO_TRIGGER)].sort();
}
