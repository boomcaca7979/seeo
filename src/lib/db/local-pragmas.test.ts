// ===== 本地 SQLite 连接级 PRAGMA 的并发契约 =====
// 根因（`next build` 多 worker 冷启动的 SQLITE_BUSY 真实来源）：
//   `PRAGMA journal_mode = WAL` 需要独占写锁，而 SQLite 对这条 PRAGMA **不调用
//   busy handler** —— busy_timeout 帮不上忙，抢不到锁当场就抛「database is locked」。
//   先赢的 worker 正在事务里跑迁移，其余 worker 全部死在这一句上。
// 这里钉住修复的三条要求：
//   1) busy_timeout 必须打在第一条语句之前（后续 BEGIN IMMEDIATE 才会排队等锁）；
//   2) WAL 转换按退避自己等，等到成功为止；
//   3) 等不到锁 / 非锁错误一律上抛，绝不静默跳过 WAL 或把失败当成功。

import { describe, it, expect, vi } from "vitest";
import type Database from "better-sqlite3";
import { applyLocalSqlitePragmas, DB_BUSY_TIMEOUT_MS } from "./adapter";

type LocalRaw = Pick<Database.Database, "pragma">;
type Probe = { mode: string; throwOn?: (attempt: number) => Error | null };

function fakeSqlite(probe: Probe) {
  const calls: { sql: string; simple?: boolean }[] = [];
  let attempts = 0;
  const raw = {
    pragma(sql: string, opts?: { simple?: boolean }) {
      calls.push({ sql, simple: opts?.simple });
      if (!/journal_mode/.test(sql)) return undefined;
      attempts += 1;
      const err = probe.throwOn?.(attempts);
      if (err) throw err;
      // 真实行为：成功返回模式名；拿不到锁时返回旧模式（不抛）或直接抛 SQLITE_BUSY
      return opts?.simple ? probe.mode : [{ journal_mode: probe.mode }];
    },
  };
  return { calls, raw: raw as unknown as LocalRaw };
}

function busy(): Error {
  return Object.assign(new Error("SqliteError: database is locked"), { code: "SQLITE_BUSY" });
}

const journalCalls = (calls: { sql: string; simple?: boolean }[]) =>
  calls.filter((c) => /journal_mode/.test(c.sql));

describe("applyLocalSqlitePragmas：语句顺序", () => {
  it("busy_timeout 先于 journal_mode，foreign_keys 已打开，一次成功不白等", async () => {
    const { calls, raw } = fakeSqlite({ mode: "wal" });
    const wait = vi.fn(async () => {});

    await expect(applyLocalSqlitePragmas(raw, wait)).resolves.toBeUndefined();

    const order = calls.map((c) => c.sql);
    expect(order[0]).toBe(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    expect(order.indexOf("foreign_keys = ON")).toBeLessThan(
      order.findIndex((s) => /journal_mode/.test(s))
    );
    // better-sqlite3 的 db.pragma() 自带 PRAGMA 前缀，这里必须传「赋值片段」而非完整语句
    expect(order.every((s) => !s.startsWith("PRAGMA "))).toBe(true);
    expect(journalCalls(calls).length).toBe(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("WAL 结果按 simple 读取；非 wal（如回退 delete）不算成功，重试后仍失败就抛", async () => {
    const { calls, raw } = fakeSqlite({ mode: "delete" });
    const wait = vi.fn(async () => {});

    await expect(applyLocalSqlitePragmas(raw, wait)).rejects.toThrow(/WAL 转换始终等不到写锁/);

    const journal = journalCalls(calls);
    expect(journal.length).toBeGreaterThan(1);
    expect(journal.every((c) => c.simple === true)).toBe(true);
  });
});

describe("applyLocalSqlitePragmas：写锁冲突退避重试", () => {
  it("第 3 次才拿到锁 → 前两次按递增退避等待，最终成功且顺序不变", async () => {
    const { calls, raw } = fakeSqlite({ mode: "wal", throwOn: (n) => (n < 3 ? busy() : null) });
    const waits: number[] = [];
    const wait = vi.fn(async (ms: number) => {
      waits.push(ms);
    });

    await applyLocalSqlitePragmas(raw, wait);

    expect(waits.length).toBeGreaterThanOrEqual(2);
    expect([...waits].sort((a, b) => a - b)).toEqual(waits); // 退避单调递增
    expect(journalCalls(calls).length).toBe(3);
    expect(calls[0].sql).toBe(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  });

  it("始终拿不到锁 → 上抛并带上最后一次原因，绝不返回「成功」", async () => {
    const { calls, raw } = fakeSqlite({ mode: "delete", throwOn: () => busy() });
    const wait = vi.fn(async () => {});

    const err = await applyLocalSqlitePragmas(raw, wait).then(
      () => new Error("WAL 转换失败时不应 resolve"),
      (e: unknown) => e as Error
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/WAL 转换始终等不到写锁/);
    expect(String((err as Error & { cause?: unknown }).cause)).toMatch(/database is locked/);
    // 重试必须有上限，不能无限自旋把初始化拖死
    expect(journalCalls(calls).length).toBeLessThan(20);
  });

  it("非锁错误（语法/权限类）立即原样上抛，不重试、不吞", async () => {
    const { calls, raw } = fakeSqlite({
      mode: "wal",
      throwOn: () => Object.assign(new Error("SqliteError: attempt to write a readonly database"), { code: "SQLITE_READONLY" }),
    });
    const wait = vi.fn(async () => {});

    await expect(applyLocalSqlitePragmas(raw, wait)).rejects.toThrow(/readonly database/);

    expect(journalCalls(calls).length).toBe(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
