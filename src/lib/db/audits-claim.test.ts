// ===== claimGuestAudits（访客审计认领）数据层测试 =====
// Free SEO Audit 漏斗衔接：未登录访客以 guest:{ip} 跑审计，注册/登录后
// 通过 claim 把近 24h 的访客审计转移到账号下。
// 使用真实内存 SQLite 验证 SQL 行为（含 audit_issues 同步转移与 domain 过滤）。

import { describe, it, expect, vi } from "vitest";
import { SQLiteAdapter } from "./adapter";

// 最小表结构（与 migrations.ts 中 audits / audit_issues 的相关列一致）
function makeAdapter(): SQLiteAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      user_id TEXT NOT NULL
    );
    CREATE TABLE audit_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
    );
  `);
  return new SQLiteAdapter(raw);
}

vi.mock("./migrations", () => ({
  getAdapter: vi.fn(async () => currentAdapter),
}));

let currentAdapter: SQLiteAdapter;
const { claimGuestAudits } = await import("./audits");

async function insertAudit(db: SQLiteAdapter, userId: string, domain: string, startedAt: string): Promise<number> {
  const info = await db.run(
    `INSERT INTO audits (domain, user_id, started_at) VALUES (?, ?, ?)`,
    [domain, userId, startedAt]
  );
  return Number(info.lastInsertRowid);
}

async function insertIssue(db: SQLiteAdapter, auditId: number, userId: string): Promise<void> {
  await db.run(`INSERT INTO audit_issues (audit_id, user_id) VALUES (?, ?)`, [auditId, userId]);
}

const GUEST = "guest:1.2.3.4";
const USER = "user-1";
const NOW = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const hoursAgo = (h: number) => iso(new Date(NOW.getTime() - h * 3600 * 1000));

describe("claimGuestAudits", () => {
  it("转移近 24h 内的访客审计与其问题清单到账号", async () => {
    currentAdapter = makeAdapter();
    const recentId = await insertAudit(currentAdapter, GUEST, "example.com", hoursAgo(2));
    await insertIssue(currentAdapter, recentId, GUEST);

    const moved = await claimGuestAudits(GUEST, USER);
    expect(moved).toBe(1);

    const audit = await currentAdapter.get(`SELECT user_id FROM audits WHERE id = ?`, [recentId]) as { user_id: string };
    expect(audit.user_id).toBe(USER);
    const issue = await currentAdapter.get(`SELECT user_id FROM audit_issues WHERE audit_id = ?`, [recentId]) as { user_id: string };
    expect(issue.user_id).toBe(USER);
  });

  it("超过 24h 的访客审计不转移", async () => {
    currentAdapter = makeAdapter();
    const oldId = await insertAudit(currentAdapter, GUEST, "example.com", hoursAgo(30));

    const moved = await claimGuestAudits(GUEST, USER);
    expect(moved).toBe(0);
    const row = await currentAdapter.get(`SELECT user_id FROM audits WHERE id = ?`, [oldId]) as { user_id: string };
    expect(row.user_id).toBe(GUEST);
  });

  it("带 domain 过滤时只转移该域名的审计", async () => {
    currentAdapter = makeAdapter();
    const targetId = await insertAudit(currentAdapter, GUEST, "target.com", hoursAgo(1));
    const otherId = await insertAudit(currentAdapter, GUEST, "other.com", hoursAgo(1));
    insertIssue(currentAdapter, targetId, GUEST);
    await insertIssue(currentAdapter, otherId, GUEST);

    const moved = await claimGuestAudits(GUEST, USER, "target.com");
    expect(moved).toBe(1);
    const ids = await currentAdapter.query(`SELECT id, user_id FROM audits ORDER BY id`) as Array<{ id: number; user_id: string }>;
    expect(ids.find((r) => r.id === targetId)?.user_id).toBe(USER);
    expect(ids.find((r) => r.id === otherId)?.user_id).toBe(GUEST);
  });

  it("不触碰其他访客或其他用户的记录", async () => {
    currentAdapter = makeAdapter();
    const mineId = await insertAudit(currentAdapter, GUEST, "example.com", hoursAgo(1));
    const otherGuestId = await insertAudit(currentAdapter, "guest:5.6.7.8", "example.com", hoursAgo(1));
    const userOwnedId = await insertAudit(currentAdapter, USER, "example.com", hoursAgo(1));

    const moved = await claimGuestAudits(GUEST, USER);
    expect(moved).toBe(1);
    const rows = await currentAdapter.query(`SELECT id, user_id FROM audits`) as Array<{ id: number; user_id: string }>;
    expect(rows.find((r) => r.id === mineId)?.user_id).toBe(USER);
    expect(rows.find((r) => r.id === otherGuestId)?.user_id).toBe("guest:5.6.7.8");
    expect(rows.find((r) => r.id === userOwnedId)?.user_id).toBe(USER);
  });
});
