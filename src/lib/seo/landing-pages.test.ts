// ===== H｜SEO 获客基地 验收测试 =====
// 覆盖 §20 要求：路由存在、en/zh 对应、canonical、hreflang、metadata、
// sitemap 收录、未 noindex、内链、schema、CTA 目标、analytics 挂载、
// canonical/pageId 唯一性、意图分离、产品真实性、Master 双向同步。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { LANDING_PAGES, LANDING_PAGE_PATHS, landingPageById, landingPageByPath, landingCopy } from "./landing-pages";
import { LOCALE_ROUTED_PATHS, isLocaleRoutedPath } from "@/i18n/locale-routed-paths";
import { alternatesFor, hreflangAlternates, localePath, localeUrl, marketingRobots } from "@/i18n/seo";
import { breadcrumbSchema, faqPageSchema, webPageSchema } from "./schema";

const ROOT = process.cwd();

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/** 真实存在的审计规则 id（从规则源文件解析，避免出现「引用了不存在的检查」） */
function realCheckIds(): Set<string> {
  const src = readSource("src/lib/seo/audit-checks.ts");
  return new Set([...src.matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
}

/** 解析 H Master（seo-growth/seo-landing-master.csv） */
function readMaster(): { header: string[]; rows: Record<string, string>[] } {
  const text = readSource("seo-growth/seo-landing-master.csv");
  const parse = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = parse(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parse(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { header, rows };
}

// ================= H2/H12：页面集合与唯一性 =================
describe("H2/H12 页面集合", () => {
  it("恰好 10 个页面，page_id 与 path 均唯一", () => {
    expect(LANDING_PAGES).toHaveLength(10);
    expect(new Set(LANDING_PAGES.map((p) => p.pageId)).size).toBe(10);
    expect(new Set(LANDING_PAGES.map((p) => p.path)).size).toBe(10);
  });

  it("页面类型只用允许的四种，且实际用了其中的合法值", () => {
    const allowed = ["Tool landing", "Problem landing", "Feature landing", "Use case landing"];
    for (const p of LANDING_PAGES) expect(allowed).toContain(p.pageType);
  });

  it("EN / ZH 路由文件成对存在（不是只做英文）", () => {
    for (const p of LANDING_PAGES) {
      const rel = p.path.replace(/^\//, "");
      expect(fs.existsSync(path.join(ROOT, "src/app/(default)", rel, "page.tsx")), `缺 EN 路由 ${p.path}`).toBe(true);
      expect(fs.existsSync(path.join(ROOT, "src/app/[locale]", rel, "page.tsx")), `缺 ZH 路由 ${p.path}`).toBe(true);
    }
  });

  it("ZH 路由文件确实渲染同一 pageId（不是复制粘贴了别的页）", () => {
    for (const p of LANDING_PAGES) {
      const rel = p.path.replace(/^\//, "");
      const localeSrc = readSource(path.join("src/app/[locale]", rel, "page.tsx"));
      expect(localeSrc).toContain(`const PAGE_ID = "${p.pageId}";`);
      expect(localeSrc).toContain(`const PATH = "${p.path}";`);
      const defaultSrc = readSource(path.join("src/app/(default)", rel, "page.tsx"));
      expect(defaultSrc).toContain(`pageId="${p.pageId}"`);
    }
  });

  it("所有 H 路径都在 locale 白名单内（否则 proxy 不走 locale 路由）", () => {
    for (const p of LANDING_PAGE_PATHS) {
      expect(LOCALE_ROUTED_PATHS.has(p), `${p} 不在 LOCALE_ROUTED_PATHS`).toBe(true);
      expect(isLocaleRoutedPath(p)).toBe(true);
    }
  });
});

// ================= H3：意图分离 =================
describe("H3 search intent separation", () => {
  it("primary_keyword / search_intent / problem 三者逐条唯一（不是换关键词）", () => {
    for (const field of ["primaryKeyword", "searchIntent", "problem"] as const) {
      const values = LANDING_PAGES.map((p) => p[field].trim().toLowerCase());
      expect(new Set(values).size, `${field} 存在重复`).toBe(values.length);
    }
  });

  it("不与既有营销路径重叠（不做同一意图的第二页）", () => {
    const existing = [
      "/features/seo-audit", "/features/rank-tracking", "/features/keyword-research",
      "/features/competitor-analysis", "/features/content-optimization", "/features/backlink-analysis",
      "/guides/how-to-do-a-technical-seo-audit", "/guides/how-to-track-keyword-rankings",
      "/guides/how-to-analyze-backlinks", "/tools/backlink-checker",
    ];
    for (const p of LANDING_PAGE_PATHS) expect(existing).not.toContain(p);
  });

  it("H 与其他页面共用同一 SEO 工具链（canonical / hreflang 不会各自为政）", () => {
    for (const p of LANDING_PAGE_PATHS) {
      expect(alternatesFor("en", p).alternates?.canonical).toBe(p);
      expect(alternatesFor("zh", p).alternates?.canonical).toBe(`/zh${p}`);
      expect(hreflangAlternates(p).map((a) => a.hreflang)).toEqual(["en", "zh-CN", "x-default"]);
    }
  });
});

// ================= H4：产品真实性 =================
describe("H4 product truthfulness", () => {
  it("每个引用的检查项都真实存在于审计规则源中", () => {
    const real = realCheckIds();
    expect(real.size).toBeGreaterThan(20);
    for (const p of LANDING_PAGES) {
      expect(p.relatedChecks.length).toBeGreaterThan(0);
      for (const id of p.relatedChecks) {
        expect(real.has(id), `${p.pageId} 引用了不存在的检查项 ${id}`).toBe(true);
      }
    }
  });

  it("不出现被禁止的夸大 / 无证据宣传话术", () => {
    const banned = ["best seo tool", "#1", "number one", "revolutionary", "guaranteed", "world's best", "ai-powered everything", "最佳的 seo", "第一名"];
    for (const p of LANDING_PAGES) {
      const text = [p.en, p.zh]
        .flatMap((c) => [c.metaTitle, c.metaDescription, c.h1, c.lead, c.example, c.ctaLabel, ...c.detectedBy, ...c.faqs.flatMap((f) => [f.q, f.a])])
        .join("\n")
        .toLowerCase();
      for (const b of banned) expect(text, `${p.pageId} 命中禁用话术「${b}」`).not.toContain(b);
    }
  });

  it("不写任何未核实的量化数字（搜索量 / KD / 百分比提升）", () => {
    for (const p of LANDING_PAGES) {
      const text = [p.en, p.zh]
        .flatMap((c) => [c.metaTitle, c.metaDescription, c.h1, c.lead, c.example, ...c.detectedBy, ...c.faqs.flatMap((f) => [f.q, f.a])])
        .join("\n");
      // 禁止 "10,000 keywords" / "+250% traffic" / "KD 12" 这类无来源数字
      expect(text, `${p.pageId} 疑似虚构数字`).not.toMatch(/\b\d{1,3}(,\d{3})+\b/);
      expect(text, `${p.pageId} 疑似虚构百分比`).not.toMatch(/\b\d{1,3}\s?%/);
      expect(text, `${p.pageId} 疑似虚构 KD`).not.toMatch(/\bKD\s?\d+/i);
    }
  });
});

// ================= H5：Metadata =================
/**
 * 中文单字承载的信息量远高于英文单词，因此长度门槛必须按 locale 分别设置，
 * 否则会出现「中文被判太短、英文被判太长」的假失败。上限保持一致（都受展示宽度约束）。
 */
const LEN_MIN = {
  en: { metaTitle: 30, metaDescription: 120, h1: 25, faqQ: 20, faqA: 80 },
  zh: { metaTitle: 12, metaDescription: 35, h1: 8, faqQ: 8, faqA: 26 },
} as const;

describe("H5 metadata", () => {
  it("每个 locale 的 meta 标题与描述都非空且长度合理（按 locale 取门槛）", () => {
    for (const p of LANDING_PAGES) {
      for (const locale of ["en", "zh"] as const) {
        const c = landingCopy(p, locale);
        const min = LEN_MIN[locale];
        expect(c.metaTitle.trim().length, `${p.pageId}.${locale} metaTitle 过短`).toBeGreaterThanOrEqual(min.metaTitle);
        expect(c.metaTitle.length).toBeLessThanOrEqual(70);
        expect(c.metaDescription.trim().length, `${p.pageId}.${locale} metaDescription 过短`).toBeGreaterThanOrEqual(min.metaDescription);
        expect(c.metaDescription.length).toBeLessThanOrEqual(200);
        expect(c.h1.trim().length, `${p.pageId}.${locale} h1 过短`).toBeGreaterThanOrEqual(min.h1);
      }
    }
  });

  it("meta 标题 / 描述 / H1 在同 locale 内唯一", () => {
    for (const locale of ["en", "zh"] as const) {
      for (const field of ["metaTitle", "metaDescription", "h1"] as const) {
        const values = LANDING_PAGES.map((p) => landingCopy(p, locale)[field].trim());
        expect(new Set(values).size, `${locale}.${field} 有重复`).toBe(values.length);
      }
    }
  });

  it("英文与中文文案确实不同（不是同一份文案两处复用）", () => {
    for (const p of LANDING_PAGES) {
      expect(p.en.metaTitle).not.toBe(p.zh.metaTitle);
      expect(p.en.h1).not.toBe(p.zh.h1);
      expect(p.en.metaDescription).not.toBe(p.zh.metaDescription);
    }
  });
});

// ================= H6：canonical / hreflang =================
describe("H6 canonical / hreflang", () => {
  it("EN canonical 无前缀、ZH canonical 带 /zh，且都指向绝对可解析路径", () => {
    for (const p of LANDING_PAGE_PATHS) {
      expect(alternatesFor("en", p).alternates?.canonical).toBe(p);
      expect(alternatesFor("zh", p).alternates?.canonical).toBe(`/zh${p}`);
      expect(localeUrl("zh", p)).toBe(`https://www.seeo.asia/zh${p}`);
      expect(localePath("zh", p)).toBe(`/zh${p}`);
    }
  });

  it("hreflang 三向且 x-default 指向 EN", () => {
    for (const p of LANDING_PAGE_PATHS) {
      const byLang = Object.fromEntries(hreflangAlternates(p).map((a) => [a.hreflang, a.href]));
      expect(byLang.en).toBe(localeUrl("en", p));
      expect(byLang["zh-CN"]).toBe(localeUrl("zh", p));
      expect(byLang["x-default"]).toBe(localeUrl("en", p));
    }
  });

  it("H 页面不设置 noindex（robots 由营销页统一策略输出）", () => {
    for (const p of LANDING_PAGE_PATHS) {
      const rel = p.replace(/^\//, "");
      const localeSrc = readSource(path.join("src/app/[locale]", rel, "page.tsx"));
      const contentSrc = readSource("src/components/seo-issues/IssueLandingPage.tsx");
      expect(localeSrc).not.toMatch(/robots\s*:/);
      expect(contentSrc).not.toContain("index: false");
      expect(contentSrc).not.toContain('robots:');
    }
    // 营销页 robots 策略本身是 index:true（H 页面不覆盖它）
    const robots = marketingRobots();
    expect(typeof robots === "object" && robots !== null && robots.index).toBe(true);
  });
});

// ================= H7：Structured data =================
describe("H7 structured data", () => {
  it("只使用与页面真实内容一致的三类 schema，且 URL 用 locale 路径", () => {
    const p = landingPageById("seo_issues_duplicate_title_tags")!;
    const copy = landingCopy(p, "en");
    const wp = webPageSchema({ name: copy.h1, description: copy.metaDescription, url: p.path }, "en") as { ["@type"]: string; url: string };
    expect(wp["@type"]).toBe("WebPage");

    const crumbs = breadcrumbSchema(
      [{ name: "Home", url: "/" }, { name: "SEO issues", url: "/seo-issues" }, { name: copy.h1, url: p.path }],
      "en"
    ) as { ["@type"]: string; itemListElement: unknown[] };
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement).toHaveLength(3);

    const faq = faqPageSchema(p.path, copy.faqs, "en") as { ["@type"]: string; mainEntity: unknown[] };
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(copy.faqs.length);
  });

  it("每条 FAQ 都有非空问题与答案", () => {
    for (const p of LANDING_PAGES) {
      for (const locale of ["en", "zh"] as const) {
        const faqs = landingCopy(p, locale).faqs;
        const min = LEN_MIN[locale];
        expect(faqs.length).toBeGreaterThanOrEqual(2);
        for (const f of faqs) {
          expect(f.q.trim().length).toBeGreaterThanOrEqual(min.faqQ);
          expect(f.a.trim().length).toBeGreaterThanOrEqual(min.faqA);
        }
      }
    }
  });
});

// ================= H8：Internal linking =================
describe("H8 internal linking", () => {
  it("每个页面的内链都指向真实存在的营销路径，且不指向自己", () => {
    for (const p of LANDING_PAGES) {
      expect(p.internalLinks.length).toBeGreaterThanOrEqual(3);
      for (const link of p.internalLinks) {
        expect(link, `${p.pageId} 自链`).not.toBe(p.path);
        expect(
          LOCALE_ROUTED_PATHS.has(link) || link === p.path,
          `${p.pageId} 内链指向未收录路径 ${link}`
        ).toBe(true);
      }
    }
  });

  it("叶子页都链回 hub，hub 链向全部叶子页（无孤岛、无死循环）", () => {
    const hub = landingPageById("seo_issues_hub")!;
    const leaves = LANDING_PAGES.filter((p) => p.pageId !== "seo_issues_hub");
    for (const leaf of leaves) expect(leaf.internalLinks, `${leaf.pageId} 未链回 hub`).toContain(hub.path);
    for (const leaf of leaves) expect(hub.internalLinks, `hub 未链向 ${leaf.path}`).toContain(leaf.path);
  });
});

// ================= H9：CTA =================
describe("H9 CTA / A integration", () => {
  it("CTA 指向真实存在的入口，且不使用硬推销话术", () => {
    for (const p of LANDING_PAGES) {
      expect(LOCALE_ROUTED_PATHS.has(p.ctaHref), `${p.pageId} CTA 指向不存在路径 ${p.ctaHref}`).toBe(true);
      for (const locale of ["en", "zh"] as const) {
        const label = landingCopy(p, locale).ctaLabel;
        expect(label.trim().length).toBeGreaterThan(4);
        expect(label.toLowerCase()).not.toMatch(/buy now|立即购买|升级即可|best seo/);
      }
    }
  });

  it("至少一个页面的 CTA 直接进入免费审计入口（H 接入 A）", () => {
    const auditTargets = LANDING_PAGES.filter((p) => p.ctaHref === "/" || p.ctaHref === "/features/seo-audit");
    expect(auditTargets.length).toBeGreaterThanOrEqual(5);
  });
});

// ================= H10：analytics =================
describe("H10 analytics integration", () => {
  it("H 页面位于会挂载 AnalyticsBootstrap 的 layout 之下（复用 B，不新增埋点）", () => {
    const localeLayout = readSource("src/app/[locale]/layout.tsx");
    expect(localeLayout).toContain("AnalyticsBootstrap");
    // H 的 EN 请求经 proxy rewrite 到 /en/... → [locale] 路由，因此也走同一 layout
    for (const p of LANDING_PAGES) {
      const rel = p.path.replace(/^\//, "");
      expect(fs.existsSync(path.join(ROOT, "src/app/[locale]", rel, "page.tsx"))).toBe(true);
    }
    // 不引入第二套埋点
    const content = readSource("src/components/seo-issues/IssueLandingPage.tsx");
    expect(content).not.toMatch(/gtag|mixpanel|posthog|analytics\.js/);
  });
});

// ================= H11：sitemap / indexing =================
describe("H11 sitemap / indexing readiness", () => {
  it("全部 H 路径都进了 sitemap 的白名单数组", () => {
    const sitemapSrc = readSource("src/app/sitemap.ts");
    for (const p of LANDING_PAGE_PATHS) {
      expect(sitemapSrc.includes(`"${p}"`), `sitemap 未包含 ${p}`).toBe(true);
    }
  });

  it("robots.txt 不阻挡 H 路径", () => {
    const robotsSrc = readSource("src/app/robots.ts");
    expect(robotsSrc).not.toMatch(/seo-issues/);
  });
});

// ================= H1：Master 双向同步 =================
describe("H1 SEO landing master", () => {
  const master = readMaster();

  it("Master 文件存在，字段覆盖 §4 要求", () => {
    for (const f of ["page_id", "path", "locale", "page_type", "primary_keyword", "search_intent", "problem", "core_value", "related_feature", "cta", "status", "internal_links", "notes"]) {
      expect(master.header).toContain(f);
    }
  });

  it("Master 的 10 行与代码里的 10 个页面一一对应（双向）", () => {
    expect(master.rows).toHaveLength(10);
    const masterIds = master.rows.map((r) => r.page_id).sort();
    const codeIds = LANDING_PAGES.map((p) => p.pageId).sort();
    expect(masterIds).toEqual(codeIds);

    for (const row of master.rows) {
      const page = landingPageById(row.page_id)!;
      expect(row.path).toBe(page.path);
      expect(row.page_type).toBe(page.pageType);
      expect(row.primary_keyword).toBe(page.primaryKeyword);
      expect(row.related_feature).toBe(page.relatedFeature);
      expect(row.cta_href).toBe(page.ctaHref);
    }
  });

  it("Master 的 status 都在允许集合内", () => {
    const allowed = ["Idea", "Research", "Ready", "Published", "Needs Review", "Retired"];
    for (const r of master.rows) expect(allowed).toContain(r.status);
  });

  it("Master 记录的检查项同样是真实存在的", () => {
    const real = realCheckIds();
    for (const r of master.rows) {
      for (const id of r.related_checks.split("|").map((s) => s.trim()).filter(Boolean)) {
        expect(real.has(id), `Master 引用了不存在的检查 ${id}`).toBe(true);
      }
    }
  });
});

// ================= H13：与 F 分离 =================
describe("H13 F separation", () => {
  it("H 落地页内容不来自 F 的内容库（两者不是同一份内容）", () => {
    const h = readSource("src/lib/seo/landing-pages.ts");
    expect(h).not.toMatch(/lib\/content/);
    expect(h).not.toContain("content-bank");
    // F 的访问控制测试要求 app 代码不得引用 lib/content，这里保持同一约束
    const content = readSource("src/components/seo-issues/IssueLandingPage.tsx");
    expect(content).not.toMatch(/lib\/content/);
  });
});

// ================= 查询助手 =================
describe("查询助手", () => {
  it("landingPageByPath / landingPageById 命中或返回 undefined", () => {
    expect(landingPageByPath("/seo-issues")?.pageId).toBe("seo_issues_hub");
    expect(landingPageByPath("/nope")).toBeUndefined();
    expect(landingPageById("seo_issues_hub")?.path).toBe("/seo-issues");
    expect(landingPageById("nope")).toBeUndefined();
  });
});
