// ===== 项目归属判据测试（/app/projects/<id> 的 404 语义源头）=====
// proxy 的路由级 404 与详情页的 notFound() 共用本模块，所以这里锁死三条契约：
//   1. 只有数据源确认「名下没有这条记录」才算 missing（→ 可以 404）；
//   2. 任何读取故障都必须抛出，不能返回 missing（否则 DB 挂了会把真实项目抹成 404）；
//   3. 归属条件写进查询本身（user_id 过滤），越权与不存在得到同一个答案。
// 全部用 mock 数据层，测试进程不碰任何真实库（见 @/lib/db/test-db 的隔离要求）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/db", () => ({ getProjectById: vi.fn() }));

import { getProjectById } from "@/lib/db";
import {
  DEMO_USER_ID,
  ProjectDataUnavailableError,
  projectIdFromPath,
  readOwnedProject,
} from "@/lib/project-access";

const getProjectByIdMock = vi.mocked(getProjectById);

const UUID = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";

interface ReadResult {
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
}

/** 只实现 readOwnedProject 用到的那条查询链，并记录调用细节 */
function fakeSupabase(result: ReadResult) {
  const calls: { table: string; filters: Array<[string, unknown]>; terminal: string } = {
    table: "",
    filters: [],
    terminal: "",
  };
  const builder = {
    select: (columns: string) => {
      calls.terminal = `select(${columns})`;
      const eqFirst = (column: string, value: unknown) => {
        calls.filters.push([column, value]);
        return { eq: (column2: string, value2: unknown) => {
          calls.filters.push([column2, value2]);
          return { maybeSingle: async () => result };
        } };
      };
      return { eq: eqFirst };
    },
  };
  const client = {
    from: (table: string) => {
      calls.table = table;
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readOwnedProject（演示模式，SQLite/Turso 整数主键）", () => {
  it("id 为 0、负数、小数、非数字或空串 → missing，且一次都不查库", async () => {
    for (const id of ["0", "-1", "1.5", "abc", "", "null", "NaN"]) {
      expect(await readOwnedProject(id, { mode: "demo" })).toEqual({ status: "missing" });
    }
    expect(getProjectByIdMock).not.toHaveBeenCalled();
  });

  it("命中 demo-user 名下的项目 → owned，id 转字符串、user_id 固定为 demo 身份", async () => {
    getProjectByIdMock.mockResolvedValueOnce({
      id: 17,
      name: "toolstep",
      domain: "toolstep.xyz",
      created_at: "2026-08-10 01:02:03",
    });
    expect(await readOwnedProject("17", { mode: "demo" })).toEqual({
      status: "owned",
      project: {
        id: "17",
        user_id: DEMO_USER_ID,
        name: "toolstep",
        domain: "toolstep.xyz",
        created_at: "2026-08-10 01:02:03",
        updated_at: "2026-08-10 01:02:03",
      },
    });
    // 归属过滤在 SQL 里：WHERE id = ? AND user_id = ?
    expect(getProjectByIdMock).toHaveBeenCalledWith(DEMO_USER_ID, 17);
  });

  it("库按 user_id 查不到这一行（他人项目 / 已删除）→ missing", async () => {
    getProjectByIdMock.mockResolvedValueOnce(null);
    expect(await readOwnedProject("17", { mode: "demo" })).toEqual({ status: "missing" });
  });

  it("本地库读取抛错（连接失败）→ 原样抛出，不折算成 missing", async () => {
    getProjectByIdMock.mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"));
    await expect(readOwnedProject("17", { mode: "demo" })).rejects.toThrow("SQLITE_BUSY");
  });
});

describe("readOwnedProject（鉴权模式，Supabase projects 表）", () => {
  it("查到行 → owned，且查询带 projects + id + 当前 user_id", async () => {
    const row = {
      id: UUID,
      user_id: "user-1",
      name: "toolstep",
      domain: "toolstep.xyz",
      created_at: "2026-08-10T00:00:00Z",
      updated_at: "2026-08-10T00:00:00Z",
    };
    const { client, calls } = fakeSupabase({ data: row, error: null });
    const result = await readOwnedProject(UUID, { mode: "supabase", client, userId: "user-1" });
    expect(result).toEqual({ status: "owned", project: row });
    expect(calls.table).toBe("projects");
    expect(calls.filters).toEqual([
      ["id", UUID],
      ["user_id", "user-1"],
    ]);
  });

  it("0 行（不存在或越权，RLS 也归入这一类）→ missing", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(
      await readOwnedProject("00000000-0000-0000-0000-000000000000", {
        mode: "supabase",
        client,
        userId: "user-1",
      })
    ).toEqual({ status: "missing" });
  });

  it("返回 error（网络故障 / 表结构变化 / 多行）→ 抛 ProjectDataUnavailableError，不是 missing", async () => {
    for (const error of [
      { code: "PGRST000", message: "Failed to fetch" },
      { message: "relation \"projects\" does not exist" },
      { code: "PGRST116", message: "JSON object requested, multiple rows returned" },
    ]) {
      const { client } = fakeSupabase({ data: null, error });
      const thrown = await readOwnedProject(UUID, {
        mode: "supabase",
        client,
        userId: "user-1",
      }).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(ProjectDataUnavailableError);
      expect(String(thrown)).toContain(error.code ?? error.message);
    }
  });

  it("用 maybeSingle 而不是 single：single() 会把「没查到」也写成 error，判据就无法区分故障与缺失", async () => {
    const { client, calls } = fakeSupabase({ data: null, error: null });
    await readOwnedProject(UUID, { mode: "supabase", client, userId: "user-1" });
    expect(calls.terminal).toBe("select(*)");
  });
});

describe("projectIdFromPath", () => {
  it("只认 /app/projects/<id> 这一段", () => {
    expect(projectIdFromPath("/app/projects/17")).toBe("17");
    expect(projectIdFromPath("/app/projects")).toBe(null); // 没有 id 段
    expect(projectIdFromPath("/app/projects/")).toBe(null);
    expect(projectIdFromPath("/app/projects/17/")).toBe("17"); // 尾斜杠是同一资源
    expect(projectIdFromPath("/app/projects/17/edit")).toBe(null); // 更深路径不归本判据
    expect(projectIdFromPath("/app/audit")).toBe(null);
    expect(projectIdFromPath("/zh/app/projects/17")).toBe(null); // /app 不参与 locale 路由
    expect(projectIdFromPath("/login")).toBe(null);
  });
});
