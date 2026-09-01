// ===== 爬取层重定向 / 状态处理单元测试 =====
// 覆盖：200 / 301 / 302 / 307 / 308 / 404 / 410 / 500、重定向链（多跳）、
// 重定向环（isLoop）、无 Location 的重定向、超时与网络错误抛 CrawlError。

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchPageWithRedirects,
  fetchUrlStatus,
  fetchPage,
  MAX_REDIRECT_HOPS,
} from "@/lib/crawl";

function htmlResponse(status = 200, location?: string | null): Response {
  const headers = new Headers({ "content-type": "text/html" });
  if (location) headers.set("location", location);
  return new Response(status >= 200 && status < 300 ? "<html><body>ok</body></html>" : "", {
    status,
    headers,
  });
}

/** 可编排的 fetch stub：按调用顺序返回 response 序列 */
function stubFetchSequence(responses: Array<Response | (() => Response | Promise<Response>)>) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const cur = responses[Math.min(i, responses.length - 1)];
      i++;
      return typeof cur === "function" ? cur() : cur;
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPageWithRedirects：状态码", () => {
  it("200 直接返回最终 URL 与 HTML", async () => {
    stubFetchSequence([htmlResponse(200)]);
    const r = await fetchPageWithRedirects("https://example.com/");
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe("https://example.com/");
    expect(r.html).toContain("ok");
    expect(r.hops).toBe(0);
    expect(r.isLoop).toBe(false);
  });

  it.each([301, 302, 307, 308] as const)("%s 跟随到最终 URL 并记录链", async (status) => {
    stubFetchSequence([
      htmlResponse(status, "https://example.com/new"),
      htmlResponse(200),
    ]);
    const r = await fetchPageWithRedirects("https://example.com/old");
    expect(r.finalUrl).toBe("https://example.com/new");
    expect(r.hops).toBe(1);
    expect(r.redirectChain).toHaveLength(1);
    expect(r.redirectChain[0].status).toBe(status);
    expect(r.redirectChain[0].location).toBe("https://example.com/new");
  });

  it("404 / 410 / 500 作为终态返回（不抛错，html 为空）", async () => {
    for (const status of [404, 410, 500]) {
      stubFetchSequence([htmlResponse(status)]);
      const r = await fetchPageWithRedirects("https://example.com/missing");
      expect(r.status).toBe(status);
      expect(r.html).toBe("");
      expect(r.hops).toBe(0);
      vi.unstubAllGlobals();
    }
  });

  it("fetchPage 对 4xx/5xx 抛 CrawlError(HTTP_ERROR)", async () => {
    stubFetchSequence([htmlResponse(404)]);
    await expect(fetchPage("https://example.com/missing")).rejects.toMatchObject({
      code: "HTTP_ERROR",
    });
  });

  it("重定向无 Location → 按终态处理", async () => {
    stubFetchSequence([htmlResponse(301, null)]);
    const r = await fetchPageWithRedirects("https://example.com/old");
    expect(r.hops).toBe(0);
    expect(r.isLoop).toBe(false);
  });

  it("相对 Location 按当前 URL 解析", async () => {
    stubFetchSequence([htmlResponse(302, "/new"), htmlResponse(200)]);
    const r = await fetchPageWithRedirects("https://example.com/old");
    expect(r.finalUrl).toBe("https://example.com/new");
  });
});

describe("fetchPageWithRedirects：链与环", () => {
  it("多跳链记录全部 hop", async () => {
    stubFetchSequence([
      htmlResponse(301, "https://example.com/a"),
      htmlResponse(302, "https://example.com/b"),
      htmlResponse(200),
    ]);
    const r = await fetchPageWithRedirects("https://example.com/start");
    expect(r.hops).toBe(2);
    expect(r.redirectChain.map((h) => h.status)).toEqual([301, 302]);
    expect(r.finalUrl).toBe("https://example.com/b");
  });

  it("重定向环 → isLoop=true，停止请求", async () => {
    stubFetchSequence([
      htmlResponse(302, "https://example.com/b"),
      htmlResponse(302, "https://example.com/a"),
      htmlResponse(200), // 不应被请求（环已检出）
    ]);
    const r = await fetchPageWithRedirects("https://example.com/a");
    expect(r.isLoop).toBe(true);
    expect(r.hops).toBe(2);
    // 环停止后不应再发起第三个请求
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("超过最大跳数停止跟随（不无限请求）", async () => {
    const chain: Array<() => Response> = [];
    for (let i = 0; i < MAX_REDIRECT_HOPS + 3; i++) {
      const next = `https://example.com/hop-${i + 1}`;
      chain.push(() => htmlResponse(302, next));
    }
    stubFetchSequence([...chain, () => htmlResponse(200)]);
    const r = await fetchPageWithRedirects("https://example.com/start");
    expect(r.hops).toBeLessThanOrEqual(MAX_REDIRECT_HOPS);
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(MAX_REDIRECT_HOPS + 1);
  });

  it("超时抛 CrawlError(TIMEOUT)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      })
    );
    await expect(fetchPageWithRedirects("https://example.com/", 100)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});

describe("fetchUrlStatus", () => {
  it("仅读状态与 Location，不下载正文", async () => {
    stubFetchSequence([htmlResponse(301, "https://example.com/new")]);
    const r = await fetchUrlStatus("https://example.com/old");
    expect(r.status).toBe(301);
    expect(r.location).toBe("https://example.com/new");
  });

  it("404 返回 status", async () => {
    stubFetchSequence([htmlResponse(404)]);
    const r = await fetchUrlStatus("https://example.com/missing");
    expect(r.status).toBe(404);
  });
});
