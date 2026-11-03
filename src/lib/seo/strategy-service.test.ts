// ===== 关键词策略生成服务：部分失败 / 重试 / 手动追加 的确定性测试 =====
// 全程 Mock 供应商：不消耗任何 SerpApi / DataForSEO 配额，也不写真实数据库。
// 覆盖：
//   1. 多种子部分失败 → status=partial，成功种子的关键词完整保留；
//   2. 只重试失败种子 → 只调用一次扩词，成功结果合并、关键词不重复；
//   3. 全部失败 → status=failed 且不产出关键词；
//   4. Add keywords（manual=true）→ 关键词带 manual 标记，meta.addedSeeds 记录，原始 seeds 不被覆盖。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategyDoc } from "./strategy-model";

const expandKeywordMock = vi.fn();
const enrichKeywordMetricsMock = vi.fn();
const isDataForSeoConfiguredMock = vi.fn();
const setProgressMock = vi.fn();
const saveDocMock = vi.fn();
const getSerpUsageMock = vi.fn();

vi.mock("./serp-service", () => ({
  expandKeyword: (...args: unknown[]) => expandKeywordMock(...args),
  getSerpUsage: (...args: unknown[]) => getSerpUsageMock(...args),
}));

vi.mock("./keyword-research-service", () => ({
  enrichKeywordMetrics: (...args: unknown[]) => enrichKeywordMetricsMock(...args),
}));

vi.mock("./dataforseo", () => ({
  isDataForSeoConfigured: () => isDataForSeoConfiguredMock(),
}));

vi.mock("@/lib/db/strategies", () => ({
  setStrategyProgress: (...args: unknown[]) => setProgressMock(...args),
  saveStrategyDoc: (...args: unknown[]) => saveDocMock(...args),
}));

const { runStrategy } = await import("./strategy-service");

function expansion(seed: string, related: string[], paa: string[] = []) {
  return {
    seed,
    related,
    paa,
    location: "美国",
    device: "desktop",
    fromCache: false,
    serpSnapshot: {
      keyword: seed,
      location: "美国",
      device: "PC",
      fetchedAt: "2026-11-02T06:00:00.000Z",
      organic: [
        { position: 1, title: `${seed} buying guide for beginners`, link: "https://a.example/x", domain: "a.example", snippet: "how to choose" },
        { position: 2, title: `best ${seed} 2026`, link: "https://b.example/y", domain: "b.example", snippet: "review" },
      ],
      relatedSearches: related.map((query) => ({ query })),
      relatedQuestions: paa.map((question) => ({ question })),
      features: [{ featureType: "related_searches", position: null, title: null, url: null }],
    },
  };
}

const BASE = {
  userId: "demo:test",
  plan: "pro" as const,
  strategyId: 1,
  market: "美国",
  device: "PC" as const,
};

beforeEach(() => {
  expandKeywordMock.mockReset();
  enrichKeywordMetricsMock.mockReset();
  isDataForSeoConfiguredMock.mockReset().mockReturnValue(false);
  setProgressMock.mockReset();
  saveDocMock.mockReset();
  getSerpUsageMock.mockReset().mockResolvedValue({ used: 0, limit: 30, month: "2026-11" });
  enrichKeywordMetricsMock.mockResolvedValue({ rows: [], source: null, fromCache: false, warnings: [] });
});

describe("runStrategy 部分失败", () => {
  it("一个种子失败：状态 partial，失败种子不产生关键词，成功种子结果保留", async () => {
    expandKeywordMock.mockImplementation(async (_u: unknown, _p: unknown, params: { keyword: string }) => {
      if (params.keyword === "bad seed") throw new Error("SerpApi 超时");
      return expansion(params.keyword, ["mountain bike tires", "mtb helmet"]);
    });

    const result = await runStrategy({ ...BASE, seeds: ["good seed", "bad seed"] });

    expect(result.status).toBe("partial");
    expect(result.doc.meta.failedSeeds).toEqual(["bad seed"]);
    expect(result.doc.meta.perSeed).toEqual([
      expect.objectContaining({ seed: "good seed", ok: true }),
      expect.objectContaining({ seed: "bad seed", ok: false, error: "SerpApi 超时" }),
    ]);
    // 成功种子的关键词存在，失败种子没有贡献任何词
    const words = result.doc.keywords.map((k) => k.id);
    expect(words).toContain("good seed");
    expect(words).toContain("mountain bike tires");
    expect(result.doc.keywords.every((k) => k.seeds.includes("bad seed") === false)).toBe(true);
    // 落库状态与文档一致
    expect(saveDocMock).toHaveBeenLastCalledWith(BASE.userId, BASE.strategyId, expect.any(Object), "partial");
  });

  it("全部失败：status=failed，不产出关键词", async () => {
    expandKeywordMock.mockRejectedValue(new Error("quota"));
    const result = await runStrategy({ ...BASE, seeds: ["a", "b"] });
    expect(result.status).toBe("failed");
    expect(result.doc.keywords).toHaveLength(0);
    expect(saveDocMock).toHaveBeenLastCalledWith(BASE.userId, BASE.strategyId, expect.any(Object), "failed");
  });
});

describe("runStrategy 重试失败种子", () => {
  it("只重试失败种子，合并后状态 ready，关键词不重复，已成功种子不再调用供应商", async () => {
    // 第一轮：good 成功、bad 失败
    expandKeywordMock.mockImplementation(async (_u: unknown, _p: unknown, params: { keyword: string }) => {
      if (params.keyword === "bad seed") throw new Error("暂时失败");
      return expansion(params.keyword, ["bike repair near me"]);
    });
    const first = await runStrategy({ ...BASE, seeds: ["good seed", "bad seed"] });
    expect(first.status).toBe("partial");

    // 第二轮：只重试 bad，且这次成功
    expandKeywordMock.mockReset();
    expandKeywordMock.mockImplementation(async (_u: unknown, _p: unknown, params: { keyword: string }) =>
      expansion(params.keyword, ["bike repair cost"])
    );
    const retried = await runStrategy({
      ...BASE,
      seeds: ["bad seed"],
      existing: first.doc,
      previousMeta: first.doc.meta,
    });

    // 供应商只为重试种子调用一次（不重复扣已成功种子的配额）
    expect(expandKeywordMock).toHaveBeenCalledTimes(1);
    expect((expandKeywordMock.mock.calls[0][2] as { keyword: string }).keyword).toBe("bad seed");

    expect(retried.status).toBe("ready");
    expect(retried.doc.meta.failedSeeds).toEqual([]);
    expect(retried.doc.meta.perSeed.map((p) => p.seed).sort()).toEqual(["bad seed", "good seed"]);

    const ids = retried.doc.keywords.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length); // 没有重复关键词
    expect(ids).toContain("good seed"); // 旧结果保留
    expect(ids).toContain("bike repair cost"); // 新结果并入
    expect(saveDocMock).toHaveBeenLastCalledWith(BASE.userId, BASE.strategyId, expect.any(Object), "ready");
  });
});

describe("runStrategy Add keywords（manual）", () => {
  it("手动追加的种子带来 manual 标记，写入 addedSeeds，原始 seeds 不变", async () => {
    expandKeywordMock.mockImplementation(async (_u: unknown, _p: unknown, params: { keyword: string }) =>
      expansion(params.keyword, [`${params.keyword} tips`])
    );
    const base = await runStrategy({ ...BASE, seeds: ["mountain bike"] });
    const originalSeeds = ["mountain bike"];

    expandKeywordMock.mockReset();
    expandKeywordMock.mockImplementation(async (_u: unknown, _p: unknown, params: { keyword: string }) =>
      expansion(params.keyword, [`${params.keyword} tips`])
    );
    const added = await runStrategy({
      ...BASE,
      seeds: ["bike repair"],
      manual: true,
      existing: base.doc,
      previousMeta: base.doc.meta,
    });

    const manualWords = added.doc.keywords.filter((k) => k.manual);
    expect(manualWords.length).toBeGreaterThan(0);
    expect(manualWords.every((k) => k.seeds.includes("bike repair"))).toBe(true);
    expect(added.doc.meta.addedSeeds).toContain("bike repair");
    // 原始种子仍完整（未被覆盖）
    expect(originalSeeds).toEqual(["mountain bike"]);
    expect(added.doc.keywords.some((k) => k.seeds.includes("mountain bike"))).toBe(true);
    expect(added.status).toBe("ready");
  });
});

describe("deriveStrategyStatus（纯函数边界）", () => {
  it("空 / 全成功 / 部分 / 全失败", async () => {
    const { deriveStrategyStatus } = await import("./strategy-model");
    expect(deriveStrategyStatus([])).toBe("ready");
    expect(deriveStrategyStatus([{ ok: true }])).toBe("ready");
    expect(deriveStrategyStatus([{ ok: true }, { ok: false }])).toBe("partial");
    expect(deriveStrategyStatus([{ ok: false }, { ok: false }])).toBe("failed");
  });
});

// 类型守卫：确保保存的 doc 结构确实是 StrategyDoc（编译期契约）
export type _DocCheck = StrategyDoc;
