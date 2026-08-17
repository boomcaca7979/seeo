// ===== 项目引用解析测试（server-only：UUID → SQLite 整数 id）=====

import { describe, it, expect, vi, beforeEach } from "vitest";

const UUID_A = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";

vi.mock("@/lib/auth-config", () => ({ isAuthEnabled: true }));

vi.mock("@/lib/db", () => ({
  getProjectByDomain: vi.fn(async (_userId: string, domain: string) => {
    if (domain === "www.toolstep.top") return { id: 1, name: "toolstep", domain };
    if (domain === "toolstep.xyz") return { id: 2, name: "toolstep", domain };
    return null;
  }),
}));

const supabaseState = { domain: null as string | null };

vi.mock("@/lib/supabase/server", () => ({
  createServer: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: supabaseState.domain ? { domain: supabaseState.domain } : null,
              error: null,
            }),
          }),
        }),
      }),
    })),
  })),
}));

import { resolveSqliteProjectId } from "@/lib/project-ref";

beforeEach(() => {
  supabaseState.domain = null;
});

describe("resolveSqliteProjectId（前端引用 → SQLite 内部整数 id）", () => {
  it("UUID 解析：Supabase 查 domain → SQLite 反查整数 id", async () => {
    supabaseState.domain = "toolstep.xyz";
    expect(await resolveSqliteProjectId("user-1", UUID_A)).toBe(2);
  });

  it("纯数字引用（演示模式）直传整数，不查 Supabase", async () => {
    expect(await resolveSqliteProjectId("demo-user", "5")).toBe(5);
  });

  it("UUID 不存在（Supabase 查不到）→ null", async () => {
    supabaseState.domain = null;
    expect(await resolveSqliteProjectId("user-1", UUID_A)).toBeNull();
  });

  it("Supabase 有项目但 SQLite 无对应记录 → null", async () => {
    supabaseState.domain = "unknown.com";
    expect(await resolveSqliteProjectId("user-1", UUID_A)).toBeNull();
  });

  it("空引用 → null", async () => {
    expect(await resolveSqliteProjectId("user-1", "")).toBeNull();
    expect(await resolveSqliteProjectId("user-1", "   ")).toBeNull();
  });

  it("id=0 旧值（auth 模式下走整数路径）返回 0，由调用方 404 处理", async () => {
    expect(await resolveSqliteProjectId("user-1", "0")).toBe(0);
  });
});
