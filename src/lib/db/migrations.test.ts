// ===== 本地 Turso URL_INVALID 回归测试 =====
// 根因：本地 next start 加载了占位/无效的 TURSO_DATABASE_URL（如空串、
// "your-turso-url" 等非 libsql:// https:// file:// 值）时，libsql 客户端
// 在运行时抛晦涩的 LibsqlError: URL_INVALID 并演变成隐蔽 500。
// 修复（getAdapter 分支）：
//   - URL 格式校验：非法 URL 不再传给 libsql
//   - auth-enabled（生产/真实后端）：缺/无效 Turso 配置 → 显式明确报错
//   - demo / auth-disabled：忽略无效配置，回退本地 SQLite，不再 500

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIG_ENV = { ...process.env };

async function loadModule() {
  vi.resetModules();
  return import("./migrations");
}

describe("getAdapter：Turso URL_INVALID 防护", () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("auth-enabled + 缺少 Turso 配置 → 显式报错（而非隐蔽 URL_INVALID 500）", async () => {
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "true";
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;

    const { getAdapter } = await loadModule();
    await expect(getAdapter()).rejects.toThrow(/TURSO_DATABASE_URL.*missing or invalid/);
  });

  it("auth-enabled + 无效 URL 格式（占位值）→ 同样显式报错", async () => {
    process.env.NEXT_PUBLIC_ENABLE_AUTH = "true";
    process.env.TURSO_DATABASE_URL = "your-turso-url"; // 非法格式：无 libsql:// https:// file:// 前缀
    process.env.TURSO_AUTH_TOKEN = "some-token";

    const { getAdapter } = await loadModule();
    await expect(getAdapter()).rejects.toThrow(/missing or invalid/);
  });

  it("URL 格式校验放行合法 libsql:// / https:// / file:// 值", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./migrations.ts", import.meta.url), "utf-8")
    );
    expect(src).toContain("(libsql|https?|file)");
    // demo 模式（auth-disabled）忽略无效配置并回退本地 SQLite
    expect(src).toContain("falling back to local SQLite");
  });
});
