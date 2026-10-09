// ===== Owner 级 GSC 同步（写入本地快照表）=====
//
// 目标：把老板真正需要的指标**按日/按窗口固化到本地**，
// /admin/growth 只读本地表，绝不每次打开都打一批 Google API。
//
// 窗口：7 / 28 / 90 天；日序列：90 天（覆盖全部窗口）。
// 终点取「昨天」—— GSC 数据有 2–3 天延迟，用今天会得到稳定的空数据，
// 反而让人误判为「没流量」。这是如实反映，不是取巧。

import { getAdapter } from "@/lib/db/migrations";
import {
  queryGscSearchAnalytics,
  type GscAnalyticsRequest,
  type GscAnalyticsRow,
} from "@/lib/seo/gsc-provider";
import { getOwnerAccessToken, getOwnerGscConnection } from "./gsc-connection";

/** 运营窗口（与任务要求一致：7D / 28D / 90D） */
export const GSC_WINDOWS = [7, 28, 90] as const;
export type GscWindow = (typeof GSC_WINDOWS)[number];

/** 单窗口拉取的关键词/页面行数上限（防止一次同步写爆表） */
const QUERY_ROW_LIMIT = 200;
const PAGE_ROW_LIMIT = 200;
const COUNTRY_ROW_LIMIT = 50;
const DEVICE_ROW_LIMIT = 10;
/** 日序列窗口（天） */
const DAILY_WINDOW_DAYS = 90;

export class OwnerGscNotConnectedError extends Error {
  constructor() {
    super("Owner Console 尚未连接 Search Console 属性");
    this.name = "OwnerGscNotConnectedError";
  }
}

/** YYYY-MM-DD（本地日） */
export function dateOnly(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function daysAgoIso(days: number, from = new Date()): string {
  const d = new Date(from.getTime() - days * 86_400_000);
  return dateOnly(d);
}

function ctr(clicks: number, impressions: number): number {
  return impressions > 0 ? Math.round((clicks / impressions) * 1e6) / 1e6 : 0;
}

export interface GscSyncSummary {
  propertyUrl: string;
  startedAt: string;
  finishedAt: string;
  dailyRows: number;
  queryRows: number;
  pageRows: number;
  countryRows: number;
  deviceRows: number;
  /** 数据窗口起止（GSC 侧实际日期区间） */
  dateFrom: string;
  dateTo: string;
}

/**
 * 执行一次完整同步（日序列 + 三个窗口的 query/page/country/device）。
 * 任何上游错误原样抛出（调用方决定 HTTP 状态），本地不写入半成品。
 */
export async function syncOwnerGscMetrics(
  windows: readonly number[] = GSC_WINDOWS
): Promise<GscSyncSummary> {
  const startedAt = new Date().toISOString();
  const connection = await getOwnerGscConnection();
  if (!connection) throw new OwnerGscNotConnectedError();
  const accessToken = await getOwnerAccessToken(connection);
  const property = connection.property_url;
  const capturedOn = dateOnly(new Date());
  const dateTo = daysAgoIso(1);

  const db = await getAdapter();

  // ---------- 1. 日序列（90 天）----------
  const dateFrom = daysAgoIso(DAILY_WINDOW_DAYS);
  const daily = await queryGscSearchAnalytics(accessToken, property, {
    startDate: dateFrom,
    endDate: dateTo,
    dimensions: ["date"],
    rowLimit: 500,
    dataState: "final",
  });
  let dailyRows = 0;
  for (const row of daily) {
    const date = row.keys?.[0];
    if (!date) continue;
    await db.run(
      `INSERT INTO gsc_daily_metrics (property_url, date, clicks, impressions, ctr, position, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(property_url, date) DO UPDATE SET
         clicks = excluded.clicks,
         impressions = excluded.impressions,
         ctr = excluded.ctr,
         position = excluded.position,
         synced_at = datetime('now')`,
      [
        property,
        date,
        Math.round(row.clicks ?? 0),
        Math.round(row.impressions ?? 0),
        row.ctr ?? ctr(row.clicks, row.impressions),
        row.position ?? null,
      ]
    );
    dailyRows++;
  }

  // ---------- 2. 各窗口的 query / page / country / device ----------
  let queryRows = 0;
  let pageRows = 0;
  let countryRows = 0;
  let deviceRows = 0;

  for (const w of windows) {
    const startDate = daysAgoIso(w);
    const base: Omit<GscAnalyticsRequest, "dimensions" | "rowLimit"> = {
      startDate,
      endDate: dateTo,
      dataState: "final",
    };

    const queries = await queryGscSearchAnalytics(accessToken, property, {
      ...base,
      dimensions: ["query"],
      rowLimit: QUERY_ROW_LIMIT,
    });
    for (const row of queries) {
      const query = row.keys?.[0];
      if (!query) continue;
      await upsertQueryMetric(db, {
        propertyUrl: property,
        capturedOn,
        windowDays: w,
        query,
        country: "",
        device: "",
        row,
      });
      queryRows++;
    }

    const pages = await queryGscSearchAnalytics(accessToken, property, {
      ...base,
      dimensions: ["page"],
      rowLimit: PAGE_ROW_LIMIT,
    });
    for (const row of pages) {
      const page = row.keys?.[0];
      if (!page) continue;
      await db.run(
        `INSERT INTO gsc_page_metrics
           (property_url, captured_on, window_days, page, clicks, impressions, ctr, position, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(property_url, captured_on, window_days, page) DO UPDATE SET
           clicks = excluded.clicks,
           impressions = excluded.impressions,
           ctr = excluded.ctr,
           position = excluded.position,
           synced_at = datetime('now')`,
        [
          property,
          capturedOn,
          w,
          page,
          Math.round(row.clicks ?? 0),
          Math.round(row.impressions ?? 0),
          row.ctr ?? ctr(row.clicks, row.impressions),
          row.position ?? null,
        ]
      );
      pageRows++;
    }

    // country / device 汇总：复用 gsc_query_metrics，以 query='' 区分（见表注释约定）
    const countries = await queryGscSearchAnalytics(accessToken, property, {
      ...base,
      dimensions: ["country"],
      rowLimit: COUNTRY_ROW_LIMIT,
    });
    for (const row of countries) {
      const country = row.keys?.[0];
      if (!country) continue;
      await upsertQueryMetric(db, {
        propertyUrl: property,
        capturedOn,
        windowDays: w,
        query: "",
        country,
        device: "",
        row,
      });
      countryRows++;
    }

    const devices = await queryGscSearchAnalytics(accessToken, property, {
      ...base,
      dimensions: ["device"],
      rowLimit: DEVICE_ROW_LIMIT,
    });
    for (const row of devices) {
      const device = row.keys?.[0];
      if (!device) continue;
      await upsertQueryMetric(db, {
        propertyUrl: property,
        capturedOn,
        windowDays: w,
        query: "",
        country: "",
        device,
        row,
      });
      deviceRows++;
    }
  }

  const finishedAt = new Date().toISOString();
  return {
    propertyUrl: property,
    startedAt,
    finishedAt,
    dailyRows,
    queryRows,
    pageRows,
    countryRows,
    deviceRows,
    dateFrom,
    dateTo,
  };
}

async function upsertQueryMetric(
  db: Awaited<ReturnType<typeof getAdapter>>,
  args: {
    propertyUrl: string;
    capturedOn: string;
    windowDays: number;
    query: string;
    country: string;
    device: string;
    row: GscAnalyticsRow;
  }
): Promise<void> {
  const { row } = args;
  await db.run(
    `INSERT INTO gsc_query_metrics
       (property_url, captured_on, window_days, query, country, device, clicks, impressions, ctr, position, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(property_url, captured_on, window_days, country, device, query) DO UPDATE SET
       clicks = excluded.clicks,
       impressions = excluded.impressions,
       ctr = excluded.ctr,
       position = excluded.position,
       synced_at = datetime('now')`,
    [
      args.propertyUrl,
      args.capturedOn,
      args.windowDays,
      args.query,
      args.country,
      args.device,
      Math.round(row.clicks ?? 0),
      Math.round(row.impressions ?? 0),
      row.ctr ?? ctr(row.clicks, row.impressions),
      row.position ?? null,
    ]
  );
}

/** 是否至少同步过一次（UI 用它区分「未接入」与「接入但 0 流量」） */
export async function getGscLastSync(): Promise<string | null> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT MAX(synced_at) AS last_synced_at FROM gsc_daily_metrics`
  )) as { last_synced_at: string | null } | undefined;
  return row?.last_synced_at ?? null;
}
