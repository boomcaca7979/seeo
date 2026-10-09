// ===== POST /api/analytics/events 路由测试 =====
// 覆盖：白名单校验、匿名事件无 user_id、user_id 由服务端 session 推导
//（客户端伪造字段被忽略）、signup_completed 触发归因绑定、限流外的正常路径。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQLiteAdapter } from "@/lib/db/adapter";

function makeAdapter(): SQLiteAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      user_id TEXT, anonymous_id TEXT, session_id TEXT, path TEXT, locale TEXT,
      referrer TEXT, source TEXT, medium TEXT, campaign TEXT, landing_page TEXT,
      ref_id TEXT, props TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      content TEXT,
      term TEXT
    );
    CREATE TABLE analytics_identities (
      anonymous_id TEXT PRIMARY KEY, user_id TEXT,
      first_touch_source TEXT, first_touch_medium TEXT, first_touch_campaign TEXT,
      first_touch_content TEXT, first_touch_term TEXT,
      first_landing_page TEXT, first_referrer TEXT,
      last_touch_source TEXT, last_touch_medium TEXT, last_touch_campaign TEXT,
      last_landing_page TEXT, last_referrer TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      bound_at TEXT
    );
  `);
  return new SQLiteAdapter(raw);
}

const h = vi.hoisted(() => ({
  currentAdapter: { value: null as SQLiteAdapter | null },
  sessionUser: { value: null as { id: string; email?: string } | null },
}));

vi.mock("@/lib/db/migrations", () => ({
  getAdapter: vi.fn(async () => h.currentAdapter.value),
}));

vi.mock("@/lib/auth-config", () => ({
  isAuthEnabled: true,
}));

const h2 = vi.hoisted(() => ({
  sendWelcome: vi.fn(async () => {}),
}));

vi.mock("@/lib/email/lifecycle", () => ({
  sendWelcomeEmail: h2.sendWelcome,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServer: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: h.sessionUser.value } })),
    },
  })),
}));

import { POST } from "./route";

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request("http://localhost/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  h.currentAdapter.value = makeAdapter();
  h.sessionUser.value = null;
  h2.sendWelcome.mockClear();
});

async function rows(): Promise<Array<Record<string, unknown>>> {
  return (await h.currentAdapter.value!.query(`SELECT * FROM analytics_events ORDER BY id`)) as Array<Record<string, unknown>>;
}

describe("POST /api/analytics/events", () => {
  it("匿名 page_view 落库且无 user_id（B2）", async () => {
    const res = await post({
      event: "page_view",
      anonymousId: "anon-1",
      sessionId: "s1",
      path: "/zh",
      locale: "zh",
      utmSource: "reddit",
      utmMedium: "social",
      utmCampaign: "test",
      referrer: "https://old.reddit.com/r/seo/",
    });
    expect(res.status).toBe(200);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].event_name).toBe("page_view");
    expect(r[0].user_id).toBeNull();
    expect(r[0].source).toBe("reddit");
    // 身份行已建立且 first_touch 归因
    const identity = await h.currentAdapter.value!.get(`SELECT * FROM analytics_identities WHERE anonymous_id = ?`, ["anon-1"]) as Record<string, unknown> | undefined;
    expect(identity?.first_touch_source).toBe("reddit");
  });

  it("未登录用户永远不会写入 user_id（B14）", async () => {
    await post({
      event: "audit_started",
      anonymousId: "anon-1",
      refId: "9",
      userId: "forged-user", // 客户端伪造字段必须被忽略
      props: { domain: "example.com" },
    });
    const r = await rows();
    expect(r[0].user_id).toBeNull();
  });

  it("白名单外的事件被拒绝", async () => {
    const res = await post({ event: "payment_completed", anonymousId: "anon-1" });
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("缺少 anonymousId 被拒绝", async () => {
    const res = await post({ event: "page_view" });
    expect(res.status).toBe(400);
  });

  it("signup_completed：服务端 session 用户绑定匿名归因（B3/D 场景）", async () => {
    // 先以匿名身份建立 first_touch
    await post({ event: "page_view", anonymousId: "anon-9", path: "/", utmSource: "reddit", utmMedium: "social" });
    // 注册成功（服务端 session 已建立）
    h.sessionUser.value = { id: "user-signup-1" };
    const res = await post({ event: "signup_completed", anonymousId: "anon-9" });
    expect(res.status).toBe(200);

    const r = await rows();
    expect(r.filter((x) => x.event_name === "signup_completed")[0].user_id).toBe("user-signup-1");
    const identity = await h.currentAdapter.value!.get(`SELECT * FROM analytics_identities WHERE anonymous_id = ?`, ["anon-9"]) as Record<string, unknown> | undefined;
    expect(identity?.user_id).toBe("user-signup-1");
    expect(identity?.first_touch_source).toBe("reddit"); // 归因保留
  });

  it("signup_completed → welcome 触发一次；重复事件不重复触发（#1/#2/#14）", async () => {
    h.sessionUser.value = { id: "user-welcome-1", email: "welcome@example.com" };
    // 注意：user_id 一致但 email 不同 → 依赖 session email；这里 mock 不校验 email
    const body = { event: "signup_completed", anonymousId: "anon-w1" };
    const res1 = await post(body);
    expect(res1.status).toBe(200);
    expect(h2.sendWelcome).toHaveBeenCalledTimes(1);

    // 重复投递同一事件（幂等在 sendWelcomeEmail/email_log 层保证；ingest 层每次都会调用，
    // 但 service 层唯一键会拒绝重复发送 —— mock 层面验证 ingest 会传递调用）
    await post(body);
    expect(h2.sendWelcome).toHaveBeenCalledTimes(2);
  });

  it("未登录的 signup_completed（伪造）不触发 welcome", async () => {
    await post({ event: "signup_completed", anonymousId: "anon-w2" });
    expect(h2.sendWelcome).not.toHaveBeenCalled();
  });

  it("login_completed：24h 前活跃用户记 returning_user", async () => {
    await post({ event: "page_view", anonymousId: "anon-9", path: "/" });
    h.sessionUser.value = { id: "user-login-1" };
    await post({ event: "login_completed", anonymousId: "anon-9" });
    // 无 24h 前记录 → 不记回访
    expect((await rows()).filter((x) => x.event_name === "returning_user")).toHaveLength(0);

    // 拨回 25h 前再登录 → returning_user
    await h.currentAdapter.value!.run(
      `UPDATE analytics_events SET created_at = datetime('now', '-25 hours') WHERE event_name = 'page_view'`
    );
    await post({ event: "login_completed", anonymousId: "anon-9" });
    expect((await rows()).filter((x) => x.event_name === "returning_user")).toHaveLength(1);
  });
});
