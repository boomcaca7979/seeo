// ===== 阶段 4 回归：demo 模式下审计链路与 Action Center 必须**同一身份** =====
//
// 根因：requireAuthAllowGuest 在 demo 模式返回 user:null → /api/audit/* 回退
// guest:{ip}，而 Action Center 各状态 API 约定 demo-user。同一个人「认领问题在
// demo-user、再审计在 guest 名下」，reverifyClaimedIssues / observeAfterAudit
// 永远找不到对应记录 → 执行→验证闭环断裂（真实数据上已复现并修复）。
//
// 契约：demo 模式（NEXT_PUBLIC_ENABLE_AUTH=false）下 requireAuthAllowGuest 必须
// 返回 user.id === "demo-user"；真实访客语义（auth 启用 + 未登录 → guest:{ip}）
// 不在本测试范围（需要 Supabase mock，仅锁定 demo 分支）。

import { describe, it, expect, vi } from "vitest";

describe("demo 模式身份一致性（requireAuthAllowGuest）", () => {
  it("demo 模式返回 demo-user 身份（与 Action Center 状态 API 同源）", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { requireAuthAllowGuest } = await import("./auth");
    const auth = await requireAuthAllowGuest();
    expect(auth.allowed).toBe(true);
    expect(auth.user?.id).toBe("demo-user");
  });
});
