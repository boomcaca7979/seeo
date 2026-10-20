// ===== 初始化/迁移并发闸门（SQLITE_BUSY 根因回归） =====
// 背景：`next build` 用多个 worker（**独立进程**）收集页面数据，每个 worker 各自开一条
// SQLite 连接跑迁移。旧实现没有 busy_timeout、没有版本闸门、迁移体里的错误一律 catch 吞掉，
// 于是并发时出现 SQLITE_BUSY / "database is locked"（修复前构建日志实测 32 次），
// 而且「迁移失败」和「迁移已完成」在库里长得一样。
// 本文件用隔离临时库（绝不碰 data/seeo-ui-preview.db）验证三件事：
// 独占写锁 + PRAGMA user_version 闸门 + 错误上抛。
// 注意：并发用例必须跨进程——better-sqlite3/libsql 的本地驱动是同步的，
// 同进程里让两条连接互相等只会阻塞事件循环，那不是我复现出的真实场景。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("适配器不提供写锁（远端 Turso）时回退为直接幂等迁移", async () => {
    const file = nextDbFile();
    const db = openSqliteAdapter(file);
    const noLock: DBAdapter = {
      query: (sql, params) => db.query(sql, params),
      run: (sql, params) => db.run(sql, params),
      get: (sql, params) => db.get(sql, params),
      exec: (sql) => db.exec(sql),
      close: () => db.close(),
      migrationControl: () => null,
    };
    try {
      const result = await ensureSchema(noLock);
      expect(result).toEqual({ applied: true, version: 0, reason: "unversioned" });
      expect((await tableNames(db)).has("projects")).toBe(true);
      // 无闸门路径不盖章：版本仍是 0，下次进程初始化会再幂等跑一遍
      expect(readUserVersion(file)).toBe(0);
    } finally {
      db.close();
    }
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
