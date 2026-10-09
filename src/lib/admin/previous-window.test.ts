// ===== 环比数据层测试：窗口边界 / 时间格式 / 不重叠 / 诚实降级 =====
//
// 覆盖任务硬性要求：
//   1. ISO 格式时间戳（T / Z / 毫秒）经 strftime('%s') 数值比较被正确统计；
//   2. 今天（当前窗口）的事件不计入上一周期；
//   3. 窗口上下边界归属正确，两个周期不重叠；
//   4. 零基数不伪造百分比（deltaBadge）；
//   5. 数据不可用 → 环比不显示（available=false / deltaBadge undefined）。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-previous-window-"));
const DAY_MS = 86_400_000;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("deltaBadge：诚实环比（纯函数）", () => {
  it("previous 不可用（null/undefined）→ undefined，UI 不显示环比", async () => {
    const pw = await import("./previous-window");
    expect(pw.deltaBadge(5, null)).toBeUndefined();
    expect(pw.deltaBadge(5, undefined)).toBeUndefined();
  });

  it("previous = 0 且 current > 0 → 「上一周期无数据」，绝不伪造百分比", async () => {
    const pw = await import("./previous-window");
    const d = pw.deltaBadge(7, 0);
    expect(d).toEqual({ text: "上一周期无数据", tone: "muted" });
  });

  it("双 0 → 「与上一周期持平」（不是 0% 涨跌）", async () => {
    const pw = await import("./previous-window");
    expect(pw.deltaBadge(0, 0)).toEqual({ text: "与上一周期持平", tone: "muted" });
  });

  it("正增长 → +X%（good）；下降 → −X%（bad）", async () => {
    const pw = await import("./previous-window");
    expect(pw.deltaBadge(120, 100)).toEqual({ text: "较上一周期 +20%", tone: "good" });
    expect(pw.deltaBadge(80, 100)).toEqual({ text: "较上一周期 −20%", tone: "bad" });
  });

  it("四舍五入后持平 → muted", async () => {
    const pw = await import("./previous-window");
    expect(pw.deltaBadge(1004, 1000)).toEqual({ text: "与上一周期持平", tone: "muted" });
  });

  it("lowerIsBetter（退款）：增加是 bad，减少是 good", async () => {
    const pw = await import("./previous-window");
    expect(pw.deltaBadge(150, 100, { lowerIsBetter: true })?.tone).toBe("bad");
    expect(pw.deltaBadge(50, 100, { lowerIsBetter: true })?.tone).toBe("good");
  });

  it("current = 0、previous > 0 → −100%（bad），不与「无数据」混淆", async () => {
    const pw = await import("./previous-window");
    expect(pw.deltaBadge(0, 1)).toEqual({ text: "较上一周期 −100%", tone: "bad" });
  });
});

describe("上一周期时间窗口：ISO 格式 / 今天事件 / 边界 / 不重叠", () => {
  let pw: typeof import("./previous-window");
  let db: { run: (sql: string, params?: unknown[]) => Promise<unknown> };

  beforeAll(async () => {
    pw = await import("./previous-window");
    db = (await (await import("@/lib/db/migrations")).getAdapter()) as never;
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString(); // ISO-8601：T 分隔 + 毫秒 + Z

    // 6 个 page_view，覆盖全部边界场景（days=7）：
    const cases: Array<[string, number]> = [
      ["anon-today", now - 1_000], // 今天（当前窗口）→ 不计入上一周期
      ["anon-upper", now - 7 * DAY_MS + 60_000], // 边界内 1 分钟（当前窗口）→ 不计入（裕量防测试时钟漂移）
      ["anon-lower", now - 7 * DAY_MS - 60_000], // 边界外 1 分钟（上一周期）→ 计入
      ["anon-mid1", now - 10 * DAY_MS], // 上一周期中部 → 计入
      ["anon-mid2", now - 10 * DAY_MS - 3_600_000], // 上一周期中部 → 计入
      ["anon-ancient", now - 15 * DAY_MS], // 两个周期之前 → 不计入
    ];
    for (const [anon, ts] of cases) {
      await db.run(
        `INSERT INTO analytics_events (event_name, anonymous_id, created_at, path)
         VALUES ('page_view', ?, ?, '/')`,
        [anon, iso(ts)]
      );
    }
    // 上一周期 1 个激活（ISO 时间戳）
    await db.run(
      `INSERT INTO analytics_events (event_name, user_id, created_at)
       VALUES ('activation_completed', 'u-prev-1', ?)`,
      [iso(now - 10 * DAY_MS)]
    );
    // 当前窗口 1 个激活（today）→ 不计入上一周期
    await db.run(
      `INSERT INTO analytics_events (event_name, user_id, created_at)
       VALUES ('activation_completed', 'u-cur-1', ?)`,
      [iso(now - 1_000)]
    );
  });

  it("ISO 时间戳：上一周期访客 = 3（下界内侧 1 + 中部 2）", async () => {
    const n = await pw.queryVisitorsPrevious(7);
    expect(n).toBe(3);
  });

  it("今天 / 紧贴上界 / 两周期之前的事件都不落入上一周期（不重叠）", async () => {
    // 计数 = 3 已隐含排除 anon-today / anon-upper / anon-ancient；
    // 再从反方向验证当前窗口访客 = 2（today + 上界内侧），两集合无交集
    const db2 = await import("@/lib/db/migrations");
    const adapter = (await db2.getAdapter()) as never;
    const row = (await (
      adapter as {
        get: (sql: string, params?: unknown[]) => Promise<{ n: number } | undefined>;
      }
    ).get(
      `SELECT COUNT(DISTINCT COALESCE(i.user_id, e.anonymous_id)) AS n
         FROM analytics_events e
         LEFT JOIN analytics_identities i ON i.anonymous_id = e.anonymous_id
        WHERE e.event_name = 'page_view'
          AND CAST(strftime('%s', e.created_at) AS INTEGER)
                >= CAST(strftime('%s', 'now') AS INTEGER) - ?`,
      [7 * 86_400]
    )) as { n: number } | undefined;
    // 当前窗口（无上界，与 funnel.ts queryVisitors 同口径）= 2；
    // 若上一周期与当前窗口重叠，这里会是 5
    expect(Number(row?.n ?? 0)).toBe(2);
  });

  it("上一周期激活 = 1（当前窗口的激活不计入）", async () => {
    const n = await pw.queryActivatedPrevious(7);
    expect(n).toBe(1);
  });

  it("withinPreviousWindow：JS 秒级数值比较，与 SQL 口径一致", async () => {
    const now = Date.now();
    expect(pw.withinPreviousWindow(new Date(now - 10 * DAY_MS).toISOString(), 7)).toBe(true);
    expect(pw.withinPreviousWindow(new Date(now - 1_000).toISOString(), 7)).toBe(false);
    expect(pw.withinPreviousWindow(new Date(now - 15 * DAY_MS).toISOString(), 7)).toBe(false);
    expect(pw.withinPreviousWindow(null, 7)).toBe(false);
    expect(pw.withinPreviousWindow("not-a-date", 7)).toBe(false);
  });

  it("previousDayKeys：d 到 2d-1 天前，与当前窗口日无交集", async () => {
    const keys = [...pw.previousDayKeys(7)].sort();
    expect(keys).toHaveLength(7);
    const today = new Date().toISOString().slice(0, 10);
    expect(keys).not.toContain(today);
    const currentKeys = new Set<string>();
    for (let i = 0; i < 7; i++) {
      currentKeys.add(new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10));
    }
    for (const k of keys) expect(currentKeys.has(k)).toBe(false);
  });
});

describe("getAdminOverviewWithPrevious：端到端（GSC / 广告切分 + 诚实降级）", () => {
  let pw: typeof import("./previous-window");
  let ads: typeof import("./ads");
  let db: { run: (sql: string, params?: unknown[]) => Promise<unknown> };

  beforeAll(async () => {
    pw = await import("./previous-window");
    ads = await import("./ads");
    db = (await (await import("@/lib/db/migrations")).getAdapter()) as never;
    const today = new Date().toISOString().slice(0, 10);
    const prevDay = new Date(Date.now() - 10 * DAY_MS).toISOString().slice(0, 10);

    // GSC：当前窗口 1 行 + 上一周期 1 行（previous 只应累计后者）
    await db.run(
      `INSERT INTO gsc_daily_metrics (property_url, date, clicks, impressions, ctr, position)
       VALUES ('sc-domain:seeo.asia', ?, 5, 100, 0.05, 12.4)`,
      [today]
    );
    await db.run(
      `INSERT INTO gsc_daily_metrics (property_url, date, clicks, impressions, ctr, position)
       VALUES ('sc-domain:seeo.asia', ?, 3, 80, 0.04, 11.0)`,
      [prevDay]
    );
    // 广告：同样两个日期（provider 独立来源）
    await ads.writeAdRevenueDays(
      [{ date: today, revenueCents: 1234, impressions: 2000, clicks: 12, currency: "USD" }],
      { provider: "adsense", source: "csv" }
    );
    await ads.writeAdRevenueDays(
      [{ date: prevDay, revenueCents: 4321, impressions: 1800, clicks: 9, currency: "USD" }],
      { provider: "adsense", source: "csv" }
    );
  });

  it("previous.searchClicks 只累计上一周期日期（=3，不是 8）", async () => {
    const o = await pw.getAdminOverviewWithPrevious(7);
    expect(o.previous.searchClicks).toBe(3);
    // 当前窗口主指标不受 2× 拉取影响
    expect(o.metrics.searchClicks).toBe(5);
  });

  it("previous.adRevenueCents 只累计上一周期日期（=4321，不是 5555）", async () => {
    const o = await pw.getAdminOverviewWithPrevious(7);
    expect(o.previous.adRevenueCents).toBe(4321);
    expect(o.metrics.adRevenueCents).toBe(1234);
  });

  it("GSC 已接入（有同步行）→ searchClicks 环比可用", async () => {
    const o = await pw.getAdminOverviewWithPrevious(7);
    expect(o.previous.available.searchClicks).toBe(true);
    // 搜索点击 5 vs 3 → +67%（四舍五入）
    expect(pw.deltaBadge(o.metrics.searchClicks, o.previous.searchClicks)?.text).toBe(
      "较上一周期 +67%"
    );
  });

  it("Supabase 权威表未配置 → signups 环比 available=false，不显示环比", async () => {
    const o = await pw.getAdminOverviewWithPrevious(7);
    expect(o.previous.available.signups).toBe(false);
    expect(pw.deltaBadge(o.metrics.signups, null)).toBeUndefined();
  });

  it("两周期激活数相同 → 持平（fixture：当前 1 + 上一周期 1）", async () => {
    const o = await pw.getAdminOverviewWithPrevious(7);
    // fixture：当前窗口 u-cur-1（today）+ 上一周期 u-prev-1 → 1 vs 1
    expect(o.previous.available.activated).toBe(true);
    expect(o.previous.activated).toBe(1);
    expect(o.metrics.activatedUsers).toBe(1);
    const d = pw.deltaBadge(o.metrics.activatedUsers, o.previous.activated);
    expect(d).toEqual({ text: "与上一周期持平", tone: "muted" });
  });
});
