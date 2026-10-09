// ===== 只读通道：SELECT 守卫 + 来源判定 + 回退语义 =====

import { describe, it, expect, afterEach } from "vitest";
import {
  assertReadOnlySql,
  wrapReadonlyAdapter,
  getAnalyticsReadSource,
  isProductionReadonlyConfigured,
  ANALYTICS_READ_SOURCE_LABELS,
} from "./readonly";

const ENV_KEYS = ["TURSO_READONLY_DATABASE_URL", "TURSO_READONLY_AUTH_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function withEnv(url: string | undefined, token: string | undefined, fn: () => void): void {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  if (url === undefined) delete process.env.TURSO_READONLY_DATABASE_URL;
  else process.env.TURSO_READONLY_DATABASE_URL = url;
  if (token === undefined) delete process.env.TURSO_READONLY_AUTH_TOKEN;
  else process.env.TURSO_READONLY_AUTH_TOKEN = token;
  try {
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("assertReadOnlySql（SELECT 守卫）", () => {
  it("放行 SELECT / WITH（含行内 -- 注释与绑定参数风格）", () => {
    expect(() => assertReadOnlySql("SELECT 1")).not.toThrow();
    expect(() =>
      assertReadOnlySql(`SELECT COUNT(*) AS n FROM analytics_events WHERE event_name = ?`)
    ).not.toThrow();
    expect(() =>
      assertReadOnlySql(
        `WITH m AS (SELECT MAX(captured_on) AS v FROM gsc_query_metrics) SELECT * FROM m`
      )
    ).not.toThrow();
    // 代码内真实存在的行内 -- 注释不得误伤
    expect(() =>
      assertReadOnlySql("SELECT date(created_at) AS day FROM t -- daily 粒度保留事件口径")
    ).not.toThrow();
  });

  it("拒绝写语句与 DDL/PRAGMA", () => {
    for (const sql of [
      "INSERT INTO analytics_events VALUES (1)",
      "UPDATE analytics_events SET user_id = 'x'",
      "DELETE FROM analytics_events",
      "DROP TABLE analytics_events",
      "ALTER TABLE analytics_events ADD COLUMN x TEXT",
      "PRAGMA foreign_keys = ON",
      "CREATE TABLE evil (id INTEGER)",
      "exec sp_help",
    ]) {
      expect(() => assertReadOnlySql(sql), sql).toThrow(/仅允许 SELECT/);
    }
  });

  it("拒绝块注释伪装与多语句追加", () => {
    // 块注释开头的语句无论命中哪条守卫都必须被拒
    expect(() => assertReadOnlySql("/* hi */ SELECT 1")).toThrow();
    expect(() => assertReadOnlySql("SELECT 1; DROP TABLE analytics_events")).toThrow(
      /多语句/
    );
    // 字符串字面量内的分号不算多语句
    expect(() =>
      assertReadOnlySql("SELECT * FROM t WHERE path = '/a;b;c'")
    ).not.toThrow();
  });
});

describe("wrapReadonlyAdapter", () => {
  it("SELECT 正常透传；写语句不会触达底层适配器", async () => {
    let calls = 0;
    const base = {
      async get() {
        calls++;
        return { n: 1 };
      },
      async query() {
        calls++;
        return [{ n: 1 }];
      },
    };
    const ro = wrapReadonlyAdapter(base);
    await expect(ro.get("SELECT 1")).resolves.toEqual({ n: 1 });
    await expect(ro.query("SELECT * FROM t WHERE x = ?", ["a"])).resolves.toEqual([{ n: 1 }]);
    expect(calls).toBe(2);
    await expect(ro.get("DELETE FROM t")).rejects.toThrow(/仅允许 SELECT/);
    await expect(ro.query("INSERT INTO t VALUES (1)")).rejects.toThrow(/仅允许 SELECT/);
    expect(calls).toBe(2); // 被拒绝的语句未触达底层
  });
});

describe("来源判定（env 驱动）", () => {
  it("默认回退本地隔离库", () => {
    withEnv(undefined, undefined, () => {
      expect(isProductionReadonlyConfigured()).toBe(false);
      expect(getAnalyticsReadSource()).toBe("local");
    });
  });

  it("file:// 或缺 token 都不算生产只读（防止把本地库误标为生产）", () => {
    withEnv("file:///tmp/x.db", "tok", () => {
      expect(isProductionReadonlyConfigured()).toBe(false);
      expect(getAnalyticsReadSource()).toBe("local");
    });
    withEnv("libsql://prod.example", "", () => {
      expect(isProductionReadonlyConfigured()).toBe(false);
    });
  });

  it("libsql:// + token → 生产只读", () => {
    withEnv("libsql://prod.example", "tok", () => {
      expect(isProductionReadonlyConfigured()).toBe(true);
      expect(getAnalyticsReadSource()).toBe("production-readonly");
    });
  });

  it("来源标签如实区分两种来源", () => {
    expect(ANALYTICS_READ_SOURCE_LABELS.local).toContain("本地隔离库");
    expect(ANALYTICS_READ_SOURCE_LABELS["production-readonly"]).toContain("生产库");
  });
});
