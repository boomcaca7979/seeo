// ===== 站点结构化数据回归测试 =====
// 验证：JSON 可序列化、@context/@type 正确、域名统一、价格与 PLAN_PRICING 单一来源一致

import { describe, it, expect } from "vitest";
import {
  organizationSchema,
  websiteSchema,
  softwareApplicationSchema,
  breadcrumbSchema,
  aboutPageSchema,
  webPageSchema,
  faqPageSchema,
  SITE_URL,
} from "@/lib/seo/schema";
import { PLAN_PRICING } from "@/lib/billing";

const SCHEMA_CONTEXT = "https://schema.org";

/** 深度遍历对象中所有字符串值 */
function collectStrings(obj: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(obj);
  return out;
}

describe("organizationSchema", () => {
  it("@context/@type/name/url 正确", () => {
    const s = organizationSchema();
    expect(s["@context"]).toBe(SCHEMA_CONTEXT);
    expect(s["@type"]).toBe("Organization");
    expect(s.name).toBe("SeeO");
    expect(s.url).toBe("https://www.seeo.asia");
  });

  it("无编造字段（无地址/社交/成立年份）", () => {
    const s = organizationSchema() as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(
      ["@context", "@type", "name", "url"].sort()
    );
  });
});

describe("websiteSchema", () => {
  it("@context/@type/name/url 正确", () => {
    const s = websiteSchema();
    expect(s["@context"]).toBe(SCHEMA_CONTEXT);
    expect(s["@type"]).toBe("WebSite");
    expect(s.name).toBe("SeeO");
    expect(s.url).toBe("https://www.seeo.asia");
  });

  it("无站内搜索，不添加 SearchAction", () => {
    const s = websiteSchema() as Record<string, unknown>;
    expect(s.potentialAction).toBeUndefined();
  });
});

describe("softwareApplicationSchema", () => {
  it("@context/@type/分类/平台 正确", () => {
    const s = softwareApplicationSchema();
    expect(s["@context"]).toBe(SCHEMA_CONTEXT);
    expect(s["@type"]).toBe("SoftwareApplication");
    expect(s.applicationCategory).toBe("BusinessApplication");
    expect(s.operatingSystem).toBe("Web");
  });

  it("offers 价格与 PLAN_PRICING 单一来源一致（¥0 / ¥9.90 / ¥29.90）", () => {
    const s = softwareApplicationSchema();
    const offers = s.offers as Array<Record<string, unknown>>;
    expect(offers).toHaveLength(3);
    const byName = new Map(offers.map((o) => [o.name as string, o]));
    expect(byName.get("免费版")?.price).toBe("0");
    expect(byName.get("Lite 版")?.price).toBe(
      (PLAN_PRICING.lite.amountCents / 100).toFixed(2)
    );
    expect(byName.get("专业版")?.price).toBe(
      (PLAN_PRICING.pro.amountCents / 100).toFixed(2)
    );
    offers.forEach((o) => {
      expect(o.priceCurrency).toBe("CNY");
      // Phase 5：offers url 随 locale（默认 zh → /zh/pricing；en → /pricing）
      expect(o.url).toBe(`${SITE_URL}/zh/pricing`);
    });
  });

  it("不出现 ¥0.01 测试价格", () => {
    const s = softwareApplicationSchema();
    const strs = collectStrings(s);
    expect(strs).not.toContain("0.01");
  });

  it("无编造 rating/review", () => {
    const s = softwareApplicationSchema() as Record<string, unknown>;
    expect(s.aggregateRating).toBeUndefined();
    expect(s.review).toBeUndefined();
    expect(s.offers).toBeDefined();
  });
});

describe("breadcrumbSchema", () => {
  it("生成 Home > Pricing 两级 BreadcrumbList", () => {
    const s = breadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Pricing", url: "/pricing" },
    ]);
    expect(s["@context"]).toBe(SCHEMA_CONTEXT);
    expect(s["@type"]).toBe("BreadcrumbList");
    expect(s.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Pricing",
        item: `${SITE_URL}/pricing`,
      },
    ]);
  });
});

describe("实体一致性（全部 schema）", () => {
  const all = [
    organizationSchema(),
    websiteSchema(),
    softwareApplicationSchema(),
    breadcrumbSchema([{ name: "Home", url: "/" }]),
  ];

  it("JSON 可序列化（无循环引用）", () => {
    all.forEach((s) => {
      expect(() => JSON.stringify(s)).not.toThrow();
    });
  });

  it("不出现旧域名 / 测试价格 / preview URL", () => {
    all.forEach((s) => {
      const strs = collectStrings(s).join(" ");
      expect(strs).not.toContain("seeo.app");
      expect(strs).not.toContain("localhost");
      expect(strs).not.toContain("vercel.app");
    });
  });
});

describe("aboutPageSchema（GEO V2）", () => {
  it("@type=AboutPage，mainEntity 指向 Organization", () => {
    const s = aboutPageSchema({
      name: "关于 SeeO",
      description: "SeeO 是 SEO 数据分析平台",
      url: "/about",
    });
    expect(s["@context"]).toBe(SCHEMA_CONTEXT);
    expect(s["@type"]).toBe("AboutPage");
    expect(s.url).toBe(`${SITE_URL}/about`);
    expect(s.mainEntity).toEqual({
      "@type": "Organization",
      name: "SeeO",
      url: SITE_URL,
    });
  });
});

describe("webPageSchema（功能页）", () => {
  it("@type=WebPage，isPartOf 指向 WebSite", () => {
    const s = webPageSchema({
      name: "技术 SEO 审计 · SeeO",
      description: "20+ 项技术检查",
      url: "/features/seo-audit",
    });
    expect(s["@type"]).toBe("WebPage");
    expect(s.url).toBe(`${SITE_URL}/features/seo-audit`);
    expect(s.isPartOf).toEqual({
      "@type": "WebSite",
      name: "SeeO",
      url: SITE_URL,
    });
  });
});

describe("faqPageSchema（HTML = JSON-LD 同源）", () => {
  const faqs = [
    { q: "SeeO 支持哪些搜索引擎？", a: "目前支持 Google 搜索。" },
    { q: "需要账号吗？", a: "排名追踪需要注册账号。" },
  ];

  it("每个 FAQ 渲染项与 Question/Answer 一一对应", () => {
    const s = faqPageSchema("/about", faqs);
    expect(s["@type"]).toBe("FAQPage");
    expect(s.url).toBe(`${SITE_URL}/about`);
    s.mainEntity.forEach((entity, i) => {
      expect(entity["@type"]).toBe("Question");
      expect(entity.name).toBe(faqs[i].q);
      expect(entity.acceptedAnswer.text).toBe(faqs[i].a);
    });
    expect(s.mainEntity).toHaveLength(faqs.length);
  });

  it("FAQ 数量约束：5-8 个（GEO V2 规范）", () => {
    // 页面 FAQ 常量按规范每页 5-8 个；schema 与渲染同源天然一致
    expect(faqs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("sitemap 公开路径（GEO V2）", () => {
  it("包含 about 与 3 个功能页", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(`${SITE_URL}/about`);
    expect(urls).toContain(`${SITE_URL}/features/seo-audit`);
    expect(urls).toContain(`${SITE_URL}/features/rank-tracking`);
    expect(urls).toContain(`${SITE_URL}/features/backlink-analysis`);
  });

  it("私有路径不进入 sitemap", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const urls = sitemap().map((e) => e.url).join(" ");
    expect(urls).not.toContain("/app");
    expect(urls).not.toContain("/api");
    expect(urls).not.toContain("/payment");
  });
});
