// ===== Owner Console 真实数据端到端集成验证（受控执行）=====
//
// 默认 SKIP（不依赖网络，保证常规测试套件稳定）；显式 RUN_INTEGRATION=1 时执行：
//   npm run 不可用 —— 直接 `RUN_INTEGRATION=1 npx vitest run src/lib/admin/integration.realdata.test.ts`
//
// 覆盖真实链路：
//   生产 Turso 只读通道（TURSO_READONLY_*）→ 访客/趋势/来源标注
//   Supabase 权威表（service_role）→ 客户/订单/收入（含 CNY 历史订单不冒充 USD）
//   本地隔离库 → GSC / 广告 CSV 导入、重复导入、错误状态（source events）
// 隐私：凭据只从 .env*.local 读入 process.env，任何断言输出不得包含密钥或个人信息。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const RUN = process.env.RUN_INTEGRATION === "1";
const itMaybe = RUN ? it : it.skip;

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-integration-"));

function readEnvValue(file: string, key: string): string | undefined {
  try {
    const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(key + "="));
    if (!line) return undefined;
    return line.slice(key.length + 1).replace(/^["']|["']$/g, "").trim() || undefined;
  } catch {
    return undefined;
  }
}

type FunnelModule = typeof import("./funnel");
type RevenueModule = typeof import("./revenue");
type CustomersModule = typeof import("./customers");
type DataSourcesModule = typeof import("./data-sources");
type AdsModule = typeof import("./ads");
type AdsManualModule = typeof import("./ads/manual");
type SourceEventsModule = typeof import("./source-events");

let funnel: FunnelModule;
let revenue: RevenueModule;
let customers: CustomersModule;
let dataSources: DataSourcesModule;
let ads: AdsModule;
let adsManual: AdsManualModule;
let sourceEvents: SourceEventsModule;

beforeAll(async () => {
  if (!RUN) return;
  // 真实凭据（不打印）：Supabase 权威表 + 生产只读通道
  const supabaseUrl =
    readEnvValue(".env.local", "NEXT_PUBLIC_SUPABASE_URL") ??
    readEnvValue(".env.development.local", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole =
    readEnvValue(".env.development.local", "SUPABASE_SERVICE_ROLE_KEY") ??
    readEnvValue(".env.local", "SUPABASE_SERVICE_ROLE_KEY");
  const roUrl = readEnvValue(".env.development.local", "TURSO_READONLY_DATABASE_URL");
  const roToken = readEnvValue(".env.development.local", "TURSO_READONLY_AUTH_TOKEN");

  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  // 本地隔离库：GSC / 广告 / Creem 快照表的写入与读取都在这里（测试事件绝不进生产）
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/snapshots.db`;
  process.env.TURSO_AUTH_TOKEN = "local-snapshot";
  if (supabaseUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  if (serviceRole) process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRole;
  if (roUrl) process.env.TURSO_READONLY_DATABASE_URL = roUrl;
  if (roToken) process.env.TURSO_READONLY_AUTH_TOKEN = roToken;
  delete process.env.CREEM_WEBHOOK_SECRET;

  vi.resetModules();
  funnel = await import("./funnel");
  revenue = await import("./revenue");
  customers = await import("./customers");
  dataSources = await import("./data-sources");
  ads = await import("./ads");
  adsManual = await import("./ads/manual");
  sourceEvents = await import("./source-events");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe.skipIf(!RUN)("真实链路：生产只读通道 + Supabase 权威表 + 本地快照库", () => {
  itMaybe("经营总览：访客/激活来自生产只读，来源标注为 production-readonly", async () => {
    const overview = await funnel.getAdminOverview(30);
    expect(overview.analyticsSource).toBe("production-readonly");
    expect(overview.analyticsSourceNote).toContain("生产");
    // 生产库最近 30 天有真实事件（09-28 起 35 行），访客不可能为 0
    expect(overview.metrics.visitors).toBeGreaterThan(0);
    expect(overview.availability.analytics).toBe(true);
    // 趋势序列长度与窗口一致（30 天）
    expect(overview.series).toHaveLength(30);
  });

  itMaybe("data-sources：analytics 行通过只读通道反映生产行数（synced，而非本地 0）", async () => {
    const rows = await dataSources.getDataSourceStatuses();
    const analytics = rows.find((r) => r.id === "analytics");
    expect(analytics).toBeDefined();
    expect(analytics!.state).toBe("synced");
    expect(analytics!.localRows ?? 0).toBeGreaterThan(0);
    expect(analytics!.hint).toContain("生产库");
    // Supabase 探针行：已配置且可读（非 unreachable）
    const supabase = rows.find((r) => r.id === "supabase-admin");
    expect(supabase!.state).not.toBe("unreachable");
    expect(supabase!.state).not.toBe("not-configured");
  });

  itMaybe("Supabase 权威表：客户列表 / 订单 / CNY 历史订单不冒充 USD", async () => {
    const snap = await customers.listCustomers();
    expect(snap.available).toBe(true);
    expect(snap.ordersAvailable).toBe(true);
    expect(snap.rows.length).toBeGreaterThan(0);
    // 搜索（大小写不敏感）与状态筛选可用
    const filtered = customers.filterCustomers(snap.rows, { search: snap.rows[0].email.slice(0, 5) });
    expect(filtered.length).toBeGreaterThanOrEqual(1);

    const summary = await revenue.getRevenueSummary(30);
    expect(summary.subscription.available).toBe(true);
    // 历史 CNY 订单：按币种分列，绝不并入 USD totalNetCents
    const cny = summary.subscription.breakdown.find((b) => b.currency === "CNY");
    if (cny) {
      expect(cny.netCents).not.toBe(0);
      expect(summary.otherCurrencyNet.some((o) => o.currency === "CNY")).toBe(true);
    }
    expect(summary.snapshotGap.ordersAvailable).toBe(true);
  });

  itMaybe("广告 CSV：导入 → 汇总 → 重复导入不叠加 → 修订覆盖 → 错误状态记录", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const csv = ["Date,Revenue,Impressions,Clicks,Currency", `${today},3.21,50,2,USD`].join("\n");
    const parsed = adsManual.parseAdRevenueCsv(csv);
    expect(parsed.errors).toEqual([]);
    await ads.writeAdRevenueDays(parsed.rows, { provider: "adsense", source: "csv" });
    const first = await ads.getAdRevenueSummary(1);
    expect(first.hasData).toBe(true);
    expect(first.revenueCents).toBe(321);

    // 重复导入同一份 → 不叠加
    await ads.writeAdRevenueDays(parsed.rows, { provider: "adsense", source: "csv" });
    expect((await ads.getAdRevenueSummary(1)).revenueCents).toBe(321);

    // 修订金额 → 覆盖
    const revised = ["Date,Revenue,Impressions,Clicks,Currency", `${today},4.00,60,3,USD`].join("\n");
    await ads.writeAdRevenueDays(adsManual.parseAdRevenueCsv(revised).rows, {
      provider: "adsense",
      source: "csv",
    });
    expect((await ads.getAdRevenueSummary(1)).revenueCents).toBe(400);

    // 非法 CSV → 解析层报行级错误（路由层据此全有全无，不写库）
    const bad = adsManual.parseAdRevenueCsv("Date,Revenue\nnot-a-date,1.00");
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.rows).toHaveLength(0);

    // 成功事件写入 → data-sources 广告行可观察到 lastSuccess
    await sourceEvents.recordSourceEvent("ads:adsense", "success", "集成验证：CSV 导入成功");
    const rows = await dataSources.getDataSourceStatuses();
    const adsRow = rows.find((r) => r.id === "ads:adsense");
    expect(adsRow!.lastSuccess?.message).toContain("集成验证");
  });

  itMaybe("历史对账：快照缺失时如实报告（不冒充历史）", async () => {
    const gap = await revenue.getCreemSnapshotGap();
    // 本地隔离库 Creem 快照为空：hasCreemData=false，绝不伪造对账结论
    expect(gap.hasCreemData).toBe(false);
    expect(gap.ordersAvailable).toBe(true);
    expect(gap.missingSnapshot.length).toBe(0); // orders 已读、快照无数据 → 不逐单比对，而非误报缺口
  });
});
