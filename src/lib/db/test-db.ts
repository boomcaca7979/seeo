// ===== 测试专用：数据库隔离路径工具 =====
// 只做两件事：给每条用例一个自己的临时库目录，并把「路径必须落在临时目录里」
// 变成断言。仓库内的 demo 库（data/seeo.db）与本地预览库
// （data/seeo-ui-preview.db*）都属于用户的真实数据文件，测试一旦打开它们，
// 事后就无法区分「测试写的」和「用户改的」——上一轮的归属疑问正来自这里。
//
// 生产代码不 import 本文件（只有 *.test.ts 使用）。

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

/** vitest 的 cwd 就是项目根 */
const REPO_ROOT = process.cwd();
const REPO_DATA_DIR = path.join(REPO_ROOT, "data");

/** 测试绝不允许打开的仓库内数据库文件（含 WAL/SHM 伴随文件） */
export const PROTECTED_REPO_DBS = [
  "seeo.db",
  "seeo-ui-preview.db",
  "seeo-ui-preview-b2.db",
  "seeo-admin-preview.db",
] as const;

export function protectedRepoDbFiles(): string[] {
  const out: string[] = [];
  for (const name of PROTECTED_REPO_DBS) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = path.join(REPO_DATA_DIR, `${name}${suffix}`);
      if (fs.existsSync(file)) out.push(file);
    }
  }
  return out;
}

export function hashFile(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 受保护库的 `路径:sha256` 指纹（文件不存在时记 ABSENT，新增文件也能被发现） */
export function snapshotProtectedDbs(): string {
  return protectedRepoDbFiles()
    .map((f) => `${path.relative(REPO_ROOT, f)}=${hashFile(f)}`)
    .sort()
    .join("\n");
}

export interface TempSqliteDb {
  dir: string;
  file: string;
  /** 还原本用例改过的环境变量 */
  restore: () => void;
}

/**
 * 显式声明一条临时库路径并写进 `SEO_SQLITE_DB_PATH`（demo 分支），
 * 返回断言过的路径。调用方负责 `closeDb()` 并在 afterAll 删除 `dir`。
 */
export function useTempSqliteDb(label: string, fileName = "case.db"): TempSqliteDb {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `seeo-${label}-`)));
  const file = assertIsolatedTestDb(path.join(dir, fileName));
  const saved = {
    auth: process.env.NEXT_PUBLIC_ENABLE_AUTH,
    dbPath: process.env.SEO_SQLITE_DB_PATH,
    tursoUrl: process.env.TURSO_DATABASE_URL,
    tursoToken: process.env.TURSO_AUTH_TOKEN,
  };
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.SEO_SQLITE_DB_PATH = file;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  return {
    dir,
    file,
    restore: () => {
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_ENABLE_AUTH: saved.auth,
        SEO_SQLITE_DB_PATH: saved.dbPath,
        TURSO_DATABASE_URL: saved.tursoUrl,
        TURSO_AUTH_TOKEN: saved.tursoToken,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

/**
 * 归一化路径：macOS 的 `os.tmpdir()` 是 /var/…（符号链接），realpath 后是
 * /private/var/…，直接字符串比较会把合法的临时库误判成「不在临时目录」。
 * 对已存在的最近祖先做 realpath，再拼回不存在的后缀，得到可比较的形式。
 */
function normalize(file: string): string {
  const resolved = path.resolve(file);
  const missing: string[] = [];
  let cur = resolved;
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    missing.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(fs.realpathSync(cur), ...missing);
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * 断言一条测试数据库路径确实位于临时目录、且不落在仓库 data/ 之内。
 * 不满足就抛（让用例直接失败），满足时返回规范化后的绝对路径。
 */
export function assertIsolatedTestDb(file: string): string {
  const target = normalize(file);
  if (isInside(REPO_DATA_DIR, target) || target === REPO_DATA_DIR) {
    throw new Error(
      `[test-db] Refusing a database inside the repository: ${path.resolve(file)} ` +
        `(protected: ${PROTECTED_REPO_DBS.join(", ")})`
    );
  }
  const realTmp = fs.realpathSync(os.tmpdir());
  if (!isInside(realTmp, target)) {
    throw new Error(
      `[test-db] Database path is not inside the temp dir (${realTmp}): ${path.resolve(file)}`
    );
  }
  return path.resolve(file);
}
