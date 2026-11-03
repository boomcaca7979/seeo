// ===== Compare SERP 确认抓取分支 · 端到端集成测试（Mock SerpApi，零真实调用） =====
//
// 覆盖发布前审计的遗留验证项：overlap 路由在「缺快照 → 用户确认 → 补抓 → 保存 →
// 二次走缓存」完整链路上的行为与成本纪律。
//   - Mock serp-service.searchSerp：记录每次调用，绝不发真实请求；
//   - 隔离 SQLite（系统临时目录内，满足 refuseNonTempDbInTests）；
//   - demo 模式鉴权（isAuthEnabled=false），scope cookie 固定。

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const SCOPE = "a1b2c3d4e5f6a7b8c9d0e1f2";
const OWNER_ID = `demo:${SCOPE}`;

// 必须在任何模块（auth-config / migrations 常量）初始化之前生效：
// 1) 关闭认证 → 路由走 demo 分支 + 本地 SQLite fallback；
// 2) 指向系统临时目录内的隔离库（refuseNonTempDbInTests 的白名单判据）。
vi.hoisted(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = "";
  process.env.TURSO_AUTH_TOKEN = "";
  // vi.hoisted 连同 vi.mock 一起被提升到静态 import 求值之前，
  // 此处只能用动态 import()（require() 违反 no-require-imports 规则）。
  const [{ default: os }, path] = await Promise.all([
    import("node:os"),
    import("node:path"),
  ]);
  const fs = await import("node:fs");
  process.env.SEO_SQLITE_DB_PATH = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "seeo-overlap-e2e-")),
    "qa.db"
  );
});

process.env.SEO_SQLITE_DB_PATH ??= "";

// ---- Mock：SerpApi 调用记录器（必须在 import 被测模块前注册） ----
const serpCalls: Array<{ userId: string; keyword: string }> = [];
let serpShouldFail = false;

vi.mock("@/lib/seo/serp-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo/serp-service")>();
  return {
    ...actual,
    searchSerp: vi.fn(async (userId: string, _plan: string, params: { keyword: string }) => {
      serpCalls.push({ userId, keyword: params.keyword });
      if (serpShouldFail) throw new Error("MOCK_SERPAPI_DOWN");
      return {
        result: {
          keyword: params.keyword,
          location: "美国",
          device: "PC" as const,
          fetchedAt: new Date().toISOString(),
          language: "en",
          fromCache: false,
          totalResults: 1000,
          adsCount: 0,
          organic: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({
            position: i,
            title: `Mock result ${i} for ${params.keyword}`,
            link: `https://mock${i % 4 === 0 ? "shared" : i}.example.com/${params.keyword.replace(/\s+/g, "-")}`,
            domain: `mock${i % 4 === 0 ? "shared" : i}.example.com`,
            snippet: `Mock snippet ${i}`,
          })),
          relatedSearches: [{ query: `${params.keyword} related` }],
          relatedQuestions: [{ question: `Is ${params.keyword} good?` }],
          features: [{ featureType: "featured_snippet" }],
        },
        fromCache: false,
      };
    }),
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "seeo_ks_scope" ? { name, value: SCOPE } : undefined),
    set: () => undefined,
    getAll: () => [{ name: "seeo_ks_scope", value: SCOPE }],
  })),
}));

import { POST as overlapPost } from "@/app/api/keywords/strategies/[id]/overlap/route";
import { createStrategy, saveStrategyDoc, getStrategy } from "@/lib/db/strategies";
import type { StrategyDoc } from "@/lib/seo/strategy-model";
import { extractCompactSnapshot } from "@/lib/seo/serp-snapshot";

const ROUTE_CTX = { params: Promise.resolve({ id: "" }) };
function post(id: number, body: unknown) {
  ROUTE_CTX.params = Promise.resolve({ id: String(id) });
  return overlapPost(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }), ROUTE_CTX);
}

let strategyId = 0;

beforeAll(async () => {
  // 建一个 ready 策略：两个种子（mountain bike / bike repair），A 种子已有快照，B 无
  const summary = await createStrategy(OWNER_ID, {
    name: "overlap-e2e",
    seeds: ["mountain bike", "bike repair"],
    market: "美国",
    device: "PC",
  });
  strategyId = summary.id;
  const keywords: StrategyDoc["keywords"] = [
    { id: "mountain bike", keyword: "mountain bike", seeds: ["mountain bike"], role: "pillar", topicId: "t1", intent: "commercial", intentSource: "estimated", kd: null, volume: null, cpc: null, sources: ["seed"] },
    { id: "bike repair", keyword: "bike repair", seeds: ["bike repair"], role: "pillar", topicId: "t1", intent: "informational", intentSource: "estimated", kd: null, volume: null, cpc: null, sources: ["seed"] },
  ] as unknown as StrategyDoc["keywords"];
  const mockA = await (async () => {
    const { searchSerp } = await import("@/lib/seo/serp-service");
    return (await searchSerp(OWNER_ID, "free", { keyword: "mountain bike", location: "美国", device: "PC" })).result;
  })();
  const doc: StrategyDoc = {
    topics: [{
      id: "t1",
      name: "Bikes",
      keywordIds: ["mountain bike", "bike repair"],
      pillarId: "mountain bike",
      pages: [],
      keywordCount: 2,
      totalVolume: null,
      avgKd: null,
      intentMix: { informational: 1, commercial: 1 },
      intentCounts: { informational: 1, commercial: 1 },
      pillarReason: "fixture",
    } as unknown as StrategyDoc["topics"][number]],
    keywords,
    meta: {
      market: "美国",
      device: "PC",
      sources: ["serpapi"],
      fetchedAt: new Date().toISOString(),
      metrics: { volume: "unavailable", kd: "unavailable", cpc: "unavailable", intent: "estimated" },
      warnings: [],
      perSeed: [
        { seed: "mountain bike", ok: true, related: 1, paa: 1 },
        { seed: "bike repair", ok: true, related: 1, paa: 1 },
      ],
      failedSeeds: [],
      method: { clustering: "rule", pillar: "rule" },
      serpSnapshots: { "mountain bike": extractCompactSnapshot("mountain bike", "美国", mockA) },
    } as unknown as StrategyDoc["meta"],
  };
  await saveStrategyDoc(OWNER_ID, strategyId, doc, "ready");
});

afterAll(async () => {
  // 隔离库在系统临时目录，测试结束无需清理仓库文件
});

beforeEach(() => {
  serpCalls.length = 0;
  serpShouldFail = false;
});

describe("Compare SERP overlap 路由 · 确认抓取分支（Mock 端到端）", () => {
  it("1. 缺快照 + 未确认 → 返回 needsFetch 清单，绝不调用 SerpApi", async () => {
    const res = await post(strategyId, { keywords: ["mountain bike", "bike repair"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ready).toBe(false);
    expect(json.data.needsFetch).toEqual(["bike repair"]);
    expect(json.data.neededCalls).toBe(1);
    expect(json.data.preflight.ok).toBe(true);
    expect(serpCalls).toHaveLength(0);
  });

  it("2. 缺快照 + confirm=true → 恰好一次抓取、快照持久化、比较结果 ready", async () => {
    const res = await post(strategyId, { keywords: ["mountain bike", "bike repair"], confirm: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ready).toBe(true);
    expect(serpCalls).toHaveLength(1);
    expect(serpCalls[0]).toMatchObject({ userId: OWNER_ID, keyword: "bike repair" });
    // 快照已随策略持久化
    const record = await getStrategy(OWNER_ID, strategyId);
    expect(record?.doc?.meta.serpSnapshots?.["bike repair"]).toBeTruthy();
    // 两个 mock SERP URL 完全不同 → separate-pages
    expect(json.data.pairs[0].verdict).toBe("separate-pages");
    expect(json.data.pairs[0].overlapRatio).toBe(0);
  });

  it("3. 再次比较同一对词 → 命中已存快照，零新增调用（防双扣）", async () => {
    const res = await post(strategyId, { keywords: ["mountain bike", "bike repair"], confirm: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ready).toBe(true);
    expect(serpCalls).toHaveLength(0);
  });

  it("4. 配额拒绝（模拟 preflight 失败）→ 403，零供应商调用，策略状态不变", async () => {
    const strategyService = await import("@/lib/seo/strategy-service");
    const spy = vi.spyOn(strategyService, "preflightSerpQuota");
    // 用一个未预取快照的新词触发 confirm 分支，再让预检失败
    const { saveStrategyDoc: save, getStrategy: get } = await import("@/lib/db/strategies");
    const record = await get(OWNER_ID, strategyId);
    record!.doc!.meta.serpSnapshots = { "mountain bike": record!.doc!.meta.serpSnapshots!["mountain bike"] };
    await save(OWNER_ID, strategyId, record!.doc!, "ready");
    spy.mockResolvedValue({ ok: false, needed: 1, available: 0, tight: false, monthlyRemaining: 0, dailyRemaining: 0, message: "mock quota exhausted" });
    try {
      const res = await post(strategyId, { keywords: ["mountain bike", "bike repair"], confirm: true });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("QUOTA_INSUFFICIENT");
      expect(serpCalls).toHaveLength(0);
      const after = await get(OWNER_ID, strategyId);
      expect(after?.status).toBe("ready"); // 状态未被破坏
    } finally {
      spy.mockRestore();
    }
  });

  it("5. 供应商失败 → 部分成功时保存已获取快照、报告 failedFetch、状态保持 ready", async () => {
    serpShouldFail = true;
    const res = await post(strategyId, { keywords: ["mountain bike", "new seed word xyz"], confirm: true });
    expect(serpCalls).toHaveLength(1);
    // mountain bike 已有快照（无需抓取）；唯一 missing 的词抓取失败 → 无法比较（<2 词）
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("FETCH_FAILED");
    expect(json.data.failedFetch).toEqual([
      expect.objectContaining({ keyword: "new seed word xyz" }),
    ]);
    const record = await getStrategy(OWNER_ID, strategyId);
    expect(record?.status).toBe("ready");
    // 失败的词不写入半套快照；已有快照不受影响
    expect(record?.doc?.meta.serpSnapshots?.["new seed word xyz"]).toBeUndefined();
    expect(record?.doc?.meta.serpSnapshots?.["mountain bike"]).toBeTruthy();

    // 恢复供应商后重试：成功抓取并持久化，重试不会重复扣已成功的词
    serpShouldFail = false;
    const callsBeforeRetry = serpCalls.length;
    const res2 = await post(strategyId, { keywords: ["mountain bike", "new seed word xyz"], confirm: true });
    expect(res2.status).toBe(200);
    expect((await res2.json()).data.ready).toBe(true);
    expect(serpCalls.length - callsBeforeRetry).toBe(1); // 只补抓失败的词
    const after = await getStrategy(OWNER_ID, strategyId);
    expect(after?.doc?.meta.serpSnapshots?.["new seed word xyz"]).toBeTruthy();
  });

  it("6. 2–5 个词边界：1 词与 6 词都拒绝，不进入抓取", async () => {
    for (const keywords of [["a"], ["a", "b", "c", "d", "e", "f"]]) {
      const res = await post(strategyId, { keywords, confirm: true });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("BAD_KEYWORD_COUNT");
    }
    expect(serpCalls).toHaveLength(0);
  });

  it("7. 跨上下文（市场/设备不同）拒绝混算，不抓取", async () => {
    // 把已有快照之一替换成不同市场，构造 CONTEXT_MISMATCH
    const { saveStrategyDoc: save, getStrategy: get } = await import("@/lib/db/strategies");
    const record = await get(OWNER_ID, strategyId);
    record!.doc!.meta.serpSnapshots = {
      "mountain bike": record!.doc!.meta.serpSnapshots!["mountain bike"],
      "bike repair": { ...record!.doc!.meta.serpSnapshots!["bike repair"], market: "英国" },
    };
    await save(OWNER_ID, strategyId, record!.doc!, "ready");
    const res = await post(strategyId, { keywords: ["mountain bike", "bike repair"], confirm: true });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("CONTEXT_MISMATCH");
    expect(serpCalls).toHaveLength(0);
  });
});
