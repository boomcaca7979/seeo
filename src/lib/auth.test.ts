// ===== Auth 回归测试 =====
// 覆盖：requireAuth 的有效/无效 session、演示模式跳过语义、
//       客户端参数不可影响鉴权结果
//
// 安全目标：
//   - 无 session → Unauthorized
//   - user.id 唯一来源是 Supabase session（requireAuth 不接收任何请求参数）
//   - 演示模式 skip=true 且 user=null → 支付 create API 因 !auth.user 直接 401，
//     不可能创建真实订单

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mock 依赖 ----

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServer: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => null),
}));

const mockGetUserPlan = vi.fn();
const mockGetPlanLimits = vi.fn();

vi.mock("@/lib/billing", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
  getPlanLimits: (...args: unknown[]) => mockGetPlanLimits(...args),
}));

let mockIsAuthEnabled = false;

vi.mock("@/lib/auth-config", () => ({
  get isAuthEnabled() {
    return mockIsAuthEnabled;
  },
}));

import { requireAuth } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthEnabled = false;
  mockGetUserPlan.mockResolvedValue({
    plan: "free",
    effectivePlan: "free",
    subscriptionStatus: "inactive",
    currentPeriodEnd: null,
  });
  mockGetPlanLimits.mockResolvedValue({ plan: "free" });
});

describe("requireAuth 演示模式（isAuthEnabled=false）", () => {
  it("跳过鉴权：allowed=true, skip=true, user=null", async () => {
    mockIsAuthEnabled = false;
    const auth = await requireAuth();
    expect(auth.allowed).toBe(true);
    expect(auth.skip).toBe(true);
    expect(auth.user).toBeNull();
  });

  it("演示模式 user=null → 支付 create API 的 !auth.user 分支必然拒绝（不可能创建真实订单）", async () => {
    mockIsAuthEnabled = false;
    const auth = await requireAuth();
    // create route 逻辑：if (!auth.allowed || !auth.user) return 401
    const wouldCreateOrder = auth.allowed && !!auth.user;
    expect(wouldCreateOrder).toBe(false);
  });
});

describe("requireAuth 鉴权模式（isAuthEnabled=true）", () => {
  it("有效 session → 返回 session 中的 user", async () => {
    mockIsAuthEnabled = true;
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-from-session" } },
      error: null,
    });
    const auth = await requireAuth();
    expect(auth.allowed).toBe(true);
    expect(auth.skip).toBe(false);
    expect(auth.user).toEqual({ id: "user-from-session" });
  });

  it("无 session（user=null）→ allowed=false, Unauthorized", async () => {
    mockIsAuthEnabled = true;
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const auth = await requireAuth();
    expect(auth.allowed).toBe(false);
    expect(auth.user).toBeNull();
    expect(auth.error).toBe("Unauthorized");
  });

  it("getUser 返回错误 → allowed=false, Unauthorized", async () => {
    mockIsAuthEnabled = true;
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "bad jwt" },
    });
    const auth = await requireAuth();
    expect(auth.allowed).toBe(false);
    expect(auth.error).toBe("Unauthorized");
  });

  it("getUser 抛异常 → allowed=false（不向上抛）", async () => {
    mockIsAuthEnabled = true;
    mockGetUser.mockRejectedValue(new Error("network down"));
    const auth = await requireAuth();
    expect(auth.allowed).toBe(false);
    expect(auth.error).toBe("Unauthorized");
  });

  it("不信任客户端 user_id：requireAuth 不接收任何请求输入，user.id 唯一来源是 session", async () => {
    mockIsAuthEnabled = true;
    // 模拟攻击者在请求体/查询参数中伪造 user_id="attacker-id"
    // requireAuth() 签名无任何参数，伪造值无法传入
    const forgedBodyUserId = "attacker-id";

    mockGetUser.mockResolvedValue({
      data: { user: { id: "real-session-user" } },
      error: null,
    });

    const auth = await requireAuth(/* 无任何参数可传 forgedBodyUserId */);

    expect(auth.user?.id).toBe("real-session-user");
    expect(auth.user?.id).not.toBe(forgedBodyUserId);
  });

  it("plan 来自 getUserPlan 的 effectivePlan（过期订阅已降级）", async () => {
    mockIsAuthEnabled = true;
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mockGetUserPlan.mockResolvedValue({
      plan: "pro",
      effectivePlan: "free", // 订阅已过期
      subscriptionStatus: "expired",
      currentPeriodEnd: "2000-01-01T00:00:00Z",
    });
    const auth = await requireAuth();
    expect(auth.plan).toBe("free");
    expect(auth.subscriptionStatus).toBe("expired");
  });
});
