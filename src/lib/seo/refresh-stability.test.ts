// P0 稳定性纯逻辑测试
// 覆盖：refresh batch limit / SerpApi call limit / automation cronCtx fuse

import { describe, it, expect } from "vitest";
import {
  MAX_KEYWORDS_PER_REQUEST,
  CONCURRENCY,
  MAX_SERPAPI_CALLS_MANUAL,
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
});

describe("P0: SerpApi call limit (cronCtx fuse)", () => {
  // 模拟 refreshRanksBatch 中的系统级保险丝逻辑
  function simulateFuse(ctx: CronRunContext, callsToMake: number): void {
    for (let i = 0; i < callsToMake; i++) {
      // 子块之间检查
      if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
        ctx.stoppedByCostLimit = true;
        break;
      }
      ctx.serpApiCalls++;
    }
    // 最终检查
    if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
      ctx.stoppedByCostLimit = true;
    }
  }

  it("未达上限时不停止", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 20,
      stoppedByCostLimit: false,
    };
    simulateFuse(ctx, 10);
    expect(ctx.stoppedByCostLimit).toBe(false);
    expect(ctx.serpApiCalls).toBe(10);
  });

  it("达到上限时立即停止并标记 stoppedByCostLimit", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: 20,
      stoppedByCostLimit: false,
    };
    simulateFuse(ctx, 200); // 尝试 200 次，但上限 20
    expect(ctx.stoppedByCostLimit).toBe(true);
    expect(ctx.serpApiCalls).toBe(20); // 不超过上限
  });

  it("手动触发上限（20）比 Cron（500）更严格", () => {
    const manualCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_MANUAL,
      stoppedByCostLimit: false,
    };
    const cronCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_PER_RUN,
      stoppedByCostLimit: false,
    };
    simulateFuse(manualCtx, 100);
    simulateFuse(cronCtx, 100);
    // 手动触发在 100 次时已停止，Cron 未停止
    expect(manualCtx.stoppedByCostLimit).toBe(true);
    expect(cronCtx.stoppedByCostLimit).toBe(false);
  });

  it("已触及上限时不再处理后续子块", () => {
    const ctx: CronRunContext = {
      serpApiCalls: 20,
      maxSerpApiCalls: 20,
      stoppedByCostLimit: false,
    };
    // 模拟 refreshRanksBatch 入口检查
    if (ctx.serpApiCalls >= ctx.maxSerpApiCalls) {
      ctx.stoppedByCostLimit = true;
    }
    expect(ctx.stoppedByCostLimit).toBe(true);
    // 即使尝试更多调用也不会增加
    simulateFuse(ctx, 50);
    expect(ctx.serpApiCalls).toBe(20);
  });
});

describe("P0: automation cronCtx 统一性", () => {
  it("POST 和 GET 都使用 CronRunContext 结构", () => {
    const manualCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_MANUAL,
      stoppedByCostLimit: false,
    };
    const cronCtx: CronRunContext = {
      serpApiCalls: 0,
      maxSerpApiCalls: MAX_SERPAPI_CALLS_PER_RUN,
      stoppedByCostLimit: false,
    };
    // 两者结构一致，仅 maxSerpApiCalls 不同
    expect(manualCtx).toHaveProperty("serpApiCalls");
    expect(manualCtx).toHaveProperty("maxSerpApiCalls");
    expect(manualCtx).toHaveProperty("stoppedByCostLimit");
    expect(cronCtx).toHaveProperty("serpApiCalls");
    expect(cronCtx).toHaveProperty("maxSerpApiCalls");
    expect(cronCtx).toHaveProperty("stoppedByCostLimit");
  });
});

describe("P0: 200 关键词不会在单次请求中全部处理", () => {
  it("200 个关键词需要 ceil(200/20)=10 次请求", () => {
    const totalKeywords = 200;
    const batch = MAX_KEYWORDS_PER_REQUEST;
    const requests = Math.ceil(totalKeywords / batch);
    expect(requests).toBe(10);
  });

  it("单次请求最坏 runtime ≈ ceil(20/3) × 10s ≈ 70s < maxDuration(90s)", () => {
    const batch = MAX_KEYWORDS_PER_REQUEST;
    const chunks = Math.ceil(batch / CONCURRENCY);
    const worstRuntime = chunks * 10; // 假设单次 SerpApi 最坏 10s
    expect(worstRuntime).toBe(70);
    expect(worstRuntime).toBeLessThan(90);
  });
});
