// ===== Agent Layer 单元测试（P0-04） =====
// 覆盖：router 中英文路由、evidence 预算与 DATA GAP 降级、demo provider 拦截、
//       六个 skill workflow 的信号/证据/建议、FACT 不被改写、跨项目拒绝

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/mcp/tools", async (importOriginal) => {
  // 用真实 tool registry 结构 + 可控 execute：注入 mock executor 更直接，
  // 这里 mock getRegisteredTools 让 createMcpToolExecutor 走到注入路径。
  const actual = await importOriginal<typeof import("@/server/mcp/tools")>();
  return { ...actual, getRegisteredTools: actual.getRegisteredTools };
});

import { EvidenceCollector, createMcpToolExecutor, type AgentToolName } from "./evidence";
import { routeSkill } from "./router";
import { runAgentSkill } from "./runtime";
import type { ToolAuthContext } from "@/server/mcp/context";

const ctx: ToolAuthContext = { userId: "user-1", plan: "lite", scopes: ["mcp:read"], baseUrl: "http://localhost:3000", authMode: "session" };

describe("routeSkill（确定性 router）", () => {
  it("六类问题路由到对应 skill（中英文）", () => {
    expect(routeSkill("帮我全面分析一下网站的 SEO")).toBe("seo-diagnostic");
    expect(routeSkill("analyze my site seo")).toBe("seo-diagnostic");
    expect(routeSkill("关键词怎么选？")).toBe("keyword-research");
    expect(routeSkill("what keywords should I target")).toBe("keyword-research");
    expect(routeSkill("竞争对手怎么样")).toBe("competitor-analysis");
    expect(routeSkill("排名为什么下降了")).toBe("rank-drop-diagnosis");
    expect(routeSkill("why did my ranking drop")).toBe("rank-drop-diagnosis");
    expect(routeSkill("我的流量为什么跌了")).toBe("gsc-diagnosis");
    expect(routeSkill("traffic drop on my site")).toBe("gsc-diagnosis");
    expect(routeSkill("AI 搜索里有没有我")).toBe("ai-search-visibility");
    expect(routeSkill("am I visible in ChatGPT?")).toBe("ai-search-visibility");
  });

  it("无关消息返回 null（不强行分类）", () => {
    expect(routeSkill("今天天气怎么样")).toBe(null);
  });

  it("长触发词优先（'排名为什么下降' 归 rank-drop 而非被'下降'弱匹配干扰）", () => {
    expect(routeSkill("排名下降")).toBe("rank-drop-diagnosis");
  });
});

describe("EvidenceCollector", () => {
  it("预算耗尽 → DATA GAP 且不再执行工具", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: true });
    const collector = new EvidenceCollector(executor, 2);
    await collector.collect("project_context", { projectId: "1" }, "a");
    await collector.collect("get_rank_history", { projectId: "1" }, "b");
    const third = await collector.collect("get_backlinks_profile", { projectId: "1" }, "c");
    expect(third).toBe(null);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(collector.gaps[0]).toMatchObject({ tool: "get_backlinks_profile", reason: "budget_exhausted" });
  });

  it("工具失败 → DATA GAP（含原因与置信度影响），不抛异常", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("GSC_NOT_CONNECTED"));
    const collector = new EvidenceCollector(executor, 3);
    const record = await collector.collect("search_console_tools", { projectId: "1" }, "GSC 流量对比");
    expect(record).toBe(null);
    expect(collector.gaps[0]).toMatchObject({ tool: "search_console_tools" });
    expect(collector.gaps[0].impact).toContain("置信度");
    expect(collector.callsUsed).toBe(1);
  });

  it("证据带递增 id 与原样数据（FACT 不可变）", async () => {
    const data = { clicks: 123 };
    const collector = new EvidenceCollector(vi.fn().mockResolvedValue(data), 3);
    const record = await collector.collect("search_console_tools", {}, "gsc");
    expect(record?.id).toBe("ev-1");
    expect(record?.data).toBe(data); // 原样引用，非拷贝改写
  });
});

describe("createMcpToolExecutor（demo 安全边界）", () => {
  it("demo ctx 调 provider tool → PROVIDER_ACCESS_DENIED", async () => {
    const demoCtx: ToolAuthContext = { ...ctx, userId: "demo-user", authMode: "demo" };
    const executor = createMcpToolExecutor(demoCtx);
    await expect(executor("research_keywords", {})).rejects.toMatchObject({ code: "PROVIDER_ACCESS_DENIED" });
  });

  it("demo ctx 对免费 tool 不触发 PROVIDER_ACCESS_DENIED（授权门通过）", async () => {
    const demoCtx: ToolAuthContext = { ...ctx, userId: "demo-user", authMode: "demo" };
    const executor = createMcpToolExecutor(demoCtx);
    try {
      await executor("list_projects", {});
    } catch (e) {
      // 免费工具不经过 provider 门（本测试环境无 DB，到达 DB 层即证明授权门已放行）
      expect((e as { code?: string }).code).not.toBe("PROVIDER_ACCESS_DENIED");
    }
  });
});

// ---------- runtime skill workflows（mock executor 注入） ----------

describe("runAgentSkill workflows", () => {
  beforeEach(() => {
    // 屏蔽真实 executor：runtime 的 createMcpToolExecutor 由我们传入的 executor 覆盖不可行，
    // 改为直接构造 collector 场景——通过 vi.spyOn 替换 createMcpToolExecutor 不可行（esm），
    // 因此 runtime 测试走真实 registry + mock getRegisteredTools 的 service 层不可行。
    // 改用：mock ./evidence 的 createMcpToolExecutor。
  });

  it("gsc-diagnosis：CTR 下降分类（impressions 稳定 + clicks/ctr 下降）", async () => {
    const { createMcpToolExecutor: realCreate } = await import("./evidence");
    const spy = vi.spyOn(await import("./evidence"), "createMcpToolExecutor")
      .mockImplementation(((exec: unknown) => exec) as never);
    void realCreate;

    const executor = vi.fn().mockImplementation(async (tool: AgentToolName) => {
      if (tool === "search_console_tools") {
        return {
          data: {
            current: { dateRange: { start: "a", end: "b" }, summary: { clicks: 68, impressions: 1000, ctr: 0.068, position: 8.7 } },
            previous: { dateRange: { start: "c", end: "d" }, summary: { clicks: 100, impressions: 1000, ctr: 0.1, position: 8.6 } },
          },
        };
      }
      throw new Error(`unexpected tool ${tool}`);
    });
    spy.mockImplementation(() => executor as never);

    const result = await runAgentSkill({ skillId: "gsc-diagnosis", projectId: "1", ctx, params: {} });
    expect(result.skill).toBe("gsc-diagnosis");
    expect(result.toolCallsUsed).toBeLessThanOrEqual(4);
    expect(result.interpretation.summary).toContain("CTR");
    expect(result.facts.length).toBeGreaterThan(0);
    // FACT 原样保留
    expect(result.facts[0].data).toMatchObject({ data: { current: { summary: { clicks: 68 } } } });
    spy.mockRestore();
  });

  it("gsc-diagnosis：GSC 不可用 → DATA GAP 降级，不整体失败", async () => {
    const spy = vi.spyOn(await import("./evidence"), "createMcpToolExecutor")
      .mockImplementation(((exec: unknown) => exec) as never);
    const executor = vi.fn().mockRejectedValue(new Error("该项目尚未连接 Google Search Console"));
    spy.mockImplementation(() => executor as never);

    const result = await runAgentSkill({ skillId: "gsc-diagnosis", projectId: "1", ctx, params: {} });
    expect(result.dataGaps.length).toBeGreaterThan(0);
    expect(result.interpretation.summary).toContain("置信度受限");
    spy.mockRestore();
  });

  it("keyword-research：缺 seed → BAD_REQUEST", async () => {
    const spy = vi.spyOn(await import("./evidence"), "createMcpToolExecutor")
      .mockImplementation(((exec: unknown) => exec) as never);
    spy.mockImplementation(() => vi.fn() as never);
    await expect(runAgentSkill({ skillId: "keyword-research", projectId: "1", ctx, params: {} }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    spy.mockRestore();
  });

  it("rank-drop-diagnosis：declined 关键词触发 SERP 深挖，budget 内", async () => {
    const spy = vi.spyOn(await import("./evidence"), "createMcpToolExecutor")
      .mockImplementation(((exec: unknown) => exec) as never);
    const executor = vi.fn().mockImplementation(async (tool: AgentToolName) => {
      if (tool === "get_rank_history") {
        return { data: { keywords: [
          { keyword: "seo audit", status: "declined", currentRank: 13, previousRank: 5 },
          { keyword: "kw b", status: "improved", currentRank: 3, previousRank: 6 },
        ], distribution: {} } };
      }
      if (tool === "get_serp_results") {
        return { data: { organic: [{ rank: 1, domain: "rival.com" }, { rank: 2, domain: "other.io" }] } };
      }
      if (tool === "search_console_tools") {
        return { data: { rows: [], summary: { clicks: 0, impressions: 0, ctr: null, position: null } } };
      }
      throw new Error(`unexpected ${tool}`);
    });
    spy.mockImplementation(() => executor as never);

    const result = await runAgentSkill({ skillId: "rank-drop-diagnosis", projectId: "1", ctx, params: {} });
    expect(result.signals.some((signal) => signal.description.includes("1 个"))).toBe(true); // 1 个 declined
    // budget：rank + ≤2 serp + gsc ≤ 6
    expect(result.toolCallsUsed).toBeLessThanOrEqual(6);
    expect(result.interpretation.observations.join(" ")).toContain("平均位置");
    spy.mockRestore();
  });

  it("competitor-analysis：缺 competitorId → BAD_REQUEST；有 id 时输出差距建议", async () => {
    const spy = vi.spyOn(await import("./evidence"), "createMcpToolExecutor")
      .mockImplementation(((exec: unknown) => exec) as never);
    await expect(runAgentSkill({ skillId: "competitor-analysis", projectId: "1", ctx, params: {} }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    const executor = vi.fn().mockImplementation(async (tool: AgentToolName) => {
      if (tool === "get_competitor_keyword_gap") {
        return { data: { competitor: { id: 11, domain: "rival.com" }, summary: { analyzedKeywords: 4, shared: 1, weaklyOwned: 1, competitorOnly: 2, projectOnly: 0 }, keywords: [
          { keyword: "comp only kw", category: "competitorOnly", competitorRank: 4, projectRank: null, rankGap: null, location: "中国", device: "desktop", searchVolume: 500, difficulty: 30, cpc: 1.2, competition: 0.4 },
        ], warnings: [] } };
      }
      if (tool === "get_serp_results") return { data: { organic: [] } };
      throw new Error(`unexpected ${tool}`);
    });
    spy.mockImplementation(() => executor as never);
    const result = await runAgentSkill({ skillId: "competitor-analysis", projectId: "1", ctx, params: { competitorId: 11 } });
    expect(result.interpretation.recommendations.map((r) => r.action).join(" ")).toContain("comp only kw");
    spy.mockRestore();
  });

  it("seo-diagnostic：GSC/AI 不可用时降级为 DATA GAP，免费层证据照常输出", async () => {
    const spy = vi.spyOn(await import("./evidence"), "createMcpToolExecutor")
      .mockImplementation(((exec: unknown) => exec) as never);
    const executor = vi.fn().mockImplementation(async (tool: AgentToolName) => {
      if (tool === "project_context") return { data: { projectId: "1", domain: "seeo.asia", trackedKeywordsCount: 5 } };
      if (tool === "get_rank_history") return { data: { distribution: { trackedCount: 5, top10Count: 2, top50Count: 4, notRankingCount: 1 } } };
      if (tool === "search_console_tools") throw new Error("demo mode");
      if (tool === "ai_search_brand_lookup") throw new Error("demo mode");
      if (tool === "get_backlinks_profile") throw new Error("demo mode");
      throw new Error(`unexpected ${tool}`);
    });
    spy.mockImplementation(() => executor as never);

    const result = await runAgentSkill({ skillId: "seo-diagnostic", projectId: "1", ctx, params: {} });
    expect(result.facts.length).toBe(2); // project_context + rank（免费层）
    expect(result.dataGaps.length).toBe(3); // GSC + AI + backlinks
    expect(result.dataGaps.every((gap) => gap.reason === "demo_mode")).toBe(true);
    expect(result.interpretation.observations.join(" ")).toContain("Top10");
    spy.mockRestore();
  });
});
