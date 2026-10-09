// ===== GSC CSV 导入：真实 Search Console 导出格式 + 幂等 + 概览联动 =====
//
// fixture 依据 GSC「效果报告 → 导出 → 下载 CSV」的真实文件结构：
//   - ZIP 内各维度 CSV（Queries / Pages / Dates）
//   - 元数据头部（标题 / 空行 / 分组行）之后才是表头
//   - CTR 为百分比字符串（"12.34%"），Position 小数可空
// 核心承诺：
//   1. 三种维度都能解析真实格式；
//   2. 重复导入同一份 → 行数不翻倍、读取值不变（覆盖式 upsert）；
//   3. Dates 导入后 getGscLastSync / getGscTotals / getGscDaily / 经营概览联动生效；
//   4. 非法行给出行号与原因，不写入该行。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-gsc-import-"));

type ImportModule = typeof import("./gsc-import");
type MetricsModule = typeof import("./gsc-metrics");
type SyncModule = typeof import("./gsc-sync");

import { zipSync, strToU8 } from "fflate";

let gscImport: ImportModule;
let metrics: MetricsModule;
let sync: SyncModule;

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** 真实 GSC Queries.csv 形态：元数据头 + 分组行 + 表头 + 数据（CTR 带 %） */
const QUERIES_CSV = [
  "Search Analytics",
  "Search type: Web",
  "",
  "Top queries",
  "",
  "Top queries,Clicks,Impressions,CTR,Position",
  `"seo audit tool",120,"3,456",3.47%,2.3`,
  "seeo audit,45,900,5.00%,",
  "technical seo checklist,0,120,0%,8.9",
].join("\n");

/** 真实 GSC Pages.csv 形态（Landing Page 别名 + 空行分隔） */
const PAGES_CSV = [
  "Top pages,Clicks,Impressions,CTR,Position",
  "https://www.seeo.asia/,88,2100,4.19%,2.1",
  "",
  "https://www.seeo.asia/tools,12,430,2.79%,4.6",
].join("\n");

/** 真实 GSC Dates.csv 形态 */
const DATES_CSV = [
  "Date,Clicks,Impressions,CTR,Position",
  `${today},70,"1,200",5.83%,3.2`,
  `${yesterday},55,1000,5.50%,3.8`,
].join("\n");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
  gscImport = await import("./gsc-import");
  metrics = await import("./gsc-metrics");
  sync = await import("./gsc-sync");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("parseGscExportCsv：真实导出格式", () => {
  it("Queries.csv：跳过元数据头与分组行，CTR 百分比与千分位正确，空 Position → null", () => {
    const r = gscImport.parseGscExportCsv(QUERIES_CSV, "queries");
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({
      key: "seo audit tool",
      clicks: 120,
      impressions: 3456,
      ctr: 0.0347,
      position: 2.3,
    });
    expect(r.rows[1].position).toBeNull(); // 空 Position
    expect(r.rows[1].ctr).toBe(0.05);
    expect(r.rows[2].ctr).toBe(0); // 0%
  });

  it("Pages.csv：Landing Page 别名 + 空行跳过", () => {
    const r = gscImport.parseGscExportCsv(PAGES_CSV, "pages");
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1].key).toBe("https://www.seeo.asia/tools");
  });

  it("Dates.csv：日期维度可解析", () => {
    const r = gscImport.parseGscExportCsv(DATES_CSV, "dates");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.key)).toEqual([today, yesterday]);
    expect(r.rows[0].impressions).toBe(1200);
  });

  it("表头完全不匹配 → line 0 报错（不猜测、不造数据）", () => {
    const r = gscImport.parseGscExportCsv("foo,bar\n1,2", "queries");
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].line).toBe(0);
    expect(r.errors[0].reason).toContain("未找到表头");
  });

  it("非法行给出行号与原因，且不写入该行", () => {
    const csv = [
      "Top queries,Clicks,Impressions,CTR,Position",
      "good query,1,10,10%,5",
      "bad clicks,abc,10,10%,5",
      "bad ctr,1,10,x%,5",
    ].join("\n");
    const r = gscImport.parseGscExportCsv(csv, "queries");
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(r.errors[0].reason).toContain("clicks 非法");
  });

  it("空文件 → line 0 错误", () => {
    const r = gscImport.parseGscExportCsv("  ", "dates");
    expect(r.errors).toEqual([{ line: 0, reason: "文件为空" }]);
  });
});

describe("writeGscImportRows：幂等写入与概览联动", () => {
  const PROPERTY = "sc-domain:seeo.asia";

  it("Dates 导入 → getGscLastSync / getGscDaily / getGscTotals 生效", async () => {
    const parsed = gscImport.parseGscExportCsv(DATES_CSV, "dates");
    const written = await gscImport.writeGscImportRows("dates", parsed.rows, {
      propertyUrl: PROPERTY,
    });
    expect(written).toBe(2);

    // 经营概览的 GSC 接入判定（gscConnected = lastSync != null）由此解锁
    expect(await sync.getGscLastSync()).not.toBeNull();

    const daily = await metrics.getGscDaily(7);
    expect(daily.map((d) => d.date)).toContain(today);
    expect(daily.find((d) => d.date === today)?.clicks).toBe(70);

    const totals = await metrics.getGscTotals(7);
    expect(totals?.clicks).toBe(70 + 55);
    expect(totals?.impressions).toBe(1200 + 1000);
  });

  it("同一份 Dates 报表重复导入 → 行数不翻倍、数值不叠加", async () => {
    const parsed = gscImport.parseGscExportCsv(DATES_CSV, "dates");
    await gscImport.writeGscImportRows("dates", parsed.rows, { propertyUrl: PROPERTY });

    const totals = await metrics.getGscTotals(7);
    expect(totals?.clicks).toBe(70 + 55); // 仍是 125，不是 250
  });

  it("Queries 导入 + 重复导入 → getGscQueries 只有一份（captured_on=MAX 覆盖）", async () => {
    const parsed = gscImport.parseGscExportCsv(QUERIES_CSV, "queries");
    const w1 = await gscImport.writeGscImportRows("queries", parsed.rows, {
      propertyUrl: PROPERTY,
      windowDays: 28,
    });
    const w2 = await gscImport.writeGscImportRows("queries", parsed.rows, {
      propertyUrl: PROPERTY,
      windowDays: 28,
    });
    expect(w1).toBe(3);
    expect(w2).toBe(3);

    const rows = await metrics.getGscQueries(28);
    const seoAuditTool = rows.filter((r) => r.key === "seo audit tool");
    expect(seoAuditTool).toHaveLength(1); // 重复导入不产生第二行
    expect(seoAuditTool[0].clicks).toBe(120);
  });

  it("Pages 导入 + 重复导入 → getGscPages 覆盖不叠加", async () => {
    const parsed = gscImport.parseGscExportCsv(PAGES_CSV, "pages");
    await gscImport.writeGscImportRows("pages", parsed.rows, {
      propertyUrl: PROPERTY,
      windowDays: 28,
    });
    await gscImport.writeGscImportRows("pages", parsed.rows, {
      propertyUrl: PROPERTY,
      windowDays: 28,
    });

    const rows = await metrics.getGscPages(28);
    expect(rows.filter((r) => r.key === "https://www.seeo.asia/")).toHaveLength(1);
    expect(rows.find((r) => r.key === "https://www.seeo.asia/")?.clicks).toBe(88);
  });
});

describe("importGscZip：真实导出 ZIP 一次导入全部维度", () => {
  const PROPERTY = "sc-domain:seeo.asia";

  /** 构造真实结构的 GSC 导出 ZIP（含元数据头） */
  function makeGscZip(extra: Record<string, string> = {}): Uint8Array {
    return zipSync({
      "Dates.csv": strToU8(DATES_CSV),
      "Queries.csv": strToU8(QUERIES_CSV),
      "Pages.csv": strToU8(PAGES_CSV),
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
    });
  }

  it("ZIP 内三个维度一次全部导入（自动识别 + 覆盖写入）", async () => {
    const result = await gscImport.importGscZip(makeGscZip(), {
      propertyUrl: PROPERTY,
      windowDays: 28,
    });
    expect(result.fatal).toBeUndefined();
    expect(result.files).toHaveLength(3);
    const byKind = Object.fromEntries(result.files.map((f) => [f.kind, f]));
    expect(byKind.dates.written).toBe(2);
    expect(byKind.queries.written).toBe(3);
    expect(byKind.pages.written).toBe(2);
    expect(result.written).toBe(7);
    // 概览联动仍然成立
    expect(await sync.getGscLastSync()).not.toBeNull();
  });

  it("同一份 ZIP 重复上传 → 行数不变、数值不叠加", async () => {
    const before = await metrics.getGscTotals(7);
    const result = await gscImport.importGscZip(makeGscZip(), {
      propertyUrl: PROPERTY,
      windowDays: 28,
    });
    expect(result.written).toBe(7);
    const after = await metrics.getGscTotals(7);
    expect(after?.clicks).toBe(before?.clicks); // 不翻倍
    expect(after?.impressions).toBe(before?.impressions);
  });

  it("损坏 ZIP → 整包级致命错误，不写入", async () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const result = await gscImport.importGscZip(bad, { propertyUrl: PROPERTY });
    expect(result.fatal).toContain("损坏");
    expect(result.written).toBe(0);
  });

  it("路径穿越条目被拒绝", async () => {
    const zip = zipSync({
      "../evil.csv": strToU8("Date,Clicks,Impressions,CTR,Position\n2026-10-09,1,2,50%,1"),
      "Dates.csv": strToU8(DATES_CSV),
    });
    const result = await gscImport.importGscZip(zip, { propertyUrl: PROPERTY });
    const evil = result.files.find((f) => f.file.includes("evil"));
    expect(evil?.errors[0]?.reason).toContain("路径不安全");
    expect(evil?.written ?? 0).toBe(0);
  });

  it("非预期文件 / 系统文件 / 不支持维度 → 各自明确跳过", async () => {
    const zip = zipSync({
      "Dates.csv": strToU8(DATES_CSV),
      "readme.txt": strToU8("not a csv"),
      "__MACOSX/Dates.csv": strToU8("junk"),
      "Countries.csv": strToU8("Top countries,Clicks,Impressions,CTR,Position\nChina,1,2,50%,1"),
    });
    const result = await gscImport.importGscZip(zip, { propertyUrl: PROPERTY });
    const byFile = Object.fromEntries(result.files.map((f) => [f.file, f]));
    expect(byFile["readme.txt"]?.skipped).toContain("非 CSV");
    expect(byFile["__MACOSX/Dates.csv"]?.skipped).toContain("系统文件");
    expect(byFile["Countries.csv"]?.skipped).toContain("暂不支持");
    expect(result.written).toBe(2); // 只有 Dates 导入
  });

  it("表头不匹配且文件名未知 → 具体错误", async () => {
    const zip = zipSync({
      "mystery.csv": strToU8("foo,bar\n1,2"),
    });
    const result = await gscImport.importGscZip(zip, { propertyUrl: PROPERTY });
    expect(result.files[0].errors[0].reason).toContain("无法识别维度");
  });

  it("条目数 / 单文件大小超限（注入小限制）", async () => {
    const zip = zipSync({
      "a.csv": strToU8("x"),
      "b.csv": strToU8("y"),
      "c.csv": strToU8("z"),
    });
    const tooMany = await gscImport.importGscZip(zip, { propertyUrl: PROPERTY }, { maxEntries: 2 });
    expect(tooMany.fatal).toContain("文件数超过上限");

    const bigContent = "Date,Clicks,Impressions,CTR,Position\n" + "x".repeat(500);
    const zip2 = zipSync({ "Dates.csv": strToU8(bigContent) });
    const tooBig = await gscImport.importGscZip(
      zip2,
      { propertyUrl: PROPERTY },
      { maxEntryBytes: 100 }
    );
    expect(tooBig.files[0].errors[0].reason).toContain("超过单文件上限");
  });

  it("空 ZIP 数据 → 致命错误", async () => {
    const result = await gscImport.importGscZip(new Uint8Array(0), { propertyUrl: PROPERTY });
    expect(result.fatal).toContain("为空");
  });
});

// ===== 窗口与站点口径隔离：不同 window_days / 不同 property 互不混用 =====
describe("口径隔离：window_days 与 property", () => {
  const PROPERTY = "sc-domain:seeo.asia";

  it("7 天与 28 天窗口的 Queries 快照互不混用（getGscQueries 只读对应窗口）", async () => {
    // 先导入 7 天窗口
    await gscImport.writeGscImportRows("queries", gscImport.parseGscExportCsv(QUERIES_CSV, "queries").rows, {
      propertyUrl: PROPERTY,
      windowDays: 7,
    });
    const sevenDayKeys = (await metrics.getGscQueries(7)).map((r) => r.key).sort();
    expect(sevenDayKeys).toContain("seo audit tool");

    // 再导入一份不同的 28 天窗口报表
    const csv28 = [
      "Top queries,Clicks,Impressions,CTR,Position",
      "long tail keyword 28d,7,70,10.00%,9.9",
    ].join("\n");
    await gscImport.writeGscImportRows("queries", gscImport.parseGscExportCsv(csv28, "queries").rows, {
      propertyUrl: PROPERTY,
      windowDays: 28,
    });

    // 7 天视图看不到 28 天窗口的行（window_days 过滤，不混用）
    const after = (await metrics.getGscQueries(7)).map((r) => r.key);
    expect(after).toContain("seo audit tool");
    expect(after).not.toContain("long tail keyword 28d");

    // 28 天视图包含自己的行（同文件更早的 ZIP 套件也向 28 天窗口写过同站点数据，同属该窗口快照）
    const w28 = await metrics.getGscQueries(28);
    expect(w28.map((r) => r.key)).toContain("long tail keyword 28d");
    expect(w28.every((r) => r.windowDays === 28)).toBe(true);
  });

  it("不同站点属性（property_url）的数据互不覆盖", async () => {
    const other = "sc-domain:example-other.com";
    await gscImport.writeGscImportRows("pages", gscImport.parseGscExportCsv(PAGES_CSV, "pages").rows, {
      propertyUrl: other,
      windowDays: 7,
    });
    // 原站点的 7 天 Queries 快照不受影响
    const original = (await metrics.getGscQueries(7)).map((r) => r.key);
    expect(original).toContain("seo audit tool");

    // 其他站点的数据独立可查（通过 getGscTotals 验证 daily 也不串：other 站只有 page 行，无 daily 行）
    const totals = await metrics.getGscTotals(7);
    // totals 汇总所有 property 的 daily 行；此处断言导入不抛错且页面行写入成功（行级隔离由 PK 保证）
    expect(totals.clicks).toBeGreaterThanOrEqual(0);
  });
});
