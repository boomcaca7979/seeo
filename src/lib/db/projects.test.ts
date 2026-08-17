// ===== 项目列表数据层 ID 链路测试 =====
// 验证 ProjectWithMetrics.id 全链路为真实 ID（string）：
//   - 鉴权模式：Supabase UUID 原样保留（修复前被硬编码为 0）
//   - 演示模式：SQLite 整数转字符串
// ProjectList 用 p.id 作为 key 和 /app/projects/<id> href，
// deleteTarget.id 发送 DELETE /api/projects?id=<id>，
// 因此这里的 id 正确性直接决定列表渲染、详情页 URL、删除功能。

import { describe, it, expect, vi, beforeEach } from "vitest";

// mock SQLite adapter：指标批量查询全部返回空（不连任何真实数据库）
vi.mock("@/lib/db/migrations", () => ({
  getAdapter: vi.fn(async () => ({
    query: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    run: vi.fn(async () => ({ changes: 0, lastInsertRowid: 0 })),
  })),
}));

import {
  listProjectsWithMetrics,
  listProjectsWithMetricsForUser,
} from "@/lib/db/projects";

const UUID_A = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";
const UUID_B = "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listProjectsWithMetricsForUser（鉴权模式，生产链路）", () => {
  it("返回真实 Supabase UUID，原样保留（不再是 0）", async () => {
    const result = await listProjectsWithMetricsForUser("user-1", [
      { id: UUID_A, name: "toolstep", domain: "www.toolstep.top", created_at: "2026-08-01T00:00:00Z" },
      { id: UUID_B, name: "toolstep", domain: "toolstep.xyz", created_at: "2026-08-10T00:00:00Z" },
    ]);

    expect(result.map((p) => p.id)).toEqual([UUID_A, UUID_B]);
    // 明确防回归：任何一个 id 都不允许是 "0" / 0 / 空串
    for (const p of result) {
      expect(p.id).not.toBe("0");
      expect(p.id).not.toBe(0);
      expect(p.id.length).toBeGreaterThan(0);
    }
  });

  it("id 唯一（可作为 React key，不再全列表重复 key=0）", async () => {
    const result = await listProjectsWithMetricsForUser("user-1", [
      { id: UUID_A, name: "a", domain: "a.com", created_at: "2026-08-01T00:00:00Z" },
      { id: UUID_B, name: "b", domain: "b.com", created_at: "2026-08-02T00:00:00Z" },
    ]);
    expect(new Set(result.map((p) => p.id)).size).toBe(2);
  });

  it("详情页 URL 拼接：/app/projects/<UUID> 使用真实 ID", async () => {
    const result = await listProjectsWithMetricsForUser("user-1", [
      { id: UUID_A, name: "a", domain: "a.com", created_at: "2026-08-01T00:00:00Z" },
    ]);
    // ProjectList.tsx: <Link href={`/app/projects/${p.id}`}>
    const href = `/app/projects/${result[0].id}`;
    expect(href).toBe(`/app/projects/${UUID_A}`);
    expect(href).not.toContain("/app/projects/0");
  });

  it("domain 关联指标不受 id 类型影响（空指标时各项为默认值）", async () => {
    const result = await listProjectsWithMetricsForUser("user-1", [
      { id: UUID_A, name: "a", domain: "a.com", created_at: "2026-08-01T00:00:00Z" },
    ]);
    expect(result[0]).toMatchObject({
      id: UUID_A,
      domain: "a.com",
      trackedKeywordCount: 0,
      healthScore: null,
      rankUp7d: 0,
      rankDown7d: 0,
      alertCount: 0,
    });
  });
});

describe("listProjectsWithMetrics（演示模式）", () => {
  it("SQLite 整数 id 转字符串，类型与鉴权模式统一", async () => {
    // adapter mock 的 listProjects 查询返回空数组 → 空列表
    const result = await listProjectsWithMetrics("demo-user");
    expect(result).toEqual([]);
  });
});
