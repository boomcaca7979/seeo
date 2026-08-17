// ===== /api/competitors 测试（UUID 项目引用，lightweight mocks）=====
// P1-3：鉴权模式前端传 Supabase UUID，API 经 resolveSqliteProjectId 转换为 SQLite 整数 id。
// 覆盖：GET/POST 的 UUID 解析、未知 UUID 404、演示模式整数直传。

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-config", () => ({ isAuthEnabled: true }));

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "lite",
    subscriptionStatus: "active",
    limits: { max_competitors: 5 },
    error: undefined,
  })),
}));

const state = {
  sqliteProjectId: 2 as number | null,
  projectRow: { id: 2, domain: "toolstep.xyz", name: "toolstep", user_id: "user-1" } as Record<string, unknown> | null,
  competitors: [{ id: 11, project_id: 2, domain: "example.com", name: null, created_at: "2026-08-01" }],
};

vi.mock("@/lib/project-ref", () => ({
  resolveSqliteProjectId: vi.fn(async (_userId: string, ref: string) => state.sqliteProjectId && !/^\d+$/.test(ref) ? state.sqliteProjectId : (/^\d+$/.test(ref) ? Number(ref) : null)),
}));

vi.mock("@/lib/db", () => ({
  listCompetitors: vi.fn(async () => state.competitors),
  countCompetitors: vi.fn(async () => 0),
  createCompetitor: vi.fn(async () => ({ id: 12, project_id: 2, domain: "new.com", name: null, created_at: "2026-08-17" })),
  deleteCompetitor: vi.fn(async () => true),
  getProjectById: vi.fn(async () => state.projectRow),
}));

vi.mock("@/lib/seo/cache", () => ({
  peekUsage: vi.fn(async () => ({ used: 1, limit: 100 })),
}));

import { GET, POST } from "./route";
import { resolveSqliteProjectId } from "@/lib/project-ref";
import { listCompetitors, createCompetitor } from "@/lib/db";

const UUID = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";

beforeEach(() => {
  vi.clearAllMocks();
  state.sqliteProjectId = 2;
  state.projectRow = { id: 2, domain: "toolstep.xyz", name: "toolstep", user_id: "user-1" };
  state.competitors = [{ id: 11, project_id: 2, domain: "example.com", name: null, created_at: "2026-08-01" }];
});

describe("GET /api/competitors?project_id=<UUID>", () => {
  it("UUID → 解析为 SQLite 整数 id 后查询列表（200）", async () => {
    const res = await GET(new Request(`https://www.seeo.asia/api/competitors?project_id=${UUID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(resolveSqliteProjectId).toHaveBeenCalledWith("user-1", UUID);
    expect(listCompetitors).toHaveBeenCalledWith("user-1", 2);
  });

  it("演示模式整数 id 直传（'5' → 5）", async () => {
    const res = await GET(new Request("https://www.seeo.asia/api/competitors?project_id=5"));
    expect(res.status).toBe(200);
    expect(listCompetitors).toHaveBeenCalledWith("user-1", 5);
  });

  it("未知 UUID → 404", async () => {
    state.sqliteProjectId = null;
    const res = await GET(new Request(`https://www.seeo.asia/api/competitors?project_id=${UUID}`));
    expect(res.status).toBe(404);
    expect(listCompetitors).not.toHaveBeenCalled();
  });

  it("空 project_id → 400", async () => {
    const res = await GET(new Request("https://www.seeo.asia/api/competitors?project_id="));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/competitors（body.project_id 接受 UUID string）", () => {
  function makeBody(projectId: string | number) {
    return new Request("https://www.seeo.asia/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, domain: "competitor.com" }),
    });
  }

  it("UUID string → 解析后创建（201）", async () => {
    const res = await POST(makeBody(UUID));
    expect(res.status).toBe(201);
    expect(createCompetitor).toHaveBeenCalledWith("user-1", { project_id: 2, domain: "competitor.com", name: null });
  });

  it("数字类型 project_id（旧客户端）→ String 化后同样接受", async () => {
    const res = await POST(makeBody(2));
    expect(res.status).toBe(201);
    expect(resolveSqliteProjectId).toHaveBeenCalledWith("user-1", "2");
  });

  it("未知 UUID → 404，不创建", async () => {
    state.sqliteProjectId = null;
    const res = await POST(makeBody(UUID));
    expect(res.status).toBe(404);
    expect(createCompetitor).not.toHaveBeenCalled();
  });
});
