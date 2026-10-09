// ===== 漏斗统计测试（B11）=====
// 口径验证：visitors 去重身份、audit 按 ref_id 去重、paid 按去重 user_id、
// 转化率分母定义、来源分组、按日明细。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQLiteAdapter } from "../db/adapter";

function makeAdapter(): SQLiteAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
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

let currentAdapter: SQLiteAdapter;
vi.mock("../db/migrations", () => ({
  getAdapter: vi.fn(async () => currentAdapter),
}));

const { getFunnelWindow, computeConversions, getSourceBreakdown, getDailyFunnel } = await import("./funnel");

const { insertEvent } = await import("./server");

beforeEach(() => {
  currentAdapter = makeAdapter();
});

async function seedRedditFunnel(): Promise<void> {
  // reddit：3 个访客，2 个开审计（3 次 started / 2 个唯一 audit），1 注册 + 1 激活 + 1 付费
  await insertEvent({ event: "page_view", anonymousId: "r1", touch: { utmSource: "reddit" }, path: "/" });
  await insertEvent({ event: "page_view", anonymousId: "r2", touch: { utmSource: "reddit" }, path: "/" });
  await insertEvent({ event: "page_view", anonymousId: "r3", touch: { utmSource: "reddit" }, path: "/" });
  await insertEvent({ event: "audit_started", anonymousId: "r1", refId: "101", touch: { utmSource: "reddit" } });
  await insertEvent({ event: "audit_completed", anonymousId: "r1", refId: "101", touch: { utmSource: "reddit" } });
  await insertEvent({ event: "audit_started", anonymousId: "r2", refId: "102", touch: { utmSource: "reddit" } });
  await insertEvent({ event: "audit_completed", anonymousId: "r2", refId: "102", touch: { utmSource: "reddit" } });
  await insertEvent({ event: "signup_completed", userId: "u1", anonymousId: "r1", touch: { utmSource: "reddit" } });
  await insertEvent({ event: "activation_completed", userId: "u1", touch: { utmSource: "reddit" } });
  await insertEvent({ event: "payment_completed", userId: "u1", refId: "ORD-1", touch: { utmSource: "reddit" } });
}

describe("getFunnelWindow / computeConversions", () => {
  it("窗口指标按定义口径计算", async () => {
    await seedRedditFunnel();
    const w = await getFunnelWindow(7);
    expect(w.visitors).toBe(3);
    expect(w.auditsStarted).toBe(2); // ref_id 去重
    expect(w.auditsCompleted).toBe(2);
    expect(w.signups).toBe(1);
    expect(w.activatedUsers).toBe(1);
    expect(w.paidUsers).toBe(1);
  });

  it("转化率分母正确（audit=人次/人数，signup=次数比，activation/paid=人数比）", async () => {
    await seedRedditFunnel();
    const w = await getFunnelWindow(7);
    const c = computeConversions(w);
    expect(c.auditConversion).toBeCloseTo(2 / 3, 3);
    expect(c.signupConversion).toBeCloseTo(1 / 2, 3);
    expect(c.activationConversion).toBe(1);
    expect(c.paidConversion).toBe(1);
  });

  it("分母为 0 时转化率为 null（不输出误导性 0）", async () => {
    const w = await getFunnelWindow(7);
    const c = computeConversions(w);
    expect(c.auditConversion).toBeNull();
    expect(c.signupConversion).toBeNull();
    expect(c.activationConversion).toBeNull();
    expect(c.paidConversion).toBeNull();
  });

  it("1 天窗口不含 2 天前的事件", async () => {
    await seedRedditFunnel();
    await currentAdapter.run(
      `UPDATE analytics_events SET created_at = datetime('now', '-2 days')`
    );
    const today = await getFunnelWindow(1);
    expect(today.visitors).toBe(0);
    const week = await getFunnelWindow(7);
    expect(week.visitors).toBe(3);
  });
});

describe("getSourceBreakdown", () => {
  it("按来源分组：reddit 与 google 各自成行", async () => {
    await seedRedditFunnel();
    await insertEvent({ event: "page_view", anonymousId: "g1", touch: { referrer: "https://www.google.com/" }, path: "/" });
    await insertEvent({ event: "audit_started", anonymousId: "g1", refId: "201", touch: { referrer: "https://www.google.com/" } });
    await insertEvent({ event: "audit_completed", anonymousId: "g1", refId: "201", touch: { referrer: "https://www.google.com/" } });

    const rows = await getSourceBreakdown(7);
    const reddit = rows.find((r) => r.source === "reddit");
    const google = rows.find((r) => r.source === "google");
    expect(reddit).toMatchObject({ visitors: 3, audits: 2, signups: 1, activated: 1, paid: 1 });
    expect(google).toMatchObject({ visitors: 1, audits: 1, signups: 0, activated: 0, paid: 0 });
  });
});

describe("getDailyFunnel", () => {
  it("按日分组输出核心漏斗", async () => {
    await seedRedditFunnel();
    const daily = await getDailyFunnel(7);
    expect(daily).toHaveLength(1);
    expect(daily[0].visitors).toBe(3);
    expect(daily[0].auditsCompleted).toBe(2);
    expect(daily[0].signups).toBe(1);
    expect(daily[0].paidUsers).toBe(1);
  });
});
