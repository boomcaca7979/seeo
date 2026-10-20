// ===== 关键词列表查询的范围契约测试 =====
// BUG-03 的数据层防线：行动中心把「已追踪关键词数」显示成账号总数，根因是
// listTrackedKeywords(userId) 无域名维度。这里同时证明两件事：
//   1. 传域名时在 **SQL 层**过滤（谓词 + 位置参数），不是取回全量后在 JS 里筛；
//   2. 不传域名时行为完全不变（账号级调用方——额度、竞品、刷新——不受影响）。
// 使用隔离临时库文件，绝不接触预览库/生产库。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DBParam } from "@/lib/db/adapter";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-kw-scope-"));

// vi.hoisted：mock 工厂在模块图求值阶段就可能执行，捕获数组必须先于此初始化
const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params?: unknown[] }>,
}));

vi.mock("@/lib/db/migrations", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db/migrations")>();
  const real = await mod.getAdapter();
  const wrapped = {
    query: async (sql: string, params?: DBParam[]) => {
      h.calls.push({ sql, params });
      return real.query(sql, params);
    },
    get: (sql: string, params?: DBParam[]) => real.get(sql, params),
    run: (sql: string, params?: DBParam[]) => real.run(sql, params),
    exec: (sql: string) => real.exec(sql),
    close: () => real.close(),
  };
  return { ...mod, getAdapter: async () => wrapped };
});

const USER = "scope-user";
const OTHER_USER = "scope-user-2";
const DOMAIN_A = "keyword-scope-a.test";
const DOMAIN_B = "keyword-scope-b.test";
const DOMAIN_EMPTY = "keyword-scope-empty.test";

let listTrackedKeywords: typeof import("@/lib/db/keywords").listTrackedKeywords;
let addTrackedKeyword: typeof import("@/lib/db/keywords").addTrackedKeyword;

/** 只取本次「关键词列表」查询（分组关联查询是 user 级的，不参与范围断言） */
function keywordQueries() {
  return h.calls.filter((c) => /FROM tracked_keywords tk/.test(c.sql));
}

async function seed(userId: string, domain: string, keywords: string[]) {
  for (const keyword of keywords) {
    await addTrackedKeyword(userId, { keyword, location: "United States", device: "PC", domain });
  }
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/kw.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();

  const db = await import("@/lib/db/migrations");
  await db.getAdapter(); // 跑迁移建表
  const keywords = await import("@/lib/db/keywords");
  listTrackedKeywords = keywords.listTrackedKeywords;
  addTrackedKeyword = keywords.addTrackedKeyword;

  await seed(USER, DOMAIN_A, ["kw a1", "kw a2"]);
  await seed(USER, DOMAIN_B, ["kw b1"]);
  await seed(OTHER_USER, DOMAIN_A, ["kw other-1"]);
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("listTrackedKeywords 传入域名：数据库层项目范围过滤", () => {
  it("只返回该域名的关键词，且 SQL 带 domain 谓词与位置参数", async () => {
    h.calls.length = 0;
    const rows = await listTrackedKeywords(USER, DOMAIN_A);
    expect(rows.map((r) => r.keyword).sort()).toEqual(["kw a1", "kw a2"]);
    expect(rows.every((r) => r.domain === DOMAIN_A)).toBe(true);

    const q = keywordQueries()[0];
    expect(q).toBeDefined();
    expect(q.sql).toContain("tk.domain = ?");
    expect(q.params).toEqual([USER, DOMAIN_A]);
  });

  it("同账号另一个域名得到另一个数字（不是同一个账号级总数）", async () => {
    const a = await listTrackedKeywords(USER, DOMAIN_A);
    const b = await listTrackedKeywords(USER, DOMAIN_B);
    expect(a.length).toBe(2);
    expect(b.length).toBe(1);
    expect(a.length).not.toBe(b.length);
  });

  it("该域名确实没有关键词 → 空数组（工作队列据此才能报 no_tracked_keywords）", async () => {
    const rows = await listTrackedKeywords(USER, DOMAIN_EMPTY);
    expect(rows).toHaveLength(0);
  });

  it("跨用户隔离：另一个用户在同域名下的关键词不会混入", async () => {
    const mine = await listTrackedKeywords(USER, DOMAIN_A);
    expect(mine.some((r) => r.keyword === "kw other-1")).toBe(false);
    const theirs = await listTrackedKeywords(OTHER_USER, DOMAIN_A);
    expect(theirs.map((r) => r.keyword)).toEqual(["kw other-1"]);
  });
});

describe("listTrackedKeywords 不传域名：保持既有账号级行为", () => {
  it("省略域名 → 返回该账号全部关键词，SQL 不含 domain 谓词", async () => {
    h.calls.length = 0;
    const rows = await listTrackedKeywords(USER);
    expect(rows).toHaveLength(3); // a1/a2/b1，不含 OTHER_USER 的
    const q = keywordQueries()[0];
    expect(q.sql).not.toContain("tk.domain = ?");
    expect(q.params).toEqual([USER]);
  });

  it("空串/空白域名按账号级处理，绝不返回空列表（避免误报「尚未追踪关键词」）", async () => {
    expect(await listTrackedKeywords(USER, "")).toHaveLength(3);
    expect(await listTrackedKeywords(USER, "   ")).toHaveLength(3);
  });

  it("账号级结果仍是各域名项目结果之和（范围口径可核对）", async () => {
    const all = await listTrackedKeywords(USER);
    const a = await listTrackedKeywords(USER, DOMAIN_A);
    const b = await listTrackedKeywords(USER, DOMAIN_B);
    const empty = await listTrackedKeywords(USER, DOMAIN_EMPTY);
    expect(all.length).toBe(a.length + b.length + empty.length);
  });
});
