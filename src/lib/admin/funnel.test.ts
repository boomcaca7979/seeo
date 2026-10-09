// ===== Owner Console 首页数据层：窗口归一化 + 概览聚合 + 诚实降级 =====
//
// 这个文件测的是「老板打开 /admin 看到的那个数字是怎么来的」：
//   1. 窗口只接受 1 / 7 / 30，非法值回落 7（URL 手改不能炸页面）；
//   2. **不可用 ≠ 0**：Supabase 权威表 / GSC / 广告数据缺失时，
//      漏斗节点必须标记 available=false，而不是把 0 冒充成"真的没人"；
//   3. 有数据时能端到端串起来：GSC → Visit → Signup → 诊断结论。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-admin-overview-"));

type FunnelModule = typeof import("./funnel");
type AdsModule = typeof import("./ads");
type RevenueModule = typeof import("./revenue");
type MigrationsModule = typeof import("@/lib/db/migrations");

let funnel: FunnelModule;
let ads: AdsModule;
let revenue: RevenueModule;
let db: MigrationsModule;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  // 明确保证 Supabase admin client 不可用 → 权威表走"可用性降级"分支
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();
  funnel = await import("./funnel");
  ads = await import("./ads");
  revenue = await import("./revenue");
  db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("normalizeWindow：URL 参数只认 1 / 7 / 30", () => {
  it("合法值原样返回", () => {
    expect(funnel.normalizeWindow("1")).toBe(1);
    expect(funnel.normalizeWindow("7")).toBe(7);
    expect(funnel.normalizeWindow("30")).toBe(30);
  });

  it("缺失 / 非数字 / 不在枚举内 → 回落 7（不炸页面）", () => {
    expect(funnel.normalizeWindow(undefined)).toBe(7);
    expect(funnel.normalizeWindow("")).toBe(7);
    expect(funnel.normalizeWindow("abc")).toBe(7);
    expect(funnel.normalizeWindow("0")).toBe(7);
    expect(funnel.normalizeWindow("-7")).toBe(7);
    expect(funnel.normalizeWindow("90")).toBe(7); // 90D 只属于 GSC 页
    expect(funnel.normalizeWindow("7.5")).toBe(7);
  });

  it("窗口枚举与文案一一对应", () => {
    for (const w of funnel.ADMIN_WINDOWS) {
      expect(funnel.ADMIN_WINDOW_LABELS[w], `缺少窗口文案：${w}`).toBeTruthy();
    }
  });
});

describe("getAdminOverview：数据源不可用时的诚实降级（不可用 ≠ 0）", () => {
  it("权威表未配置时，Signup / Checkout / Paid 标记为 unavailable，而不是 0", async () => {
    const o = await funnel.getAdminOverview(7);
    expect(o.availability.profiles).toBe(false);
    expect(o.availability.orders).toBe(false);
    expect(o.availability.analytics).toBe(false);
    expect(o.availability.gscConnected).toBe(false);
    expect(o.availability.ads).toBe(false);

    const byKey = Object.fromEntries(o.funnel.map((s) => [s.key, s]));
    expect(byKey.signup.available).toBe(false);
    expect(byKey.checkout.available).toBe(false);
    expect(byKey.paid.available).toBe(false);
    expect(byKey.visit.available).toBe(false);
    expect(byKey.activation.available).toBe(false);
    expect(byKey.impression.available).toBe(false);
    expect(byKey.click.available).toBe(false);
    // 数字仍然是 0（没数据），但上面的 available=false 才是 UI 该展示的信号
    for (const step of o.funnel) expect(step.count).toBe(0);
  });

  it("无数据时不下结论：NO_DATA + conclusive=false", async () => {
    const o = await funnel.getAdminOverview(7);
    expect(o.diagnosis.code).toBe("NO_DATA");
    expect(o.diagnosis.conclusive).toBe(false);
    expect(o.diagnosis.missingData.length).toBeGreaterThan(0);
  });

  it("趋势序列是 7 天骨架（升序、末日为今天、全 0）", async () => {
    const o = await funnel.getAdminOverview(7);
    expect(o.series).toHaveLength(7);
    const days = o.series.map((s) => s.day);
    expect([...days].sort()).toEqual(days);
    expect(days[days.length - 1]).toBe(new Date().toISOString().slice(0, 10));
    for (const p of o.series) {
      expect(p).toMatchObject({ visitors: 0, signups: 0, activated: 0, checkout: 0, paid: 0 });
    }
  });

  it("首节点转化率为 null（没有上游）；未同步过 GSC / 未导入广告 → null 时间戳", async () => {
    const o = await funnel.getAdminOverview(7);
    expect(o.funnel[0].conversionFromPrevious).toBeNull();
    expect(o.gscLastSyncAt).toBeNull();
    expect(o.adsLastImportedAt).toBeNull();
  });
});

describe("getAdminOverview：有数据时端到端串起来", () => {
  beforeAll(async () => {
    const adapter = await db.getAdapter();
    const now = new Date().toISOString();

    // 两个访客（不同匿名身份）
    await adapter.run(
      `INSERT INTO analytics_events (event_name, anonymous_id, created_at, path)
       VALUES ('page_view', 'anon-1', ?, '/'), ('page_view', 'anon-2', ?, '/pricing')`,
      [now, now]
    );
    // 其中一个用户完成了首次审计（激活）
    await adapter.run(
      `INSERT INTO analytics_events (event_name, user_id, created_at)
       VALUES ('activation_completed', 'u-1', ?)`,
      [now]
    );
    // GSC：今天的站点级日指标
    await adapter.run(
      `INSERT INTO gsc_daily_metrics (property_url, date, clicks, impressions, ctr, position)
       VALUES ('sc-domain:seeo.asia', ?, 5, 100, 0.05, 12.4)`,
      [new Date().toISOString().slice(0, 10)]
    );
    // 广告收入（provider 独立来源）
    await ads.writeAdRevenueDays(
      [
        {
          date: new Date().toISOString().slice(0, 10),
          revenueCents: 1234,
          impressions: 2000,
          clicks: 12,
          currency: "USD",
        },
      ],
      { provider: "adsense", source: "csv" }
    );
  });

  it("访客 / 激活 / GSC 点击 / 广告收入都进入指标", async () => {
    const o = await funnel.getAdminOverview(7);
    expect(o.metrics.visitors).toBe(2);
    expect(o.metrics.activatedUsers).toBe(1);
    expect(o.metrics.searchClicks).toBe(5);
    expect(o.metrics.adRevenueCents).toBe(1234);
    expect(o.gscLastSyncAt).not.toBeNull();
    expect(o.adsLastImportedAt).not.toBeNull();
    // 订阅收入不可用（权威表未配置）→ 总收入 = 广告收入，不虚增
    expect(o.metrics.totalRevenueCents).toBe(1234);
  });

  it("漏斗 Visit→Activation 段有数、Signup 段标为 unavailable", async () => {
    const o = await funnel.getAdminOverview(7);
    const byKey = Object.fromEntries(o.funnel.map((s) => [s.key, s]));
    expect(byKey.impression).toMatchObject({ count: 100, available: true });
    expect(byKey.click).toMatchObject({ count: 5, available: true });
    expect(byKey.visit).toMatchObject({ count: 2, available: true });
    expect(byKey.activation).toMatchObject({ count: 1, available: true });
    // 转化率永远相对**上一节点**：Click→Visit = 5/100，Visit→Signup = 0/2
    expect(byKey.click.conversionFromPrevious).toBe(0.05);
    expect(byKey.visit.conversionFromPrevious).toBe(0.4);
    expect(byKey.signup).toMatchObject({ count: 0, available: false });
    expect(byKey.signup.conversionFromPrevious).toBe(0); // 有上游但 0 注册
    // 上游缺失（signup 不可用 = 0）时不给转化率，避免把"没数据"显示成 0%
    expect(byKey.activation.conversionFromPrevious).toBeNull();
  });

  it("诊断诚实性：有访问但注册数据不可读 → 数据不足，不断言注册环节", async () => {
    const o = await funnel.getAdminOverview(7);
    expect(o.diagnosis.code).toBe("INSUFFICIENT_DATA");
    expect(o.diagnosis.conclusive).toBe(false);
    // 必须说明缺什么数据，而不是把「不可读」当成 0 注册
    expect(o.diagnosis.missingData.join("\n")).toContain("注册数据不可读");
  });

  it("趋势序列把 GSC 点击与广告收入落到对应日期", async () => {
    const o = await funnel.getAdminOverview(7);
    const today = new Date().toISOString().slice(0, 10);
    const point = o.series.find((p) => p.day === today);
    expect(point?.searchClicks).toBe(5);
    expect(point?.adRevenueCents).toBe(1234);
    expect(point?.visitors).toBe(2);
    expect(point?.activated).toBe(1);
  });
});

describe("revenue：分母为 0 时不伪造 ARPU", () => {
  it("窗口内没有付费 → ARPU value=null（UI 显示 unavailable，而不是 $0.00）", async () => {
    const arpu = await revenue.getArpu(7);
    expect(arpu.value).toBeNull();
    expect(arpu.basis.trim().length).toBeGreaterThan(0);
  });

  it("MRR 在权威表不可用时标记 available=false", async () => {
    const mrr = await revenue.getMrr();
    expect(mrr.available).toBe(false);
    expect(mrr.mrrCents).toBe(0);
    expect(mrr.basis).toContain("Custom");
  });
});

describe("ads：provider 独立收入源（与订阅收入分开统计）", () => {
  it("汇总把同一天的多个 provider 分别保存并聚合", async () => {
    await ads.writeAdRevenueDays(
      [
        {
          date: new Date().toISOString().slice(0, 10),
          revenueCents: 200,
          impressions: 100,
          clicks: 1,
          currency: "USD",
        },
      ],
      { provider: "other-network", source: "manual" }
    );
    const summary = await ads.getAdRevenueSummary(7);
    expect(summary.hasData).toBe(true);
    expect(summary.revenueCents).toBe(1234 + 200); // SUM 跨 provider
  });

  it("未知 provider id → null（不做静默 fallback）", () => {
    expect(ads.getAdProvider("nope")).toBeNull();
    expect(ads.getAdProvider("adsense")?.id).toBe("adsense");
  });
});
