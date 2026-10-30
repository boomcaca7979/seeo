// ===== 初始化/迁移并发闸门（SQLITE_BUSY 根因回归） =====
// 背景：`next build` 用多个 worker（**独立进程**）收集页面数据，每个 worker 各自开一条
// SQLite 连接跑迁移。旧实现没有 busy_timeout、没有版本闸门、迁移体里的错误一律 catch 吞掉，
// 于是并发时出现 SQLITE_BUSY / "database is locked"（修复前构建日志实测 32 次），
// 而且「迁移失败」和「迁移已完成」在库里长得一样。
// 本文件用隔离临时库（绝不碰 data/seeo-ui-preview.db）验证三件事：
// 独占写锁 + PRAGMA user_version 闸门 + 错误上抛。
// 注意：并发用例必须跨进程——better-sqlite3/libsql 的本地驱动是同步的，
// 同进程里让两条连接互相等只会阻塞事件循环，那不是我复现出的真实场景。

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  DB_BUSY_TIMEOUT_MS,
  SQLiteAdapter,
  isBusyDbError,
  type DBAdapter,
} from "./adapter";
import {
  REMOTE_CLAIM_WAIT_MS,
  REMOTE_LEASE_RENEW_MS,
  REMOTE_MIGRATION_LEASE_MS,
  SCHEMA_VERSION,
  closeDb,
  ensureSchema,
  getAdapter,
  getSchemaInitResult,
  type SchemaInitResult,
} from "./migrations";
import { TursoAdapter } from "./turso-adapter";
import { assertIsolatedTestDb } from "./test-db";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = process.cwd();
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "seeo-schema-init-")));

/** 仓库里的本地 demo 库：本文件一切用例都必须跑在临时目录里，不许碰它 */
const repoDemoDb = path.join(REPO, "data", "seeo.db");
/** 内容指纹（size+mtime 不够：并发用例可能只改字节不改 mtime） */
function snapshot(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const s = fs.statSync(file);
  return `${s.size}:${Math.round(s.mtimeMs)}:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}
let repoDemoDbBefore: string | null = null;

let fileSeq = 0;
function nextDbFile(): string {
  fileSeq += 1;
  // 每条用例的库路径都要断言在临时目录内（解析到仓库 data/ 就当场失败）
  return assertIsolatedTestDb(path.join(tmpRoot, `case-${fileSeq}.db`));
}

/** 本地 better-sqlite3 适配器：与 getAdapter() 的 demo 分支同样的连接设置 */
function openSqliteAdapter(file: string): SQLiteAdapter {
  const raw = new Database(file);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  return new SQLiteAdapter(raw);
}

function openTursoFileAdapter(file: string): TursoAdapter {
  return new TursoAdapter(`file://${file}`, "local");
}

/**
 * 包住适配器**连同它的迁移锁**：迁移体是在锁里用 `lock.adapter` 执行的，
 * 只包外层等于没拦截（这一点本身就容易写错，所以抽成一个工具）。
 */
function wrapWrites(db: DBAdapter, beforeWrite: (sql: string) => void): DBAdapter {
  const make = (target: DBAdapter): DBAdapter => ({
    query: (sql, params) => target.query(sql, params),
    get: (sql, params) => target.get(sql, params),
    run: (sql, params) => {
      beforeWrite(sql);
      return target.run(sql, params);
    },
    exec: (sql) => {
      beforeWrite(sql);
      return target.exec(sql);
    },
    close: () => target.close(),
    migrationControl: () => null,
  });
  const control = db.migrationControl?.() ?? null;
  const base = make(db);
  if (!control) return base;
  return {
    ...base,
    migrationControl: () => ({
      readVersion: () => control.readVersion(),
      acquireLock: async () => {
        const lock = await control.acquireLock();
        return { ...lock, adapter: make(lock.adapter) };
      },
    }),
  };
}

function countWrites(db: DBAdapter): { proxy: DBAdapter; writes: () => number } {
  let writes = 0;
  return { proxy: wrapWrites(db, () => (writes += 1)), writes: () => writes };
}

/**
 * 远端库的分支身份 = 「适配器不提供本地写锁」（`migrationControl()` 返回 null）。
 * 用真实 SQLite 文件披上这个身份，就能在本机跑通整条远端闸门：版本表、租约抢占、
 * 盖章与失败让约都不依赖传输层，只有往返延迟依赖（延迟在测量脚本里单独建模）。
 *
 * `log` 记录**每一条**经过的语句（含抛错的那条）：远程路径上一条语句 = 一次 HTTP
 * 往返，所以这个数组就是「冷启动到底发了多少条 SQL」的直接计量。
 */
function asRemoteAdapter(db: DBAdapter, log: string[]): DBAdapter {
  const track = <T>(sql: string, run: () => Promise<T>): Promise<T> => {
    log.push(sql.replace(/\s+/g, " ").trim().slice(0, 90));
    return run();
  };
  return {
    query: (sql, params) => track(sql, () => db.query(sql, params)),
    get: (sql, params) => track(sql, () => db.get(sql, params)),
    run: (sql, params) => track(sql, () => db.run(sql, params)),
    exec: (sql) => track(sql, () => db.exec(sql)),
    close: () => db.close(),
    migrationControl: () => null,
  };
}

/** 版本表单行（闸门的全部持久状态） */
async function readMetaRow(
  db: DBAdapter
): Promise<{ version: number; claim_owner: string | null; claim_expires_at: number | null } | undefined> {
  return (await db.get(
    `SELECT version, claim_owner, claim_expires_at FROM schema_meta WHERE id = 1`
  )) as
    | { version: number; claim_owner: string | null; claim_expires_at: number | null }
    | undefined;
}

/**
 * 在 `asRemoteAdapter` 之上再加一道「迁移体的第一条业务写语句挂起」的闸门。
 *
 * 为什么需要它：租约过期这个状态在真实世界里要迁移跑满 45 秒才会出现，而测试既不能
 * 真等 45 秒，也不能靠改短租约（那测的就不是同一份契约）。挂起迁移体里的第一条写语句，
 * 就能确定性地造出「进程还活着、迁移还没跑完、租约已过期」，然后用可控时钟推过去。
 *
 * 判据只用**写语句**：闸门自己只读库或改 schema_meta，所以「第一条不碰 schema_meta 的
 * 写」必然来自迁移体。用读语句判会误判——版本探测也是读，会把「还没抢到租约」当成
 * 「正在迁移」（这个坑本文件踩过一次，代价是整条用例在真实退避预算上白等 46 秒）。
 * `insideMigrate()` 因此就是「这个实例正在跑 migrate()」的直接证据。
 */
/** 续租语句（与 `leaseRenewalSql()` 同锚点）：闸门簿记里唯一按周期重复的那条 */
function isLeaseRenewal(sql: string): boolean {
  return /^UPDATE schema_meta SET claim_expires_at/i.test(sql);
}

/**
 * 在 `asRemoteAdapter` 之上再加两道可注入的故障，用来造出真实世界要等满 45 秒才会
 * 出现的状态，而不用真等：
 *
 * 1. `gate`：挂起迁移体的**第一条业务写语句**。进程还活着、迁移还没跑完，租约随可控
 *    时钟过期 —— 这是「接管 vs 并发迁移」的最小模型。
 * 2. `renewal`：改写续租请求的命运。`"fail"` 让它根本没拿到结果（HTTP 层网络错误/超时，
 *    对应「不确定」），`"hold"` 让它永远悬在途（对应 RTT 抖动下的重叠堆积风险）。
 *    两者都不碰库，所以 `claim_expires_at` 停在旧值，能区分「库里确认我不是持有人」
 *    和「我压根不知道」这两条不同的失效路径。
 *
 * 判据只用**写语句**：闸门自己只读库或改 schema_meta，所以「第一条不碰 schema_meta 的
 * 写」必然来自迁移体。用读语句判会误判——版本探测也是读，会把「还没抢到租约」当成
 * 「正在迁移」（这个坑本文件踩过一次，代价是整条用例在真实退避预算上白等 46 秒）。
 * `insideMigrate()` 因此就是「这个实例正在跑 migrate()」的直接证据。
 *
 * `renewals()` 只数**发出的请求**，`renewalInflight()` 数其中未落定的，
 * `maxRenewalInflight()` 是历史峰值：峰值 > 1 就等于续租请求在排队堆积。
 */
function gatedRemote(
  db: DBAdapter,
  log: string[],
  opts: {
    gate?: Promise<void>;
    renewal?: "fail" | "hold";
    renewalSettle?: Promise<void>;
  } = {}
): {
  remote: DBAdapter;
  insideMigrate: () => boolean;
  renewals: () => number;
  renewalInflight: () => number;
  maxRenewalInflight: () => number;
} {
  let inside = false;
  let armed = !!opts.gate;
  let held = false;
  let renewals = 0;
  let inflight = 0;
  let peak = 0;
  const call = async <T>(sql: string, isWrite: boolean, run: () => Promise<T>): Promise<T> => {
    log.push(sql.replace(/\s+/g, " ").trim().slice(0, 90));
    if (isLeaseRenewal(sql)) {
      renewals += 1;
      inflight += 1;
      peak = Math.max(peak, inflight);
      try {
        // hold 只掐住第一次续租：放开后链必须能自己往下走，否则测不到「续租继续」
        if (opts.renewal === "fail") throw new Error("injected renewal transport failure");
        if (opts.renewal === "hold" && !held && opts.renewalSettle) {
          held = true;
          await opts.renewalSettle;
        }
        return await run();
      } finally {
        inflight -= 1;
      }
    }
    if (isWrite && !/schema_meta/i.test(sql)) {
      inside = true;
      if (armed && opts.gate) {
        armed = false;
        await opts.gate;
      }
    }
    return run();
  };
  return {
    insideMigrate: () => inside,
    renewals: () => renewals,
    renewalInflight: () => inflight,
    maxRenewalInflight: () => peak,
    remote: {
      query: (sql, params) => call(sql, false, () => db.query(sql, params)),
      get: (sql, params) => call(sql, false, () => db.get(sql, params)),
      run: (sql, params) => call(sql, true, () => db.run(sql, params)),
      exec: (sql) => call(sql, true, () => db.exec(sql)),
      close: () => db.close(),
      migrationControl: () => null,
    },
  };
}

/** 迁移体真正改结构的语句（闸门簿记除外）：用于断言「 parked 期间没跑任何业务写」 */
function bodyWrites(log: string[]): string[] {
  return log.filter(
    (sql) => /^(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)/i.test(sql) && !/schema_meta/i.test(sql)
  );
}

/** 挂起点的 drain：fake timers 下不能靠 setTimeout 轮询，只能排干微任务 */
async function waitUntil(cond: () => boolean, label: string): Promise<void> {
  for (let tick = 0; tick < 20000; tick++) {
    if (cond()) return;
    await Promise.resolve();
  }
  throw new Error(`等待超时：${label}`);
}

/** 把远端版本退回 0（业务结构留着）：模拟「库里还没盖章」的冷启动场景 */
async function rewindRemoteVersion(file: string): Promise<void> {
  const db = openSqliteAdapter(file);
  try {
    await db.run(
      `UPDATE schema_meta SET version = 0, claim_owner = NULL, claim_expires_at = NULL WHERE id = 1`
    );
  } finally {
    db.close();
  }
}

function readUserVersion(file: string): number {
  const raw = new Database(file);
  try {
    return Number(raw.pragma("user_version", { simple: true }));
  } finally {
    raw.close();
  }
}

async function tableNames(db: DBAdapter): Promise<Set<string>> {
  const rows = (await db.query(`SELECT name FROM sqlite_master WHERE type='table'`)) as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

beforeAll(() => {
  repoDemoDbBefore = snapshot(repoDemoDb);
});

afterAll(async () => {
  closeDb();
  await new Promise((resolve) => setTimeout(resolve, 50));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  // 隔离性守卫：并发用例只允许写临时库
  expect(snapshot(repoDemoDb)).toBe(repoDemoDbBefore);
});

describe("迁移闸门：版本化 + 独占写锁", () => {
  it("全新库首次初始化应用迁移并盖上 SCHEMA_VERSION", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    try {
      const result = await ensureSchema(db);
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect(readUserVersion(file)).toBe(SCHEMA_VERSION);
      const tables = await tableNames(db);
      for (const required of [
        "projects",
        "audits",
        "content_checks",
        "payment_notifications",
      ]) {
        expect(tables.has(required)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("版本已满足时只做一次读，零写入（稳态初始化不再抢锁）", async () => {
    const file = nextDbFile();
    const first = openSqliteAdapter(file);
    try {
      await ensureSchema(first);
    } finally {
      first.close();
    }

    const db = openSqliteAdapter(file);
    const { proxy, writes } = countWrites(db);
    try {
      const result = await ensureSchema(proxy);
      expect(result).toEqual({ applied: false, version: SCHEMA_VERSION, reason: "current" });
      expect(writes()).toBe(0);
    } finally {
      db.close();
    }
  });

  it("库里版本比代码新时不倒退盖章，也不重复迁移", async () => {
    const file = nextDbFile();
    const seed = openSqliteAdapter(file);
    try {
      await ensureSchema(seed);
      const ctl = seed.migrationControl();
      expect(ctl).not.toBeNull();
      const lock = await ctl!.acquireLock();
      await lock.setVersion(SCHEMA_VERSION + 3);
      await lock.commit();
    } finally {
      seed.close();
    }

    const db = openSqliteAdapter(file);
    const { proxy, writes } = countWrites(db);
    try {
      const result = await ensureSchema(proxy);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe("ahead");
      expect(writes()).toBe(0);
      expect(readUserVersion(file)).toBe(SCHEMA_VERSION + 3);
    } finally {
      db.close();
    }
  });

  it("迁移体中途失败：错误上抛、整批 DDL 回滚、版本号不盖章", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    const sabotage = wrapWrites(db, (sql) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS tracked_keywords")) {
        throw new Error("injected migration failure");
      }
    });
    try {
      await expect(ensureSchema(sabotage)).rejects.toThrow(/injected migration failure/);
      expect(readUserVersion(file)).toBe(0);
      // SQLite 的 DDL 是事务性的：失败那一批结构必须整体回滚，不能留半套表
      expect((await tableNames(db)).size).toBe(0);

      // 回滚后连接没有被卡在失败事务里：补跑一次必须成功
      const retry = await ensureSchema(db);
      expect(retry).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect(readUserVersion(file)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("迁移体末尾失败（默认配置写入那一步）同样不盖章", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    const sabotage = wrapWrites(db, (sql) => {
      if (sql.includes("INSERT OR IGNORE INTO automation_settings")) {
        throw new Error("injected tail failure");
      }
    });
    try {
      await expect(ensureSchema(sabotage)).rejects.toThrow(/injected tail failure/);
      expect(readUserVersion(file)).toBe(0);
      expect((await tableNames(db)).size).toBe(0);
    } finally {
      db.close();
    }
  });

  it("写入计数确实覆盖到迁移体（否则上面的「零写入」断言是空断言）", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    const { proxy, writes } = countWrites(db);
    try {
      const result = await ensureSchema(proxy);
      expect(result.applied).toBe(true);
      expect(writes()).toBeGreaterThan(20);
    } finally {
      db.close();
    }
  });

  it("远端分支（无本地写锁）首次初始化应用迁移并把版本写进库", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    const statements: string[] = [];
    try {
      const result = await ensureSchema(asRemoteAdapter(db, statements));
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect((await tableNames(db)).has("projects")).toBe(true);
      // 版本记在库里，不是进程内状态：否则换一个冷启动实例就又要重放整套迁移
      expect(await readMetaRow(db)).toMatchObject({
        version: SCHEMA_VERSION,
        claim_owner: null,
        claim_expires_at: null,
      });
    } finally {
      db.close();
    }
  });
});

describe("远端 Turso 版本闸门：冷启动不再重放整套迁移", () => {
  /** 迁移体里的语句特征：稳态初始化里一条都不该出现 */
  const MIGRATION_MARKERS = [
    "CREATE TABLE IF NOT EXISTS tracked_keywords",
    "INSERT OR IGNORE INTO automation_settings",
    "ALTER TABLE",
  ];

  function seededRemote(file: string): { db: DBAdapter; log: string[]; remote: DBAdapter } {
    const db = openSqliteAdapter(file);
    const log: string[] = [];
    return { db, log, remote: asRemoteAdapter(db, log) };
  }

  it("冷启动成本对照：重放整套迁移的语句数 vs 版本闸门的 2 条", async () => {
    const file = nextDbFile();

    // 先把库带到「已是当前版本」的状态（生产库此刻就长这样：所有表都在）
    const boot = seededRemote(file);
    try {
      expect((await ensureSchema(boot.remote)).applied).toBe(true);
    } finally {
      boot.db.close();
    }

    // 对照组：版本记录落后 → 整套迁移必须在「结构已全部存在」的库上重放一遍，
    // 每个 addColumnIfMissing 都要先探测表、再读 PRAGMA，这正是远程往返的来源。
    const rewind = openSqliteAdapter(file);
    try {
      await rewind.run(`UPDATE schema_meta SET version = 0 WHERE id = 1`);
    } finally {
      rewind.close();
    }
    const replay = seededRemote(file);
    let replayStatements = 0;
    try {
      const result = await ensureSchema(replay.remote);
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      replayStatements = replay.log.length;
      expect(replay.log.join("\n")).toContain("CREATE TABLE IF NOT EXISTS tracked_keywords");
    } finally {
      replay.db.close();
    }

    // 修复组：结构没变、请求没变、计时方式没变，只剩一次表探测 + 一次版本读
    const steady = seededRemote(file);
    try {
      const result = await ensureSchema(steady.remote);
      expect(result).toEqual({ applied: false, version: SCHEMA_VERSION, reason: "current" });
      expect(steady.log).toHaveLength(2);
      expect(steady.log.every((sql) => sql.startsWith("SELECT"))).toBe(true);
      // 按实测单程 ~220ms 折算：~93 条串行远程语句 ≈ 20 秒，2 条 ≈ 0.4 秒
      expect(replayStatements).toBeGreaterThanOrEqual(90);
      expect(replayStatements / steady.log.length).toBeGreaterThanOrEqual(45);
    } finally {
      steady.db.close();
    }
  });

  it("版本已满足的库：新进程初始化只剩两次远程读、零写入", async () => {
    const file = nextDbFile();
    const first = seededRemote(file);
    try {
      await ensureSchema(first.remote);
    } finally {
      first.db.close();
    }

    // 换一条连接 = 换一个全新进程（闸门状态只可能来自库里）
    const { db, log, remote } = seededRemote(file);
    try {
      const result = await ensureSchema(remote);
      expect(result).toEqual({ applied: false, version: SCHEMA_VERSION, reason: "current" });
      expect(log, `稳态初始化发出了 ${log.length} 条语句`).toHaveLength(2);
      for (const marker of MIGRATION_MARKERS) {
        expect(log.join("\n")).not.toContain(marker);
      }
    } finally {
      db.close();
    }
  });

  it("同一进程内重复初始化同样只剩两次读（不只是跨进程有效）", async () => {
    const { db, log, remote } = seededRemote(nextDbFile());
    try {
      await ensureSchema(remote);
      const after = log.length;
      const again = await ensureSchema(remote);
      expect(again).toEqual({ applied: false, version: SCHEMA_VERSION, reason: "current" });
      expect(log.length - after).toBe(2);
    } finally {
      db.close();
    }
  });

  it("版本落后时完整执行迁移，并只把版本号往前推", async () => {
    const file = nextDbFile();
    const seed = seededRemote(file);
    try {
      await ensureSchema(seed.remote);
      // 代码回滚/别人抢先：把版本记成一个更低的值，必须重跑迁移而不是跳过
      await seed.db.run(`UPDATE schema_meta SET version = 0 WHERE id = 1`);
    } finally {
      seed.db.close();
    }

    const { db, log, remote } = seededRemote(file);
    try {
      const result = await ensureSchema(remote);
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect(log.join("\n")).toContain("CREATE TABLE IF NOT EXISTS tracked_keywords");
      expect(await readMetaRow(db)).toMatchObject({ version: SCHEMA_VERSION });
    } finally {
      db.close();
    }
  });

  it("库里版本比代码新时不倒退盖章，也不重复迁移", async () => {
    const file = nextDbFile();
    const seed = seededRemote(file);
    try {
      await ensureSchema(seed.remote);
      await seed.db.run(`UPDATE schema_meta SET version = ? WHERE id = 1`, [
        SCHEMA_VERSION + 3,
      ]);
    } finally {
      seed.db.close();
    }

    const { db, log, remote } = seededRemote(file);
    try {
      const result = await ensureSchema(remote);
      expect(result).toEqual({
        applied: false,
        version: SCHEMA_VERSION + 3,
        reason: "ahead",
      });
      expect(log).toHaveLength(2);
      expect(await readMetaRow(db)).toMatchObject({ version: SCHEMA_VERSION + 3 });
    } finally {
      db.close();
    }
  });

  it("迁移中途失败：让出租约、不盖章，下一次初始化能重试并成功", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    const boom: string[] = [];
    const sabotage = asRemoteAdapter(db, boom);
    const failing: DBAdapter = {
      ...sabotage,
      exec: (sql) => {
        if (sql.includes("CREATE TABLE IF NOT EXISTS tracked_keywords")) {
          throw new Error("injected remote migration failure");
        }
        return sabotage.exec(sql);
      },
    };
    try {
      await expect(ensureSchema(failing)).rejects.toThrow(/injected remote migration failure/);
      const meta = await readMetaRow(db);
      expect(meta).toMatchObject({ version: 0 });
      // 租约已交回：下一个进程不必等满 45 秒才接手
      expect(meta?.claim_owner).toBeNull();
      expect((await tableNames(db)).size).toBe(1); // 只有 schema_meta，业务表一套都没落地

      const ok: string[] = [];
      const retry = await ensureSchema(asRemoteAdapter(db, ok));
      expect(retry).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect(await readMetaRow(db)).toMatchObject({
        version: SCHEMA_VERSION,
        claim_owner: null,
      });
    } finally {
      db.close();
    }
  });

  it("别人持有未过期租约时不抢、不自跑迁移，等满预算后报错而不是假装成功", async () => {
    const file = nextDbFile();
    const seed = seededRemote(file);
    try {
      await ensureSchema(seed.remote);
      // 「别的实例」正在应用迁移：版本被退回 0，租约远未过期
      await seed.db.run(
        `UPDATE schema_meta SET version = 0, claim_owner = 'other-instance', claim_expires_at = ? WHERE id = 1`,
        [Date.now() + 3_600_000]
      );
    } finally {
      seed.db.close();
    }

    vi.useFakeTimers();
    const db = openSqliteAdapter(file);
    const log: string[] = [];
    try {
      const pending = ensureSchema(asRemoteAdapter(db, log));
      // 先挂上断言再推进定时器：否则拒绝发生在 drain 期间，会被记成未处理拒绝
      const assertion = expect(pending).rejects.toThrow(/still claimed by another instance/);
      await vi.runAllTimersAsync();
      await assertion;
      const meta = await readMetaRow(db);
      expect(meta).toMatchObject({ version: 0, claim_owner: "other-instance" });
      // 一次迁移都没跑，也没偷偷盖章
      expect(log.join("\n")).not.toContain("ALTER TABLE");
      expect(log.join("\n")).not.toContain("CREATE TABLE IF NOT EXISTS tracked_keywords");
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });

  it("持有者退出留下过期租约时，下一个进程接管并完成迁移", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    try {
      // 版本表已存在（真实闸门建的），但单行停在「别人持有且租约已过期」的状态
      const boot: string[] = [];
      await ensureSchema(asRemoteAdapter(db, boot));
      await db.run(
        `UPDATE schema_meta SET version = 0, claim_owner = 'dead-instance', claim_expires_at = ? WHERE id = 1`,
        [Date.now() - 1]
      );
      await db.run(`DROP TABLE projects`);

      const log: string[] = [];
      const result = await ensureSchema(asRemoteAdapter(db, log));
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect((await tableNames(db)).has("projects")).toBe(true);
      expect(await readMetaRow(db)).toMatchObject({
        version: SCHEMA_VERSION,
        claim_owner: null,
      });
    } finally {
      db.close();
    }
  });

  // ===== 租约过期边界：45 秒这个上界本身是不是安全，不能靠 22.7 秒的模拟中位数担保 =====
  // 三条用例都用可控时钟 + 挂起迁移体语句构造状态，不真等 45 秒。

  it("迁移超过租约：旧持有者还在跑 migrate 时，第二个实例不得并发进入迁移体", async () => {
    const file = nextDbFile();
    const boot = seededRemote(file);
    try {
      expect((await ensureSchema(boot.remote)).applied).toBe(true);
    } finally {
      boot.db.close();
    }
    await rewindRemoteVersion(file);

    vi.useFakeTimers();
    const holder = openSqliteAdapter(file);
    const taker = openSqliteAdapter(file);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holderLog: string[] = [];
    const takerLog: string[] = [];
    let takenResult: SchemaInitResult | null = null;
    let takenError: string | null = null;
    try {
      // 实例 A：抢到租约后卡在迁移体第一条业务写上（进程还活着，只是慢）
      const a = gatedRemote(holder, holderLog, { gate });
      const held = ensureSchema(a.remote);
      await waitUntil(a.insideMigrate, "实例 A 进入迁移体");

      // 实例 B：同时在跑冷启动，它会一路排队直到租约过期
      const b = gatedRemote(taker, takerLog);
      void ensureSchema(b.remote).then(
        (r) => {
          takenResult = r;
        },
        (err: unknown) => {
          takenError = String((err as Error)?.message ?? err);
        }
      );
      await waitUntil(() => takerLog.length > 0, "实例 B 开始读版本");

      // 把时钟推过「租约上界 + B 的退避预算末尾」：此刻 A 仍挂在同一条业务写上，
      // 既没进展也没退出。任何接管都等于两个实例并发改同一批表结构。
      const claimBudget = REMOTE_CLAIM_WAIT_MS.reduce((total, ms) => total + ms, 0);
      await vi.advanceTimersByTimeAsync(claimBudget + REMOTE_MIGRATION_LEASE_MS / 8);

      expect(
        b.insideMigrate(),
        "租约一过期就接管，而旧持有者还活着并在跑 migrate() = 两个实例同时改同一批表结构"
      ).toBe(false);
      const during = await readMetaRow(taker);
      expect(during).toMatchObject({ version: 0 });
      expect(
        (during?.claim_expires_at ?? 0) > Date.now(),
        "活着的持有者必须还在续租，否则等待方会把它当死租约抢走"
      ).toBe(true);
      expect(
        takenError ?? (takenResult ? JSON.stringify(takenResult) : "pending"),
        "等不到租约时只能报错，不能假装初始化成功"
      ).toMatch(/still claimed by another instance/);

      // 释放旧持有者：它一直是合法持有人，必须正常完成并盖章
      release();
      await vi.advanceTimersByTimeAsync(1);
      expect(await held).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect(b.insideMigrate()).toBe(false);
      expect(await readMetaRow(taker)).toMatchObject({
        version: SCHEMA_VERSION,
        claim_owner: null,
        claim_expires_at: null,
      });
    } finally {
      holder.close();
      taker.close();
      vi.useRealTimers();
    }
  });

  it("慢但活着的持有者会续租：租约不会被时间本身判死", async () => {
    const file = nextDbFile();
    const boot = seededRemote(file);
    try {
      expect((await ensureSchema(boot.remote)).applied).toBe(true);
    } finally {
      boot.db.close();
    }
    await rewindRemoteVersion(file);

    vi.useFakeTimers();
    const db = openSqliteAdapter(file);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const log: string[] = [];
    try {
      const a = gatedRemote(db, log, { gate });
      const held = ensureSchema(a.remote);
      await waitUntil(a.insideMigrate, "持有者进入迁移体");

      // 恰好推到「一次完整迁移」的实测上限：此刻租约绝不该已经失效
      await vi.advanceTimersByTimeAsync(REMOTE_MIGRATION_LEASE_MS);
      const meta = await readMetaRow(db);
      expect(
        (meta?.claim_expires_at ?? 0) > Date.now(),
        `持有者仍在迁移且还活着，但租约已到期（expires_at=${String(meta?.claim_expires_at)}）`
      ).toBe(true);
      // 续租只碰版本表；挂起期间迁移体一条业务写都没往前走
      const renewals = log.filter((sql) =>
        /^UPDATE schema_meta SET claim_expires_at/i.test(sql)
      );
      expect(renewals.length).toBeGreaterThanOrEqual(1);
      expect(bodyWrites(log), "挂起期间不该有其他业务写").toHaveLength(1);

      release();
      expect(await held).toMatchObject({ applied: true, reason: "applied" });
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });

  it("租约被别的实例接管后，旧持有者不得盖章、也不得清除对方的租约", async () => {
    const file = nextDbFile();
    const boot = seededRemote(file);
    try {
      expect((await ensureSchema(boot.remote)).applied).toBe(true);
    } finally {
      boot.db.close();
    }
    await rewindRemoteVersion(file);

    const db = openSqliteAdapter(file);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    try {
      const a = gatedRemote(db, [], { gate });
      const held = ensureSchema(a.remote);
      await waitUntil(a.insideMigrate, "持有者进入迁移体");

      // 别的实例接管了租约（真实诱因：迁移跑过租约 / 时钟偏移 / 续租请求失败）
      await db.run(
        `UPDATE schema_meta SET claim_owner = 'other-instance', claim_expires_at = ? WHERE id = 1`,
        [Date.now() + 600_000]
      );

      release();
      // 旧持有者跑完了自己的迁移，但它已不再持有租约：不能替别人宣布「结构已就位」
      await expect(held).rejects.toThrow(/lost remote migration claim/);
      expect(await readMetaRow(db)).toMatchObject({
        version: 0,
        claim_owner: "other-instance",
      });

      // 拒绝盖章是可恢复的，不是死锁：租约过期后新进程照样能完成并盖章
      await db.run(
        `UPDATE schema_meta SET claim_owner = 'other-instance', claim_expires_at = ? WHERE id = 1`,
        [Date.now() - 1]
      );
      const log: string[] = [];
      expect(await ensureSchema(asRemoteAdapter(db, log))).toEqual({
        applied: true,
        version: SCHEMA_VERSION,
        reason: "applied",
      });
      expect(await readMetaRow(db)).toMatchObject({
        version: SCHEMA_VERSION,
        claim_owner: null,
      });
    } finally {
      db.close();
    }
  });

  // ===== 续租失效：盖章时的 owner 守卫只挡住「盖章」，挡不住失效之后那几十条 DDL =====
  // 下面三条都靠注入的续租行为 + 可控时钟造状态，不真等 45 秒，也不改短租约契约。

  it("续租确认 owner 已变：停止发出后续迁移语句，不盖章、不碰新持有人的租约", async () => {
    const file = nextDbFile();
    const boot = seededRemote(file);
    try {
      expect((await ensureSchema(boot.remote)).applied).toBe(true);
    } finally {
      boot.db.close();
    }
    await rewindRemoteVersion(file);

    vi.useFakeTimers();
    const db = openSqliteAdapter(file);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const log: string[] = [];
    try {
      const a = gatedRemote(db, log, { gate });
      const held = ensureSchema(a.remote);
      await waitUntil(a.insideMigrate, "持有者进入迁移体");
      const parkedWrites = bodyWrites(log).length;

      // 真实接管：租约换了主人且远未过期 → 我们的续租 UPDATE 只会匹配 0 行
      await db.run(
        `UPDATE schema_meta SET claim_owner = 'other-instance', claim_expires_at = ? WHERE id = 1`,
        [Date.now() + 600_000]
      );
      await vi.advanceTimersByTimeAsync(REMOTE_LEASE_RENEW_MS);
      expect(a.renewals(), "租约被别人持有期间，自己这一轮续租必须真的发出去了").toBe(1);

      release();
      await expect(held).rejects.toThrow(/lost remote migration claim/);

      // 失效信号必须在**每条语句发出前**生效：迁移体就此停在那条已经放行的写上，
      // 而不是把剩下整套 DDL 跑完再在末尾发现自己是局外人。
      expect(
        log.join("\n"),
        "失去租约后仍在推进迁移体 = 与新持有人并发改同一批表结构"
      ).not.toContain("INSERT OR IGNORE INTO automation_settings");
      expect(bodyWrites(log)).toHaveLength(parkedWrites);

      // 边界要说清楚：挡住的是「尚未发出」的语句。那条已经交到传输层的写确实落库了，
      // 本闸门不撤销、也撤销不了已发出的请求（remote 分支更没有事务可回滚）。
      expect((await tableNames(db)).has("tracked_keywords"), "已放行的语句应当照常落库").toBe(
        true
      );

      const after = await readMetaRow(db);
      expect(after).toMatchObject({ version: 0, claim_owner: "other-instance" });
      expect(
        (after?.claim_expires_at ?? 0) > Date.now(),
        "让约必须带 owner 守卫：不是自己持有的租约一条都不能清"
      ).toBe(true);
      expect(vi.getTimerCount(), "失败路径退出后不得残留续租定时器").toBe(0);

      // 拒绝盖章是可恢复的：等新持有人也死了，下一个进程照样接管并盖章
      await db.run(
        `UPDATE schema_meta SET claim_owner = 'other-instance', claim_expires_at = ? WHERE id = 1`,
        [Date.now() - 1]
      );
      const takeover: string[] = [];
      expect(await ensureSchema(asRemoteAdapter(db, takeover))).toEqual({
        applied: true,
        version: SCHEMA_VERSION,
        reason: "applied",
      });
      // 对照：同一个库、同一条代码路径，没有失效时一路跑到迁移体末尾那条写
      expect(takeover.join("\n")).toContain("INSERT OR IGNORE INTO automation_settings");
      expect(bodyWrites(takeover).length).toBeGreaterThan(parkedWrites);
      expect(await readMetaRow(db)).toMatchObject({
        version: SCHEMA_VERSION,
        claim_owner: null,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });

  it("续租请求本身失败（结果不确定）：fail-closed 停在当前语句，绝不盖章", async () => {
    const file = nextDbFile();
    const boot = seededRemote(file);
    try {
      expect((await ensureSchema(boot.remote)).applied).toBe(true);
    } finally {
      boot.db.close();
    }
    await rewindRemoteVersion(file);

    vi.useFakeTimers();
    const db = openSqliteAdapter(file);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const log: string[] = [];
    try {
      const a = gatedRemote(db, log, { gate, renewal: "fail" });
      const held = ensureSchema(a.remote);
      await waitUntil(a.insideMigrate, "持有者进入迁移体");

      await vi.advanceTimersByTimeAsync(REMOTE_LEASE_RENEW_MS);
      expect(a.renewals()).toBe(1);

      release();
      await expect(held).rejects.toThrow(/renewal request failed; lease state unknown/);
      expect(bodyWrites(log)).toHaveLength(1);
      expect(log.join("\n")).not.toContain("INSERT OR IGNORE INTO automation_settings");

      // 「不知道这条 UPDATE 落没落地」不能当成「还在持有」：HTTP 传输层的失败与
      // 「库里确认我不是持有人」这两种结论，适配器给不出区分，只能一律按失效处理。
      // 但租约本身仍是我们自己的，所以让约（带 owner 守卫）会成功——
      // 于是下一个进程不必等满一个租约周期就能接管。
      expect(await readMetaRow(db)).toMatchObject({ version: 0, claim_owner: null });
      expect(vi.getTimerCount(), "失败路径退出后不得残留续租定时器").toBe(0);

      expect(await ensureSchema(asRemoteAdapter(db, []))).toMatchObject({
        applied: true,
        reason: "applied",
      });
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });

  it("续租不重叠堆积：在途时不排第二条，落定后链继续，收尾不残留定时器", async () => {
    const file = nextDbFile();
    const boot = seededRemote(file);
    try {
      expect((await ensureSchema(boot.remote)).applied).toBe(true);
    } finally {
      boot.db.close();
    }
    await rewindRemoteVersion(file);

    vi.useFakeTimers();
    const db = openSqliteAdapter(file);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => (releaseGate = resolve));
    let settle: () => void = () => {};
    const renewalSettle = new Promise<void>((resolve) => (settle = resolve));
    const log: string[] = [];
    try {
      const a = gatedRemote(db, log, { gate, renewal: "hold", renewalSettle });
      const held = ensureSchema(a.remote);
      await waitUntil(a.insideMigrate, "持有者进入迁移体");

      await vi.advanceTimersByTimeAsync(REMOTE_LEASE_RENEW_MS);
      expect(a.renewals()).toBe(1);
      expect(a.renewalInflight()).toBe(1);

      // 一条续租卡在传输层时把时钟推过好几个周期：不得堆出第二条在途请求
      // （远程一条语句 = 一次往返，堆积既放大延迟，也让「哪一轮的结论」失去意义）
      await vi.advanceTimersByTimeAsync(REMOTE_LEASE_RENEW_MS * 5);
      expect(a.renewals()).toBe(1);
      expect(a.maxRenewalInflight(), "同时最多只允许一条续租在途").toBe(1);

      // 落定后链必须继续：否则慢-but-活着的持有者会被时间本身判死，退回上一轮的缺陷
      settle();
      await vi.advanceTimersByTimeAsync(0);
      expect(a.renewalInflight()).toBe(0);
      await vi.advanceTimersByTimeAsync(REMOTE_LEASE_RENEW_MS);
      expect(a.renewals()).toBe(2);

      // 下一轮已排上、迁移此时收尾：停止函数要清掉待发的定时器，
      // 且已经排出去的续租落定后不得重新排链（否则停止形同无效）
      releaseGate();
      expect(await held).toMatchObject({ applied: true, reason: "applied" });
      expect(log.join("\n"), "持有者没失效时迁移必须完整跑完").toContain(
        "INSERT OR IGNORE INTO automation_settings"
      );
      expect(vi.getTimerCount(), "成功路径退出后不得残留续租定时器").toBe(0);
      await vi.advanceTimersByTimeAsync(REMOTE_LEASE_RENEW_MS * 4);
      expect(a.renewals()).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      settle();
      db.close();
      vi.useRealTimers();
    }
  });

  it("本地文件库路径完全不变：仍走 user_version，库里不出现 schema_meta", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    try {
      const result = await ensureSchema(db);
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect(readUserVersion(file)).toBe(SCHEMA_VERSION);
      expect((await tableNames(db)).has("schema_meta")).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("SCHEMA_VERSION 升级契约", () => {
  /**
   * 「改了迁移体却忘记把 SCHEMA_VERSION +1」是这套闸门唯一无法自愈的失误：
   * 已盖章的库会永远跳过新迁移，直到某个请求撞上缺列/缺表才暴露，而那时库里已经
   * 记着「结构已就位」。migrations.ts 顶部只有注释约束（注释会腐烂），所以这里把
   * 它变成会失败的测试。
   *
   * 指纹取的是**去掉注释、折叠空白后的 migrate() 源码**：纯格式化/注释改动不会触发，
   * 增删一条迁移语句必然触发。指纹变了只有两条出路——要么这条改动本就不该存在，
   * 要么把它连同版本号一起提交。
   */
  const MIGRATE_BODY_SHA256 = "f7493df231697f8ab26130ae85d68b9ae5423e38be8a7ca3cf814892860b0ba0";

  function migrateBody(): string {
    const source = fs.readFileSync(path.join(HERE, "migrations.ts"), "utf8");
    const file = ts.createSourceFile("migrations.ts", source, ts.ScriptTarget.Latest, true);
    let decl: ts.FunctionDeclaration | undefined;
    file.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.getText(file) === "migrate") {
        decl = node;
      }
    });
    if (!decl) throw new Error("migrations.ts 里找不到 migrate()：迁移入口被改名或删除");
    return ts
      .transpileModule(decl!.getFullText(file), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true },
      })
      .outputText.replace(/\s+/g, " ")
      .trim();
  }

  it("迁移体指纹与记录的常量一致（否则必须同时把 SCHEMA_VERSION +1）", () => {
    const hash = crypto.createHash("sha256").update(migrateBody()).digest("hex");
    expect(
      hash,
      `迁移体已改动。若这是必要的结构变更：把 migrations.ts 的 SCHEMA_VERSION +1 并按新指纹更新本常量；` +
        `否则回退迁移体的改动。未 bump 版本时，已盖章（schema_meta.version / user_version 已到目标值）` +
        `的库会永久跳过这套新迁移。`
    ).toBe(MIGRATE_BODY_SHA256);
  });
});

describe("TursoAdapter（file:，预览与构建副本走的路径）", () => {
  it("本地文件库提供写锁并只应用一次迁移", async () => {
    const file = nextDbFile();
    const db = openTursoFileAdapter(file);
    try {
      expect(db.migrationControl()).not.toBeNull();
      const result = await ensureSchema(db);
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      expect(readUserVersion(file)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("重连同一个库时不再写入，且迁移用专用连接后主连接的 foreign_keys 仍生效", async () => {
    const file = nextDbFile();
    const first = openTursoFileAdapter(file);
    try {
      await ensureSchema(first);
    } finally {
      first.close();
    }

    const db = openTursoFileAdapter(file);
    const { proxy, writes } = countWrites(db);
    try {
      const result = await ensureSchema(proxy);
      expect(result.reason).toBe("current");
      expect(writes()).toBe(0);
      // 旧写法 client.transaction() 会把主连接换掉，constructor 上的 PRAGMA 全丢；
      // 迁移改走专用锁连接后，外键约束必须依然拦住孤儿行。
      await expect(
        db.run(
          `INSERT INTO gsc_connections
             (user_id, project_id, property_url, property_type, encrypted_credentials)
           VALUES ('u1', 987654, 'https://example.com', 'URL_PREFIX', 'x')`
        )
      ).rejects.toThrow(/FOREIGN KEY|foreign key/i);
    } finally {
      db.close();
    }
  });

  it("远端 URL 不提供本地写锁", () => {
    const remote = new TursoAdapter("libsql://example.turso.io", "token-for-test");
    try {
      expect(remote.migrationControl()).toBeNull();
    } finally {
      remote.close();
    }
  });
});

describe("旧库升级分支真的会执行（不再被 catch 吞掉）", () => {
  it("重建全局 UNIQUE domain 的 projects 并保留数据", async () => {
    const file = nextDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        domain TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO projects (name, domain) VALUES ('Legacy', 'legacy.example');
    `);
    raw.close();

    const db = openSqliteAdapter(file);
    try {
      const result = await ensureSchema(db);
      expect(result.applied).toBe(true);
      const def = (await db.get(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'`
      )) as { sql: string };
      expect(def.sql).toContain("UNIQUE (user_id, domain)");
      expect(def.sql).not.toContain("domain TEXT NOT NULL UNIQUE");
      const row = (await db.get(
        `SELECT name, user_id FROM projects WHERE domain=?`,
        ["legacy.example"]
      )) as { name: string; user_id: string } | undefined;
      expect(row?.name).toBe("Legacy");
      expect(row?.user_id).toBe("demo-user");
    } finally {
      db.close();
    }
  });

  it("重建带 CHECK (id = 1) 的 automation_settings 并保留数据", async () => {
    const file = nextDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE automation_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        daily_refresh_enabled INTEGER NOT NULL DEFAULT 0,
        daily_refresh_time TEXT NOT NULL DEFAULT '09:00',
        weekly_report_enabled INTEGER NOT NULL DEFAULT 0,
        weekly_report_day INTEGER NOT NULL DEFAULT 1,
        weekly_report_time TEXT NOT NULL DEFAULT '09:00',
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      INSERT INTO automation_settings (id, daily_refresh_time) VALUES (1, '07:30');
    `);
    raw.close();

    const db = openSqliteAdapter(file);
    try {
      await ensureSchema(db);
      const def = (await db.get(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='automation_settings'`
      )) as { sql: string };
      expect(def.sql).not.toContain("CHECK (id = 1)");
      const row = (await db.get(
        `SELECT daily_refresh_time FROM automation_settings WHERE id=1`
      )) as { daily_refresh_time: string };
      expect(row.daily_refresh_time).toBe("07:30");
      const columns = (await db.query(`PRAGMA table_info(automation_settings)`)) as {
        name: string;
      }[];
      expect(columns.map((c) => c.name)).toContain("user_id");
    } finally {
      db.close();
    }
  });

  it("补列只加缺的那一列，已有列和数据都不动", async () => {
    const file = nextDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        pages_crawled INTEGER,
        health_score INTEGER,
        status TEXT,
        errors INTEGER,
        warnings INTEGER,
        notices INTEGER,
        comparison TEXT,
        user_id TEXT NOT NULL DEFAULT 'keep-me'
      );
      INSERT INTO audits (domain, comparison, user_id) VALUES ('a.example', '{"k":1}', 'u1');
    `);
    raw.close();

    const db = openSqliteAdapter(file);
    try {
      await ensureSchema(db);
      const row = (await db.get(
        `SELECT comparison, user_id, depth FROM audits WHERE domain=?`,
        ["a.example"]
      )) as { comparison: string; user_id: string; depth: string };
      expect(row.comparison).toBe('{"k":1}');
      expect(row.user_id).toBe("u1");
      expect(row.depth).toBe("quick");
    } finally {
      db.close();
    }
  });

  it("表还不存在时跳过补列（由 CREATE TABLE 带出），不会误报", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    try {
      await ensureSchema(db);
      const columns = (await db.query(`PRAGMA table_info(content_checks)`)) as { name: string }[];
      expect(columns.map((c) => c.name)).toEqual(
        expect.arrayContaining(["content_score", "internal_links_count", "user_id"])
      );
    } finally {
      db.close();
    }
  });
});

describe("getAdapter() 进程内初始化", () => {
  const ENV_KEYS = [
    "NEXT_PUBLIC_ENABLE_AUTH",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    closeDb();
  });

  it("并发首调共享同一次建连与迁移；重连后只剩一次版本读", async () => {
    const file = nextDbFile();
    closeDb();
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
    process.env.TURSO_DATABASE_URL = `file://${file}`;
    process.env.TURSO_AUTH_TOKEN = "local";

    const [a, b] = await Promise.all([getAdapter(), getAdapter()]);
    expect(a).toBe(b);
    expect(getSchemaInitResult()).toEqual({
      applied: true,
      version: SCHEMA_VERSION,
      reason: "applied",
    });

    const inserted = await a.run("INSERT INTO projects (name, domain) VALUES (?, ?)", [
      "race",
      "race.example",
    ]);
    expect(inserted.changes).toBe(1);

    closeDb();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const c = await getAdapter();
    expect(getSchemaInitResult()).toEqual({
      applied: false,
      version: SCHEMA_VERSION,
      reason: "current",
    });
    const kept = (await c.get(`SELECT name FROM projects WHERE domain=?`, [
      "race.example",
    ])) as { name: string } | undefined;
    expect(kept?.name).toBe("race");
    closeDb();
  });

  it("初始化失败不缓存坏连接：下一次调用会重试并成功", async () => {
    // 指向父目录不存在的 file:// 路径：在 Turso(file) 分支里失败。
    // 不能写成「URL 不合法」——那会落进 demo 分支去开仓库里的 data/seeo.db。
    const missing = path.join(tmpRoot, "no-such-dir", "case.db");
    closeDb();
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
    process.env.TURSO_DATABASE_URL = `file://${missing}`;
    process.env.TURSO_AUTH_TOKEN = "local";

    await expect(getAdapter()).rejects.toThrow();
    expect(getSchemaInitResult()?.applied ?? false).toBe(false);

    const file = nextDbFile();
    process.env.TURSO_DATABASE_URL = `file://${file}`;
    const db = await getAdapter();
    expect((await tableNames(db)).has("projects")).toBe(true);
    expect(getSchemaInitResult()?.applied).toBe(true);
    closeDb();
  });
});

describe("跨进程并发（真实 next build worker 场景）", () => {
  const outDir = path.join(tmpRoot, "cross-process");
  const migrationJs = path.join(outDir, "migrations.js");
  const nodeEnv = {
    ...process.env,
    // 转译产物在临时目录，裸模块需要从仓库 node_modules 解析
    NODE_PATH: path.join(REPO, "node_modules"),
    NEXT_PUBLIC_ENABLE_AUTH: "false",
    TURSO_AUTH_TOKEN: "local",
  };

  beforeAll(() => {
    fs.mkdirSync(outDir, { recursive: true });
    // 只转译、不类型检查：类型由 npx tsc 门负责，这里要的是能跨进程跑的真实实现
    for (const name of ["adapter", "migrations", "turso-adapter"]) {
      const source = fs.readFileSync(path.join(HERE, `${name}.ts`), "utf8");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
        fileName: `${name}.ts`,
      });
      fs.writeFileSync(path.join(outDir, `${name}.js`), outputText);
    }
    // 占住写锁的独立进程：持有 holdMs 后提交
    fs.writeFileSync(
      path.join(outDir, "blocker.cjs"),
      `const Database = require("better-sqlite3");
const db = new Database(process.argv[2]);
db.exec("BEGIN IMMEDIATE");
db.prepare("CREATE TABLE IF NOT EXISTS held_lock_probe (x TEXT)").run();
setTimeout(() => { db.exec("COMMIT"); db.close(); }, Number(process.argv[3] || 1500));
`
    );
    // 初始化并报告耗时（毫秒）的 worker
    fs.writeFileSync(
      path.join(outDir, "timed-worker.cjs"),
      `const m = require(${JSON.stringify(migrationJs)});
const t0 = Date.now();
m.getAdapter().then(
  () => console.log("RESULT " + JSON.stringify({ ms: Date.now() - t0, schema: m.getSchemaInitResult() })),
  (e) => { console.log("ERROR " + String((e && (e.code || e.message)) || e)); process.exitCode = 1; }
);
`
    );
  });

  it("9 个独立进程同时初始化同一个新库：只有一个应用，零 SQLITE_BUSY", async () => {
    const worker = path.join(outDir, "race-worker.cjs");
    fs.writeFileSync(
      worker,
      `const startAt = Number(process.argv[3]);
const m = require(${JSON.stringify(migrationJs)});
setTimeout(() => {
  m.getAdapter().then(
    () => console.log("RESULT " + JSON.stringify(m.getSchemaInitResult())),
    (e) => { console.log("ERROR " + String((e && (e.code || e.message)) || e)); process.exitCode = 1; }
  );
}, Math.max(0, startAt - Date.now()));
`
    );

    const file = nextDbFile();
    const workerCount = 9;
    const startAt = Date.now() + 500;
    const runs = await Promise.all(
      Array.from({ length: workerCount }, () =>
        runNode(worker, ["x", String(startAt)], { ...nodeEnv, TURSO_DATABASE_URL: `file://${file}` }, outDir)
      )
    );

    const output = runs.map((r) => r.stdout).join("\n");
    expect(runs.filter((r) => r.code !== 0), `worker failed:\n${output}`).toHaveLength(0);
    expect(output, "SQLITE_BUSY 又出现了").not.toMatch(/SQLITE_BUSY|database is locked/i);
    const results = runs.map(
      (r) => JSON.parse(r.stdout.replace(/^RESULT /m, "")) as SchemaInitResult
    );
    expect(results).toHaveLength(workerCount);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.every((r) => r.version === SCHEMA_VERSION)).toBe(true);
    expect(readUserVersion(file)).toBe(SCHEMA_VERSION);

    // 结构完整性抽查（迁移只跑了一遍，不是被 9 个进程各拆一半）
    const db = openSqliteAdapter(file);
    try {
      const tables = await tableNames(db);
      expect(tables.has("payment_notifications")).toBe(true);
      expect(tables.has("admin_source_events")).toBe(true);
      const indexes = await db.query(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`
      );
      expect(indexes.length).toBeGreaterThan(50);
    } finally {
      db.close();
    }
  }, 90_000);

  it("远端闸门跨进程竞争：只有一个实例应用迁移，其余排队后确认已 current", async () => {
    // 独立进程才是这里的真实并发（同进程里两条 SQLite 连接只会阻塞事件循环）。
    // 传输层用不上：闸门只依赖「库里那一行版本记录」，所以把本地 SQLite 适配器
    // 披上「无本地写锁」的身份跑同一条远端分支，就等价于两个 Vercel 冷启动实例。
    const adapterJs = path.join(outDir, "adapter.js");
    const worker = path.join(outDir, "remote-gate-worker.cjs");
    fs.writeFileSync(
      worker,
      `const Database = require("better-sqlite3");
const adapter = require(${JSON.stringify(adapterJs)});
const m = require(${JSON.stringify(migrationJs)});
const raw = new Database(process.argv[2]);
const a = new adapter.SQLiteAdapter(raw);
let statements = 0;
const track = (fn) => (...args) => { statements += 1; return fn(...args); };
const remote = {
  query: track((s, p) => a.query(s, p)),
  get: track((s, p) => a.get(s, p)),
  run: track((s, p) => a.run(s, p)),
  exec: track((s) => a.exec(s)),
  close: () => a.close(),
  migrationControl: () => null,
};
setTimeout(() => {
  m.ensureSchema(remote).then(
    (r) => console.log("RESULT " + JSON.stringify({ schema: r, statements })),
    (e) => { console.log("ERROR " + String((e && (e.code || e.message)) || e)); process.exitCode = 1; }
  );
}, Math.max(0, Number(process.argv[3]) - Date.now()));
`
    );

    const file = nextDbFile();
    const workerCount = 4;
    const startAt = Date.now() + 400;
    const runs = await Promise.all(
      Array.from({ length: workerCount }, () =>
        runNode(worker, [file, String(startAt)], nodeEnv, outDir)
      )
    );
    const output = runs.map((r) => r.stdout).join("\n");
    expect(runs.filter((r) => r.code !== 0), `worker failed:\n${output}`).toHaveLength(0);
    // 两个实例同时改同一批表结构就会长成这样：这是本轮要消除的 DDL 竞争
    expect(output, "并发初始化又打起来了").not.toMatch(
      /SQLITE_BUSY|database is locked|duplicate column/i
    );

    const results = runs.map(
      (r) => JSON.parse(r.stdout.replace(/^RESULT /m, "")) as {
        schema: SchemaInitResult;
        statements: number;
      }
    );
    expect(results.filter((r) => r.schema.applied)).toHaveLength(1);
    expect(results.filter((r) => !r.schema.applied)).toHaveLength(workerCount - 1);
    expect(results.every((r) => r.schema.version === SCHEMA_VERSION)).toBe(true);
    // 赢家跑一遍整套迁移（新库 ~50 条语句），输家只付出版本探测 + 排队轮询的代价：
    // 没有任何一个进程重放整套迁移，也没有两个进程同时改结构。
    const applyCount = results.find((r) => r.schema.applied)!.statements;
    expect(applyCount).toBeGreaterThan(40);
    expect(Math.max(...results.map((r) => r.statements))).toBe(applyCount);
    for (const loser of results.filter((r) => !r.schema.applied)) {
      expect(loser.statements, `输家跑了 ${loser.statements} 条语句`).toBeLessThan(40);
    }

    const db = openSqliteAdapter(file);
    try {
      expect(await readMetaRow(db)).toMatchObject({
        version: SCHEMA_VERSION,
        claim_owner: null,
        claim_expires_at: null,
      });
      expect((await tableNames(db)).has("payment_notifications")).toBe(true);
    } finally {
      db.close();
    }
  }, 90_000);

  it("demo 分支（better-sqlite3 本地文件）跨进程并发同样只有一个应用", async () => {
    const worker = path.join(outDir, "demo-worker.cjs");
    fs.writeFileSync(
      worker,
      `const startAt = Number(process.argv[3]);
const m = require(${JSON.stringify(migrationJs)});
setTimeout(() => {
  m.getAdapter().then(
    () => console.log("RESULT " + JSON.stringify({ cwd: process.cwd(), dbPath: m.localSqliteDbPath(), schema: m.getSchemaInitResult() })),
    (e) => { console.log("ERROR " + String((e && (e.code || e.message)) || e)); process.exitCode = 1; }
  );
}, Math.max(0, startAt - Date.now()));
`
    );

    // demo 分支的库路径来自 <cwd>/data/seeo.db（或显式 SEO_SQLITE_DB_PATH）。
    // 子进程继承 VITEST 标记，未显式声明路径会被隔离闸门直接拒绝，所以这里
    // 必须显式指向临时目录——cwd 也一并指到临时目录，模拟真实 demo 部署。
    const cwd = path.join(tmpRoot, `demo-cwd-${fileSeq++}`);
    fs.mkdirSync(cwd, { recursive: true });
    const demoDb = assertIsolatedTestDb(path.join(cwd, "data", "seeo.db"));
    const env: NodeJS.ProcessEnv = { ...nodeEnv, SEO_SQLITE_DB_PATH: demoDb };
    delete env.TURSO_DATABASE_URL;
    delete env.TURSO_AUTH_TOKEN;

    const startAt = Date.now() + 400;
    const runs = await Promise.all(
      Array.from({ length: 6 }, () => runNode(worker, ["x", String(startAt)], env, cwd))
    );
    const output = runs.map((r) => r.stdout).join("\n");
    expect(runs.filter((r) => r.code !== 0), `worker failed:\n${output}`).toHaveLength(0);
    expect(output, "SQLITE_BUSY 又出现了").not.toMatch(/SQLITE_BUSY|database is locked/);
    const results = runs.map(
      (r) =>
        JSON.parse(r.stdout.replace(/^RESULT /m, "")) as {
          cwd: string;
          dbPath: string;
          schema: SchemaInitResult;
        }
    );
    expect(results.filter((r) => r.schema.applied)).toHaveLength(1);
    expect(readUserVersion(demoDb)).toBe(SCHEMA_VERSION);
    // 每个 worker 解析到的都必须是临时目录里的那条路径（不是仓库 data/seeo.db）
    for (const r of results) {
      expect(r.dbPath, `worker 解析到 ${r.dbPath}`).toBe(demoDb);
      expect(r.dbPath.startsWith(tmpRoot)).toBe(true);
    }
    // 仓库 demo 库没有被这条 demo 分支用例打开（afterAll 再做全文件指纹比对）
    expect(demoDb.startsWith(tmpRoot)).toBe(true);
  }, 90_000);

  it("别人正持有写锁时按 busy_timeout 排队等到锁，而不是立刻失败", async () => {
    const file = nextDbFile();
    const holdMs = 1500;

    const [blockRun, initRun] = await Promise.all([
      runNode(path.join(outDir, "blocker.cjs"), [file, String(holdMs)], nodeEnv, outDir),
      new Promise((resolve) => setTimeout(resolve, 150)).then(() =>
        runNode(
          path.join(outDir, "timed-worker.cjs"),
          [],
          { ...nodeEnv, TURSO_DATABASE_URL: `file://${file}` },
          outDir
        )
      ),
    ]);

    expect(blockRun.code, blockRun.stdout).toBe(0);
    expect(initRun.code, initRun.stdout).toBe(0);
    expect(initRun.stdout).not.toMatch(/SQLITE_BUSY|database is locked/);
    const parsed = JSON.parse(initRun.stdout.replace(/^RESULT /m, "")) as {
      ms: number;
      schema: SchemaInitResult;
    };
    // 等满了对方持锁的时间才完成 = 真的在排队；立刻失败则 ms 很小且带 busy 错误
    expect(parsed.ms, `只等了 ${parsed.ms}ms，说明没有等待写锁`).toBeGreaterThanOrEqual(300);
    expect(parsed.schema.applied).toBe(true);
    expect(readUserVersion(file)).toBe(SCHEMA_VERSION);
  }, 90_000);

  it("已迁移过的库初始化不申请写锁：别人正在写也立刻完成", async () => {
    const file = nextDbFile();
    const seed = openSqliteAdapter(file); // WAL：写事务不挡读
    try {
      await ensureSchema(seed);
    } finally {
      seed.close();
    }
    expect(readUserVersion(file)).toBe(SCHEMA_VERSION);

    const holdMs = 2000;
    const [blockRun, initRun] = await Promise.all([
      runNode(path.join(outDir, "blocker.cjs"), [file, String(holdMs)], nodeEnv, outDir),
      new Promise((resolve) => setTimeout(resolve, 200)).then(() =>
        runNode(
          path.join(outDir, "timed-worker.cjs"),
          [],
          { ...nodeEnv, TURSO_DATABASE_URL: `file://${file}` },
          outDir
        )
      ),
    ]);

    expect(blockRun.code, blockRun.stdout).toBe(0);
    expect(initRun.code, initRun.stdout).toBe(0);
    const parsed = JSON.parse(initRun.stdout.replace(/^RESULT /m, "")) as {
      ms: number;
      schema: SchemaInitResult;
    };
    // 稳态：一次 PRAGMA 读就够了，不该因为别人占着写锁而等满 2 秒
    expect(parsed.schema).toEqual({
      applied: false,
      version: SCHEMA_VERSION,
      reason: "current",
    });
    expect(parsed.ms, `等了 ${parsed.ms}ms，说明稳态初始化还在申请写锁`).toBeLessThan(800);
  }, 90_000);
});

function runNode(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout: `${stdout}${stderr}`.trim() }));
  });
}

describe("锁冲突判定与连接级等待", () => {
  it("只把写锁冲突认成可重试", () => {
    expect(isBusyDbError(Object.assign(new Error("blah"), { code: "SQLITE_BUSY" }))).toBe(true);
    expect(
      isBusyDbError(
        Object.assign(new Error("unable to open database file"), { code: "SQLITE_CANTOPEN" })
      )
    ).toBe(false);
    expect(isBusyDbError(new Error("database is locked"))).toBe(true);
    expect(isBusyDbError(new Error("no such table: projects"))).toBe(false);
    expect(isBusyDbError(undefined)).toBe(false);
  });

  it("本地驱动默认几乎不等写锁，适配器把它抬到 DB_BUSY_TIMEOUT_MS", async () => {
    expect(DB_BUSY_TIMEOUT_MS).toBeGreaterThan(1000);
    const file = nextDbFile();
    // libsql 的 file: 驱动不设置就是 0 —— 预览库/构建副本并发初始化立刻 SQLITE_BUSY 的直接原因
    const rawClient = createClient({ url: `file://${file}`, authToken: "local" });
    try {
      const rows = (await rawClient.execute("PRAGMA busy_timeout")).rows as unknown as {
        timeout: number;
      }[];
      expect(Number(rows[0]?.timeout)).toBe(0);
    } finally {
      rawClient.close();
    }

    const db = openTursoFileAdapter(file);
    try {
      const rows = (await db.query("PRAGMA busy_timeout")) as { timeout: number }[];
      expect(Number(rows[0]?.timeout)).toBe(DB_BUSY_TIMEOUT_MS);
    } finally {
      db.close();
    }
  });
});
