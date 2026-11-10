// ===== URL 归属映射契约测试 =====
// 覆盖：URL 只从真实 Sitemap 派生、i18n 映射与 localeUrl 一致、闭包归因、SHELL/SEO_SHARED 区分、
// 36 个 messages 命名空间全部有归属、私有/停用路径永不提交。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import sitemap from "@/app/sitemap";
import { localeUrl, SITE_URL } from "@/i18n/seo";
import { locales } from "@/i18n/config";
import messagesEn from "../../../messages/en.json";

import {
  INFRA_FILES,
  MESSAGE_NAMESPACE_NO_TRIGGER,
  MESSAGE_NAMESPACE_PATHS,
  NEVER_TRIGGER_FILES,
  SEO_SHARED_FILES,
  SHELL_FILES,
  SITE_LOCALES,
  SITE_ORIGIN,
  TRIGGER_OVERRIDES,
  buildPathIndex,
  canonicalUrl,
  changedMessageNamespaces,
  computeAffectedPaths,
  extractSitemapUrls,
  isNeverSubmitPath,
  isSubmittableUrl,
  messageNamespaceKeys,
  pageOwnerFiles,
  urlToLogicalPath,
  urlsForNamespaces,
  urlsToPaths,
  validateSitemapUrls,
} from "./indexnow-map";

const ROOT = process.cwd();
const sitemapUrls = sitemap().map((e) => e.url);
const logicalPaths = urlsToPaths(sitemapUrls);
const index = buildPathIndex(logicalPaths, ROOT);

function affected(files: string[]) {
  return computeAffectedPaths(files, index);
}

describe("Sitemap 基线", () => {
  it("当前 Sitemap 恰为 29 条逻辑路径 / 58 条 URL", () => {
    expect(logicalPaths).toHaveLength(29);
    expect(sitemapUrls).toHaveLength(58);
    expect(new Set(sitemapUrls).size).toBe(58);
  });

  it("所有 URL 都在规范域名下", () => {
    for (const u of sitemapUrls) expect(u === SITE_ORIGIN || u.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
  });
});

describe("中英文 URL 映射", () => {
  it("canonicalUrl 与 i18n 的 localeUrl 逐条相等（单一事实来源不漂移）", () => {
    for (const p of logicalPaths) {
      for (const l of locales) {
        expect(canonicalUrl(l, p)).toBe(localeUrl(l, p));
      }
    }
  });

  it("locale 集合与 i18n 配置一致", () => {
    expect([...SITE_LOCALES]).toEqual([...locales]);
  });

  it("urlToLogicalPath 往返成立", () => {
    for (const p of logicalPaths) {
      for (const l of SITE_LOCALES) {
        expect(urlToLogicalPath(canonicalUrl(l, p))).toBe(p);
      }
    }
    expect(urlToLogicalPath(SITE_URL)).toBe("/");
    expect(urlToLogicalPath("https://www.seeo.asia/zh")).toBe("/");
    expect(urlToLogicalPath("https://www.seeo.asia/pricing/")).toBe("/pricing");
  });

  it("拒绝非规范形态", () => {
    expect(isSubmittableUrl("https://www.seeo.asia/pricing")).toBe(true);
    expect(isSubmittableUrl("https://www.seeo.asia/zh/pricing")).toBe(true);
    expect(isSubmittableUrl("http://www.seeo.asia/pricing")).toBe(false);
    expect(isSubmittableUrl("https://seeo.asia/pricing")).toBe(false);
    expect(isSubmittableUrl("https://www.seeo.asia/en/pricing")).toBe(false);
    expect(isSubmittableUrl("https://www.seeo.asia/pricing/")).toBe(false);
    expect(isSubmittableUrl("https://www.seeo.asia/pricing?x=1")).toBe(false);
  });
});

describe("永不提交的路径", () => {
  it.each([
    "/login",
    "/signup",
    "/app",
    "/app/dashboard",
    "/payment/result",
    "/share/keyword-strategy",
    "/unsubscribe",
    "/api/indexnow",
    "/tools/backlink-checker",
    "/features/backlink-analysis",
  ])("%s 被硬性拒绝", (p) => {
    expect(isNeverSubmitPath(p)).toBe(true);
    expect(isSubmittableUrl(canonicalUrl("en", p))).toBe(false);
  });

  it("这些路径当前都不在 Sitemap 里", () => {
    for (const p of ["/login", "/signup", "/tools/backlink-checker", "/features/backlink-analysis"]) {
      expect(logicalPaths).not.toContain(p);
    }
  });
});

describe("Sitemap 解析与校验", () => {
  it("提取 loc 并去重", () => {
    const xml = `<urlset><url><loc>https://www.seeo.asia/a</loc></url><url><loc>https://www.seeo.asia/a</loc></url><url><loc>https://www.seeo.asia/b?x=1&amp;y=2</loc></url></urlset>`;
    expect(extractSitemapUrls(xml)).toEqual(["https://www.seeo.asia/a", "https://www.seeo.asia/b?x=1&y=2"]);
  });

  it("空集合 / 外域 / /en 前缀都判不合法", () => {
    expect(validateSitemapUrls([]).ok).toBe(false);
    expect(validateSitemapUrls(["https://seeo.asia/a"]).ok).toBe(false);
    expect(validateSitemapUrls(["https://www.seeo.asia/a", "https://evil.example/b"]).ok).toBe(false);
    expect(validateSitemapUrls(["https://www.seeo.asia/en/pricing"]).ok).toBe(false);
    expect(validateSitemapUrls(["https://www.seeo.asia", "https://www.seeo.asia/zh"]).ok).toBe(true);
  });
});

describe("页面 owner", () => {
  it("/ 只有 [locale] 一个 owner（不存在 (default)/page.tsx）", () => {
    expect(pageOwnerFiles("/", ROOT).map((f) => f.replace(ROOT, ""))).toEqual(["/src/app/[locale]/page.tsx"]);
  });

  it("/pricing 有正文与 metadata 两个 owner", () => {
    const owners = pageOwnerFiles("/pricing", ROOT).map((f) => f.replace(`${ROOT}/`, ""));
    expect(owners).toEqual(["src/app/(default)/pricing/page.tsx", "src/app/[locale]/pricing/page.tsx"]);
  });

  it("每条 sitemap 路径都能解析出 owner", () => {
    for (const p of logicalPaths) expect(pageOwnerFiles(p, ROOT).length).toBeGreaterThan(0);
  });
});

describe("变更文件 → 受影响路径", () => {
  it("Navbar / Footer 不触发任何提交", () => {
    for (const f of SHELL_FILES) {
      const r = affected([f]);
      expect(r.paths.size).toBe(0);
      expect(r.impacts[0].kind).toBe("shell");
    }
  });

  it("SEO_SHARED 覆盖全部 29 条路径（= 58 条 URL）", () => {
    for (const f of SEO_SHARED_FILES) {
      const r = affected([f]);
      expect(r.paths.size).toBe(29);
      expect(r.impacts[0].kind).toBe("seo-shared");
    }
  });

  it("lib/billing.ts 只映射 /pricing", () => {
    const r = affected(["src/lib/billing.ts"]);
    expect([...r.paths.keys()]).toEqual(["/pricing"]);
    expect(r.impacts[0].kind).toBe("override");
  });

  it("public-tools.ts 不触发（开关变化由 Sitemap 差集覆盖）", () => {
    expect(affected(["src/lib/seo/public-tools.ts"]).paths.size).toBe(0);
  });

  it("landing-pages.ts 精确映射 10 条 /seo-issues 路径", () => {
    const r = affected(["src/lib/seo/landing-pages.ts"]);
    expect(r.paths.size).toBe(10);
    for (const p of r.paths.keys()) expect(p.startsWith("/seo-issues")).toBe(true);
  });

  it("AlternativesPageContent 只映射 2 条 alternatives 路径", () => {
    const r = affected(["src/components/AlternativesPageContent.tsx"]);
    expect([...r.paths.keys()].sort()).toEqual(["/alternatives/ahrefs", "/alternatives/semrush"]);
  });

  it("单页正文或单页 metadata 都只影响该页", () => {
    expect([...affected(["src/app/(default)/pricing/page.tsx"]).paths.keys()]).toEqual(["/pricing"]);
    expect([...affected(["src/app/[locale]/pricing/page.tsx"]).paths.keys()]).toEqual(["/pricing"]);
  });

  it("基础设施文件不触发", () => {
    for (const f of INFRA_FILES) {
      const r = affected([f]);
      expect(r.paths.size).toBe(0);
      expect(r.impacts[0].kind).toBe("infra");
    }
  });

  it("非 src 文件与测试文件不触发", () => {
    for (const f of ["README.md", "docs/x.md", "next.config.ts", "src/lib/seo/indexnow.ts", "src/lib/seo/indexnow-map.test.ts"]) {
      expect(affected([f]).paths.size).toBe(0);
    }
  });

  it("闭包归因不会把私有路径纳入（/login 的 owner 即使被改动也不提交）", () => {
    const r = affected(["src/app/(default)/login/page.tsx"]);
    expect(r.paths.size).toBe(0);
  });
});

describe("分档完整性（fail-closed）", () => {
  it("出现在 ≥24/29 个闭包中的文件必须被显式登记", () => {
    const counts = new Map<string, number>();
    for (const entry of index.values()) {
      for (const f of entry.closure) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const widespread = [...counts.entries()].filter(([, n]) => n >= 24).map(([f]) => f).sort();
    const declared = new Set<string>([
      ...SHELL_FILES,
      ...SEO_SHARED_FILES,
      ...INFRA_FILES,
      ...NEVER_TRIGGER_FILES,
      ...Object.keys(TRIGGER_OVERRIDES),
    ]);
    const unclassified = widespread.filter((f) => !declared.has(f));
    expect(unclassified).toEqual([]);
    expect(widespread.length).toBeGreaterThan(15);
  });
});

describe("messages 命名空间归属", () => {
  const keys = Object.keys(messagesEn).sort();

  it("36 个顶层命名空间全部有归属，且无重复、无遗漏", () => {
    expect(keys).toHaveLength(36);
    expect(messageNamespaceKeys()).toEqual(keys);
    expect(Object.keys(MESSAGE_NAMESPACE_PATHS).filter((k) => k in MESSAGE_NAMESPACE_NO_TRIGGER)).toEqual([]);
  });

  it("每个映射目标都是真实 Sitemap 路径", () => {
    for (const [ns, paths] of Object.entries(MESSAGE_NAMESPACE_PATHS)) {
      for (const p of paths) {
        expect(logicalPaths, `命名空间 ${ns} 指向了不存在的路径 ${p}`).toContain(p);
      }
    }
  });

  it("按 locale 分侧：en 只出 EN URL，zh 只出 ZH URL", () => {
    expect(urlsForNamespaces(["pricing"], "en")).toEqual(["https://www.seeo.asia/pricing"]);
    expect(urlsForNamespaces(["pricing"], "zh")).toEqual(["https://www.seeo.asia/zh/pricing"]);
  });

  it("alternatives 两个命名空间不互相串台", () => {
    expect(urlsForNamespaces(["alternativesSemrush"], "en")).toEqual(["https://www.seeo.asia/alternatives/semrush"]);
    expect(urlsForNamespaces(["alternativesAhrefs"], "en")).toEqual(["https://www.seeo.asia/alternatives/ahrefs"]);
  });

  it("不触发的命名空间产出 0 条 URL", () => {
    for (const ns of Object.keys(MESSAGE_NAMESPACE_NO_TRIGGER)) {
      expect(urlsForNamespaces([ns], "en")).toEqual([]);
      expect(urlsForNamespaces([ns], "zh")).toEqual([]);
    }
  });

  it("命名空间差异按顶层 key 比较", () => {
    const before = { pricing: { a: 1 }, nav: { b: 1 } };
    const after = { pricing: { a: 2 }, nav: { b: 1 } };
    expect(changedMessageNamespaces(before, after)).toEqual(["pricing"]);
    expect(changedMessageNamespaces({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
    expect(changedMessageNamespaces({ a: 1 }, {})).toEqual(["a"]);
  });
});

describe("结构性隔离", () => {
  it("src/app/** 不得 import IndexNow 模块（保证不在构建/运行时执行）", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(e.name) || e.name.includes(".test.")) continue;
        const src = fs.readFileSync(full, "utf-8");
        if (/from\s+["'][^"']*seo\/indexnow/.test(src)) offenders.push(path.relative(ROOT, full));
      }
    };
    walk(path.join(ROOT, "src/app"));
    expect(offenders).toEqual([]);
  });

  it("Key 文件存在且内容与文件名一致", () => {
    const dir = path.join(ROOT, "public");
    const hits = fs
      .readdirSync(dir)
      .filter((f) => /^[a-z0-9]{32}\.txt$/.test(f))
      .filter((f) => fs.readFileSync(path.join(dir, f), "utf-8").trim() === f.replace(/\.txt$/, ""));
    expect(hits).toHaveLength(1);
  });
});
