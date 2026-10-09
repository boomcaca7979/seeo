// ===== 广告收入：Provider 注册表 + 本地日表读写 =====
//
// 广告收入与订阅收入是**两个独立 source**，本模块只负责广告侧；
// 汇总（Total Revenue）在 src/lib/admin/revenue.ts 里做唯一一次相加。

import { getAdapter } from "@/lib/db/migrations";
import type { AdRevenueDay, AdRevenueProvider } from "./provider";
export {
  AdProviderNotConfiguredError,
  type AdRevenueDay,
  type AdRevenueProvider,
  type AdProviderConfigStatus,
} from "./provider";
import { adsenseProvider } from "./adsense";

/** 已登记的广告 provider（当前只有 SeeO 实际使用的 AdSense） */
export const AD_PROVIDERS: AdRevenueProvider[] = [adsenseProvider];

export function getAdProvider(id: string): AdRevenueProvider | null {
  return AD_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** 写入/覆盖日收入（PK=(date, provider)，幂等） */
export async function writeAdRevenueDays(
  rows: AdRevenueDay[],
  args: { provider: string; source: "api" | "csv" | "manual" }
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await getAdapter();
  let written = 0;
  for (const row of rows) {
    await db.run(
      `INSERT INTO ad_revenue_daily
         (date, provider, currency, revenue_cents, impressions, clicks, source, raw_json, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))
       ON CONFLICT(date, provider) DO UPDATE SET
         currency = excluded.currency,
         revenue_cents = excluded.revenue_cents,
         impressions = excluded.impressions,
         clicks = excluded.clicks,
         source = excluded.source,
         imported_at = datetime('now')`,
      [
        row.date,
        args.provider,
        row.currency.toUpperCase(),
        Math.max(0, Math.round(row.revenueCents)),
        Math.max(0, Math.round(row.impressions)),
        Math.max(0, Math.round(row.clicks)),
        args.source,
      ]
    );
    written++;
  }
  return written;
}

export interface AdRevenueDailyRow {
  date: string;
  /** USD 口径金额（分）。同日若有非 USD 行，不计入本字段（见 nonUsd） */
  revenueCents: number;
  impressions: number;
  clicks: number;
  providers: string[];
  currencies: string[];
  /** 该日非 USD 金额（分，按币种）；不换算、不并入 revenueCents */
  nonUsd: Array<{ currency: string; cents: number }>;
}

/** 近 N 天广告收入日序列（跨 provider 按日期聚合；非 USD 金额单独列出，绝不跨币种相加） */
export async function getAdRevenueDaily(days: number): Promise<AdRevenueDailyRow[]> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT date,
            SUM(CASE WHEN currency = 'USD' THEN revenue_cents ELSE 0 END) AS usd_cents,
            SUM(impressions) AS impressions,
            SUM(clicks) AS clicks,
            GROUP_CONCAT(DISTINCT provider) AS providers,
            GROUP_CONCAT(DISTINCT currency) AS currencies,
            SUM(CASE WHEN currency != 'USD' THEN revenue_cents ELSE 0 END) AS other_cents,
            GROUP_CONCAT(DISTINCT CASE WHEN currency != 'USD' THEN currency END) AS other_currencies
       FROM ad_revenue_daily
      WHERE date >= date('now', ?)
      GROUP BY date
      ORDER BY date ASC`,
    [`-${Math.max(0, Math.floor(days)) - 1} days`]
  )) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const otherCurrencies = String(r.other_currencies ?? "")
      .split(",")
      .filter((c) => c && c !== "USD");
    const otherCents = Number(r.other_cents ?? 0);
    const nonUsd =
      otherCurrencies.length > 0 && otherCents !== 0
        ? // 同日多个非 USD 币种时按币种细分（amount 无法按币种拆分时如实合并展示币种名单）
          [{ currency: otherCurrencies.join("/"), cents: otherCents }]
        : [];
    return {
      date: String(r.date),
      revenueCents: Number(r.usd_cents ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      providers: String(r.providers ?? "").split(",").filter(Boolean),
      currencies: String(r.currencies ?? "").split(",").filter(Boolean),
      nonUsd,
    };
  });
}

export interface AdRevenueSummary {
  windowDays: number;
  /** USD 口径收入（分）。非 USD 金额在 nonUsd 单独列出，未经换算绝不并入本字段 */
  revenueCents: number;
  impressions: number;
  clicks: number;
  /** 命中过数据的币种；长度 > 1 时不做换算，仅在 UI 提示 */
  currencies: string[];
  mixedCurrency: boolean;
  /** 非 USD 金额（分，按币种分组）；不换算、不并入 revenueCents */
  nonUsd: Array<{ currency: string; cents: number }>;
  /** 本地表最近一次导入时间（null = 从未导入） */
  lastImportedAt: string | null;
  /** 本地表是否有任何数据（false 时 UI 必须显示"尚未接入/导入"而不是 0 收入） */
  hasData: boolean;
}

/** 广告收入汇总（只读本地表，绝不实时请求平台；非 USD 金额单独列出，不跨币种相加） */
export async function getAdRevenueSummary(days: number): Promise<AdRevenueSummary> {
  const db = await getAdapter();
  const windowDays = Math.max(1, Math.floor(days));
  const agg = (await db.get(
    `SELECT COALESCE(SUM(CASE WHEN currency = 'USD' THEN revenue_cents ELSE 0 END),0) AS usd_cents,
            COALESCE(SUM(CASE WHEN currency != 'USD' THEN revenue_cents ELSE 0 END),0) AS other_cents,
            GROUP_CONCAT(DISTINCT currency) AS currencies,
            GROUP_CONCAT(DISTINCT CASE WHEN currency != 'USD' THEN currency END) AS other_currencies,
            COALESCE(SUM(impressions),0) AS impressions,
            COALESCE(SUM(clicks),0) AS clicks
       FROM ad_revenue_daily
      WHERE date >= date('now', ?)`,
    [`-${windowDays - 1} days`]
  )) as Record<string, unknown> | undefined;
  const meta = (await db.get(
    `SELECT COUNT(*) AS n, MAX(imported_at) AS last_imported_at FROM ad_revenue_daily`
  )) as { n: number; last_imported_at: string | null } | undefined;

  const currencies = String(agg?.currencies ?? "").split(",").filter(Boolean);
  const otherCurrencies = String(agg?.other_currencies ?? "")
    .split(",")
    .filter((c) => c && c !== "USD");
  const otherCents = Number(agg?.other_cents ?? 0);
  const nonUsd =
    otherCurrencies.length > 0 && otherCents !== 0
      ? [{ currency: otherCurrencies.join("/"), cents: otherCents }]
      : [];
  return {
    windowDays,
    revenueCents: Number(agg?.usd_cents ?? 0),
    impressions: Number(agg?.impressions ?? 0),
    clicks: Number(agg?.clicks ?? 0),
    currencies,
    mixedCurrency: currencies.length > 1,
    nonUsd,
    lastImportedAt: meta?.last_imported_at ?? null,
    hasData: Number(meta?.n ?? 0) > 0,
  };
}
