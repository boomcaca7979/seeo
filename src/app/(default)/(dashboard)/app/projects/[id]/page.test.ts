// ===== /app/projects/[id] 详情页测试（鉴权模式）=====
// 验证详情页直接接受 Supabase UUID：
//   - 存在的 UUID → 正常渲染（返回 ReactElement）
//   - 不存在的 UUID → notFound()
//   - id=0（修复前的错误 URL）→ notFound()

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/auth-config", () => ({ isAuthEnabled: true }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("@/lib/db", () => ({
  getProjectById: vi.fn(),
}));

const state = { project: null as Record<string, unknown> | null };

vi.mock("@/lib/supabase/server", () => ({
  createServer: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.project, error: null }),
        }),
      }),
    })),
  })),
}));

import ProjectDetailPage from "./page";

const UUID = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";

function props(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  state.project = {
    id: UUID,
    user_id: "user-1",
    name: "toolstep",
    domain: "toolstep.xyz",
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
  };
});

describe("项目详情页（鉴权模式，UUID 路由）", () => {
  it("真实 UUID → 正常加载（返回 ReactElement，不抛错）", async () => {
    const el = await ProjectDetailPage(props(UUID));
    expect(el).toBeTruthy();
    expect(typeof (el as ReactElement).type).toBeTruthy();
  });

  it("不存在的 UUID → notFound（抛 NOT_FOUND）", async () => {
    state.project = null;
    await expect(ProjectDetailPage(props("00000000-0000-0000-0000-000000000000"))).rejects.toThrow(
      "NOT_FOUND"
    );
  });

  it("id=0（修复前列表产生的错误链接）→ notFound", async () => {
    state.project = null; // UUID 主键表查不到 "0"
    await expect(ProjectDetailPage(props("0"))).rejects.toThrow("NOT_FOUND");
  });

  it("未登录（supabase 返回 null）→ notFound，不渲染", async () => {
    state.project = null;
    await expect(ProjectDetailPage(props(UUID))).rejects.toThrow("NOT_FOUND");
  });
});
