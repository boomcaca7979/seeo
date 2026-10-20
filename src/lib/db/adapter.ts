// ===== 数据库连接抽象层 =====
// 接口统一为 async，适配 Turso（async）和 SQLite（sync 包 async）
// 部署时由 getAdapter() 根据 env 自动切换，业务代码零改动

import type Database from "better-sqlite3";

/** 数据库参数：支持位置参数（数组）或命名参数（对象） */
export type DBParam = string | number | bigint | boolean | null | Record<string, unknown>;

/**
 * 迁移锁：绑定在“持有写锁的那条连接/事务”上的执行通道。
 *
 * 迁移语句必须走 `adapter`，不能用原客户端：
 * BEGIN IMMEDIATE 之后，适配器主连接已不是事务连接，走它会绕过写锁并看到旧结构。
 */
export interface MigrationLock {
  adapter: DBAdapter;
  /** 锁内复查版本：后进者据此发现“别人已应用”，从而什么都不做 */
  getVersion(): Promise<number>;
  setVersion(version: number): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * 迁移闸门：仅本地文件库适配器提供（better-sqlite3、libsql `file:`）。
 *
 * 诱因：同一份 SQLite 文件会被多条连接同时打开——`next build` 用 9 个 worker
 * 收集页面数据，每个 worker 各自 new 一条连接跑迁移，彼此抢写锁 → SQLITE_BUSY。
 * `PRAGMA user_version` 把“迁移是否已完成”变成库里的事实（稳态初始化只剩一次读、
 * 零写入），BEGIN IMMEDIATE + busy_timeout 把 check-and-apply 串成临界区：
 * 只有一个 worker 应用，其余排队后在锁内复查并跳过。
 * 远端 Turso（libsql:// / https://）不提供，调用方回退为直接执行幂等迁移。
 */
export interface MigrationControl {
  /** 无锁读取 PRAGMA user_version（0 = 尚未版本化） */
  readVersion(): Promise<number>;
  /**
   * 取得独占写锁（BEGIN IMMEDIATE）。拿不到时按连接级 busy_timeout 等待；
   * 等满仍失败必须原样抛错——不能吞掉，也不能当作“迁移已完成”。
   */
  acquireLock(): Promise<MigrationLock>;
}

export interface DBAdapter {
  query(sql: string, params?: DBParam[]): Promise<unknown[]>;
  run(
    sql: string,
    params?: DBParam[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  get(sql: string, params?: DBParam[]): Promise<unknown | undefined>;
  exec(sql: string): Promise<void>;
  close(): void;
  migrationControl?(): MigrationControl | null;
}

/** 等待写锁上限（毫秒）：并发 worker 排队而不是立刻失败 */
export const DB_BUSY_TIMEOUT_MS = 10_000;

/** 判断适配器错误是否为“可重试的写锁冲突”，其他错误一律上抛 */
export function isBusyDbError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; errno?: number };
  const text = `${e?.code ?? ""} ${e?.message ?? ""}`;
  return /SQLITE_(BUSY|LOCKED)/i.test(text) || /database is locked/i.test(text);
}

/**
 * 赋值型 PRAGMA 有两种写法要求：
 * - libsql 的 `execute()` 要完整语句 `PRAGMA name = value`
 * - better-sqlite3 的 `db.pragma()` 会自己补 `PRAGMA ` 前缀，传完整语句反而语法错
 * 所以这里成对提供：assignment 给 db.pragma()，pragma 给 execute()。
 */
export function busyTimeoutAssignment(value: number): string {
  assertNonNegativeInteger(value, "busy timeout");
  return `busy_timeout = ${value}`;
}

export function busyTimeoutPragma(value: number): string {
  return `PRAGMA ${busyTimeoutAssignment(value)}`;
}

export function userVersionAssignment(version: number): string {
  assertSchemaVersion(version);
  return `user_version = ${version}`;
}

export function userVersionSetSql(version: number): string {
  return `PRAGMA ${userVersionAssignment(version)}`;
}

/**
 * journal_mode=WAL 需要写锁，而 SQLite 对这条 PRAGMA **不调用 busy handler**
 * （文档明确：抢不到锁直接返回 SQLITE_BUSY，connection 级 busy_timeout 帮不上忙）。
 * 冷启动时先赢的 worker 正在事务里跑迁移，其余 worker 的这条 PRAGMA 就会当场炸
 * 「database is locked」——这正是 `next build` 多 worker 的 SQLITE_BUSY 真实来源。
 * 这里按退避自己等（总预算小于 DB_BUSY_TIMEOUT_MS），等满仍失败就原样上抛，
 * 绝不静默跳过 WAL 转换或把失败当成初始化成功。
 */
const JOURNAL_MODE_WAIT_MS = [50, 100, 200, 400, 800, 1500, 3000] as const;

export async function applyLocalSqlitePragmas(
  raw: Pick<Database.Database, "pragma">,
  wait: (ms: number) => Promise<void> = sleepMs
): Promise<void> {
  // 顺序即语义：busy_timeout 必须打在第一条语句之前，后面的 BEGIN IMMEDIATE 才会排队等锁
  raw.pragma(busyTimeoutAssignment(DB_BUSY_TIMEOUT_MS));
  raw.pragma("foreign_keys = ON");

  let lastError: unknown = null;
  for (const delay of [0, ...JOURNAL_MODE_WAIT_MS]) {
    if (delay > 0) await wait(delay);
    try {
      const mode = String(raw.pragma("journal_mode = WAL", { simple: true }) ?? "");
      if (mode.toLowerCase() === "wal") return;
      // 拿不到排他锁时 SQLite 也会「不报错但原样返回旧模式」，同样按未完成重试
      lastError = new Error(`journal_mode 仍为 ${mode || "(空)"}`);
    } catch (err) {
      if (!isBusyDbError(err)) throw err;
      lastError = err;
    }
  }
  throw new Error("[db] WAL 转换始终等不到写锁（其他连接长期占锁）", { cause: lastError });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SQLite 实现（本地开发，sync 包 async）
export class SQLiteAdapter implements DBAdapter {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    // 连接级等待：拿不到写锁时先等，等满超时才报错（错误一律上抛，不吞）
    this.db.pragma(busyTimeoutAssignment(DB_BUSY_TIMEOUT_MS));
  }

  async query(sql: string, params?: DBParam[]): Promise<unknown[]> {
    return params && params.length > 0
      ? (this.db.prepare(sql).all(...params) as unknown[])
      : (this.db.prepare(sql).all() as unknown[]);
  }

  async run(
    sql: string,
    params?: DBParam[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    return params && params.length > 0
      ? this.db.prepare(sql).run(...params)
      : this.db.prepare(sql).run();
  }

  async get(sql: string, params?: DBParam[]): Promise<unknown | undefined> {
    return params && params.length > 0
      ? this.db.prepare(sql).get(...params)
      : this.db.prepare(sql).get();
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  // better-sqlite3 单连接：事务绑定在这条连接上，迁移体继续用同一个适配器即可。
  migrationControl(): MigrationControl {
    const db = this.db;
    return {
      readVersion: async () =>
        readPragmaNumber(db.pragma("user_version", { simple: true })),
      acquireLock: async () => {
        db.exec("BEGIN IMMEDIATE");
        return {
          adapter: this,
          getVersion: async () =>
            readPragmaNumber(db.pragma("user_version", { simple: true })),
          setVersion: async (version: number) => {
            db.pragma(userVersionAssignment(version));
          },
          commit: async () => {
            db.exec("COMMIT");
          },
          rollback: async () => {
            // 语句失败时 SQLite 可能已自动回滚；这里的异常只是“已回滚”，
            // 迁移失败本身仍由调用方的原始错误上抛。
            try {
              db.exec("ROLLBACK");
            } catch {
              /* no transaction active */
            }
          },
        };
      },
    };
  }

  close(): void {
    this.db.close();
  }
}

function readPragmaNumber(value: unknown): number {
  if (typeof value === "number") return Number.isInteger(value) ? value : 0;
  if (value && typeof value === "object" && "user_version" in value) {
    const raw = (value as { user_version: unknown }).user_version;
    const num = Number(raw);
    return Number.isFinite(num) ? Math.trunc(num) : 0;
  }
  return 0;
}

export function assertSchemaVersion(version: number): void {
  assertNonNegativeInteger(version, "schema version");
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[db] invalid ${label}: ${String(value)}`);
  }
}
