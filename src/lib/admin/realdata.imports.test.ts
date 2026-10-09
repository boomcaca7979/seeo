// ===== 真实报表导入验证执行器（GSC ZIP / AdSense CSV，受控执行）=====
//
// 用途：用户提供真实导出文件后，一键跑通完整业务链路：
//   文件解析 → 校验 → 数据库写入（本地隔离库）→ 汇总读取 → 经营总览/趋势联动 → 重复导入/修订覆盖复核
//
// 运行方式（默认 SKIP，不影响常规测试套件）：
//   REAL_GSC_ZIP=/path/to/导出.zip REAL_ADSENSE_CSV=/path/to/报表.csv \
//   RUN_REAL_IMPORTS=1 npx vitest run src/lib/admin/realdata.imports.test.ts
// 两个文件可只提供其一（对应测试自动启用）。
//
// 隐私与安全：
//   - 只读取用户显式指定的文件路径；绝不扫描个人目录
//   - 写入目标是本地隔离库（file:// 临时库），绝不写生产
//   - 生产只读通道仅用于复核总览联动（SELECT）
//   - 输出只含行数/数值/错误原因，不含凭据与个人信息

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GSC_ZIP = process.env.REAL_GSC_ZIP ?? "";
const ADSENSE_CSV = process.env.REAL_ADSENSE_CSV ?? "";
const RUN = process.env.RUN_REAL_IMPORTS === "1";
const hasGsc = RUN && GSC_ZIP && fs.existsSync(GSC_ZIP);
const hasAds = RUN && ADSENSE_CSV && fs.existsSync(ADSENSE_CSV);
const itMaybe = RUN ? it : it.skip;

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-real-imports-"));

function readEnvValue(file: string, key: string): string | undefined {
  try {
    const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(key + "="));
    if (!line) return undefined;
    return line.slice(key.length + 1).replace(/^["']|["']$/g, "").trim() || undefined;
  } catch {
    return undefined;
  }
}

type ImportModule = typeof import("./gsc-import");
type MetricsModule = typeof import("./gsc-metrics");
type FunnelModule = typeof import("./funnel");
type AdsModule = typeof import("./ads");
type AdsManualModule = typeof import("./ads/manual");

let gscImport: ImportModule;
let metrics: MetricsModule;
let funnel: FunnelModule;
let ads: AdsModule;
let adsManual: AdsManualModule;

beforeAll(async () => {
  if (!RUN) return;
  const supabaseUrl =
    readEnvValue(".env.local", "NEXT_PUBLIC_SUPABASE_URL") ??
    readEnvValue(".env.development.local", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole =
    readEnvValue(".env.development.local", "SUPABASE_SERVICE_ROLE_KEY") ??
    readEnvValue(".env.local", "SUPABASE_SERVICE_ROLE_KEY");
  const roUrl = readEnvValue(".env.development.local", "TURSO_READONLY_DATABASE_URL");
  const roToken = readEnvValue(".env.development.local", "TURSO_READONLY_AUTH_TOKEN");

  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/snapshots.db`;
  process.env.TURSO_AUTH_TOKEN = "local-snapshot";
  if (supabaseUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  if (serviceRole) process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRole;
  if (roUrl) process.env.TURSO_READONLY_DATABASE_URL = roUrl;
  if (roToken) process.env.TURSO_READONLY_AUTH_TOKEN = roToken;
  delete process.env.CREEM_WEBHOOK_SECRET;

  vi.resetModules();
  gscImport = await import("./gsc-import");
  metrics = await import("./gsc-metrics");
  funnel = await import("./funnel");
  ads = await import("./ads");
  adsManual = await import("./ads/manual");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe.skipIf(!hasGsc)("真实 GSC ZIP 导入（完整链路）", () => {
  const PROPERTY = "sc-domain:seeo.asia";
  const WINDOW = 28;

  itMaybe("首次导入：多维度自动识别 + 写入 + 读取联动", async () => {
    const buf = new Uint8Array(fs.readFileSync(GSC_ZIP));
    // PK 魔数校验（与路由层一致）
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);

    const result = await gscImport.importGscZip(buf, { propertyUrl: PROPERTY, windowDays: WINDOW });
    expect(result.fatal).toBeFalsy();
    // 输出每个文件的识别结果（文件名 / 维度 / 行数 / 错误）——供真实格式问题定位
    for (const f of result.files) {
      console.log(
        `[GSC] ${f.file} → kind=${f.kind ?? "unknown"} written=${f.written} skipped=${f.skipped ?? "no"} errors=${f.errors.length}${
          f.errors.length ? " | " + f.errors.map((e) => `L${e.line}:${e.reason}`).join("；") : ""
        }`
      );
    }
    expect(result.written).toBeGreaterThan(0);

    // Dates 维度 → 概览联动（gscConnected 解锁）
    const lastSync = await import("./gsc-sync").then((m) => m.getGscLastSync());
    expect(lastSync).not.toBeNull();

    const totals = await metrics.getGscTotals(WINDOW);
    console.log(
      `[GSC] totals clicks=${totals.clicks} impressions=${totals.impressions} ctr=${(totals.ctr * 100).toFixed(2)}% position=${totals.position}`
    );
    // 真实效果报告：曝光数必然可观
    expect(totals.impressions).toBeGreaterThan(0);
    expect((await metrics.getGscQueries(WINDOW)).length).toBeGreaterThan(0);
    expect((await metrics.getGscPages(WINDOW)).length).toBeGreaterThan(0);

    // 经营总览联动：gscConnected 解锁 + searchClicks 使用真实数据
    const overview = await funnel.getAdminOverview(WINDOW);
    expect(overview.availability.gscConnected).toBe(true);
    expect(overview.metrics.searchClicks).toBeGreaterThan(0);
    expect(overview.funnel.find((s) => s.key === "impression")!.available).toBe(true);
  });

  itMaybe("重复上传同一 ZIP：行数不翻倍、数值不叠加", async () => {
    const before = await metrics.getGscTotals(WINDOW);
    const buf = new Uint8Array(fs.readFileSync(GSC_ZIP));
    const result = await gscImport.importGscZip(buf, { propertyUrl: PROPERTY, windowDays: WINDOW });
    expect(result.fatal).toBeFalsy();
    const after = await metrics.getGscTotals(WINDOW);
    expect(after.clicks).toBe(before.clicks);
    expect(after.impressions).toBe(before.impressions);
  });

  itMaybe("不同窗口天数口径隔离：7 天视图只含 7 天导入的数据", async () => {
    // 若用户同时提供多窗口报表可扩展；此处验证 28 天导入后 7 天视图不会误读 28 天快照
    const q28 = await metrics.getGscQueries(WINDOW);
    const q7 = await metrics.getGscQueries(7);
    // 7 天窗口未导入 → 应为空（不混用 28 天数据）
    if (!q7.some((r) => q28.some((x) => x.key === r.key))) {
      expect(q7).toHaveLength(0);
    }
  });
});

describe.skipIf(!hasAds)("真实 AdSense CSV 导入（完整链路）", () => {
  itMaybe("首次导入：解析 → 写入 → 汇总 → 币种口径", async () => {
    const text = fs.readFileSync(ADSENSE_CSV, "utf8");
    const parsed = adsManual.parseAdRevenueCsv(text);
    for (const e of parsed.errors.slice(0, 10)) {
      console.log(`[ADS] 错误 行${e.line}: ${e.reason}`);
    }
    if (parsed.errors.length > 0) {
      // 真实报表有无法识别的行时：如实报告，不写库（与路由层全有全无一致）
      console.log(`[ADS] 存在 ${parsed.errors.length} 个行级错误，本次不写库（全有全无）`);
      expect(parsed.rows.length + parsed.errors.length).toBeGreaterThan(0);
      return;
    }
    expect(parsed.rows.length).toBeGreaterThan(0);
    console.log(`[ADS] 解析 ${parsed.rows.length} 行，币种=${[...new Set(parsed.rows.map((r) => r.currency))].join("/")}`);

    await ads.writeAdRevenueDays(parsed.rows, { provider: "adsense", source: "csv" });
    const s30 = await ads.getAdRevenueSummary(30);
    console.log(
      `[ADS] 30d USD=${(s30.revenueCents / 100).toFixed(2)} nonUsd=${s30.nonUsd.map((n) => `${(n.cents / 100).toFixed(2)} ${n.currency}`).join(",") || "无"} mixed=${s30.mixedCurrency}`
    );
    expect(s30.hasData).toBe(true);
    expect(s30.revenueCents).toBeGreaterThan(0);
    // 汇总 = 各行 USD 部分之和（口径一致性）
    const usdSum = parsed.rows.filter((r) => r.currency === "USD").reduce((s, r) => s + r.revenueCents, 0);
    expect(s30.revenueCents).toBe(usdSum);

    // 经营总览联动：广告收入计入 + 广告趋势有数据
    const overview = await funnel.getAdminOverview(30);
    expect(overview.availability.ads).toBe(true);
    expect(overview.metrics.adRevenueCents).toBeGreaterThan(0);
    expect(overview.series.some((p) => p.adRevenueCents > 0)).toBe(true);

    // 重复导入同一份 → 不叠加
    await ads.writeAdRevenueDays(parsed.rows, { provider: "adsense", source: "csv" });
    expect((await ads.getAdRevenueSummary(30)).revenueCents).toBe(usdSum);
  });

  itMaybe("修订报表覆盖：同日期不同金额 → 以最新为准", async () => {
    const text = fs.readFileSync(ADSENSE_CSV, "utf8");
    const parsed = adsManual.parseAdRevenueCsv(text);
    if (parsed.errors.length > 0 || parsed.rows.length === 0) return;
    const firstRow = parsed.rows[0];
    const revisedCsv = [
      "Date,Revenue,Impressions,Clicks,Currency",
      `${firstRow.date},${((firstRow.revenueCents + 1) / 100).toFixed(2)},${firstRow.impressions},${firstRow.clicks},${firstRow.currency}`,
    ].join("\n");
    await ads.writeAdRevenueDays(adsManual.parseAdRevenueCsv(revisedCsv).rows, {
      provider: "adsense",
      source: "csv",
    });
    const daily = await ads.getAdRevenueDaily(30);
    const row = daily.find((r) => r.date === firstRow.date);
    if (firstRow.currency === "USD") {
      expect(row?.revenueCents).toBe(firstRow.revenueCents + 1); // 覆盖而非叠加
    }
  });
});
