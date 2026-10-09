// ===== Owner Console 授权层测试（/admin）=====
// 核心不变量：**fail-closed**。
//   未配置白名单 / 未登录 / 不在白名单 / 账号系统关闭 —— 一律拒绝。
// 这里逐条锁死，防止后续"顺手"把 /admin 放开（它能看到全部客户与收入）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  /** 当前会话用户（null = 未登录） */
  user: null as { id: string; email?: string | null } | null,
  /** 账号系统是否启用（演示模式为 false） */
  authEnabled: true,
  /** createServer 调用次数（用于断言"未配置时根本不读会话"） */
  serverCalls: 0,
}));

vi.mock("@/lib/auth-config", () => ({
  get isAuthEnabled() {
    return h.authEnabled;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServer: async () => ({
    auth: {
      getUser: async () => {
        h.serverCalls++;
        return { data: { user: h.user } };
      },
    },
  }),
}));

import {
  ADMIN_EMAILS_ENV,
  checkAdmin,
  getAdminEmails,
  getCurrentIdentity,
  hasCronSecret,
  isAdminConfigured,
  isAdminEmail,
} from "./auth";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  h.user = null;
  h.authEnabled = true;
  h.serverCalls = 0;
  delete process.env[ADMIN_EMAILS_ENV];
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe("getAdminEmails：解析白名单", () => {
  it("去空白、转小写、去重、丢空项", () => {
    expect(getAdminEmails(" Boss@SeeO.asia , ops@seeo.asia ,, BOSS@seeo.asia ")).toEqual([
      "boss@seeo.asia",
      "ops@seeo.asia",
    ]);
  });

  it("未配置 / 空串 / 只有分隔符 → 空数组", () => {
    expect(getAdminEmails(undefined)).toEqual([]);
    expect(getAdminEmails("")).toEqual([]);
    expect(getAdminEmails(" , , ")).toEqual([]);
  });
});

describe("isAdminConfigured：白名单是否生效", () => {
  it("空 → false（/admin 完全关闭）", () => {
    expect(isAdminConfigured("")).toBe(false);
    expect(isAdminConfigured("   ,  ")).toBe(false);
    expect(isAdminConfigured(undefined)).toBe(false);
  });

  it("有值 → true", () => {
    expect(isAdminConfigured("boss@seeo.asia")).toBe(true);
  });
});

describe("isAdminEmail：大小写不敏感的成员判断", () => {
  const LIST = "boss@seeo.asia, ops@seeo.asia";

  it("命中（含大小写/空白差异）", () => {
    expect(isAdminEmail("boss@seeo.asia", LIST)).toBe(true);
    expect(isAdminEmail("BOSS@Seeo.Asia", LIST)).toBe(true);
    expect(isAdminEmail("  ops@seeo.asia  ", LIST)).toBe(true);
  });

  it("未命中 / 空值 / 白名单为空 → false", () => {
    expect(isAdminEmail("other@seeo.asia", LIST)).toBe(false);
    expect(isAdminEmail("", LIST)).toBe(false);
    expect(isAdminEmail(null, LIST)).toBe(false);
    expect(isAdminEmail(undefined, LIST)).toBe(false);
    expect(isAdminEmail("boss@seeo.asia", "")).toBe(false);
  });

  it("不做子串/后缀匹配（防 boss@seeo.asia.evil.com 之类绕过）", () => {
    expect(isAdminEmail("boss@seeo.asia.evil.com", LIST)).toBe(false);
    expect(isAdminEmail("xboss@seeo.asia", LIST)).toBe(false);
  });
});

describe("getCurrentIdentity", () => {
  it("已登录 → 返回 userId + email", async () => {
    h.user = { id: "u1", email: "boss@seeo.asia" };
    expect(await getCurrentIdentity()).toEqual({ userId: "u1", email: "boss@seeo.asia" });
  });

  it("未登录 → null", async () => {
    expect(await getCurrentIdentity()).toBeNull();
  });

  it("用户没有 email → null（不能凭 userId 放行）", async () => {
    h.user = { id: "u1", email: null };
    expect(await getCurrentIdentity()).toBeNull();
  });

  it("账号系统关闭（演示模式）→ null，且不读会话", async () => {
    h.authEnabled = false;
    h.user = { id: "u1", email: "boss@seeo.asia" };
    expect(await getCurrentIdentity()).toBeNull();
    expect(h.serverCalls).toBe(0);
  });
});

describe("checkAdmin：统一的 owner 校验（fail-closed）", () => {
  it("ADMIN_EMAILS 未配置 → 503，且不读会话", async () => {
    const res = await checkAdmin();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(503);
    expect(res.code).toBe("ADMIN_NOT_CONFIGURED");
    expect(h.serverCalls).toBe(0);
  });

  it("已配置但未登录 → 401 AUTH_REQUIRED", async () => {
    process.env[ADMIN_EMAILS_ENV] = "boss@seeo.asia";
    const res = await checkAdmin();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(401);
    expect(res.code).toBe("AUTH_REQUIRED");
  });

  it("已登录但不在白名单 → 403 NOT_AN_ADMIN", async () => {
    process.env[ADMIN_EMAILS_ENV] = "boss@seeo.asia";
    h.user = { id: "u2", email: "customer@example.com" };
    const res = await checkAdmin();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(403);
    expect(res.code).toBe("NOT_AN_ADMIN");
  });

  it("白名单成员 → ok:true 且带上身份", async () => {
    process.env[ADMIN_EMAILS_ENV] = "boss@seeo.asia,ops@seeo.asia";
    h.user = { id: "u1", email: "BOSS@SeeO.Asia" };
    const res = await checkAdmin();
    expect(res).toEqual({ ok: true, identity: { userId: "u1", email: "BOSS@SeeO.Asia" } });
  });

  it("账号系统关闭 + 已配置白名单 → 仍然拒绝（演示模式不得放开 admin）", async () => {
    process.env[ADMIN_EMAILS_ENV] = "boss@seeo.asia";
    h.authEnabled = false;
    h.user = { id: "u1", email: "boss@seeo.asia" };
    const res = await checkAdmin();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(401);
    expect(h.serverCalls).toBe(0);
  });
});

describe("hasCronSecret：运维/Cron 用的 Bearer 校验", () => {
  const req = (auth?: string) =>
    new Request("https://www.seeo.asia/api/admin/sync/gsc", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    });

  it("未配置 CRON_SECRET → 恒 false（不能拿空值当通行证）", () => {
    expect(hasCronSecret(req("Bearer "), undefined)).toBe(false);
    expect(hasCronSecret(req("Bearer anything"), "")).toBe(false);
  });

  it("匹配的 Bearer → true", () => {
    expect(hasCronSecret(req("Bearer s3cr3t"), "s3cr3t")).toBe(true);
  });

  it("错误 scheme / 大小写不匹配 / 缺头 → false", () => {
    expect(hasCronSecret(req("s3cr3t"), "s3cr3t")).toBe(false);
    expect(hasCronSecret(req("bearer s3cr3t"), "s3cr3t")).toBe(false);
    expect(hasCronSecret(req("Bearer S3CR3T"), "s3cr3t")).toBe(false);
    expect(hasCronSecret(req(), "s3cr3t")).toBe(false);
  });

  it("默认读 process.env.CRON_SECRET", () => {
    process.env.CRON_SECRET = "env-secret";
    expect(hasCronSecret(req("Bearer env-secret"))).toBe(true);
  });
});
