// ===== 站点级报告（robots / sitemap / llms.txt）单元测试 =====
// 覆盖：robots 解析（组、Disallow、整站阻断、Sitemap 提取）、AI 爬虫访问状态
// （Allowed / Disallowed / Not specified）、llms.txt 结构校验、sitemap 抓取与状态抽检。

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseRobotsGroups,
  fetchRobotsReport,
  fetchLlmsTxtReport,
  fetchSitemapReport,
  isDisallowedPath,
  AI_CRAWLER_AGENTS,
  type RobotsReport,
} from "@/lib/seo/site-reports";

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

/** 按 URL 路由的 fetch stub */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      for (const [key, handler] of Object.entries(routes)) {
        if (url.includes(key)) return handler();
      }
      return new Response("<html></html>", { status: 200 });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseRobotsGroups", () => {
  it("解析 User-agent 分组与 Disallow 规则", () => {
    const text = [
      "User-agent: *",
      "Disallow: /private",
      "Disallow: /admin",
      "",
      "User-agent: GPTBot",
      "Disallow: /",
      "",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n");
    const groups = parseRobotsGroups(text);
    expect(groups.get("*")?.disallow).toEqual(["/private", "/admin"]);
    expect(groups.get("gptbot")?.disallow).toEqual(["/"]);
  });

  it("Allow 指令结束组但不产生 Disallow（组存在、规则为空）", () => {
    const text = ["User-agent: *", "Allow: /public", ""].join("\n");
    const groups = parseRobotsGroups(text);
    expect(groups.get("*")?.disallow ?? []).toEqual([]);
    expect(groups.get("*")?.hasGroup).toBe(true);
  });

  it("isDisallowedPath 前缀匹配", () => {
    expect(isDisallowedPath("/admin/panel", ["/admin"])).toBe(true);
    expect(isDisallowedPath("/about", ["/admin"])).toBe(false);
  });
});

describe("fetchRobotsReport", () => {
  it("robots.txt 正常 → ok，含 universalDisallow / sitemapUrls / AI 爬虫状态", async () => {
    stubFetch({
      "/robots.txt": () =>
        textResponse(
          "User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\nUser-agent: GPTBot\nDisallow: /"
        ),
    });
    const r: RobotsReport = await fetchRobotsReport("https://example.com");
    expect(r.status).toBe("ok");
    expect(r.universalDisallow).toEqual(["/private"]);
    expect(r.disallowAll).toBe(false);
    expect(r.sitemapUrls).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("Disallow: / → disallowAll=true，AI 爬虫回退为 disallowed", async () => {
    stubFetch({ "/robots.txt": () => textResponse("User-agent: *\nDisallow: /") });
    const r = await fetchRobotsReport("https://example.com");
    expect(r.disallowAll).toBe(true);
    for (const agent of AI_CRAWLER_AGENTS) {
      expect(r.aiCrawlers[agent]).toBe("disallowed");
    }
  });

  it("AI 爬虫状态：显式 Allow → allowed；无规则 → not-specified（* 不阻断时）", async () => {
    stubFetch({
      "/robots.txt": () =>
        textResponse("User-agent: *\nDisallow: /private\nUser-agent: OAI-SearchBot\nAllow: /"),
    });
    const r = await fetchRobotsReport("https://example.com");
    expect(r.aiCrawlers["OAI-SearchBot"]).toBe("allowed");
    expect(r.aiCrawlers["GPTBot"]).toBe("not-specified");
    expect(r.aiCrawlers["ClaudeBot"]).toBe("not-specified");
  });

  it("404 → missing（视为全部允许，不是错误）", async () => {
    stubFetch({ "/robots.txt": () => textResponse("", 404) });
    const r = await fetchRobotsReport("https://example.com");
    expect(r.status).toBe("missing");
    expect(r.httpStatus).toBe(404);
    expect(r.disallowAll).toBe(false);
  });

  it("5xx / 网络错误 → unreachable", async () => {
    stubFetch({ "/robots.txt": () => textResponse("", 500) });
    const r = await fetchRobotsReport("https://example.com");
    expect(r.status).toBe("unreachable");
  });
});

describe("fetchLlmsTxtReport", () => {
  it("有效 llms.txt（标题 + 列表）→ found", async () => {
    stubFetch({ "/llms.txt": () => textResponse("# Example\n\n- [Home](https://example.com/)") });
    const r = await fetchLlmsTxtReport("https://example.com");
    expect(r.status).toBe("found");
  });

  it("存在但无必需结构 → invalid", async () => {
    stubFetch({ "/llms.txt": () => textResponse("just some text") });
    const r = await fetchLlmsTxtReport("https://example.com");
    expect(r.status).toBe("invalid");
  });

  it("404 → missing", async () => {
    stubFetch({ "/llms.txt": () => textResponse("", 404) });
    const r = await fetchLlmsTxtReport("https://example.com");
    expect(r.status).toBe("missing");
    expect(r.httpStatus).toBe(404);
  });
});

describe("fetchSitemapReport", () => {
  const xmlUrlset = (urls: string[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
      .map((u) => `<url><loc>${u}</loc></url>`)
      .join("")}</urlset>`;

  it("找到合法 urlset，收集同域 URL，复用已爬取状态", async () => {
    stubFetch({
      "/sitemap.xml": () =>
        new Response(xmlUrlset(["https://example.com/", "https://example.com/page"]), {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    });
    const robots: RobotsReport = {
      status: "ok",
      httpStatus: 200,
      text: "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
      universalDisallow: [],
      disallowAll: false,
      sitemapUrls: ["https://example.com/sitemap.xml"],
      aiCrawlers: {},
    };
    const known = new Map([
      ["https://example.com/", { status: 200, hops: 0 }],
      ["https://example.com/page", { status: 404, hops: 0 }],
    ]);
    const r = await fetchSitemapReport("https://example.com", robots, known);
    expect(r.found).toBe(true);
    expect(r.xmlValid).toBe(true);
    expect(r.urls).toEqual(["https://example.com/", "https://example.com/page"]);
    // 已爬取 URL 复用状态（404 记为 4xx，不重复请求）
    expect(r.urlStatuses.find((u) => u.url === "https://example.com/page")?.status).toBe(404);
    expect(r.urlStatuses.find((u) => u.url === "https://example.com/")?.status).toBe(200);
  });

  it("robots 声明 sitemap 且为 sitemapindex 时跟随子 sitemap", async () => {
    stubFetch({
      "/sitemap.xml": () =>
        new Response(
          '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>',
          { status: 200, headers: { "content-type": "application/xml" } }
        ),
      "/child.xml": () =>
        new Response(xmlUrlset(["https://example.com/a", "https://example.com/b"]), {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    });
    const robots: RobotsReport = {
      status: "ok",
      httpStatus: 200,
      text: "Sitemap: https://example.com/sitemap.xml",
      universalDisallow: [],
      disallowAll: false,
      sitemapUrls: ["https://example.com/sitemap.xml"],
      aiCrawlers: {},
    };
    const r = await fetchSitemapReport("https://example.com", robots, new Map());
    expect(r.found).toBe(true);
    expect(r.isIndex).toBe(true);
    expect(r.urls).toContain("https://example.com/a");
    expect(r.urls).toContain("https://example.com/b");
  });

  it("sitemap 不可达 → found=false", async () => {
    stubFetch({ "/sitemap.xml": () => textResponse("", 404) });
    const robots: RobotsReport = {
      status: "ok",
      httpStatus: 200,
      text: "Sitemap: https://example.com/sitemap.xml",
      universalDisallow: [],
      disallowAll: false,
      sitemapUrls: ["https://example.com/sitemap.xml"],
      aiCrawlers: {},
    };
    const r = await fetchSitemapReport("https://example.com", robots, new Map());
    expect(r.found).toBe(false);
    expect(r.httpStatus).toBe(404);
  });
});
