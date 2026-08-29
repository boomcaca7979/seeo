// ===== Execution Adapter 抽象（P2） =====
// Opportunity/Action 层通过 adapter 执行，不直接知道 GitHub/CMS/HTTP provider。
// 当前 SeeO 审计确认：无任何真实网站写入集成（A Real = 无），因此注册表只有：
//   - ManualExecutionAdapter：preview = 结构化手动执行包（不伪造 diff）；execute = 用户确认手动完成后记录
// 未来接入 GitHub/CMS 时：实现 ExecutionAdapter 并注册，Opportunity/Action 层零改动。

export interface ActionForExecution {
  actionId: number;
  opportunityId: number;
  projectId: number;
  actionType: string;
  targetValue: string;
  steps: string[];
  evidence: Array<{ source: string; ref: string; summary: string }>;
}

export interface ExecutionPreview {
  /** manual adapter 无真实旧内容，绝不伪造 diff——只有结构化指令包 */
  kind: "manual_instruction_package";
  target: string;
  currentState: string[];
  exactSteps: string[];
  expectedResult: string;
  verificationPlan: string[];
  rollbackNotes: string;
}

export interface ExecutionResult {
  status: "completed" | "failed";
  detail: string;
}

export interface ExecutionAdapter {
  mode: string;
  capabilities: string[];
  preview(action: ActionForExecution): ExecutionPreview;
  execute(action: ActionForExecution & { approvedBy: string }): Promise<ExecutionResult>;
}

/** 手动执行适配器：确认型 execute（用户手动完成后在 UI 确认），预览不伪造旧内容 */
export const ManualExecutionAdapter: ExecutionAdapter = {
  mode: "manual",
  capabilities: ["preview", "manual_execute", "verify"],
  preview(action) {
    const expectedByType: Record<string, string> = {
      content_update: "目标页面对目标关键词的排名与内容覆盖度提升",
      meta_update: "目标查询的 CTR 提升（GSC 数据滞后 2-3 天）",
      refresh_page: "目标页面排名止跌回升",
      create_content: "新页面进入目标关键词前 100 并逐步上升",
      technical_fix: "目标 URL 审计 error 清零",
      internal_link: "目标页面获得的内链入口增加",
    };
    return {
      kind: "manual_instruction_package",
      target: action.targetValue,
      currentState: action.evidence.map((item) => `[${item.source}] ${item.summary}`),
      exactSteps: action.steps,
      expectedResult: expectedByType[action.actionType] ?? "目标关键词/页面的 SEO 表现改善",
      verificationPlan: [
        "rank：SeeO 立即复检该关键词 Top-100 位置",
        "gsc：等待 2-3 天数据滞后后对比点击/曝光",
        "ai_search：重新运行 brand lookup 后对比 mentions/SOV",
      ],
      rollbackNotes: "manual——手动修改的内容请自行保留原稿备份；SeeO 不代写不回滚",
    };
  },
  async execute() {
    // manual adapter 的 execute = 记录用户对"已手动完成"的确认（由 service 层传入已验证的状态）
    return { status: "completed" as const, detail: "已记录为手动执行完成" };
  },
};

const ADAPTERS: Record<string, ExecutionAdapter> = {
  manual: ManualExecutionAdapter,
};

export function getExecutionAdapter(mode: string): ExecutionAdapter | null {
  return ADAPTERS[mode] ?? null;
}

/** 当前真实可用的执行模式清单（供 API/UI 展示，不虚构） */
export function listExecutionModes(): Array<{ mode: string; capabilities: string[] }> {
  return Object.values(ADAPTERS).map((adapter) => ({ mode: adapter.mode, capabilities: adapter.capabilities }));
}
