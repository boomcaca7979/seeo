// ===== 公开外链检查工具（/tools/backlink-checker）服务层测试 =====
// 覆盖两件事：
//   1. 域名归一化与拒绝规则（SSRF / 私网 / IP 字面量 / 非法输入）
//   2. 成本与滥用防护顺序：缓存命中不消耗额度、冷却生效、每日额度生效，
//      以及错误归一化（provider 细节不外泄）
// 全部依赖均 mock，不触达 DataForSEO、Turso 或网络。

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/backlinks", () => ({
  getBacklinkSummary: vi.fn(),
  listBacklinks: vi.fn(),
  saveBacklinks: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  tryIncrementApiDailyUsage: vi.fn(),
}));
vi.mock("./dataforseo", () => ({
  fetchBacklinks: vi.fn(),
  isDataForSeoConfigured: vi.fn(),
}));
vi.mock("./cache", () => ({
  readCache: vi.fn(),
  writeCache: vi.fn(),
}));

import { getBacklinkSummary, listBacklinks, saveBacklinks } from "@/lib/db/backlinks";
import { tryIncrementApiDailyUsage } from "@/lib/db";
import { fetchBacklinks, isDataForSeoConfigured } from "./dataforseo";
import { readCache, writeCache } from "./cache";
import {
  normalizePublicDomain,
  getPublicBacklinkPreview,
  PUBLIC_CACHE_SCOPE,
  PUBLIC_GLOBAL_SCOPE,
  PREVIEW_SAMPLE_LIMIT,
} from "./public-backlink-service";

const m = {
  getBacklinkSummary: vi.mocked(getBacklinkSummary),
  listBacklinks: vi.mocked(listBacklinks),
  saveBacklinks: vi.mocked(saveBacklinks),
  tryIncrement: vi.mocked(tryIncrementApiDailyUsage),
  fetchBacklinks: vi.mocked(fetchBacklinks),
  configured: vi.mocked(isDataForSeoConfigured),
  readCache: vi.mocked(readCache),
  writeCache: vi.mocked(writeCache),
};

/** 构造一行缓存 summary（fetched_at 为 UTC 无 Z 形式，与 datetime('now') 一致） */
function summaryRow(isoUtc: string) {
  return {
    id: 1,
    domain: "example.com",
    total_backlinks: 1200,
    referring_domains: 87,
    domain_rank: 42,
    dofollow_pct: 63.5,
    raw_json: null,
    fetched_at: isoUtc,
  };
}

function backlinkRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    domain: "example.com",
    source_url: `https://source-${i}.example.org/post-${i}`,
    anchor: `anchor ${i}`,
    target_url: "https://example.com/page",
    dofollow: i % 2 === 0 ? 1 : 0,
    source_rank: 900 - i,
    first_seen: "2026-01-0" + ((i % 9) + 1),
    fetched_at: "2026-09-15 00:00:00",
  }));
}

const FRESH_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
const STALE_AT = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");

beforeEach(() => {
  // resetAllMocks（而非 clearAllMocks）：连实现一起清空，避免上一个用例的
  // mockResolvedValue 泄漏到下一个用例——本例顺序敏感（缓存读在配置检查之前）
  vi.resetAllMocks();
  m.configured.mockReturnValue(true);
  m.readCache.mockResolvedValue(null);
  m.writeCache.mockResolvedValue(undefined);
  m.saveBacklinks.mockResolvedValue(undefined);
  m.tryIncrement.mockResolvedValue({ ok: true, used: 1, limit: 5 });
  m.getBacklinkSummary.mockResolvedValue(null);
  m.listBacklinks.mockResolvedValue([]);
});

// ---------- 1. 域名归一化 ----------

describe("normalizePublicDomain：归一化", () => {
  const accepted: Array<[string, string]> = [
    ["example.com", "example.com"],
    ["  Example.COM ", "example.com"],
    ["https://example.com", "example.com"],
    ["http://example.com/path/to/page?q=1#frag", "example.com"],
    ["example.com:8080", "example.com"],
    ["example.com/", "example.com"],
    ["example.com.", "example.com"],
    ["sub.domain.example.co.uk", "sub.domain.example.co.uk"],
    ["www.example.com", "example.com"],
    ["WWW.Example.COM/", "example.com"],
    ["https://www.example.com:8443/path?q=1", "example.com"],
    ["www.sub.example.com", "sub.example.com"],
  ];

  it.each(accepted)("%s → %s", (input, expected) => {
    const result = normalizePublicDomain(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.domain).toBe(expected);
  });

  it("Unicode 国际化域名转为 punycode", () => {
    const result = normalizePublicDomain("https://中文.com");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.domain.startsWith("xn--")).toBe(true);
  });
});

describe("normalizePublicDomain：拒绝规则", () => {
  it("空输入 → EMPTY", () => {
    expect(normalizePublicDomain("")).toEqual({ ok: false, code: "EMPTY" });
    expect(normalizePublicDomain("   ")).toEqual({ ok: false, code: "EMPTY" });
    expect(normalizePublicDomain(undefined as unknown as string)).toEqual({ ok: false, code: "EMPTY" });
  });

  const privateHosts = [
    "localhost",
    "localhost:3000",
    "http://localhost/app",
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.9",
    "169.254.169.254",
    "0.0.0.0",
    "8.8.8.8",
    "[::1]",
    "http://[::1]/",
    "something.local",
    "api.internal",
    "foo.localhost",
    "metadata.google.internal",
    "printer.lan",
  ];

  it.each(privateHosts)("%s → PRIVATE_HOST", (input) => {
    const result = normalizePublicDomain(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PRIVATE_HOST");
  });

  const invalidHosts = [
    "not a domain",
    "example",
    "http://",
    "javascript:alert(1)",
    ".com",
    "example..com",
    "-example.com",
    "example-.com",
    "example.c",
    "example.123",
    "a".repeat(64) + ".com",
  ];

  it.each(invalidHosts)("%s → INVALID_DOMAIN", (input) => {
    const result = normalizePublicDomain(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_DOMAIN");
  });
});

// ---------- 2. 成本与滥用防护 ----------

describe("getPublicBacklinkPreview：缓存优先（零 provider 成本）", () => {
  it("命中 7 天缓存时直接返回，不消耗额度、不调用 provider", async () => {
    m.getBacklinkSummary.mockResolvedValue(summaryRow(FRESH_AT));
    m.listBacklinks.mockResolvedValue(backlinkRows(12));

    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.fromCache).toBe(true);
    expect(outcome.data.summary.totalBacklinks).toBe(1200);
    expect(outcome.data.sample).toHaveLength(PREVIEW_SAMPLE_LIMIT);
    expect(outcome.data.storedLinks).toBe(12);
    expect(m.fetchBacklinks).not.toHaveBeenCalled();
    expect(m.tryIncrement).not.toHaveBeenCalled();
    expect(m.writeCache).not.toHaveBeenCalled();
  });

  it("缓存过期（>7 天）时视为未命中", async () => {
    // 第一次读缓存：过期 → 视为 miss；写入后第二次读：新鲜快照
    m.getBacklinkSummary.mockResolvedValueOnce(summaryRow(STALE_AT));
    m.getBacklinkSummary.mockResolvedValue(summaryRow(FRESH_AT));
    m.listBacklinks.mockResolvedValue(backlinkRows(3));
    m.fetchBacklinks.mockResolvedValue({
      summary: { total_backlinks: 5, referring_domains: 2, domain_rank: 10, dofollow_pct: 50 },
      backlinks: [],
      rawJson: { summary: {}, backlinks: {} },
    });

    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");

    expect(m.fetchBacklinks).toHaveBeenCalledTimes(1);
    expect(m.saveBacklinks).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.fromCache).toBe(false);
      expect(outcome.data.sample).toHaveLength(3);
    }
  });
});

describe("getPublicBacklinkPreview：防滥用闸门顺序", () => {
  it("域名为私网主机时立即拒绝，不消耗额度", async () => {
    const outcome = await getPublicBacklinkPreview("localhost", "1.2.3.4");
    expect(outcome).toEqual({ ok: false, code: "PRIVATE_HOST", retryAfterSeconds: 0 });
    expect(m.tryIncrement).not.toHaveBeenCalled();
  });

  it("未配置 provider 时返回 DATAFORSEO_NOT_CONFIGURED，不消耗额度", async () => {
    m.configured.mockReturnValue(false);
    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");
    expect(outcome).toEqual({ ok: false, code: "DATAFORSEO_NOT_CONFIGURED", retryAfterSeconds: 0 });
    expect(m.tryIncrement).not.toHaveBeenCalled();
  });

  it("单域名冷却期内拒绝，不进入额度与 provider", async () => {
    m.getBacklinkSummary.mockResolvedValue(null);
    m.readCache.mockResolvedValue({ at: Date.now() - 60_000 });

    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("BACKLINK_COOLDOWN");
      expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(m.tryIncrement).not.toHaveBeenCalled();
    expect(m.fetchBacklinks).not.toHaveBeenCalled();
  });

  it("单访客每日额度用尽 → CHECKER_DAILY_LIMIT，且不使用全局额度", async () => {
    m.getBacklinkSummary.mockResolvedValue(null);
    m.tryIncrement.mockResolvedValueOnce({ ok: false, used: 5, limit: 5 });

    const outcome = await getPublicBacklinkPreview("example.com", "9.9.9.9");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("CHECKER_DAILY_LIMIT");
    expect(m.tryIncrement).toHaveBeenCalledTimes(1);
    expect(m.fetchBacklinks).not.toHaveBeenCalled();
  });

  it("全局每日额度用尽 → CHECKER_BUDGET_EXHAUSTED", async () => {
    m.getBacklinkSummary.mockResolvedValue(null);
    m.tryIncrement
      .mockResolvedValueOnce({ ok: true, used: 1, limit: 5 })
      .mockResolvedValueOnce({ ok: false, used: 100, limit: 100 });

    const outcome = await getPublicBacklinkPreview("example.com", "9.9.9.9");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("CHECKER_BUDGET_EXHAUSTED");
    expect(m.fetchBacklinks).not.toHaveBeenCalled();
  });

  it("额度作用域使用保留 key，不会污染真实用户数据", async () => {
    m.getBacklinkSummary.mockResolvedValue(null);
    m.fetchBacklinks.mockResolvedValue({
      summary: { total_backlinks: 1, referring_domains: 1, domain_rank: 1, dofollow_pct: 100 },
      backlinks: [],
      rawJson: { summary: {}, backlinks: {} },
    });

    await getPublicBacklinkPreview("example.com", "5.6.7.8");

    const scopes = m.tryIncrement.mock.calls.map((call) => call[0]);
    expect(scopes).toContain("public-checker:ip:5.6.7.8");
    expect(scopes).toContain(PUBLIC_GLOBAL_SCOPE);
    expect(m.saveBacklinks).toHaveBeenCalledWith(PUBLIC_CACHE_SCOPE, expect.anything());
    // 冷却标记先于 provider 调用写入（失败重试抑制）
    expect(m.writeCache).toHaveBeenCalled();
  });
});

describe("getPublicBacklinkPreview：错误归一化", () => {
  it("provider 异常只返回归一化错误码，不泄露原始信息", async () => {
    m.getBacklinkSummary.mockResolvedValue(null);
    m.fetchBacklinks.mockRejectedValue(new Error("DataForSEO 错误 [40200]: quota exceeded for login abc"));

    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("UPSTREAM_ERROR");
      expect(JSON.stringify(outcome)).not.toContain("40200");
      expect(JSON.stringify(outcome)).not.toContain("abc");
    }
  });

  it("provider 超时映射为 UPSTREAM_TIMEOUT", async () => {
    m.getBacklinkSummary.mockResolvedValue(null);
    m.fetchBacklinks.mockRejectedValue(new Error("DataForSEO 请求超时（30s）"));

    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("失败后不写入任何外链数据", async () => {
    m.getBacklinkSummary.mockResolvedValue(null);
    m.fetchBacklinks.mockRejectedValue(new Error("boom"));

    await getPublicBacklinkPreview("example.com", "1.2.3.4");
    expect(m.saveBacklinks).not.toHaveBeenCalled();
  });
});

describe("预览样本边界", () => {
  it("样本最多 5 条，且 dofollow 计数只统计样本", async () => {
    m.getBacklinkSummary.mockResolvedValue(summaryRow(FRESH_AT));
    m.listBacklinks.mockResolvedValue(backlinkRows(100));

    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.sample).toHaveLength(5);
    expect(outcome.data.storedLinks).toBe(100);
    // backlinkRows 中 index 偶数 = dofollow，前 5 条里 0,2,4 为 dofollow
    expect(outcome.data.sampleDofollow).toBe(3);
    expect(outcome.data.preview).toEqual({ sampleLimit: 5, storedLimit: 100, cacheDays: 7 });
  });

  it("链接数为 0 时不报错，汇总指标照常返回", async () => {
    m.getBacklinkSummary.mockResolvedValue(summaryRow(FRESH_AT));
    m.listBacklinks.mockResolvedValue([]);

    const outcome = await getPublicBacklinkPreview("example.com", "1.2.3.4");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.sample).toEqual([]);
    expect(outcome.data.sampleDofollow).toBe(0);
    expect(outcome.data.storedLinks).toBe(0);
    expect(outcome.data.summary.referringDomains).toBe(87);
  });
});
