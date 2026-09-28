// ===== Analytics 服务端逻辑测试（真实内存 SQLite）=====
// 覆盖 B2/B4/B6/B7/B9/B12/B13 的数据层行为：
//   匿名事件无 user_id、first_touch 不被覆盖、last_touch 可更新、
//   注册后归因绑定与防串号、activation 只记一次且 guest/demo 不记、
//   returning_user 24h 判定、payment_completed 记录、身份查询。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQLiteAdapter } from "../db/adapter";

function makeAdapter(): SQLiteAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'completed',
      user_id TEXT NOT NULL
    );
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      user_id TEXT,
      anonymous_id TEXT,
      session_id TEXT,
      path TEXT,
      locale TEXT,
      referrer TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      landing_page TEXT,
      ref_id TEXT,
      props TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE analytics_identities (
      anonymous_id TEXT PRIMARY KEY,
      user_id TEXT,
      first_touch_source TEXT,
      first_touch_medium TEXT,
      first_touch_campaign TEXT,
      first_touch_content TEXT,
      first_touch_term TEXT,
      first_landing_page TEXT,
      first_referrer TEXT,
      last_touch_source TEXT,
      last_touch_medium TEXT,
      last_touch_campaign TEXT,
      last_landing_page TEXT,
      last_referrer TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      bound_at TEXT
    );
  `);
  return new SQLiteAdapter(raw);
}

let currentAdapter: SQLiteAdapter;

vi.mock("../db/migrations", () => ({
  getAdapter: vi.fn(async () => currentAdapter),
}));

const {
  insertEvent,
  recordVisit,
  bindIdentity,
  trackActivationIfFirst,
  trackReturningIfEligible,
  recordPaymentCompleted,
  getIdentity,
} = await import("./server");

const AID = "anon-1111-2222";
const USER_A = "user-aaaa";
const USER_B = "user-bbbb";

beforeEach(() => {
  currentAdapter = makeAdapter();
});

async function events(): Promise<Array<Record<string, unknown>>> {
  return (await currentAdapter.query(`SELECT * FROM analytics_events ORDER BY id`)) as Array<Record<string, unknown>>;
}

describe("recordVisit：匿名 page_view 与归因", () => {
  it("匿名 page_view 落库：无 user_id，source 标准化", async () => {
    await recordVisit({
      anonymousId: AID,
      sessionId: "s1",
      path: "/zh",
      locale: "zh",
      touch: { referrer: "https://www.reddit.com/r/seo/" },
    });
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0].event_name).toBe("page_view");
    expect(rows[0].user_id).toBeNull();
    expect(rows[0].anonymous_id).toBe(AID);
    expect(rows[0].source).toBe("reddit");
  });

  it("first_touch 首次写入且不被后续渠道覆盖（B4）", async () => {
    await recordVisit({
      anonymousId: AID,
      path: "/",
      touch: { utmSource: "reddit", utmMedium: "social", utmCampaign: "launch", referrer: "https://reddit.com" },
    });
    // 后来从 Google 进入
    await recordVisit({
      anonymousId: AID,
      path: "/pricing",
      touch: { referrer: "https://www.google.com/" },
    });

    const id = await getIdentity(AID);
    expect(id?.first_touch_source).toBe("reddit");
    expect(id?.first_touch_medium).toBe("social");
    expect(id?.first_touch_campaign).toBe("launch");
    expect(id?.first_landing_page).toBe("/");
    // last touch 已更新为 google
    expect(id?.last_touch_source).toBe("google");
    expect(id?.last_landing_page).toBe("/pricing");
  });

  it("无渠道访问不更新 last_touch，仅更新活跃时间", async () => {
    await recordVisit({
      anonymousId: AID,
      path: "/",
      touch: { utmSource: "reddit", utmMedium: "social" },
    });
    await recordVisit({ anonymousId: AID, path: "/app", touch: {} });

    const id = await getIdentity(AID);
    expect(id?.last_touch_source).toBe("reddit");
  });

  it("不同访客身份互不干扰（B14 数据不串）", async () => {
    await recordVisit({ anonymousId: "anon-A", path: "/", touch: { utmSource: "reddit", utmMedium: "social" } });
    await recordVisit({ anonymousId: "anon-B", path: "/", touch: { utmSource: "bing", utmMedium: "organic" } });

    const a = await getIdentity("anon-A");
    const b = await getIdentity("anon-B");
    expect(a?.first_touch_source).toBe("reddit");
    expect(b?.first_touch_source).toBe("bing");
  });
});

describe("bindIdentity：注册后归因绑定（B2 / B3）", () => {
  it("绑定后匿名行带 user_id，first_touch 保留", async () => {
    await recordVisit({ anonymousId: AID, path: "/", touch: { utmSource: "reddit", utmMedium: "social", utmCampaign: "test" } });
    const changed = await bindIdentity(AID, USER_A);
    expect(changed).toBe(true);

    const id = await getIdentity(AID);
    expect(id?.user_id).toBe(USER_A);
    expect(id?.first_touch_source).toBe("reddit");
    expect(id?.bound_at).not.toBeNull();
  });

  it("已绑定其他用户时拒绝覆盖（防 cookie 共享串号）", async () => {
    await recordVisit({ anonymousId: AID, path: "/", touch: {} });
    await bindIdentity(AID, USER_A);
    const changed = await bindIdentity(AID, USER_B);
    expect(changed).toBe(false);
    const id = await getIdentity(AID);
    expect(id?.user_id).toBe(USER_A);
  });

  it("同一用户重复绑定幂等", async () => {
    await recordVisit({ anonymousId: AID, path: "/", touch: {} });
    expect(await bindIdentity(AID, USER_A)).toBe(true);
    expect(await bindIdentity(AID, USER_A)).toBe(false);
    const id = await getIdentity(AID);
    expect(id?.user_id).toBe(USER_A);
  });
});

describe("trackActivationIfFirst：激活判定（B7）", () => {
  it("注册用户首次完成审计 → activation_completed 一次", async () => {
    expect(await trackActivationIfFirst(USER_A)).toBe(true);
    expect(await trackActivationIfFirst(USER_A)).toBe(false);
    const rows = await events();
    const activations = rows.filter((r) => r.event_name === "activation_completed");
    expect(activations).toHaveLength(1);
    expect(activations[0].user_id).toBe(USER_A);
  });

  it("guest / demo-user 不产生激活事件", async () => {
    expect(await trackActivationIfFirst("guest:1.2.3.4")).toBe(false);
    expect(await trackActivationIfFirst("demo-user")).toBe(false);
    expect(await events()).toHaveLength(0);
  });
});

describe("trackReturningIfEligible：回访判定（B6 邻接）", () => {
  it("24h 内新注册用户登录不记回访", async () => {
    await insertEvent({ event: "signup_completed", userId: USER_A });
    expect(await trackReturningIfEligible(USER_A)).toBe(false);
  });

  it("24h 前有活跃记录的登录用户记一次回访，且 24h 内去重", async () => {
    await insertEvent({ event: "signup_completed", userId: USER_A });
    // 手动把该事件时间拨回 25h 前
    await currentAdapter.run(
      `UPDATE analytics_events SET created_at = datetime('now', '-25 hours') WHERE user_id = ?`,
      [USER_A]
    );
    expect(await trackReturningIfEligible(USER_A)).toBe(true);
    expect(await trackReturningIfEligible(USER_A)).toBe(false);
    const rows = await events();
    expect(rows.filter((r) => r.event_name === "returning_user")).toHaveLength(1);
  });
});

describe("身份级事件按 first-touch 归因（B3/B9）", () => {
  it("Reddit 来的匿名用户：激活与支付事件的 source 保持 reddit", async () => {
    await recordVisit({
      anonymousId: AID,
      path: "/",
      touch: { utmSource: "reddit", utmMedium: "social", utmCampaign: "launch" },
    });
    await bindIdentity(AID, USER_A);
    await trackActivationIfFirst(USER_A);
    await recordPaymentCompleted({ userId: USER_A, outTradeNo: "ORD-9", plan: "pro" });

    const rows = await events();
    const activation = rows.find((r) => r.event_name === "activation_completed");
    const payment = rows.find((r) => r.event_name === "payment_completed");
    expect(activation?.source).toBe("reddit");
    expect(activation?.medium).toBe("social");
    expect(activation?.campaign).toBe("launch");
    expect(payment?.source).toBe("reddit");
  });
});

describe("payment_completed（B9）", () => {
  it("记录带 user_id / 订单号 / plan", async () => {
    await recordPaymentCompleted({ userId: USER_A, outTradeNo: "SEE0-123", plan: "lite" });
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0].event_name).toBe("payment_completed");
    expect(rows[0].user_id).toBe(USER_A);
    expect(rows[0].ref_id).toBe("SEE0-123");
    expect(JSON.parse(String(rows[0].props))).toEqual({ plan: "lite" });
  });
});

describe("insertEvent：隐私与字段清洗（B12）", () => {
  it("props 白名单化截断，不含超长内容", async () => {
    await insertEvent({
      event: "audit_started",
      anonymousId: AID,
      props: {
        domain: "example.com",
        secret_token: "supertoken".repeat(100),
        ok: 123,
      },
    });
    const rows = await events();
    const props = JSON.parse(String(rows[0].props));
    expect(props.domain).toBe("example.com");
    expect(props.secret_token.length).toBeLessThanOrEqual(200);
    expect(props.ok).toBe("123");
  });

  it("session/path/locale/referrer 正常落库", async () => {
    await insertEvent({
      event: "login_completed",
      userId: USER_A,
      anonymousId: AID,
      sessionId: "sess-1",
      path: "/login",
      locale: "en",
      touch: { referrer: "https://x.com/seeo" },
    });
    const rows = await events();
    expect(rows[0].session_id).toBe("sess-1");
    expect(rows[0].path).toBe("/login");
    expect(rows[0].locale).toBe("en");
    expect(rows[0].source).toBe("x");
  });
});
