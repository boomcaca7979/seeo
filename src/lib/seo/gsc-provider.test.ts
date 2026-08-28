// ===== GscProvider 单元测试（P0-02-E） =====
// 覆盖：sites.list / searchAnalytics / 错误映射（401/403→AUTH、429→QUOTA、404→NOT_FOUND）、
//       空响应、OAuth URL 构造、token 交换

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("listGscSites / queryGscSearchAnalytics", () => {
  it("sites.list 解析 siteEntry；Authorization 携带 Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { listGscSites } = await import("./gsc-provider");
    const sites = await listGscSites("token-1");
    expect(sites).toEqual([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/webmasters/v3/sites");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-1" });
  });

  it("searchAnalytics：POST body 原样传递；rows 缺失时返回空数组（不伪造数据）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const { queryGscSearchAnalytics } = await import("./gsc-provider");
    const rows = await queryGscSearchAnalytics("token-1", "https://example.com/", {
      startDate: "2026-08-01", endDate: "2026-08-25", dimensions: ["query"], rowLimit: 10,
    });
    expect(rows).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ dimensions: ["query"], rowLimit: 10 });
  });

  it("错误映射：401→GSC_AUTH_REQUIRED、429→GSC_QUOTA_EXCEEDED、404→GSC_PROPERTY_NOT_FOUND、500→GSC_PROVIDER_ERROR", async () => {
    const { GscProviderError } = await import("./gsc-provider");
    for (const [status, expected] of [[401, "GSC_AUTH_REQUIRED"], [429, "GSC_QUOTA_EXCEEDED"], [404, "GSC_PROPERTY_NOT_FOUND"], [500, "GSC_PROVIDER_ERROR"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { error: { message: "upstream" } })));
      const { queryGscSearchAnalytics } = await import("./gsc-provider");
      await expect(queryGscSearchAnalytics("token", "sc-domain:x.com", { startDate: "2026-08-01", endDate: "2026-08-02" }))
        .rejects.toMatchObject({ code: expected });
    }
    void GscProviderError;
  });
});

describe("OAuth helpers", () => {
  it("buildGoogleAuthUrl 携带 offline access + webmasters.readonly scope + state", async () => {
    const { buildGoogleAuthUrl } = await import("./gsc-provider");
    const url = new URL(buildGoogleAuthUrl("https://app.example.com/api/gsc/auth/callback", "state-123"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("client_id")).toBe("client-id");
  });

  it("exchangeGoogleCode 成功 / 失败映射", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "at", expires_in: 3600, refresh_token: "rt" })));
    const mod = await import("./gsc-provider");
    const tokens = await mod.exchangeGoogleCode("code", "https://app/callback");
    expect(tokens).toMatchObject({ access_token: "at", refresh_token: "rt" });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_grant" })));
    const mod2 = await import("./gsc-provider");
    await expect(mod2.exchangeGoogleCode("bad", "https://app/callback")).rejects.toMatchObject({ code: "GSC_AUTH_REQUIRED" });
  });
});
