// ===== 生产环境数据库启动守卫 =====
// 正式生产（VERCEL_ENV=production 或非 Vercel 的 next start 生产态）必须同时满足：
// auth 启用 + TURSO_DATABASE_URL（远程 libsql/https）+ TURSO_AUTH_TOKEN；
// file:// 本地库与 better-sqlite3 回退一律拒绝初始化。
// demo / preview / 本地 dev / build 阶段不受影响。
// 全部用例跑在隔离临时库上，绝不触碰 data/ 下的真实数据库。

import { afterEach, describe, expect, it, vi } from "vitest";
import * as os from "node:os";
import path from "node:path";
import { assertIsolatedTestDb } from "./test-db";
import { closeDb, getAdapter, isProductionDatabaseEnvironment } from "./migrations";

// TursoAdapter 由 openAdapter 动态 import；这里替换成最小桩：
// readVersion 返回极大值 → ensureSchema 判定 "ahead"，不发任何真实远程语句。
vi.mock("./turso-adapter", () => {
  class TursoAdapter {
    url: string;
    token: string;
    constructor(url: string, token: string) {
      this.url = url;
      this.token = token;
    }
    migrationControl() {
      return {
        readVersion: async () => Number.MAX_SAFE_INTEGER,
        acquireLock: async () => {
          throw new Error("test stub: lock is never needed (version already ahead)");
        },
      };
    }
    async close() {}
    async query() {
      throw new Error("test stub: no remote statements expected");
    }
    async run() {
      throw new Error("test stub: no remote statements expected");
    }
    async get() {
      throw new Error("test stub: no remote statements expected");
    }
  }
  return { TursoAdapter };
});

const GUARD_ERROR = /Production database guard/;

/** 保存并替换本用例关心的环境变量，afterEach 统一还原 */
const WATCHED_KEYS = [
  "VERCEL_ENV",
  "NODE_ENV",
  "NEXT_PHASE",
  "NEXT_PUBLIC_ENABLE_AUTH",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "SEO_SQLITE_DB_PATH",
] as const;
const savedEnv = new Map<string, string | undefined>();
function setEnv(key: string, value: string | undefined): void {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  closeDb();
});

/** 生产态基线：合法远程配置，各用例按需破坏其中一项 */
function asProduction(): void {
  setEnv("VERCEL_ENV", "production");
  setEnv("NODE_ENV", "production");
  setEnv("NEXT_PHASE", undefined);
  setEnv("NEXT_PUBLIC_ENABLE_AUTH", "true");
  setEnv("TURSO_DATABASE_URL", "libsql://protected-stub.example");
  setEnv("TURSO_AUTH_TOKEN", "stub-token-not-a-real-secret");
}

describe("isProductionDatabaseEnvironment", () => {
  it("VERCEL_ENV=production → true；preview/development → false", () => {
    expect(isProductionDatabaseEnvironment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionDatabaseEnvironment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isProductionDatabaseEnvironment({ VERCEL_ENV: "development" })).toBe(false);
  });

  it("非 Vercel：NODE_ENV=production（next start）→ true；dev/test → false", () => {
    expect(isProductionDatabaseEnvironment({})).toBe(false);
    expect(isProductionDatabaseEnvironment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionDatabaseEnvironment({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionDatabaseEnvironment({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("生产守卫：拒绝初始化", () => {
  it("Production + 认证关闭 → 拒绝启动", async () => {
    asProduction();
    setEnv("NEXT_PUBLIC_ENABLE_AUTH", "false");
    await expect(getAdapter()).rejects.toThrow(GUARD_ERROR);
    await expect(getAdapter()).rejects.toThrow(/auth is disabled/);
  });

  it("Production + 缺失 TURSO_DATABASE_URL → 拒绝启动", async () => {
    asProduction();
    setEnv("TURSO_DATABASE_URL", undefined);
    await expect(getAdapter()).rejects.toThrow(GUARD_ERROR);
    await expect(getAdapter()).rejects.toThrow(/TURSO_DATABASE_URL is missing/);
  });

  it("Production + 缺失 TURSO_AUTH_TOKEN → 拒绝启动", async () => {
    asProduction();
    setEnv("TURSO_AUTH_TOKEN", undefined);
    await expect(getAdapter()).rejects.toThrow(GUARD_ERROR);
    await expect(getAdapter()).rejects.toThrow(/TURSO_AUTH_TOKEN is missing/);
  });

  it("Production + file:// 本地库 → 拒绝启动（不允许回退本地文件）", async () => {
    asProduction();
    setEnv("TURSO_DATABASE_URL", `file://${assertIsolatedTestDb(path.join(os.tmpdir(), "seeo-guard-prod.db"))}`);
    await expect(getAdapter()).rejects.toThrow(GUARD_ERROR);
    await expect(getAdapter()).rejects.toThrow(/local file:\/\/ database/);
  });

  it("守卫报错不包含任何凭据值", async () => {
    asProduction();
    setEnv("TURSO_AUTH_TOKEN", undefined);
    let message = "";
    await getAdapter().catch((err: Error) => (message = err.message));
    expect(message).not.toContain("stub-token-not-a-real-secret");
    expect(message).not.toContain("protected-stub");
  });
});

describe("生产守卫：合法配置与既有环境不受影响", () => {
  it("Production + 合法远程配置 → 初始化通过（TursoAdapter，零远程语句）", async () => {
    asProduction();
    const db = await getAdapter();
    expect(db).toBeTruthy();
    expect(db.migrationControl?.()).toBeTruthy();
  });

  it("Development + file:// 本地库 → 正常（非生产不受守卫约束）", async () => {
    setEnv("VERCEL_ENV", undefined);
    setEnv("NODE_ENV", "development");
    setEnv("NEXT_PUBLIC_ENABLE_AUTH", "false");
    setEnv("TURSO_DATABASE_URL", `file://${assertIsolatedTestDb(path.join(os.tmpdir(), "seeo-guard-dev.db"))}`);
    setEnv("TURSO_AUTH_TOKEN", "local");
    const db = await getAdapter();
    expect(db).toBeTruthy();
  });

  it("Demo/Preview + 现有配置 → 正常走本地 SQLite（auth 关闭）", async () => {
    setEnv("VERCEL_ENV", "preview");
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_ENABLE_AUTH", "false");
    setEnv("TURSO_DATABASE_URL", undefined);
    setEnv("TURSO_AUTH_TOKEN", undefined);
    setEnv("SEO_SQLITE_DB_PATH", assertIsolatedTestDb(path.join(os.tmpdir(), "seeo-guard-demo.db")));
    const db = await getAdapter();
    expect(db).toBeTruthy();
    expect(db.migrationControl?.()).toBeTruthy();
  });

  it("build 阶段豁免：生产环境变量 + NEXT_PHASE=phase-production-build 不触发守卫", async () => {
    asProduction();
    setEnv("NEXT_PHASE", "phase-production-build");
    setEnv("NEXT_PUBLIC_ENABLE_AUTH", "false");
    setEnv("TURSO_DATABASE_URL", undefined);
    setEnv("TURSO_AUTH_TOKEN", undefined);
    setEnv("SEO_SQLITE_DB_PATH", assertIsolatedTestDb(path.join(os.tmpdir(), "seeo-guard-build.db")));
    const db = await getAdapter();
    expect(db).toBeTruthy();
  });
});
