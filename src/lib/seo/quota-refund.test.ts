// ===== 额度回滚契约测试（2026-11-01 定向修复）=====
// 目的：证明「平台凭据错误不得扣减用户额度」在**真实 SQL 语义**下成立，
// 而不是只 mock 掉 consumeQuota/refundQuota 就宣称通过。
//
// 覆盖：
//   1. refundQuota 把刚扣的月度与日度用量各还原 1（Free 套餐双 guard）
//   2. used 不会被回滚到负数（重复回滚/无记录时不越界）
//   3. 回滚后 limit 不变（不碰套餐额度），429 仍在原上限处触发
//   4. lite/pro 无日度 guard：只回滚月度
//   5. 平台凭据错误判定：INVALID_KEY / DataForSEO 401xx-403xx / 未配置 → true
//      QUOTA_EXCEEDED / TIMEOUT / UPSTREAM_ERROR / 50000 → false

import { describe, it, expect, vi } from "vitest";

// 内存 SQLite：真实执行原子 UPSERT/DECREMENT SQL（与生产同一套语句）
vi.mock("@/lib/db/migrations", async () => {
  const { default: Database } = await import("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE api_usage_daily_per_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      api_type TEXT NOT NULL,
      date TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, api_type, date)
    );
    CREATE TABLE api_usage_per_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      api_type TEXT NOT NULL,
      month TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, api_type, month)
    );
  `);
  const adapter = {
    query: async (sql: string, params?: unknown[]) => raw.prepare(sql).all(...(params ?? [])),
    get: async (sql: string, params?: unknown[]) => raw.prepare(sql).get(...(params ?? [])),
    run: async (sql: string, params?: unknown[]) => raw.prepare(sql).run(...(params ?? [])),
    exec: async (sql: string) => raw.exec(sql),
    close: () => raw.close(),
  };
  return { getAdapter: vi.fn(async () => adapter), __raw: raw };
});

// billing 用真实 DEFAULT_PLAN_LIMITS（不 mock 额度，证明套餐数字未被改动）
import { consumeQuota, refundQuota, peekUsage, QuotaExceededError, getPlanLimit } from "./cache";
import { isPlatformCredentialError, refundOnPlatformCredentialError } from "./credential-guard";
import { SeoProviderError } from "./provider";
import { DataForSeoApiError, DataForSeoNotConfiguredError } from "./dataforseo";
import { getApiDailyUsage, getUserApiUsage } from "@/lib/db";

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayKey(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

describe("refundQuota 与 consumeQuota 对称（真实 SQL）", () => {
  it("Free 套餐：扣 1 次后 used=1/1，回滚后回到 0/0，limit 不变", async () => {
    const user = "refund-free";
    await consumeQuota(user, "serpapi", "free");
    expect((await getUserApiUsage(user, "serpapi", monthKey()))?.used).toBe(1);
    expect((await getApiDailyUsage(user, "serpapi", todayKey()))?.used).toBe(1);

    await refundQuota(user, "serpapi", "free");

    expect((await getUserApiUsage(user, "serpapi", monthKey()))?.used).toBe(0);
    expect((await getApiDailyUsage(user, "serpapi", todayKey()))?.used).toBe(0);
    // 额度定义不变：free serpapi 月 30 / 日 3
    expect(await getPlanLimit("free", "serpapi")).toBe(30);
    expect((await peekUsage(user, "serpapi", "free")).limit).toBe(30);
  });

  it("used 不会回滚成负数：连续回滚 3 次仍为 0", async () => {
    const user = "refund-floor";
    await consumeQuota(user, "serpapi", "free");
    await refundQuota(user, "serpapi", "free");
    await refundQuota(user, "serpapi", "free");
    await refundQuota(user, "serpapi", "free");
    expect((await getUserApiUsage(user, "serpapi", monthKey()))?.used).toBe(0);
    expect((await getApiDailyUsage(user, "serpapi", todayKey()))?.used).toBe(0);
  });

  it("回滚不改变上限：free 第 4 次仍按每日 3 次拒绝（429 语义不变）", async () => {
    const user = "refund-429";
    await consumeQuota(user, "serpapi", "free");
    await consumeQuota(user, "serpapi", "free");
    await consumeQuota(user, "serpapi", "free");
    await refundQuota(user, "serpapi", "free"); // 回到 2/3
    const fourth = await consumeQuota(user, "serpapi", "free"); // 第 3 次（可用）
    expect(fourth.used).toBe(3);
    await expect(consumeQuota(user, "serpapi", "free")).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("lite 无日度 guard：只回滚月度；dataforseo 只回滚月度", async () => {
    const user = "refund-lite";
    await consumeQuota(user, "dataforseo", "lite");
    expect((await getUserApiUsage(user, "dataforseo", monthKey()))?.used).toBe(1);
    await refundQuota(user, "dataforseo", "lite");
    expect((await getUserApiUsage(user, "dataforseo", monthKey()))?.used).toBe(0);
    // lite dataforseo 月度额度仍是 5（未被改动）
    expect(await getPlanLimit("lite", "dataforseo")).toBe(5);
    expect(await getPlanLimit("pro", "dataforseo")).toBe(30);
  });

  it("回滚不影响其他用户与其他 API 类型的账本", async () => {
    const a = "refund-a";
    const b = "refund-b";
    await consumeQuota(a, "serpapi", "free");
    await consumeQuota(b, "serpapi", "free");
    await refundQuota(a, "serpapi", "free");
    expect((await getUserApiUsage(a, "serpapi", monthKey()))?.used).toBe(0);
    expect((await getUserApiUsage(b, "serpapi", monthKey()))?.used).toBe(1);
  });
});

describe("平台凭据错误判定", () => {
  it("SerpApi INVALID_KEY / DataForSEO 未配置 / 401xx-403xx → true", () => {
    expect(isPlatformCredentialError(new SeoProviderError("INVALID_KEY", "未配置 SERPAPI_KEY"))).toBe(true);
    expect(isPlatformCredentialError(new DataForSeoNotConfiguredError())).toBe(true);
    expect(isPlatformCredentialError(new DataForSeoApiError(40100, "no auth"))).toBe(true);
    expect(isPlatformCredentialError(new DataForSeoApiError(40102, "invalid login"))).toBe(true);
    expect(isPlatformCredentialError(new DataForSeoApiError(40200, "payment required"))).toBe(true);
    expect(isPlatformCredentialError(new DataForSeoApiError(40300, "not authorized"))).toBe(true);
  });

  it("额度超限 / 超时 / 上游故障 / 业务参数错误 → false（不回滚）", () => {
    expect(isPlatformCredentialError(new SeoProviderError("QUOTA_EXCEEDED", "额度耗尽"))).toBe(false);
    expect(isPlatformCredentialError(new SeoProviderError("TIMEOUT", "超时"))).toBe(false);
    expect(isPlatformCredentialError(new SeoProviderError("UPSTREAM_ERROR", "上游 500"))).toBe(false);
    expect(isPlatformCredentialError(new SeoProviderError("BAD_REQUEST", "参数错"))).toBe(false);
    expect(isPlatformCredentialError(new DataForSeoApiError(40501, "invalid field"))).toBe(false);
    expect(isPlatformCredentialError(new DataForSeoApiError(50000, "internal"))).toBe(false);
    expect(isPlatformCredentialError(new Error("random"))).toBe(false);
  });

  it("refundOnPlatformCredentialError：只对凭据错误回滚，且返回是否回滚", async () => {
    const user = "refund-guard";
    await consumeQuota(user, "serpapi", "free");

    const notRefunded = await refundOnPlatformCredentialError(
      new SeoProviderError("UPSTREAM_ERROR", "500"),
      user,
      "serpapi",
      "free"
    );
    expect(notRefunded).toBe(false);
    expect((await getUserApiUsage(user, "serpapi", monthKey()))?.used).toBe(1);

    const refunded = await refundOnPlatformCredentialError(
      new SeoProviderError("INVALID_KEY", "无效"),
      user,
      "serpapi",
      "free"
    );
    expect(refunded).toBe(true);
    expect((await getUserApiUsage(user, "serpapi", monthKey()))?.used).toBe(0);
  });
});
