// ===== SeeO 站点 SEO metadata 契约测试 =====
// 背景：技术审计暴露站点自身 metadata 问题——
//   - 首页 ZH title 25 字符（<30）、description 110 字符（<120）
//   - 多页 title/description 曾共用同一文案（重复）
// 本测试对齐审计引擎阈值（TITLE 30-60 / DESC 120-160，按 String.length 计），
// 覆盖全部营销页（首页 / pricing / docs / about / features×3 / privacy / terms /
// refund / login / signup），并保证同 locale 下 title 与 description 全站唯一。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import zhMessages from "../../messages/zh.json";
import enMessages from "../../messages/en.json";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

// 与 src/lib/seo/audit-checks.ts 的审计阈值保持一致
const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 120;
const DESC_MAX = 160;

interface MetaEntry {
  title: string;
  description: string;
}

/** 递归收集 messages JSON 中所有 *.meta.{title,description} */
function collectMeta(
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, MetaEntry> {
  const out: Record<string, MetaEntry> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "meta" && v && typeof v === "object") {
      const m = v as { title?: unknown; description?: unknown };
      out[prefix || "(root)"] = {
        title: typeof m.title === "string" ? m.title : "",
        description: typeof m.description === "string" ? m.description : "",
      };
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(
        out,
        collectMeta(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k)
      );
    }
  }
  return out;
}

/** 从 TSX 源码解析 { en: { title, description }, zh: { title, description } } 结构 */
function parseLocaleMetaBlock(src: string): Record<"en" | "zh", MetaEntry> {
  const out = { en: { title: "", description: "" }, zh: { title: "", description: "" } };
  for (const loc of ["en", "zh"] as const) {
    const block = src.match(new RegExp(`\\b${loc}:\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
    out[loc].title = block.match(/title:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    out[loc].description = block.match(/description:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
  }
  return out;
}

/** 从 TSX 源码解析单语言 metadata（title/description 直接字面量） */
function parsePlainMetadata(src: string): MetaEntry {
  return {
    title: src.match(/title:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "",
    description: src.match(/description:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "",
  };
}

// ---- 汇总全站 metadata（页面路径 → 条目）----
const zhMeta = collectMeta(zhMessages as unknown as Record<string, unknown>);
const enMeta = collectMeta(enMessages as unknown as Record<string, unknown>);

const homeMeta = parseLocaleMetaBlock(read("../app/[locale]/layout.tsx"));
const pricingMeta = parseLocaleMetaBlock(read("../app/[locale]/pricing/page.tsx"));

const PAGES: Record<"en" | "zh", Record<string, MetaEntry>> = {
  en: {
    "/": homeMeta.en,
    "/pricing": pricingMeta.en,
    "/features/seo-audit": enMeta.seoAudit,
    "/features/rank-tracking": enMeta.rankTracking,
    "/features/backlink-analysis": enMeta.backlinks,
    "/docs": enMeta.docsPage,
    "/about": enMeta.aboutPage,
    "/privacy": enMeta.privacyPage,
    "/terms": enMeta.termsPage,
    "/refund": enMeta.refundPage,
    "/login": parsePlainMetadata(read("../app/(default)/login/page.tsx")),
    "/signup": parsePlainMetadata(read("../app/(default)/signup/page.tsx")),
  },
  zh: {
    "/zh": homeMeta.zh,
    "/zh/pricing": pricingMeta.zh,
    "/zh/features/seo-audit": zhMeta.seoAudit,
    "/zh/features/rank-tracking": zhMeta.rankTracking,
    "/zh/features/backlink-analysis": zhMeta.backlinks,
    "/zh/docs": zhMeta.docsPage,
    "/zh/about": zhMeta.aboutPage,
    "/zh/privacy": zhMeta.privacyPage,
    "/zh/terms": zhMeta.termsPage,
    "/zh/refund": zhMeta.refundPage,
    // login / signup 为 EN 专属页（不参与 locale 路由）
  },
};

for (const locale of ["en", "zh"] as const) {
  describe(`[${locale}] 全站 metadata 完整性`, () => {
    it("每个页面都有非空 title 与 description", () => {
      for (const [path, meta] of Object.entries(PAGES[locale])) {
        expect(meta.title.length, `${path} title 为空`).toBeGreaterThan(0);
        expect(meta.description.length, `${path} description 为空`).toBeGreaterThan(0);
      }
    });
  });

  describe(`[${locale}] title 长度（审计阈值 ${TITLE_MIN}-${TITLE_MAX}）`, () => {
    for (const [path, meta] of Object.entries(PAGES[locale])) {
      it(`${path} title ${meta.title.length} 字符在范围内`, () => {
        expect(meta.title.length).toBeGreaterThanOrEqual(TITLE_MIN);
        expect(meta.title.length).toBeLessThanOrEqual(TITLE_MAX);
      });
    }
  });

  describe(`[${locale}] description 长度（审计阈值 ${DESC_MIN}-${DESC_MAX}）`, () => {
    for (const [path, meta] of Object.entries(PAGES[locale])) {
      it(`${path} description ${meta.description.length} 字符在范围内`, () => {
        expect(meta.description.length).toBeGreaterThanOrEqual(DESC_MIN);
        expect(meta.description.length).toBeLessThanOrEqual(DESC_MAX);
      });
    }
  });

  describe(`[${locale}] 全站唯一性（防 duplicate-title / duplicate-description 回归）`, () => {
    it("所有页面 title 互不相同", () => {
      const titles = Object.values(PAGES[locale]).map((m) => m.title);
      expect(new Set(titles).size).toBe(titles.length);
    });

    it("所有页面 description 互不相同", () => {
      const descriptions = Object.values(PAGES[locale]).map((m) => m.description);
      expect(new Set(descriptions).size).toBe(descriptions.length);
    });
  });
}

describe("EN / ZH 对应关系", () => {
  it("messages JSON 的 meta 键在 EN 与 ZH 完全对应", () => {
    expect(Object.keys(enMeta).sort()).toEqual(Object.keys(zhMeta).sort());
  });

  it("EN 与 ZH 页面集合一致（login/signup 除外，为 EN 专属）", () => {
    const enPaths = Object.keys(PAGES.en).filter((p) => p !== "/login" && p !== "/signup");
    const zhPaths = Object.keys(PAGES.zh);
    expect(zhPaths.map((p) => (p === "/zh" ? "/" : p.replace(/^\/zh/, ""))).sort()).toEqual(enPaths.sort());
  });
});

describe("回归防护：本轮修复的历史问题不得再现", () => {
  it("25 字符的旧首页 title（duplicate-title 来源）不再使用", () => {
    for (const locale of ["en", "zh"] as const) {
      for (const [path, meta] of Object.entries(PAGES[locale])) {
        expect(meta.title, `${locale} ${path}`).not.toBe(
          "SeeO · SEO 数据分析、排名追踪与审计平台"
        );
      }
    }
  });

  it("110 字符的旧首页 description（duplicate-description 来源）不再使用", () => {
    const legacyDesc =
      "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析六大核心功能。每日自动刷新排名数据，生成可视化审计报告，帮助你基于真实数据做出搜索优化决策，持续提升自然搜索流量。";
    for (const locale of ["en", "zh"] as const) {
      for (const [path, meta] of Object.entries(PAGES[locale])) {
        expect(meta.description, `${locale} ${path}`).not.toBe(legacyDesc);
      }
    }
  });

  it("EN root layout 与 ZH 布局不再共用同一中文 title（曾致 3 页重复）", () => {
    const defaultLayout = read("../app/(default)/layout.tsx");
    const siteTitle = defaultLayout.match(/const siteTitle = "((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    expect(siteTitle.length).toBeGreaterThanOrEqual(TITLE_MIN);
    expect(siteTitle.length).toBeLessThanOrEqual(TITLE_MAX);
    // (default) 根布局的兜底 title 不得与任何 locale 页面 title 重复
    for (const locale of ["en", "zh"] as const) {
      for (const [path, meta] of Object.entries(PAGES[locale])) {
        expect(meta.title, `(default) layout 与 ${locale} ${path} title 重复`).not.toBe(siteTitle);
      }
    }
  });
});
