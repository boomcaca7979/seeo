// ===== 测试隔离闸门：数据库路径必须显式、且落在临时目录 =====
// 上一轮遗留的安全/归属问题：中间版本的 SQLite 并发测试打开了仓库内的
// data/seeo.db（幂等迁移重放 + PRAGMA user_version 盖章），事后只能看当前
// hash/mtime，无法证明那次改动是不是测试产生的。这里把三件事变成自动断言：
//   1. 解析结果不在系统临时目录内就当场拒绝建连（migrations.refuseNonTempDbInTests）：
//      demo 默认路径、显式 SEO_SQLITE_DB_PATH、file:// 的 TURSO_DATABASE_URL 都管。
//      这一层比静态扫描可靠——路由级测试（如经 /api/mcp 间接建连的 mcp.test.ts）
//      源码里不出现 getAdapter()，扫描抓不到，但运行时一定被拦。
//   2. 任何声明出来的测试库路径都必须位于临时目录，仓库 data/ 内的一律失败；
//   3. 静态扫描：直接调用 getAdapter() 的测试文件必须显式声明数据库路径。
// 另见 test/vitest-db-guard.global.ts（跑完整套测试后比对 data/seeo.db 的 SHA-256）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import {
  assertIsolatedTestDb,
  hashFile,
  protectedRepoDbFiles,
  snapshotProtectedDbs,
  useTempSqliteDb,
} from "./test-db";
import { SCHEMA_VERSION, closeDb, getAdapter, getSchemaInitResult, localSqliteDbPath } from "./migrations";

const REPO = process.cwd();
const repoDemoDb = path.join(REPO, "data", "seeo.db");
const repoPreviewDb = path.join(REPO, "data", "seeo-ui-preview.db");

/** 递归列出 src 下的测试文件（与 vitest include 同口径） */
function testFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : testFiles(full);
    return /\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** 一份测试源码是否显式声明了自己的数据库路径（临时库 / test-db 工具） */
function declaresDbPath(src: string): boolean {
  return (
    /SEO_SQLITE_DB_PATH/.test(src) ||
    /TURSO_DATABASE_URL\s*=[^;]*file:\/\/|TURSO_DATABASE_URL`/.test(src) ||
    /from "\.\/test-db"|from "@\/lib\/db\/test-db"/.test(src)
  );
}

describe("测试库路径断言（仓库内路径一律拒绝）", () => {
  it("仓库 demo 库与预览库路径都会让断言失败", () => {
    for (const file of [repoDemoDb, repoPreviewDb, path.join(REPO, "data", "case.db")]) {
      expect(() => assertIsolatedTestDb(file), file).toThrow(/not inside the temp dir|inside the repository/);
    }
  });

  it("临时目录内的路径通过并返回规范化绝对路径", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-isolation-"));
    const ok = assertIsolatedTestDb(path.join(dir, "case.db"));
    expect(ok).toBe(path.resolve(dir, "case.db"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("临时目录里的同名 seeo.db 不会被误判成仓库库（判定按目录，不按文件名）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-isolation-"));
    expect(() => assertIsolatedTestDb(path.join(dir, "seeo.db"))).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("受保护清单确实覆盖 data/ 下的 demo 库与预览库", () => {
    const listed = protectedRepoDbFiles().map((f) => path.relative(REPO, f));
    expect(listed).toContain(path.join("data", "seeo.db"));
    expect(listed).toContain(path.join("data", "seeo-ui-preview.db"));
  });
});

describe("demo 分支：没有显式路径就拒绝打开仓库库", () => {
  let before: string | null;

  beforeEach(() => {
    closeDb();
    before = fs.existsSync(repoDemoDb) ? hashFile(repoDemoDb) : null;
  });

  afterEach(() => {
    closeDb();
    if (before !== null) expect(hashFile(repoDemoDb)).toBe(before);
    else expect(fs.existsSync(repoDemoDb)).toBe(false);
  });

  it("vitest 进程 + auth disabled + 未声明路径 → 当场失败，且不创建/不打开 data/seeo.db", async () => {
    expect(process.env.VITEST).toBe("true"); // 闸门依赖 vitest 注入的标记
    const saved = {
      auth: process.env.NEXT_PUBLIC_ENABLE_AUTH,
      dbPath: process.env.SEO_SQLITE_DB_PATH,
      tursoUrl: process.env.TURSO_DATABASE_URL,
      tursoToken: process.env.TURSO_AUTH_TOKEN,
    };
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
    delete process.env.SEO_SQLITE_DB_PATH;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    // 默认解析路径必须就是仓库 demo 库（否则这条断言毫无意义）
    expect(localSqliteDbPath()).toBe(repoDemoDb);

    try {
      await expect(getAdapter()).rejects.toThrow(/Test isolation: refusing the non-temporary database/);
    } finally {
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_ENABLE_AUTH: saved.auth,
        SEO_SQLITE_DB_PATH: saved.dbPath,
        TURSO_DATABASE_URL: saved.tursoUrl,
        TURSO_AUTH_TOKEN: saved.tursoToken,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("失败不会被记忆化：声明了临时路径后同一进程能正常初始化", async () => {
    const saved = {
      auth: process.env.NEXT_PUBLIC_ENABLE_AUTH,
      dbPath: process.env.SEO_SQLITE_DB_PATH,
      tursoUrl: process.env.TURSO_DATABASE_URL,
      tursoToken: process.env.TURSO_AUTH_TOKEN,
    };
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
    delete process.env.SEO_SQLITE_DB_PATH;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    await expect(getAdapter()).rejects.toThrow(/Test isolation/);

    const tmp = useTempSqliteDb("implicit-then-explicit");
    try {
      const db = await getAdapter();
      expect(localSqliteDbPath()).toBe(tmp.file);
      expect(assertIsolatedTestDb(localSqliteDbPath())).toBe(tmp.file);
      const result = getSchemaInitResult();
      expect(result).toEqual({ applied: true, version: SCHEMA_VERSION, reason: "applied" });
      const rows = (await db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='projects'`)) as {
        name: string;
      }[];
      expect(rows.map((r) => r.name)).toEqual(["projects"]);
      expect(fs.existsSync(tmp.file)).toBe(true);
    } finally {
      closeDb();
      tmp.restore();
      fs.rmSync(tmp.dir, { recursive: true, force: true });
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_ENABLE_AUTH: saved.auth,
        SEO_SQLITE_DB_PATH: saved.dbPath,
        TURSO_DATABASE_URL: saved.tursoUrl,
        TURSO_AUTH_TOKEN: saved.tursoToken,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("显式声明的仓库内路径同样拒绝（不只是隐式默认值）", () => {
  beforeEach(() => closeDb());
  afterEach(() => closeDb());

  it("SEO_SQLITE_DB_PATH 指向 data/seeo.db → 当场失败，绝不建连", async () => {
    const saved = {
      auth: process.env.NEXT_PUBLIC_ENABLE_AUTH,
      dbPath: process.env.SEO_SQLITE_DB_PATH,
      tursoUrl: process.env.TURSO_DATABASE_URL,
      tursoToken: process.env.TURSO_AUTH_TOKEN,
    };
    const before = fs.existsSync(repoDemoDb) ? hashFile(repoDemoDb) : null;
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.SEO_SQLITE_DB_PATH = repoDemoDb;
    try {
      await expect(getAdapter()).rejects.toThrow(/Test isolation: refusing the non-temporary database/);
    } finally {
      process.env.SEO_SQLITE_DB_PATH = saved.dbPath ?? "";
      if (saved.dbPath === undefined) delete process.env.SEO_SQLITE_DB_PATH;
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_ENABLE_AUTH: saved.auth,
        TURSO_DATABASE_URL: saved.tursoUrl,
        TURSO_AUTH_TOKEN: saved.tursoToken,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    if (before !== null) expect(hashFile(repoDemoDb)).toBe(before);
  });

  it("TURSO_DATABASE_URL=file://<repo>/data/… 也拒绝（预览库同样是用户数据）", async () => {
    const saved = {
      auth: process.env.NEXT_PUBLIC_ENABLE_AUTH,
      dbPath: process.env.SEO_SQLITE_DB_PATH,
      tursoUrl: process.env.TURSO_DATABASE_URL,
      tursoToken: process.env.TURSO_AUTH_TOKEN,
    };
    const before = fs.existsSync(repoPreviewDb) ? hashFile(repoPreviewDb) : null;
    delete process.env.SEO_SQLITE_DB_PATH;
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
    process.env.TURSO_DATABASE_URL = `file://${repoPreviewDb}`;
    process.env.TURSO_AUTH_TOKEN = "test-token";
    try {
      await expect(getAdapter()).rejects.toThrow(/Test isolation: refusing the non-temporary database/);
    } finally {
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_ENABLE_AUTH: saved.auth,
        SEO_SQLITE_DB_PATH: saved.dbPath,
        TURSO_DATABASE_URL: saved.tursoUrl,
        TURSO_AUTH_TOKEN: saved.tursoToken,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    if (before !== null) expect(hashFile(repoPreviewDb)).toBe(before);
  });
});

describe("getAdapter() 一律跑在自己的临时库（指纹不漂移）", () => {
  it("整份基线指纹：受保护库在初始化前后完全一致", async () => {
    const baseline = snapshotProtectedDbs();
    const tmp = useTempSqliteDb("fingerprint");
    try {
      const db = await getAdapter();
      await db.query(`SELECT 1`);
    } finally {
      closeDb();
      tmp.restore();
      fs.rmSync(tmp.dir, { recursive: true, force: true });
    }
    expect(snapshotProtectedDbs()).toBe(baseline);
  });
});

describe("静态扫描：每个用 getAdapter() 的测试必须显式声明数据库路径", () => {
  const files = testFiles(path.join(REPO, "src"));

  it("调用 getAdapter() 的文件都设置了 SEO_SQLITE_DB_PATH / TURSO_DATABASE_URL 或用 test-db 工具", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      if (!/getAdapter\(\)/.test(src)) continue;
      if (!declaresDbPath(src)) offenders.push(path.relative(REPO, file));
    }
    expect(offenders, `这些测试会静默回退到仓库 demo 库：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("扫描覆盖到的测试文件数量不为 0（防止 glob 失效造成假通过）", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => /getAdapter\(\)/.test(fs.readFileSync(f, "utf8"))).length).toBeGreaterThan(5);
  });
});
