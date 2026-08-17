// ===== DELETE /api/projects 测试（鉴权模式，lightweight mocks）=====
// 验证：
//   - DELETE /api/projects?id=<UUID> 成功 → 200
//   - DELETE /api/projects?id=0 → 404（修复前生产必现路径）
//   - 不属于当前用户的项目 → 404，不触发删除
//   - 查询/删除均带显式 user_id 条件（Server Auth + user_id + RLS 三层防线）

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-config", () => ({ isAuthEnabled: true }));

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "lite",
    subscriptionStatus: "active",
    limits: {},
    error: undefined,
  })),
}));

vi.mock("@/lib/db", () => ({
  listProjectsWithMetrics: vi.fn(),
  listProjectsWithMetricsForUser: vi.fn(),
  addProject: vi.fn(),
  removeProject: vi.fn(),
  getProjectByDomain: vi.fn(),
  listProjects: vi.fn(),
}));

// 可控的 Supabase mock：记录链式 eq 条件，用于断言 user_id 防线
const state = {
  project: { domain: "toolstep.xyz" } as { domain: string } | null,
  deleteError: null as string | null,
  selectEqs: [] as Array<[string, unknown]>,
  deleteEqs: [] as Array<[string, unknown]>,
};

vi.mock("@/lib/supabase/server", () => ({
  createServer: vi.fn(async () => {
    const selectChain = {
      eq: vi.fn((col: string, val: unknown) => {
        state.selectEqs.push([col, val]);
        return selectChain;
      }),
      single: vi.fn(async () => ({ data: state.project, error: null })),
    };
    const deleteChain = {
      eq: vi.fn((col: string, val: unknown) => {
        state.deleteEqs.push([col, val]);
        return deleteChain;
      }),
      then: (resolve: (v: { error: string | null }) => void) =>
        Promise.resolve({ error: state.deleteError }).then(resolve),
    };
    return {
      from: vi.fn(() => ({
        select: () => selectChain,
        delete: () => deleteChain,
      })),
    };
  }),
}));

import { removeProject, getProjectByDomain } from "@/lib/db";
import { DELETE } from "./route";

const mockRemoveProject = vi.mocked(removeProject);
const mockGetByDomain = vi.mocked(getProjectByDomain);

const UUID = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";

function makeRequest(id: string): Request {
  return new Request(`https://www.seeo.asia/api/projects?id=${id}`, {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.project = { domain: "toolstep.xyz" };
  state.deleteError = null;
  state.selectEqs = [];
  state.deleteEqs = [];
  mockGetByDomain.mockResolvedValue(null);
});

describe("删除成功路径", () => {
  it("DELETE ?id=<UUID> → 200", async () => {
    const res = await DELETE(makeRequest(UUID));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.ok).toBe(true);
    expect(mockRemoveProject).not.toHaveBeenCalled(); // SQLite 无同名项目时跳过
  });

  it("查询与删除均带显式 id + user_id 条件（三层防线）", async () => {
    await DELETE(makeRequest(UUID));
    expect(state.selectEqs).toContainEqual(["id", UUID]);
    expect(state.selectEqs).toContainEqual(["user_id", "user-1"]);
    expect(state.deleteEqs).toContainEqual(["id", UUID]);
    expect(state.deleteEqs).toContainEqual(["user_id", "user-1"]);
  });
});

describe("404 路径", () => {
  it("DELETE ?id=0 → 404（修复前生产必现：UUID 主键查不到）", async () => {
    state.project = null; // id="0" 匹配不到任何 UUID 行
    const res = await DELETE(makeRequest("0"));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe("未找到该项目");
  });

  it("不存在的 UUID → 404", async () => {
    state.project = null;
    const res = await DELETE(makeRequest("00000000-0000-0000-0000-000000000000"));
    expect(res.status).toBe(404);
  });

  it("不属于当前用户的项目 → 404 且不执行删除（user_id 条件拦截）", async () => {
    // user_id 条件不匹配时 .single() 返回 null → 404，delete 链不会被调用
    state.project = null;
    const res = await DELETE(makeRequest(UUID));
    expect(res.status).toBe(404);
    expect(state.deleteEqs).toEqual([]);
    expect(mockRemoveProject).not.toHaveBeenCalled();
  });
});
