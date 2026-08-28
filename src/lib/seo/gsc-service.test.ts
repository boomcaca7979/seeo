// ===== GscService 单元测试（P0-02-E） =====
// 覆盖：日期解析/校验、summary 曝光加权、连接缺失、维度校验、cache 隔离、
//       property 绑定（未在 grant 上/未验证/成功且凭证加密）、token 刷新、OAuth state

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", "e".repeat(64));
vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");

const getGscConnectionByProjectMock = vi.fn();
const upsertGscConnectionMock = vi.fn();
const updateGscCredentialsMock = vi.fn();
const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
// 简单有状态缓存（gsc-pending grant 经 writeCache 写入后可被 readCache 读到）
const cacheStore = new Map<string, unknown>();
const listGscSitesMock = vi.fn();
const queryGscSearchAnalyticsMock = vi.fn();
const refreshGoogleTokenMock = vi.fn();
const exchangeGoogleCodeMock = vi.fn();
const getGscUserEmailMock = vi.fn();

vi.mock("@/lib/db/gsc", () => ({
  getGscConnectionByProject: (...args: unknown[]) => getGscConnectionByProjectMock(...args),
  upsertGscConnection: (...args: unknown[]) => upsertGscConnectionMock(...args),
  updateGscCredentials: (...args: unknown[]) => updateGscCredentialsMock(...args),
  deleteGscConnection: vi.fn(),
}));

vi.mock("./cache", () => ({
  readCache: (...args: unknown[]) => readCacheMock(...args),
  writeCache: (...args: unknown[]) => writeCacheMock(...args),
}));

vi.mock("./gsc-provider", () => ({
  GscNotConfiguredError: class GscNotConfiguredError extends Error {},
  GscProviderError: class GscProviderError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number, message: string) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  listGscSites: (...args: unknown[]) => listGscSitesMock(...args),
  queryGscSearchAnalytics: (...args: unknown[]) => queryGscSearchAnalyticsMock(...args),
  refreshGoogleToken: (...args: unknown[]) => refreshGoogleTokenMock(...args),
  exchangeGoogleCode: (...args: unknown[]) => exchangeGoogleCodeMock(...args),
  getGscUserEmail: (...args: unknown[]) => getGscUserEmailMock(...args),
  inspectGscUrl: vi.fn(),
  isGoogleOAuthConfigured: () => true,
  buildGoogleAuthUrl: vi.fn(),
}));

import {
  completeOAuth,
  connectProperty,
  getConnectionStatus,
  resolveGscDateRange,
  searchAnalytics,
  signOAuthState,
  summarizeGscRows,
  verifyOAuthState,
} from "./gsc-service";
import { GscProviderError } from "./gsc-provider";

// 未过期的 access token（service 内部加密格式）
async function makeEncryptedTokens(overrides: Partial<{ accessToken: string | null; expiresAt: number | null; refreshToken: string | null }> = {}) {
  const { encryptSecret } = await import("@/lib/crypto/secure-store");
  return encryptSecret(JSON.stringify({
    refreshToken: overrides.refreshToken ?? "refresh-token",
    accessToken: overrides.accessToken ?? "access-token",
    expiresAt: overrides.expiresAt ?? Date.now() + 3600_000,
    scope: "webmasters.readonly",
  }));
}

let connection: Record<string, unknown>;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", "e".repeat(64));
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  getGscConnectionByProjectMock.mockReset();
  upsertGscConnectionMock.mockReset().mockResolvedValue(undefined);
  updateGscCredentialsMock.mockReset().mockResolvedValue(undefined);
  cacheStore.clear();
  readCacheMock.mockReset().mockImplementation((_ns: string, params: Record<string, string>) =>
    Promise.resolve(cacheStore.get(JSON.stringify(params)) ?? null));
  writeCacheMock.mockReset().mockImplementation((_ns: string, params: Record<string, string>, data: unknown) => {
    cacheStore.set(JSON.stringify(params), data);
    return Promise.resolve();
  });
  listGscSitesMock.mockReset();
  queryGscSearchAnalyticsMock.mockReset().mockResolvedValue([]);
  refreshGoogleTokenMock.mockReset();
  exchangeGoogleCodeMock.mockReset().mockResolvedValue({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
  getGscUserEmailMock.mockReset().mockResolvedValue("owner@example.com");
  connection = {
    id: 1, user_id: "u1", project_id: 2, property_url: "sc-domain:example.com",
    property_type: "domain", google_email: "owner@example.com",
    encrypted_credentials: await makeEncryptedTokens(),
    connected_at: "2026-08-01", updated_at: "2026-08-01",
  };
});

describe("resolveGscDateRange", () => {
  it("显式日期原样返回", () => {
    expect(resolveGscDateRange({ startDate: "2026-07-01", endDate: "2026-07-31" }, "2026-08-28"))
      .toEqual({ startDate: "2026-07-01", endDate: "2026-07-31" });
  });
  it("start > end / 未来日期 / 非法格式 / 超 16 个月 → 抛错", () => {
    expect(() => resolveGscDateRange({ startDate: "2026-08-02", endDate: "2026-08-01" }, "2026-08-28")).toThrow();
    expect(() => resolveGscDateRange({ startDate: "2026-08-01", endDate: "2026-09-01" }, "2026-08-28")).toThrow();
    expect(() => resolveGscDateRange({ startDate: "bad", endDate: "2026-08-01" }, "2026-08-28")).toThrow();
    expect(() => resolveGscDateRange({ startDate: "2020-01-01", endDate: "2026-08-28" }, "2026-08-28")).toThrow();
  });
  it("dateRange 预设扣除 3 天数据滞后", () => {
    const range = resolveGscDateRange({ dateRange: "last_7_days" }, "2026-08-28");
    expect(range.endDate).toBe("2026-08-25");
    expect(range.startDate).toBe("2026-08-18");
  });
});

describe("summarizeGscRows", () => {
  it("clicks/impressions 求和、ctr 为 0-1 小数、position 曝光加权", () => {
    const summary = summarizeGscRows([
      { keys: ["a"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { keys: ["b"], clicks: 30, impressions: 300, ctr: 0.1, position: 8.7 },
    ]);
    expect(summary.clicks).toBe(40);
    expect(summary.impressions).toBe(400);
    expect(summary.ctr).toBeCloseTo(0.1);
    // (5×100 + 8.7×300) / 400 = 7.775 —— 平均位置不做取整
    expect(summary.position).toBeCloseTo(7.775);
  });
  it("空行：ctr/position 为 null（不伪造）", () => {
    expect(summarizeGscRows([])).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null });
  });
});

describe("searchAnalytics", () => {
  it("项目未连接 → GscNotConnectedError（不触达 Google）", async () => {
    getGscConnectionByProjectMock.mockResolvedValue(null);
    await expect(searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["query"] }))
      .rejects.toThrow("尚未连接");
    expect(queryGscSearchAnalyticsMock).not.toHaveBeenCalled();
  });
  it("非法维度 → 抛错", async () => {
    getGscConnectionByProjectMock.mockResolvedValue(connection);
    await expect(searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["keyword"] })).rejects.toThrow();
  });
  it("cache miss：调 provider（filters 包装为 dimensionFilterGroups）并写缓存", async () => {
    getGscConnectionByProjectMock.mockResolvedValue(connection);
    queryGscSearchAnalyticsMock.mockResolvedValue([
      { keys: ["seo audit"], clicks: 12, impressions: 3100, ctr: 0.0039, position: 8.6 },
    ]);
    const result = await searchAnalytics({
      userId: "u1", projectId: 2, dimensions: ["query"],
      startDate: "2026-08-01", endDate: "2026-08-25", rowLimit: 25,
      filters: [{ dimension: "query", operator: "equals", expression: "seo audit" }],
    });
    expect(queryGscSearchAnalyticsMock).toHaveBeenCalledTimes(1);
    const [, siteUrl, request] = queryGscSearchAnalyticsMock.mock.calls[0];
    expect(siteUrl).toBe("sc-domain:example.com");
    expect(request).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-25", dimensions: ["query"], rowLimit: 25 });
    expect(request.dimensionFilterGroups[0].filters[0]).toEqual({ dimension: "query", operator: "equals", expression: "seo audit" });
    expect(result.rows[0]).toMatchObject({ clicks: 12, ctr: 0.0039, position: 8.6 }); // 原样归一，不取整
    expect(result.summary.clicks).toBe(12);
    expect(writeCacheMock).toHaveBeenCalledTimes(1);
  });
  it("cache 命中：零 provider 调用", async () => {
    getGscConnectionByProjectMock.mockResolvedValue(connection);
    readCacheMock.mockResolvedValue([{ keys: ["cached"], clicks: 1, impressions: 10, ctr: 0.1, position: 3 }]);
    const result = await searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["query"] });
    expect(queryGscSearchAnalyticsMock).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.rows[0].keys).toEqual(["cached"]);
  });
  it("不同 dimensions / 日期使用不同 cache key", async () => {
    getGscConnectionByProjectMock.mockResolvedValue(connection);
    await searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["query"], startDate: "2026-08-01", endDate: "2026-08-25" });
    await searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["page"], startDate: "2026-08-01", endDate: "2026-08-25" });
    await searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["query"], startDate: "2026-07-01", endDate: "2026-07-31" });
    const keys = readCacheMock.mock.calls.map((call) => JSON.stringify(call[1]));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("rowLimit 收紧到 1-1000", async () => {
    getGscConnectionByProjectMock.mockResolvedValue(connection);
    const result = await searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["query"], rowLimit: 100000 });
    expect(result.rowLimit).toBe(1000);
  });
});

describe("connection flow", () => {
  it("getConnectionStatus 不含凭证字段", async () => {
    getGscConnectionByProjectMock.mockResolvedValue(connection);
    const status = await getConnectionStatus("u1", 2);
    expect(status).toEqual({
      connected: true, propertyUrl: "sc-domain:example.com", propertyType: "domain",
      googleEmail: "owner@example.com", connectedAt: "2026-08-01",
    });
    expect(JSON.stringify(status)).not.toContain("encrypted");
  });
  it("connectProperty：property 不在 grant 上 → GSC_PROPERTY_NOT_FOUND", async () => {
    listGscSitesMock.mockResolvedValue([{ siteUrl: "https://other.com/", permissionLevel: "siteOwner" }]);
    await completeOAuth({ userId: "u1", code: "code", redirectUri: "http://localhost/callback" });
    await expect(connectProperty({ userId: "u1", projectId: 2, siteUrl: "sc-domain:example.com" }))
      .rejects.toMatchObject({ code: "GSC_PROPERTY_NOT_FOUND" });
  });
  it("connectProperty：未验证 property → GSC_AUTH_REQUIRED", async () => {
    listGscSitesMock.mockResolvedValue([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteUnverifiedUser" }]);
    await completeOAuth({ userId: "u1", code: "code", redirectUri: "http://localhost/callback" });
    await expect(connectProperty({ userId: "u1", projectId: 2, siteUrl: "sc-domain:example.com" }))
      .rejects.toMatchObject({ code: "GSC_AUTH_REQUIRED" });
  });
  it("connectProperty 成功：凭证加密入库（密文不含 refresh token 明文）", async () => {
    listGscSitesMock.mockResolvedValue([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }]);
    await completeOAuth({ userId: "u1", code: "code", redirectUri: "http://localhost/callback" });
    const result = await connectProperty({ userId: "u1", projectId: 2, siteUrl: "sc-domain:example.com" });
    expect(result).toEqual({ propertyUrl: "sc-domain:example.com", propertyType: "domain", googleEmail: "owner@example.com" });
    expect(upsertGscConnectionMock).toHaveBeenCalledTimes(1);
    const [, params] = upsertGscConnectionMock.mock.calls[0];
    expect(params.property_type).toBe("domain");
    expect(params.encryptedCredentials).not.toContain("refresh-token");
    expect(String(params.encryptedCredentials)).toMatch(/^v1\./);
  });
  it("connectProperty 前未完成 OAuth → GSC_AUTH_REQUIRED", async () => {
    await expect(connectProperty({ userId: "u2", projectId: 2, siteUrl: "sc-domain:example.com" }))
      .rejects.toMatchObject({ code: "GSC_AUTH_REQUIRED" });
  });
});

describe("access token refresh", () => {
  it("access token 过期 → refresh 并写回（refresh token 轮转安全）", async () => {
    const expired = await makeEncryptedTokens({ expiresAt: Date.now() - 1000 });
    getGscConnectionByProjectMock.mockResolvedValue({ ...connection, encrypted_credentials: expired });
    refreshGoogleTokenMock.mockResolvedValue({ access_token: "fresh-token", expires_in: 3600 });
    queryGscSearchAnalyticsMock.mockResolvedValue([]);

    await searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["query"] });

    expect(refreshGoogleTokenMock).toHaveBeenCalledWith("refresh-token");
    expect(updateGscCredentialsMock).toHaveBeenCalledTimes(1);
    const [, , encrypted] = updateGscCredentialsMock.mock.calls[0];
    expect(encrypted).not.toContain("fresh-token"); // 写回的是密文
    // provider 收到刷新后的新 token
    expect(queryGscSearchAnalyticsMock.mock.calls[0][0]).toBe("fresh-token");
  });
  it("refresh 失败 → GSC_AUTH_REQUIRED（提示重连）", async () => {
    const expired = await makeEncryptedTokens({ expiresAt: Date.now() - 1000 });
    getGscConnectionByProjectMock.mockResolvedValue({ ...connection, encrypted_credentials: expired });
    refreshGoogleTokenMock.mockRejectedValue(new GscProviderError("GSC_AUTH_REQUIRED", 401, "refresh 失效"));
    await expect(searchAnalytics({ userId: "u1", projectId: 2, dimensions: ["query"] }))
      .rejects.toMatchObject({ code: "GSC_AUTH_REQUIRED" });
  });
});

describe("OAuth state", () => {
  it("签名往返 + 篡改拒绝 + 过期拒绝", async () => {
    const { signOAuthState: sign, verifyOAuthState: verify } = await import("./gsc-service");
    const state = sign("user-1", Date.now());
    expect(verify(state)).toBe("user-1");
    expect(verify(state.slice(0, -2) + "xx")).toBe(null);
    expect(verify(sign("user-1", Date.now() - 11 * 60_000))).toBe(null);
    const other = sign("user-2", Date.now());
    expect(verify(other)).toBe("user-2");
    // state 与登录用户不匹配由路由层拒绝（callback 比较 stateUserId !== auth.user.id）
    void signOAuthState; void verifyOAuthState;
  });
});
