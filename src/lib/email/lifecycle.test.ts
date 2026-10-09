// ===== Lifecycle sweep 端到端 + 事务性邮件独立性（C3–C10 / C13）=====
// 基于真实 DB adapter（内存 SQLite）+ mock provider，验证：
//   - 未激活用户收到 audit reminder；已激活用户不收
//   - 已付费用户不收 upgrade 营销
//   - 同一 automation 不会重复发送（跨 sweep 幂等）
//   - 营销退订后 lifecycle 停止，但事务性邮件照常发送

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQLiteAdapter } from "../db/adapter";

function makeAdapter(): SQLiteAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, email TEXT NOT NULL, template TEXT NOT NULL,
      automation_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      provider_message_id TEXT, failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT,
      UNIQUE (user_id, automation_key)
    );
    CREATE TABLE email_preferences (
      user_id TEXT PRIMARY KEY, email TEXT, unsubscribe_token TEXT UNIQUE,
      marketing_unsubscribed_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL, user_id TEXT, anonymous_id TEXT, session_id TEXT,
      path TEXT, locale TEXT, referrer TEXT, source TEXT, medium TEXT, campaign TEXT,
      landing_page TEXT, ref_id TEXT, props TEXT,
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

const h = vi.hoisted(() => ({
  sendRaw: vi.fn(async () => ({ success: true, messageId: "msg-sweep" })),
  configured: { value: true },
  users: { value: [] as Array<{ id: string; email: string }> },
}));

vi.mock("./resend", () => ({
  isEmailConfigured: vi.fn(() => h.configured.value),
  sendRawEmail: h.sendRaw,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users: h.users.value }, error: null })),
      },
    },
  })),
}));

const { runLifecycleEmailSweep } = await import("./lifecycle");
const { sendTransactionalEmail } = await import("./service");
const { ensureUnsubscribeToken, unsubscribeByToken } = await import("./preferences");

const USER = "user-sweep-1";
const EMAIL = "sweep@example.com";

const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000);
const toSqlite = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

async function seedEvent(eventName: string, agoHours: number, userId = USER): Promise<void> {
  await currentAdapter.run(
    `INSERT INTO analytics_events (event_name, user_id, anonymous_id, created_at)
     VALUES (?, ?, ?, ?)`,
    [eventName, userId, `anon-${userId}`, toSqlite(hoursAgo(agoHours))]
  );
}

async function logRows(): Promise<Array<Record<string, unknown>>> {
  return (await currentAdapter.query(`SELECT * FROM email_log ORDER BY id`)) as Array<
    Record<string, unknown>
  >;
}

beforeEach(() => {
  currentAdapter = makeAdapter();
  h.sendRaw.mockClear();
  h.sendRaw.mockImplementation(async () => ({ success: true, messageId: "msg-sweep" }));
  h.configured.value = true;
  h.users.value = [{ id: USER, email: EMAIL }];
});

describe("Lifecycle sweep 端到端", () => {
  it("注册 30h 未激活 → 发出 audit_reminder_v1（C4）", async () => {
    await seedEvent("signup_completed", 30);
    const r = await runLifecycleEmailSweep();
    expect(r.targets).toBe(1);
    expect(r.results.map((x) => x.template)).toContain("audit_reminder_v1");
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(h.sendRaw).toHaveBeenCalledTimes(1);
  });

  it("已激活 → 不发 audit_reminder（C4 反向）", async () => {
    await seedEvent("signup_completed", 30);
    await seedEvent("activation_completed", 29);
    const r = await runLifecycleEmailSweep();
    expect(r.results.map((x) => x.template)).not.toContain("audit_reminder_v1");
    expect(h.sendRaw).not.toHaveBeenCalled();
  });

  it("已付费用户 → 不发 upgrade 营销邮件（C8）", async () => {
    await seedEvent("signup_completed", 30);
    await seedEvent("activation_completed", 29);
    await seedEvent("payment_completed", 28);
    for (let i = 0; i < 3; i++) await seedEvent("pricing_viewed", 20 - i);
    const r = await runLifecycleEmailSweep();
    expect(r.results.map((x) => x.template)).not.toContain("upgrade_v1");
    expect(h.sendRaw).not.toHaveBeenCalled();
  });

  it("未付费 + 真实升级信号 → 发出 upgrade_v1（C8）", async () => {
    await seedEvent("signup_completed", 30);
    await seedEvent("activation_completed", 29);
    for (let i = 0; i < 3; i++) await seedEvent("pricing_viewed", 20 - i);
    const r = await runLifecycleEmailSweep();
    expect(r.results.map((x) => x.template)).toContain("upgrade_v1");
  });

  it("跨 sweep 幂等：第二轮不再重复发送（C13）", async () => {
    await seedEvent("signup_completed", 30);
    const r1 = await runLifecycleEmailSweep();
    expect(r1.results).toHaveLength(1);
    const r2 = await runLifecycleEmailSweep();
    // 第二轮仍会判定资格，但 email_log 唯一键拦截 → 不产生新发送
    expect(r2.results.map((x) => x.status)).toEqual(["skipped_already_sent"]);
    expect(h.sendRaw).toHaveBeenCalledTimes(1);
    expect(await logRows()).toHaveLength(1);
  });

  it("营销退订后 sweep → skipped_unsubscribed，不调用 provider（C10）", async () => {
    const token = await ensureUnsubscribeToken(USER, EMAIL);
    expect(await unsubscribeByToken(token)).toBe(true);
    await seedEvent("signup_completed", 30);
    const r = await runLifecycleEmailSweep();
    expect(r.results[0].status).toBe("skipped_unsubscribed");
    expect(h.sendRaw).not.toHaveBeenCalled();
    const rows = await logRows();
    expect(rows[0].status).toBe("skipped_unsubscribed");
    expect(String(rows[0].failure_reason)).toContain("unsubscribed");
  });

  it("provider 未配置 → dry-run 记录，不抛错（不阻塞业务）", async () => {
    h.configured.value = false;
    await seedEvent("signup_completed", 30);
    const r = await runLifecycleEmailSweep();
    expect(r.results[0].status).toBe("skipped_no_provider");
    expect(h.sendRaw).not.toHaveBeenCalled();
  });
});

describe("事务性邮件独立于营销退订（C10）", () => {
  it("退订营销后，事务性邮件仍可发送", async () => {
    const token = await ensureUnsubscribeToken(USER, EMAIL);
    await unsubscribeByToken(token);

    const r = await sendTransactionalEmail({
      userId: USER,
      email: EMAIL,
      templateKey: "report_email_v1",
      subject: "Your SeeO report",
      html: "<p>report</p>",
    });
    expect(r.status).toBe("sent");
    expect(r.messageId).toBe("msg-sweep");
    expect(h.sendRaw).toHaveBeenCalledTimes(1);

    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].template).toBe("report_email_v1");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sent_at).not.toBeNull();
  });

  it("同一报告可重复请求发送（事务邮件不做生命周期幂等拦截）", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await sendTransactionalEmail({
        userId: USER,
        email: EMAIL,
        templateKey: "report_email_v1",
        subject: "Your SeeO report",
        html: "<p>report</p>",
        automationKey: `report_email:1:${i}`,
      });
      expect(r.status).toBe("sent");
    }
    expect(h.sendRaw).toHaveBeenCalledTimes(2);
    expect(await logRows()).toHaveLength(2);
  });

  it("营销邮件在退订后停止，但同一用户的事务邮件不受牵连（对比验证）", async () => {
    // 先发一封生命周期营销邮件（成功）
    await seedEvent("signup_completed", 30);
    const first = await runLifecycleEmailSweep();
    expect(first.results[0].status).toBe("sent");

    // 退订
    const token = await ensureUnsubscribeToken(USER, EMAIL);
    await unsubscribeByToken(token);

    // 事务邮件仍成功
    const tx = await sendTransactionalEmail({
      userId: USER,
      email: EMAIL,
      templateKey: "report_email_v1",
      subject: "Your SeeO report",
      html: "<p>report</p>",
    });
    expect(tx.status).toBe("sent");
    expect(h.sendRaw).toHaveBeenCalledTimes(2);
  });
});
