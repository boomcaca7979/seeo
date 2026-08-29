// ===== Evidence Collector（P0-04） =====
// Agent 的「眼睛」：经 MCP tool registry 执行工具调用，收集结构化证据。
// 硬规则：
// - 有界执行：超过 skill 预算的调用直接拒绝并记 DATA GAP（禁止无限探索）
// - 失败降级：单工具失败 → DATA GAP（记录原因与影响），不中断整个 skill
// - FACT 不可变：工具返回的结构化数据原样进入证据，LLM 只能解释、不能改写
// - 来源标注：每条证据带 tool 名与时间戳，recommendation 可引用 evidenceId

import type { ToolAuthContext } from "@/server/mcp/context";
import { requireProviderAccess } from "@/server/mcp/context";
import { getRegisteredTools } from "@/server/mcp/tools";

export interface EvidenceRecord {
  id: string; // ev-1, ev-2, ...
  tool: string;
  /** 人类可读的证据摘要（由调用点写入，如 "GSC compare_periods clicks -32%"） */
  label: string;
  /** 工具结构化输出（FACT，原样保留，不改写） */
  data: unknown;
  status: "ok";
  capturedAt: string;
}

export interface DataGap {
  tool: string;
  reason: string;
  /** 该缺口对诊断置信度的影响说明 */
  impact: string;
}

export interface Signal {
  description: string;
  evidenceIds: string[];
}

/** 消耗 provider 配额的工具集合（与 server.ts 的 providerBackedTools + 新工具同步） */
const PROVIDER_TOOLS = new Set([
  "research_keywords",
  "get_serp_results",
  "get_backlinks_profile",
  "search_console_tools",
  "ai_search_brand_lookup",
  "get_competitor_keyword_gap",
]);

export type AgentToolName = "list_projects" | "project_context" | "research_keywords" | "get_serp_results" | "get_backlinks_profile" | "search_console_tools" | "get_rank_history" | "ai_search_brand_lookup" | "get_competitor_keyword_gap" | "get_seo_opportunities";
export type ToolExecutor = (tool: AgentToolName, input: unknown) => Promise<unknown>;

/** 真实执行器：经注册表调用 MCP tool（授权 = 与外部 MCP client 相同路径） */
export function createMcpToolExecutor(ctx: ToolAuthContext): ToolExecutor {
  const tools = new Map(getRegisteredTools().map((tool) => [tool.name as AgentToolName, tool]));
  return async (toolName: AgentToolName, input: unknown) => {
    const tool = tools.get(toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    if (PROVIDER_TOOLS.has(toolName)) {
      // demo 模式禁止产生 provider 成本（与 /api/mcp 完全一致的安全边界）
      requireProviderAccess(ctx);
    }
    return tool.execute(ctx, input);
  };
}

export class EvidenceCollector {
  readonly records: EvidenceRecord[] = [];
  readonly gaps: DataGap[] = [];
  readonly signals: Signal[] = [];
  readonly warnings: string[] = [];
  private seq = 0;

  constructor(
    private readonly executor: ToolExecutor,
    readonly maxToolCalls: number
  ) {}

  get callsUsed(): number {
    return this.records.length + this.gaps.filter((gap) => gap.reason.startsWith("调用失败")).length;
  }

  /**
   * 执行一次工具调用并记录证据。
   * 超预算 / demo 拦截 / provider 失败 → 记 DATA GAP 并返回 null（skill 自行降级）。
   */
  async collect(tool: AgentToolName, input: Record<string, unknown>, label: string): Promise<EvidenceRecord | null> {
    if (this.records.length >= this.maxToolCalls) {
      this.gaps.push({ tool: String(tool), reason: "budget_exhausted", impact: `已达到本 skill 的工具调用上限（${this.maxToolCalls}），跳过 ${tool}` });
      return null;
    }
    try {
      const data = await this.executor(tool, input);
      this.seq += 1;
      const record: EvidenceRecord = {
        id: `ev-${this.seq}`,
        tool,
        label,
        data,
        status: "ok",
        capturedAt: new Date().toISOString(),
      };
      this.records.push(record);
      return record;
    } catch (e) {
      const message = (e as Error).message;
      const isDemoBlock = message.includes("demo mode");
      this.gaps.push({
        tool: String(tool),
        reason: isDemoBlock ? "demo_mode" : `调用失败：${message}`,
        impact: isDemoBlock
          ? "演示模式不可产生 provider 成本；相关诊断置信度受限"
          : `${label}不可用，相关诊断置信度降低`,
      });
      return null;
    }
  }

  addSignal(description: string, evidenceIds: Array<string | null>): void {
    const ids = evidenceIds.filter((id): id is string => Boolean(id));
    this.signals.push({ description, evidenceIds: ids });
  }

  warn(message: string): void {
    this.warnings.push(message);
  }
}
