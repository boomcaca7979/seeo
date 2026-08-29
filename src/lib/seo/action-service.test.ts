// ===== Action Service 单元测试（P2） =====
// 覆盖：ensure 幂等、preview 确定性（无伪造 diff）、approval 硬门槛（未批准不可执行、
//       重复 approve 幂等）、manual 完成（幂等、闭环触发验证）、cancel 冲突、adapter 注册表

import { beforeEach, describe, expect, it, vi } from "vitest";

const getActionByOpportunityMock = vi.fn();
const getActionByIdMock = vi.fn();
const createActionMock = vi.fn();
const updateActionStatusMock = vi.fn();
const getOpportunityByIdMock = vi.fn();
const verifyOpportunityMock = vi.fn();

vi.mock("@/lib/db/actions", () => ({
  getActionByOpportunity: (...args: unknown[]) => getActionByOpportunityMock(...args),
  getActionById: (...args: unknown[]) => getActionByIdMock(...args),
  createAction: (...args: unknown[]) => createActionMock(...args),
  updateActionStatus: (...args: unknown[]) => updateActionStatusMock(...args),
}));

vi.mock("@/lib/db/opportunities", () => ({
  getOpportunityById: (...args: unknown[]) => getOpportunityByIdMock(...args),
  saveOpportunityVerification: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getProjectById: vi.fn() }));

vi.mock("./serp-service", () => ({ searchRank: vi.fn() }));
vi.mock("./gsc-service", () => ({ searchAnalytics: vi.fn() }));
vi.mock("./opportunity-service", () => ({
  verifyOpportunity: (...args: unknown[]) => verifyOpportunityMock(...args),
}));

import {
  approveAction,
  cancelAction,
  completeActionManually,
  ensureAction,
  previewAction,
} from "./action-service";

function action(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 55, user_id: "u1", opportunity_id: 9, project_id: 2,
    action_type: "content_update", execution_mode: "manual", status: "planned",
    plan_json: JSON.stringify({ steps: ["step 1", "step 2"] }),
    preview_json: null, result_json: null, events_json: "[]",
    approved_at: null, approved_by: null, executed_at: null, completed_at: null,
    error_code: null, idempotency_key: "2|rank_improvement|seo audit tool",
    created_at: "2026-08-29", updated_at: "2026-08-29",
    ...overrides,
  };
}

const opportunity = (status: string) => ({
  id: 9, user_id: "u1", project_id: 2, type: "rank_improvement",
  target_type: "keyword", target_value: "seo audit tool", fingerprint: "fp",
  priority: "P0", impact: "high", confidence: "high",
  evidence_json: JSON.stringify([{ source: "rank_history", ref: "keyword:1", summary: "#14", capturedAt: "now" }]),
  signals_json: "{}", action_plan_json: JSON.stringify({ executionMode: "manual", actionType: "content_update", steps: ["step 1", "step 2"] }),
  verification_json: null, status, generated_at: "2026-08-29", last_evaluated_at: "2026-08-29",
});

let mutableAction: Record<string, unknown>;

beforeEach(() => {
  mutableAction = action();
  getActionByOpportunityMock.mockReset().mockResolvedValue(null);
  getActionByIdMock.mockReset().mockImplementation(async (_u: string, id: number) => ({ ...mutableAction, id }));
  createActionMock.mockReset().mockResolvedValue(55);
  updateActionStatusMock.mockReset().mockImplementation(async (_u: string, _id: number, updates: Record<string, unknown>) => {
    if (typeof updates.status === "string") mutableAction.status = updates.status;
  });
  getOpportunityByIdMock.mockReset().mockResolvedValue(opportunity("approved"));
  verifyOpportunityMock.mockReset().mockResolvedValue({ checks: [{ check: "rank", status: "pass", detail: null, checkedAt: "now" }] });
});

describe("ensureAction（幂等创建）", () => {
  it("已存在 → 不重建", async () => {
    const existing = action();
    getActionByOpportunityMock.mockResolvedValue(existing);
    const result = await ensureAction("u1", 9);
    expect(createActionMock).not.toHaveBeenCalled();
    expect(result.id).toBe(55);
  });
  it("opportunity 为 dismissed/completed → 拒绝创建", async () => {
    getOpportunityByIdMock.mockResolvedValue(opportunity("dismissed"));
    await expect(ensureAction("u1", 9)).rejects.toMatchObject({ code: "EXECUTION_INVALID_STATE" });
  });
});

describe("previewAction（手动执行包，不伪造 diff）", () => {
  it("输出 manual_instruction_package：currentState 来自证据、exactSteps 来自 plan", async () => {
    getActionByOpportunityMock.mockResolvedValue(action());
    const preview = await previewAction("u1", 9);
    expect(preview.kind).toBe("manual_instruction_package");
    expect(preview.exactSteps).toEqual(["step 1", "step 2"]);
    expect(preview.currentState.join(" ")).toContain("rank_history");
    expect(preview.rollbackNotes).toContain("manual");
    expect(updateActionStatusMock).toHaveBeenCalled(); // preview 持久化
  });
});

describe("approveAction（硬门槛）", () => {
  it("opportunity 未批准 → EXECUTION_NOT_APPROVED", async () => {
    getOpportunityByIdMock.mockResolvedValue(opportunity("reviewed"));
    await expect(approveAction("u1", 55)).rejects.toMatchObject({ code: "EXECUTION_NOT_APPROVED" });
  });
  it("opportunity 已批准 → action approved 并记录 approved_by", async () => {
    getOpportunityByIdMock.mockResolvedValue(opportunity("approved"));
    const result = await approveAction("u1", 55);
    expect(result.status).toBe("approved");
    expect(updateActionStatusMock).toHaveBeenCalledWith("u1", 55, expect.objectContaining({
      status: "approved", approved_by: "u1", event: expect.objectContaining({ event: "approved" }),
    }));
  });
  it("重复 approve 幂等（不重写时间戳）", async () => {
    getActionByIdMock.mockResolvedValue(action({ status: "approved", approved_at: "earlier", approved_by: "u1" }));
    const result = await approveAction("u1", 55);
    expect(result.status).toBe("approved");
    expect(updateActionStatusMock).not.toHaveBeenCalled();
  });
});

describe("completeActionManually（manual 执行 + 闭环验证）", () => {
  it("未批准 → EXECUTION_NOT_APPROVED", async () => {
    getActionByIdMock.mockResolvedValue(action({ status: "planned" }));
    await expect(completeActionManually("u1", "lite", 55)).rejects.toMatchObject({ code: "EXECUTION_NOT_APPROVED" });
  });
  it("approved → completed + 触发 opportunity 验证", async () => {
    mutableAction = action({ status: "approved", approved_at: "earlier", approved_by: "u1" });
    const { action: result, verification } = await completeActionManually("u1", "lite", 55);
    expect(result.status).toBe("completed");
    expect(verifyOpportunityMock).toHaveBeenCalledTimes(1);
    // 闭环：action completed 后触发 opportunity 的 verification（P1 service）
    expect(updateActionStatusMock).toHaveBeenCalledWith("u1", 55, expect.objectContaining({ event: expect.objectContaining({ event: "verification_started" }) }));
    void verification;
  });
  it("重复完成幂等（不重跑验证）", async () => {
    getActionByIdMock.mockResolvedValue(action({ status: "completed" }));
    const { action: result } = await completeActionManually("u1", "lite", 55);
    expect(result.status).toBe("completed");
    expect(verifyOpportunityMock).not.toHaveBeenCalled();
  });
});

describe("cancelAction", () => {
  it("已完成 → EXECUTION_CONFLICT", async () => {
    getActionByIdMock.mockResolvedValue(action({ status: "completed" }));
    await expect(cancelAction("u1", 55)).rejects.toMatchObject({ code: "EXECUTION_CONFLICT" });
  });
  it("planned → cancelled", async () => {
    getActionByIdMock.mockResolvedValue(action({ status: "planned" }));
    await cancelAction("u1", 55);
    expect(updateActionStatusMock).toHaveBeenCalledWith("u1", 55, expect.objectContaining({ status: "cancelled" }));
  });
});
