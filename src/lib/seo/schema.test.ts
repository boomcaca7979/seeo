// ===== 站点结构化数据回归测试 =====
// 验证：JSON 可序列化、@context/@type 正确、域名统一、价格与 PLAN_PRICING 单一来源一致

import { describe, it, expect } from "vitest";
import {
  organizationSchema,
  websiteSchema,
  softwareApplicationSchema,
  breadcrumbSchema,
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
      expect(o.url).toBe(`${SITE_URL}/pricing`);
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
