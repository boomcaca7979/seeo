// ===== SERP Intelligence / Priority / Overlap / Content Gap API 契约 =====
//
// Mock 身份 + 真实 SQLite 临时库（沿用 strategies-ownership 的隔离模式）。

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { useTempSqliteDb } from "@/lib/db/test-db";
import { closeDb } from "@/lib/db/migrations";
import { assertPublicHost, isAllowedByRobots, BlockedUrlError } from "@/lib/seo/content-gap/fetcher";
import { normalizeUrlForOverlap } from "@/lib/seo/serp-overlap";
import type { CompactSerpSnapshot, SerpSnapshotMap } from "@/lib/seo/serp-snapshot";
import type { StrategyDoc } from "@/lib/seo/strategy-model";

const authState = vi.hoisted(() => ({ user: "user-a" }));

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: async () => ({
    user: { id: authState.user },
    plan: "free",
    subscriptionStatus: "inactive",
    limits: { max_tracked_keywords: 3 },
    allowed: true,
    skip: false,
  }),
}));

vi.mock("@/lib/seo/strategy-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo/strategy-service")>();
  return { ...actual, resolveStrategyOwner: async () => authState.user };
});

let temp: ReturnType<typeof useTempSqliteDb>;

const { createStrategy, saveStrategyDoc, getStrategy, setPriorityOverride, getPriorityOverrides } = await import("@/lib/db/strategies");
const detailRoute = await import("./[id]/route");
const overlapRoute = await import("./[id]/overlap/route");

function ctx(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function makeSnapshot(keyword: string, urls: string[]): CompactSerpSnapshot {
  return {
    keyword,
    market: "美国",
    language: "en",
    device: "PC",
    fetchedAt: "2026-11-02T00:00:00.000Z",
    fromCache: false,
    totalResults: null,
    adsCount: 0,
    results: urls.map((url, i) => ({ position: i + 1, title: `R${i}`, url, domain: "a.com", snippet: "" })),
    features: [],
    paa: ["question one?", "question two?"],
    related: ["related one"],
  };
}

function makeDoc(snapshots: SerpSnapshotMap): StrategyDoc {
  return {
    topics: [
      {
        id: "t-best-grinder",
        name: "best grinder",
        keywordIds: ["best grinder"],
        keywordCount: 1,
        pillarId: "best grinder",
        pages: [],
        totalVolume: null,
        avgKd: null,
        intentMix: [100, 0, 0] as const,
        intentCounts: { informational: 1, commercial: 0, transactional: 0, navigational: 0, unknown: 0 },
        pillarReason: "fixture",
      },
    ],
    keywords: [
      {
        id: "best grinder",
        keyword: "best grinder",
        seeds: ["best grinder"],
        origins: ["seed" as const],
        volume: null,
        kd: null,
        cpc: null,
        metricsSource: null,
        intent: "商业型" as const,
        intentSource: "estimated" as const,
        manual: false,
        topicId: "t-best-grinder",
        role: "pillar" as const,
        pageId: null,
        serpFeatures: null,
      },
    ],
    meta: {
      market: "美国",
      device: "PC",
      fetchedAt: "2026-11-02T00:00:00.000Z",
      sources: ["serpapi"],
      metrics: { volume: "unavailable", kd: "unavailable", cpc: "unavailable", intent: "estimated" },
      warnings: [],
      perSeed: [{ seed: "best grinder", ok: true, related: 1, paa: 1 }],
      failedSeeds: [],
      addedSeeds: [],
      related: ["related one"],
      paa: ["question one?", "question two?"],
      method: { clustering: "", pillar: "" },
      serpSnapshots: snapshots,
    },
  };
}

beforeAll(() => {
  temp = useTempSqliteDb("serp-upgrade");
  closeDb();
});

afterAll(() => {
  closeDb();
  temp.restore();
  fs.rmSync(temp.dir, { recursive: true, force: true });
});

describe("SERP 快照随策略持久化", () => {
  it("保存含快照的 doc 后可完整读回", async () => {
    const snapshots = { "best grinder": makeSnapshot("best grinder", ["https://a.com/1", "https://a.com/2"]) };
    const row = await createStrategy("user-a", { name: "s", seeds: ["best grinder"], market: "美国", device: "PC" });
    await saveStrategyDoc("user-a", row.id, makeDoc(snapshots), "ready");

    const record = await getStrategy("user-a", row.id);
    expect(record?.doc?.meta.serpSnapshots?.["best grinder"].results).toHaveLength(2);
    expect(record?.doc?.meta.serpSnapshots?.["best grinder"].paa).toEqual(["question one?", "question two?"]);
  });
});

describe("Strategy Priority 用户覆盖", () => {
  it("PATCH priorityOverride 保存并在 GET 返回", async () => {
    const snapshots = { "best grinder": makeSnapshot("best grinder", ["https://a.com/1"]) };
    const row = await createStrategy("user-a", { name: "s2", seeds: ["best grinder"], market: "美国", device: "PC" });
    await saveStrategyDoc("user-a", row.id, makeDoc(snapshots), "ready");

    const patch = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ priorityOverride: { topicId: "t-best-grinder", level: "recommended" } }),
      }),
      ctx(row.id)
    );
    expect(patch.status).toBe(200);

    expect(await getPriorityOverrides("user-a", row.id)).toEqual({ "t-best-grinder": "recommended" });

    const get = await detailRoute.GET(new Request(`http://local/api/keywords/strategies/${row.id}`), ctx(row.id));
    const body = await get.json();
    expect(body.data.priorityOverrides).toEqual({ "t-best-grinder": "recommended" });

    // 清除覆盖
    expect(await setPriorityOverride("user-a", row.id, "t-best-grinder", null)).toBe(true);
    expect(await getPriorityOverrides("user-a", row.id)).toEqual({});
  });

  it("非法 level 返回 400；B 用户操作 A 的覆盖返回 404", async () => {
    const snapshots = { "best grinder": makeSnapshot("best grinder", ["https://a.com/1"]) };
    const row = await createStrategy("user-a", { name: "s3", seeds: ["best grinder"], market: "美国", device: "PC" });
    await saveStrategyDoc("user-a", row.id, makeDoc(snapshots), "ready");

    const bad = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ priorityOverride: { topicId: "t-best-grinder", level: "pwned" } }),
      }),
      ctx(row.id)
    );
    expect(bad.status).toBe(400);

    authState.user = "user-b";
    const cross = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ priorityOverride: { topicId: "t-best-grinder", level: "low" } }),
      }),
      ctx(row.id)
    );
    expect(cross.status).toBe(404);
    authState.user = "user-a";
  });
});

describe("Overlap API", () => {
  it("快照齐全：直接返回 Jaccard 结果，不发请求", async () => {
    const snapshots = {
      "best grinder": makeSnapshot("best grinder", Array.from({ length: 8 }, (_, i) => `https://a.com/${i}`)),
      grinder: makeSnapshot("grinder", Array.from({ length: 8 }, (_, i) => `https://a.com/${i}`)),
    };
    const row = await createStrategy("user-a", { name: "s4", seeds: ["best grinder"], market: "美国", device: "PC" });
    await saveStrategyDoc("user-a", row.id, makeDoc(snapshots), "ready");

    const res = await overlapRoute.POST(
      new Request(`http://local/api/keywords/strategies/${row.id}/overlap`, {
        method: "POST",
        body: JSON.stringify({ keywords: ["best grinder", "grinder"] }),
      }),
      ctx(row.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ready).toBe(true);
    expect(body.data.pairs[0].overlapRatio).toBe(1);
    expect(body.data.pairs[0].verdict).toBe("strong-same-page");
    expect(body.data.needsFetch).toEqual([]);
  });

  it("快照缺失：不自动请求，列出缺失与所需调用数", async () => {
    const row = await createStrategy("user-a", { name: "s5", seeds: ["best grinder"], market: "美国", device: "PC" });
    await saveStrategyDoc("user-a", row.id, makeDoc({}), "ready");

    const res = await overlapRoute.POST(
      new Request(`http://local/api/keywords/strategies/${row.id}/overlap`, {
        method: "POST",
        body: JSON.stringify({ keywords: ["best grinder", "grinder"] }),
      }),
      ctx(row.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ready).toBe(false);
    expect(body.data.needsFetch).toEqual(["best grinder", "grinder"]);
    expect(body.data.neededCalls).toBe(2);
    expect(body.data.preflight).toBeTruthy();
  });

  it("少于 2 个词返回 400；B 访问 A 的策略返回 404", async () => {
    const row = await createStrategy("user-a", { name: "s6", seeds: ["best grinder"], market: "美国", device: "PC" });
    await saveStrategyDoc("user-a", row.id, makeDoc({}), "ready");

    const few = await overlapRoute.POST(
      new Request(`http://local/api/keywords/strategies/${row.id}/overlap`, {
        method: "POST",
        body: JSON.stringify({ keywords: ["only one"] }),
      }),
      ctx(row.id)
    );
    expect(few.status).toBe(400);

    authState.user = "user-b";
    const cross = await overlapRoute.POST(
      new Request(`http://local/api/keywords/strategies/${row.id}/overlap`, {
        method: "POST",
        body: JSON.stringify({ keywords: ["best grinder", "grinder"] }),
      }),
      ctx(row.id)
    );
    expect(cross.status).toBe(404);
    authState.user = "user-a";
  });
});

describe("Content Gap 安全护栏", () => {
  it("SSRF：拒绝 localhost / 私有地址 / 非 http 协议", async () => {
    await expect(assertPublicHost("127.0.0.1")).rejects.toThrow(BlockedUrlError);
    await expect(assertPublicHost("10.0.0.5")).rejects.toThrow(BlockedUrlError);
    await expect(assertPublicHost("192.168.1.1")).rejects.toThrow(BlockedUrlError);
    await expect(assertPublicHost("169.254.169.254")).rejects.toThrow(BlockedUrlError);
    await expect(assertPublicHost("[::1]")).rejects.toThrow(BlockedUrlError);
    await expect(assertPublicHost("localhost")).rejects.toThrow(BlockedUrlError);
    const u = await import("@/lib/seo/content-gap/fetcher");
    await expect(u.assertSafeUrl("ftp://example.com/x")).rejects.toThrow(BlockedUrlError);
  });

  it("robots 前缀匹配", () => {
    const rules = { disallow: ["/private/", "/admin"], fetched: true };
    expect(isAllowedByRobots("/public/page", rules)).toBe(true);
    expect(isAllowedByRobots("/private/x", rules)).toBe(false);
    expect(isAllowedByRobots("/admin/x", rules)).toBe(false);
  });

  it("URL 归一复用 overlap 实现", () => {
    expect(normalizeUrlForOverlap("https://a.com/x?utm_campaign=1")).toBe("a.com/x");
  });
});
