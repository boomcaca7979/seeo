// ===== 结构化数据分析（V2）单元测试 =====
// 覆盖：Valid / Potential Issue / Invalid / Malformed / No Structured Data 五种状态；
// 合法 JSON / 非法 JSON / 缺 @context / 缺 @type / 合法 @graph / 损坏 @graph /
// 重复 Schema / 多 JSON-LD block / @id / 常见 Schema 基础字段。

import { describe, it, expect } from "vitest";
import { analyzeStructuredData } from "@/lib/seo/structured-data";

const CTX = "https://schema.org";

function webSite(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ "@context": CTX, "@type": "WebSite", name: "X", url: "https://x.com/", ...overrides });
}

describe("状态分类", () => {
  it("无 JSON-LD → none", () => {
    const r = analyzeStructuredData([]);
    expect(r.status).toBe("none");
    expect(r.blockCount).toBe(0);
    expect(r.nodeTypes).toEqual([]);
  });

  it("合法 JSON-LD（@context + @type + 基础字段）→ valid", () => {
    const r = analyzeStructuredData([webSite()]);
    expect(r.status).toBe("valid");
    expect(r.nodeTypes).toContain("WebSite");
    expect(r.findings).toHaveLength(0);
  });

  it("合法 @graph（根含 @context，节点缺 @id 为建议级）→ valid 或 potential-issue（缺 @id）", () => {
    // @graph 节点缺 @id → missing-id（建议级）→ potential-issue
    const r = analyzeStructuredData([
      JSON.stringify({
        "@context": CTX,
        "@graph": [
          { "@type": "WebPage", name: "Page" },
          { "@type": "WebSite", name: "X", url: "https://x.com/" },
        ],
      }),
    ]);
    expect(r.status).toBe("potential-issue");
    expect(r.findings.some((f) => f.kind === "missing-id")).toBe(true);
    // @graph 节点继承根 @context，不误报 missing-context
    expect(r.findings.some((f) => f.kind === "missing-context")).toBe(false);
    expect(r.nodeTypes).toContain("WebPage");
    expect(r.nodeTypes).toContain("WebSite");
  });

  it("非法 JSON → malformed", () => {
    const r = analyzeStructuredData(["{ not valid json }"]);
    expect(r.status).toBe("malformed");
    expect(r.findings.some((f) => f.kind === "malformed")).toBe(true);
  });

  it("缺 @type → invalid（missing-type）", () => {
    const r = analyzeStructuredData([JSON.stringify({ "@context": CTX, foo: "bar" })]);
    expect(r.status).toBe("invalid");
    expect(r.findings.some((f) => f.kind === "missing-type")).toBe(true);
  });

  it("@graph 不是数组 → invalid（graph-not-array）", () => {
    const r = analyzeStructuredData([
      JSON.stringify({ "@context": CTX, "@type": "WebSite", "@graph": "oops" }),
    ]);
    expect(r.status).toBe("invalid");
    expect(r.findings.some((f) => f.kind === "graph-not-array")).toBe(true);
  });

  it("缺 @context（根节点）→ potential-issue（missing-context）", () => {
    const r = analyzeStructuredData([
      JSON.stringify({ "@type": "WebSite", name: "X", url: "https://x.com/" }),
    ]);
    expect(r.status).toBe("potential-issue");
    expect(r.findings.some((f) => f.kind === "missing-context")).toBe(true);
  });

  it("常见 Schema 缺基础字段 → potential-issue（missing-fields）", () => {
    // Article 缺 author / datePublished
    const r = analyzeStructuredData([
      JSON.stringify({ "@context": CTX, "@type": "Article", headline: "H" }),
    ]);
    expect(r.status).toBe("potential-issue");
    const fields = r.findings.filter((f) => f.kind === "missing-fields");
    expect(fields.length).toBeGreaterThan(0);
    expect(fields[0].nodeType).toBe("Article");
  });

  it("@graph 数组形式顶层（JSON 数组）→ 逐节点校验", () => {
    const r = analyzeStructuredData([
      JSON.stringify([
        { "@context": CTX, "@type": "WebSite", name: "X", url: "https://x.com/" },
        { "@context": CTX, "@type": "WebPage", name: "P" },
      ]),
    ]);
    expect(r.status).toBe("valid");
    expect(r.nodeTypes).toEqual(expect.arrayContaining(["WebSite", "WebPage"]));
  });
});

describe("重复 Schema 与多 block", () => {
  it("同一 @type 在多个 JSON-LD block 中 → duplicate-type", () => {
    const r = analyzeStructuredData([webSite(), webSite()]);
    expect(r.status).toBe("potential-issue");
    expect(r.findings.some((f) => f.kind === "duplicate-type")).toBe(true);
  });

  it("不同 @type 多 block 不误报重复", () => {
    const r = analyzeStructuredData([
      webSite(),
      JSON.stringify({ "@context": CTX, "@type": "Organization", name: "X", url: "https://x.com/" }),
    ]);
    expect(r.findings.some((f) => f.kind === "duplicate-type")).toBe(false);
  });

  it("blockCount 与 @type 收集正确", () => {
    const r = analyzeStructuredData([
      webSite(),
      JSON.stringify({ "@context": CTX, "@type": ["WebPage", "Product"], name: "P" }),
    ]);
    expect(r.blockCount).toBe(2);
    expect(r.nodeTypes).toContain("Product");
  });
});

describe("常见 Schema 类型支持", () => {
  const cases: Array<{ type: string; payload: Record<string, unknown>; expectValid: boolean }> = [
    { type: "Organization", payload: { name: "X", url: "https://x.com/" }, expectValid: true },
    { type: "WebSite", payload: { name: "X", url: "https://x.com/" }, expectValid: true },
    { type: "WebPage", payload: { name: "P" }, expectValid: true },
    { type: "Product", payload: { name: "P" }, expectValid: true },
    {
      type: "Article",
      payload: { headline: "H", datePublished: "2026-01-01", author: { "@type": "Person", name: "A" } },
      expectValid: true,
    },
    { type: "FAQPage", payload: { mainEntity: [] }, expectValid: true },
    { type: "Event", payload: { name: "E", startDate: "2026-01-01", location: { name: "L" } }, expectValid: true },
  ];

  it("支持 Organization / WebSite / WebPage / Product / Article / FAQPage / Event", () => {
    for (const c of cases) {
      const r = analyzeStructuredData([JSON.stringify({ "@context": CTX, "@type": c.type, ...c.payload })]);
      expect(r.status, c.type).toBe(c.expectValid ? "valid" : "potential-issue");
    }
  });
});
