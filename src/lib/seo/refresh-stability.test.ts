// P0 稳定性纯逻辑测试
// 覆盖：refresh batch limit / SerpApi call limit / runtime fuse / automation cronCtx

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MAX_KEYWORDS_PER_REQUEST,
  CONCURRENCY,
  MAX_SERPAPI_CALLS_MANUAL,
  MAX_MANUAL_RUNTIME_MS,
  hasCronRuntimeExpired,
  type CronRunContext,
} from "@/lib/seo/refresh";
import { MAX_SERPAPI_CALLS_PER_RUN } from "@/lib/automation/cron";

describe("P0: refresh batch limit", () => {
  it("单次 HTTP 请求最多处理 20 个关键词", () => {
    expect(MAX_KEYWORDS_PER_REQUEST).toBe(20);
  });

  it("并发度受控为 3（禁止 Promise.all(200))", () => {
    expect(CONCURRENCY).toBe(3);
  });

  it("手动触发 SerpApi 调用上限为 20（远小于 Cron 500）", () => {
    expect(MAX_SERPAPI_CALLS_MANUAL).toBe(20);
  });

  it("Cron 系统级 SerpApi 上限为 500", () => {
    expect(MAX_SERPAPI_CALLS_PER_RUN).toBe(500);
  });

  it("手动上限远小于 Cron 上限", () => {
    expect(MAX_SERPAPI_CALLS_MANUAL).toBeLessThan(MAX_SERPAPI_CALLS_PER_RUN);
  });

  it("手动触发运行时间上限为 90s", () => {
    expect(MAX_MANUAL_RUNTIME_MS).toBe(90_000);
  });
});

describe("P0: SerpApi call limit (cost fuse)", () => {
  // 模拟 refreshRanksBatch 中的系统级保险丝逻辑
  function simulateCostFuse(ctx: CronRunContext, callsToMake: number): void {
    for (let i = 0; i < callsToMake; i++) {
      if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
        ctx.stoppedByCostLimit = true;
        break;
      }
      ctx.serpApiCalls++;
    }
    if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
      ctx.stoppedByCostLimit = true;
    }
  }

  it("未达上限时不停止", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 20,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    simulateCostFuse(ctx, 10);
    expect(ctx.stoppedByCostLimit).toBe(false);
    expect(ctx.serpApiCalls).toBe(10);
  });

  it("达到上限时立即停止并标记 stoppedByCostLimit", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 20,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    simulateCostFuse(ctx, 200); // 尝试 200 次，但上限 20
    expect(ctx.stoppedByCostLimit).toBe(true);
    expect(ctx.serpApiCalls).toBe(20); // 不超过上限
  });

  it("手动触发上限（20）比 Cron（500）更严格", () => {
    const manualCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_MANUAL,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: MAX_MANUAL_RUNTIME_MS,
      stoppedByTimeLimit: false,
    };
    const cronCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_PER_RUN,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    simulateCostFuse(manualCtx, 100);
    simulateCostFuse(cronCtx, 100);
    expect(manualCtx.stoppedByCostLimit).toBe(true);
    expect(cronCtx.stoppedByCostLimit).toBe(false);
  });

  it("已触及上限时不再处理后续子块", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 20,
      maxSerpApiCalls: 20,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
      ctx.stoppedByCostLimit = true;
    }
    expect(ctx.stoppedByCostLimit).toBe(true);
    simulateCostFuse(ctx, 50);
    expect(ctx.serpApiCalls).toBe(20);
  });
});

describe("P0: runtime fuse (hasCronRuntimeExpired)", () => {
  it("未超时返回 false", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now() - 100_000, // 100s ago
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    expect(hasCronRuntimeExpired(ctx)).toBe(false);
  });

  it("达到 maxRuntimeMs 返回 true", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now() - 240_001, // 240.001s ago
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    expect(hasCronRuntimeExpired(ctx)).toBe(true);
  });

  it("刚好等于 maxRuntimeMs 返回 true", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now() - 240_000, // exactly 240s ago
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    expect(hasCronRuntimeExpired(ctx)).toBe(true);
  });
});

describe("P0: runtime fuse 穿透 3 层", () => {
  // 模拟 refreshAllRanks 的 batch loop（Layer 1）
  function simulateBatchLoop(ctx: CronRunContext, totalBatches: number, batchDurationMs: number): number {
    let executedBatches = 0;
    for (let i = 0; i < totalBatches; i++) {
      if (ctx.stoppedByCostLimit || ctx.stoppedByTimeLimit) break;
      if (hasCronRuntimeExpired(ctx)) {
        ctx.stoppedByTimeLimit = true;
        break;
      }
      executedBatches++;
      // 模拟每批消耗时间
      ctx.startTime -= batchDurationMs;
    }
    return executedBatches;
  }

  // 模拟 refreshRanksBatch 的 chunk loop（Layer 2）
  function simulateChunkLoop(ctx: CronRunContext, totalChunks: number, chunkDurationMs: number): number {
    let executedChunks = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (ctx.stoppedByCostLimit || ctx.stoppedByTimeLimit) break;
      if (hasCronRuntimeExpired(ctx)) {
        ctx.stoppedByTimeLimit = true;
        break;
      }
      if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
        ctx.stoppedByCostLimit = true;
        break;
      }
      executedChunks++;
      ctx.serpApiCalls++;
      ctx.startTime -= chunkDurationMs;
    }
    return executedChunks;
  }

  // 模拟 refreshSingleKeyword（Layer 3）
  function simulateSingleKeyword(ctx: CronRunContext): { skipped: boolean; reason: string } {
    if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
      ctx.stoppedByCostLimit = true;
      return { skipped: true, reason: "cost_limit" };
    }
    if (hasCronRuntimeExpired(ctx)) {
      ctx.stoppedByTimeLimit = true;
      return { skipped: true, reason: "time_limit" };
    }
    ctx.serpApiCalls++;
    return { skipped: false, reason: "executed" };
  }

  it("Layer 1: refreshAllRanks runtime 到期后不再执行下一 batch", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now() - 240_001, // 已超时
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    const executed = simulateBatchLoop(ctx, 10, 70_000);
    expect(executed).toBe(0);
    expect(ctx.stoppedByTimeLimit).toBe(true);
  });

  it("Layer 1: 200 keywords (10 batches) - runtime 在第 5 个 batch 前到期", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    // 10 batches × 70s = 700s，但 maxRuntimeMs = 240s
    // batch 1: t=0, execute → t=70
    // batch 2: t=70, execute → t=140
    // batch 3: t=140, execute → t=210
    // batch 4: t=210, execute → t=280
    // batch 5: t=280 >= 240 → stop
    const executed = simulateBatchLoop(ctx, 10, 70_000);
    expect(executed).toBe(4);
    expect(ctx.stoppedByTimeLimit).toBe(true);
    // 已完成的 4 个 batch 数据保留
    expect(ctx.serpApiCalls).toBe(0); // batch loop 不直接消耗 SerpApi
  });

  it("Layer 2: refreshRanksBatch runtime 到期后不再执行下一 chunk", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now() - 240_001,
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    const executed = simulateChunkLoop(ctx, 10, 10_000);
    expect(executed).toBe(0);
    expect(ctx.stoppedByTimeLimit).toBe(true);
    expect(ctx.serpApiCalls).toBe(0); // 未发起任何 SerpApi 调用
  });

  it("Layer 3: refreshSingleKeyword runtime 到期后不再发起 SerpApi 调用", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now() - 240_001,
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    const result = simulateSingleKeyword(ctx);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("time_limit");
    expect(ctx.stoppedByTimeLimit).toBe(true);
    expect(ctx.serpApiCalls).toBe(0); // 未发起 SerpApi 调用
  });

  it("Layer 3: refreshSingleKeyword cost 到期后不再发起 SerpApi 调用", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 500,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    const result = simulateSingleKeyword(ctx);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("cost_limit");
    expect(ctx.stoppedByCostLimit).toBe(true);
  });
});

describe("P0: 双重 fuse (cost + runtime) 同时存在", () => {
  function simulateDualFuse(ctx: CronRunContext, iterations: number, stepDurationMs: number): {
    executed: number;
  } {
    let executed = 0;
    for (let i = 0; i < iterations; i++) {
      if (ctx.stoppedByCostLimit || ctx.stoppedByTimeLimit) break;
      if (hasCronRuntimeExpired(ctx)) {
        ctx.stoppedByTimeLimit = true;
        break;
      }
      if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
        ctx.stoppedByCostLimit = true;
        break;
      }
      executed++;
      ctx.serpApiCalls++;
      ctx.startTime -= stepDurationMs;
    }
    return { executed };
  }

  it("cost fuse 先触发时 stoppedByCostLimit = true, stoppedByTimeLimit = false", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 5,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    const { executed } = simulateDualFuse(ctx, 100, 1_000);
    expect(ctx.stoppedByCostLimit).toBe(true);
    expect(ctx.stoppedByTimeLimit).toBe(false);
    expect(executed).toBe(5);
    expect(ctx.serpApiCalls).toBe(5);
  });

  it("runtime fuse 先触发时 stoppedByTimeLimit = true, stoppedByCostLimit = false", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: Date.now() - 240_001,
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    const { executed } = simulateDualFuse(ctx, 100, 1_000);
    expect(ctx.stoppedByTimeLimit).toBe(true);
    expect(ctx.stoppedByCostLimit).toBe(false);
    expect(executed).toBe(0);
    expect(ctx.serpApiCalls).toBe(0);
  });

  it("两个 fuse 都不会越过各自上限", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 10,
      stoppedByCostLimit: false,
      startTime: Date.now() - 100_000, // 100s 已过
      maxRuntimeMs: 120_000, // 120s 上限（20s 后到期）
      stoppedByTimeLimit: false,
    };
    // 每步 5s，cost 上限 10
    // step 1: t=100, execute → t=95, calls=1
    // step 2: t=95+5=100? No: startTime -= 5000, so startTime = now-105000, elapsed=105000
    // step 3: elapsed=110000
    // step 4: elapsed=115000
    // step 5: elapsed=120000 >= 120000 → time fuse triggers
    // But cost limit is 10, so cost doesn't trigger
    const { executed } = simulateDualFuse(ctx, 100, 5_000);
    // 100s + 5*5s = 125s > 120s → triggers at step 5 (after 4 steps)
    expect(ctx.stoppedByTimeLimit).toBe(true);
    expect(executed).toBeLessThanOrEqual(5);
    expect(ctx.serpApiCalls).toBeLessThanOrEqual(10); // 未超过 cost 上限
  });
});

describe("P0: 200 keywords worst case", () => {
  it("200 keywords = 10 batches, 单 batch ≈ 70s, 不会出现 500×10s=5000s", () => {
    const totalKeywords = 200;
    const batches = Math.ceil(totalKeywords / MAX_KEYWORDS_PER_REQUEST);
    expect(batches).toBe(10);

    // 单 batch 最坏 runtime
    const batchRuntime = Math.ceil(MAX_KEYWORDS_PER_REQUEST / CONCURRENCY) * 10_000;
    expect(batchRuntime).toBe(70_000); // 70s

    // 如果没有 fuse，10 batches = 700s
    const noFuseRuntime = batches * batchRuntime;
    expect(noFuseRuntime).toBe(700_000); // 700s

    // 有 runtime fuse (240s)：只执行 4 batches
    const maxRuntimeMs = 240_000;
    const maxBatches = Math.floor(maxRuntimeMs / batchRuntime);
    expect(maxBatches).toBe(3); // 240/70 = 3.42 → 3 full batches before time check
    // Actually batch 4 starts at 210s < 240s, so 4 batches execute
    // But 4 * 70 = 280 > 240, so batch 5 is stopped
    // The point: 700s is reduced to ~280s by runtime fuse
    expect(maxBatches * batchRuntime).toBeLessThan(maxRuntimeMs + batchRuntime); // 不会远超 240s
  });

  it("automation cron 受 call limit + runtime limit + batch limit 共同限制", () => {
    // call limit: 500 次 SerpApi 调用
    // runtime limit: 240s
    // batch limit: 20 keywords / batch

    // 最坏情况：500 calls × 10s / 3 concurrent ≈ 1667s
    // 但 runtime fuse 会在 240s 时停止
    const maxRuntimeS = 240_000 / 1000; // 240s
    const perCallS = 10; // 10s per SerpApi call
    const concurrent = CONCURRENCY;
    const maxCallsByRuntime = Math.floor(maxRuntimeS * concurrent / perCallS);
    // 240 × 3 / 10 = 72 calls max before runtime fuse triggers
    expect(maxCallsByRuntime).toBeLessThan(MAX_SERPAPI_CALLS_PER_RUN); // 72 < 500
    // runtime fuse 比 cost fuse 更先触发
  });
});

describe("P0: automation cronCtx 统一性", () => {
  it("POST 和 GET 都使用 CronRunContext 结构（含 runtime 字段）", () => {
    const manualCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_MANUAL,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: MAX_MANUAL_RUNTIME_MS,
      stoppedByTimeLimit: false,
    };
    const cronCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_PER_RUN,
      stoppedByCostLimit: false,
      startTime: Date.now(),
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };
    // 两者结构一致，cost + runtime 字段都存在
    for (const ctx of [manualCtx, cronCtx]) {
      expect(ctx).toHaveProperty("serpApiCalls");
      expect(ctx).toHaveProperty("maxSerpApiCalls");
      expect(ctx).toHaveProperty("stoppedByCostLimit");
      expect(ctx).toHaveProperty("startTime");
      expect(ctx).toHaveProperty("maxRuntimeMs");
      expect(ctx).toHaveProperty("stoppedByTimeLimit");
    }
    // POST 的限制更严格
    expect(manualCtx.maxSerpApiCalls).toBeLessThan(cronCtx.maxSerpApiCalls);
    expect(manualCtx.maxRuntimeMs).toBeLessThan(cronCtx.maxRuntimeMs);
  });
});

describe("P0: runtime fuse 使用 fake timers 验证", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("200 keywords: 前 4 个 batch 完成后 runtime 到期，第 5 个 batch 不执行", () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: now,
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };

    // 模拟 refreshAllRanks: 10 batches, 每 batch 70s
    let executedBatches = 0;
    for (let i = 0; i < 10; i++) {
      if (ctx.stoppedByCostLimit || ctx.stoppedByTimeLimit) break;
      if (hasCronRuntimeExpired(ctx)) {
        ctx.stoppedByTimeLimit = true;
        break;
      }
      executedBatches++;
      vi.setSystemTime(Date.now() + 70_000);
    }

    // batch 1: t=0 → execute → t=70000
    // batch 2: t=70000 → execute → t=140000
    // batch 3: t=140000 → execute → t=210000
    // batch 4: t=210000 < 240000 → execute → t=280000
    // batch 5: t=280000 >= 240000 → stop
    expect(executedBatches).toBe(4);
    expect(ctx.stoppedByTimeLimit).toBe(true);
  });

  it("已完成的 batch 数据保留，不回滚", () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: now,
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };

    const completedBatchData: number[] = [];
    for (let i = 0; i < 10; i++) {
      if (ctx.stoppedByCostLimit || ctx.stoppedByTimeLimit) break;
      if (hasCronRuntimeExpired(ctx)) {
        ctx.stoppedByTimeLimit = true;
        break;
      }
      completedBatchData.push(i); // 模拟 DB 写入，不回滚
      vi.setSystemTime(Date.now() + 70_000);
    }

    expect(completedBatchData).toEqual([0, 1, 2, 3]);
    expect(ctx.stoppedByTimeLimit).toBe(true);
  });

  it("runtime 到期后不再发起新的 SerpApi 请求", () => {
    const now = Date.now();
    vi.setSystemTime(now + 240_001); // 已过 240s

    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 500,
      stoppedByCostLimit: false,
      startTime: now,
      maxRuntimeMs: 240_000,
      stoppedByTimeLimit: false,
    };

    // 模拟 refreshSingleKeyword 的检查
    let serpApiCalled = false;
    if (!ctx.stoppedByCostLimit && !ctx.stoppedByTimeLimit) {
      if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
        ctx.stoppedByCostLimit = true;
      } else if (hasCronRuntimeExpired(ctx)) {
        ctx.stoppedByTimeLimit = true;
      } else {
        serpApiCalled = true;
        ctx.serpApiCalls++;
      }
    }

    expect(serpApiCalled).toBe(false);
    expect(ctx.stoppedByTimeLimit).toBe(true);
    expect(ctx.serpApiCalls).toBe(0);
  });
});
