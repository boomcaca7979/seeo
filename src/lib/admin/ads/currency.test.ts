// ===== 广告收入币种口径：非 USD 不换算、不并入 USD 合计 =====
//
// 验证：getAdRevenueSummary / getAdRevenueDaily 的 revenueCents 只含 USD；
// 非 USD 金额在 nonUsd 单独列出（分，按币种），绝不跨币种相加；
// 同一日修订导入仍按 (date, provider) 覆盖。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-ads-currency-"));

type AdsModule = typeof import("./index");
type ManualModule = typeof import("./manual");

let ads: AdsModule;
let manual: ManualModule;

function isoDay(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
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

describe("广告收入：币种口径", () => {
  const d0 = isoDay(0); // USD 日
  const d1 = isoDay(1); // EUR 日
  const d2 = isoDay(2); // EUR-only 日

  it("USD 日 + EUR 日：汇总 revenueCents 只含 USD，EUR 单独列出", async () => {
    const csv = [
      "Date,Revenue,Impressions,Clicks,Currency",
      `${d0},10.00,100,4,USD`,
      `${d1},8.00,80,3,EUR`,
    ].join("\n");
    const parsed = manual.parseAdRevenueCsv(csv);
    expect(parsed.errors).toEqual([]);
    await ads.writeAdRevenueDays(parsed.rows, { provider: "adsense", source: "csv" });

    const summary = await ads.getAdRevenueSummary(7);
    expect(summary.hasData).toBe(true);
    // 关键口径：USD 合计只含 USD 行；EUR 的 800 分绝不并入
    expect(summary.revenueCents).toBe(1000);
    expect(summary.nonUsd).toEqual([{ currency: "EUR", cents: 800 }]);
    expect(summary.mixedCurrency).toBe(true);

    // 日序列同样只含 USD，非 USD 单独携带
    const daily = await ads.getAdRevenueDaily(7);
    const usdDay = daily.find((r) => r.date === d0);
    const eurDay = daily.find((r) => r.date === d1);
    expect(usdDay?.revenueCents).toBe(1000);
    expect(usdDay?.nonUsd).toEqual([]);
    expect(eurDay?.revenueCents).toBe(0); // 该日只有 EUR → USD 口径为 0，而不是 800
    expect(eurDay?.nonUsd).toEqual([{ currency: "EUR", cents: 800 }]);
  });

  it("EUR-only 修订导入：按 (date, provider) 覆盖，不叠加", async () => {
    const csv = ["Date,Revenue,Impressions,Clicks,Currency", `${d2},5.00,50,2,EUR`].join("\n");
    await ads.writeAdRevenueDays(manual.parseAdRevenueCsv(csv).rows, {
      provider: "adsense",
      source: "csv",
    });
    // 同日重新导入修订值
    const csv2 = ["Date,Revenue,Impressions,Clicks,Currency", `${d2},6.00,55,2,EUR`].join("\n");
    await ads.writeAdRevenueDays(manual.parseAdRevenueCsv(csv2).rows, {
      provider: "adsense",
      source: "csv",
    });

    const summary = await ads.getAdRevenueSummary(7);
    expect(summary.revenueCents).toBe(1000); // USD 部分不受影响
    expect(summary.nonUsd).toEqual([{ currency: "EUR", cents: 800 + 600 }]);

    const daily = await ads.getAdRevenueDaily(7);
    const eurOnly = daily.find((r) => r.date === d2);
    expect(eurOnly?.nonUsd).toEqual([{ currency: "EUR", cents: 600 }]); // 覆盖而非 500+600
  });
});
