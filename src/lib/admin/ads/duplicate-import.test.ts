// ===== 广告收入 CSV 重复导入幂等（用户点名场景）=====
//
// 验证真实链路：CSV 文本 → parseAdRevenueCsv → writeAdRevenueDays → getAdRevenueSummary。
// 核心承诺：
//   1. 同一份报表导入两次 → 行数不翻倍、收入不叠加（ON CONFLICT(date, provider) 覆盖）；
//   2. 同一日期重新导入**不同金额** → 以最新导入为准（覆盖更新，不是追加）；
//   3. 汇总口径（getAdRevenueSummary）与写入内容一致。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-ads-duplicate-"));

type AdsModule = typeof import("./index");
type ManualModule = typeof import("./manual");

let ads: AdsModule;
let manual: ManualModule;

function isoDay(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function csvFor(day0: string, day1: string, rev0: string, rev1: string): string {
  return [
    "Date,Revenue,Impressions,Clicks,Currency",
    `${day0},${rev0},500,8,USD`,
    `${day1},${rev1},300,5,USD`,
  ].join("\n");
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
  ads = await import("./index");
  manual = await import("./manual");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("广告收入 CSV：重复导入不叠加收入", () => {
  const d0 = isoDay(0);
  const d1 = isoDay(1);

  it("第一次导入：2 行入库，汇总 = 12.34 + 7.89 = 2023 分", async () => {
    const parsed = manual.parseAdRevenueCsv(csvFor(d0, d1, "12.34", "7.89"));
    expect(parsed.errors).toEqual([]);
    const written = await ads.writeAdRevenueDays(parsed.rows, {
      provider: "adsense",
      source: "csv",
    });
    expect(written).toBe(2);

    const summary = await ads.getAdRevenueSummary(7);
    expect(summary.hasData).toBe(true);
    expect(summary.revenueCents).toBe(1234 + 789);
    expect(summary.lastImportedAt).not.toBeNull();
  });

  it("同一份报表重复导入 → 行数仍为 2，收入不叠加", async () => {
    const parsed = manual.parseAdRevenueCsv(csvFor(d0, d1, "12.34", "7.89"));
    const written = await ads.writeAdRevenueDays(parsed.rows, {
      provider: "adsense",
      source: "csv",
    });
    expect(written).toBe(2);

    const summary = await ads.getAdRevenueSummary(7);
    // 关键断言：还是 2023 分，而不是 2023 × 2
    expect(summary.revenueCents).toBe(1234 + 789);
  });

  it("同日期重新导入不同金额 → 覆盖为最新值（不是追加）", async () => {
    const parsed = manual.parseAdRevenueCsv(csvFor(d0, d1, "10.00", "5.00"));
    await ads.writeAdRevenueDays(parsed.rows, { provider: "adsense", source: "csv" });

    const summary = await ads.getAdRevenueSummary(7);
    expect(summary.revenueCents).toBe(1000 + 500);

    const daily = await ads.getAdRevenueDaily(7);
    const today = daily.find((r) => r.date === d0);
    expect(today?.revenueCents).toBe(1000); // 覆盖后的值
  });
});
