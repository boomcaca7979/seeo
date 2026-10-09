// ===== Owner Console：数据源接入状态（五态模型，如实展示）=====
//
// 五态（state）：
//   not-configured   凭据未配置
//   unreachable      凭据已配置但无法连接（探针真实请求失败）
//   connected-no-data 连接成功但尚无数据
//   synced           已正常同步真实数据（有真实行数）
//   sync-error       上一次同步/导入失败（最近事件为 error 且其后无成功）
//
// 原则：**不能只看环境变量是否存在就说已连接**。连接状态（探针）、
// 数据权限（能否读到行）、最近成功同步时间、最近错误分别记录。
// GSC / AdSense 的手动导入成功计入对应来源的实际可用状态（导入写的是同一批表）。

import { getAdapter } from "@/lib/db/migrations";
import { getCreemConfig, getCreemWebhookSecret } from "@/lib/creem/config";
import { isAdminConfigured } from "./auth";
import { isOwnerGscOAuthConfigured, getOwnerGscConnection } from "./gsc-connection";
import { getGscLastSync } from "./gsc-sync";
import { getLatestSourceEvents, getLatestSourceSuccesses, type SourceEvent } from "./source-events";
import { probeSupabase } from "./snapshot";
import { getAnalyticsReadAdapter, getAnalyticsReadSource, ANALYTICS_READ_SOURCE_LABELS } from "@/lib/analytics/readonly";
import { AD_PROVIDERS } from "./ads";

export type DataSourceState =
  | "not-configured"
  | "unreachable"
  | "connected-no-data"
  | "synced"
  | "sync-error";

export const DATA_SOURCE_STATE_LABELS: Record<DataSourceState, string> = {
  "not-configured": "凭据未配置",
  unreachable: "已配置但无法连接",
  "connected-no-data": "已连接，尚无数据",
  synced: "已同步真实数据",
  "sync-error": "上一次同步失败",
};

export interface DataSourceStatus {
  id: string;
  label: string;
  /** 本地快照/读链路是否可用（配置齐备） */
  configured: boolean;
  /** 五态状态（由探针 + 行数 + 最近事件推导） */
  state: DataSourceState;
  missing: string[];
  hint: string;
  /** 本地快照最近同步时间（null = 从未同步或该源无同步概念） */
  lastSyncAt: string | null;
  /** 本地快照行数（null = 未统计） */
  localRows: number | null;
  /** 最近一次成功同步/导入（时间 + 说明；null = 从未成功） */
  lastSuccess: SourceEvent | null;
  /** 最近一次失败（时间 + 原因；null = 从未失败） */
  lastError: SourceEvent | null;
  /** 该源在 Owner Console 中支撑的内容 */
  powers: string[];
}

async function safeCount(sql: string): Promise<number | null> {
  try {
    const db = await getAdapter();
    const row = (await db.get(sql)) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}

async function safeMax(sql: string, column: string): Promise<string | null> {
  try {
    const db = await getAdapter();
    const row = (await db.get(sql)) as Record<string, unknown> | undefined;
    const v = row?.[column];
    return v === null || v === undefined ? null : String(v);
  } catch {
    return null;
  }
}

function tursoConfigured(): boolean {
  const url = (process.env.TURSO_DATABASE_URL ?? "").trim();
  return !!url && /^(libsql|https?|file):\/\//i.test(url) && !!process.env.TURSO_AUTH_TOKEN;
}

/** 由「配置 / 行数 / 最近事件」推导五态（count=null 表示探针失败 → unreachable） */
export function deriveState(args: {
  configured: boolean;
  /** 探针结果：null = 无法连接；数字 = 可读到的行数 */
  count: number | null;
  lastError: SourceEvent | null;
  lastSuccess: SourceEvent | null;
}): DataSourceState {
  if (!args.configured) return "not-configured";
  if (args.count === null) return "unreachable";
  if (args.count > 0) {
    // 有数据但最近一次事件是失败且晚于最近成功 → 上一次同步失败
    if (
      args.lastError &&
      (!args.lastSuccess || args.lastError.createdAt >= args.lastSuccess.createdAt)
    ) {
      return "sync-error";
    }
    return "synced";
  }
  return "connected-no-data";
}

export async function getDataSourceStatuses(): Promise<DataSourceStatus[]> {
  const creemConfig = getCreemConfig();
  const webhookSecret = getCreemWebhookSecret();
  const gscOAuth = isOwnerGscOAuthConfigured();
  const gscConnection = await getOwnerGscConnection().catch(() => null);
  const adminAllowlist = isAdminConfigured();

  const [
    analyticsCount,
    analyticsLast,
    webhookCount,
    webhookLast,
    creemTxnCount,
    gscDailyCount,
    gscDailyLast,
    adsenseRows,
    adsenseLast,
    adsImportedAt,
    supabaseProbe,
    latestEvents,
    latestSuccesses,
  ] = await Promise.all([
    safeCount(`SELECT COUNT(*) AS n FROM analytics_events`),
    safeMax(`SELECT MAX(created_at) AS v FROM analytics_events`, "v"),
    safeCount(`SELECT COUNT(*) AS n FROM creem_webhook_events`),
    safeMax(`SELECT MAX(received_at) AS v FROM creem_webhook_events`, "v"),
    safeCount(`SELECT COUNT(*) AS n FROM creem_transactions`),
    safeCount(`SELECT COUNT(*) AS n FROM gsc_daily_metrics`),
    safeMax(`SELECT MAX(synced_at) AS v FROM gsc_daily_metrics`, "v"),
    safeCount(`SELECT COUNT(*) AS n FROM ad_revenue_daily WHERE provider = 'adsense'`),
    safeMax(
      `SELECT MAX(imported_at) AS v FROM ad_revenue_daily WHERE provider = 'adsense'`,
      "v"
    ),
    safeMax(`SELECT MAX(imported_at) AS v FROM ad_revenue_daily`, "v"),
    probeSupabase(),
    getLatestSourceEvents(),
    getLatestSourceSuccesses(),
  ]);

  const supabaseConfigured =
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  // 「站内行为分析」行通过**只读通道**探测（配置了 TURSO_READONLY_* 时如实反映生产行数，
  // 而不是本地隔离库的 0）；探针只读 analytics_events。
  const analyticsReadSource = getAnalyticsReadSource();
  const analyticsReadProbe = (async () => {
    try {
      const db = await getAnalyticsReadAdapter();
      const row = (await db.get(
        `SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM analytics_events`
      )) as { n: number; latest: string | null } | undefined;
      return { count: Number(row?.n ?? 0), latest: row?.latest ?? null };
    } catch {
      return { count: null as number | null, latest: null as string | null };
    }
  })();
  const analyticsRead = await analyticsReadProbe;

  const adsStatuses: DataSourceStatus[] = AD_PROVIDERS.map((p) => {
    const s = p.configStatus();
    // CSV 导入是一等接入方式：本地日表有该 provider 的真实行数即视为可用
    const count = p.id === "adsense" ? adsenseRows : null;
    const last = p.id === "adsense" ? adsenseLast : null;
    const configured = s.configured || (count !== null && count > 0);
    return {
      id: `ads:${p.id}`,
      label: `${p.label}（广告收入）`,
      configured,
      state: deriveState({
        configured,
        count,
        lastError: latestEvents.get(`ads:${p.id}`) ?? null,
        lastSuccess: latestSuccesses.get(`ads:${p.id}`) ?? null,
      }),
      missing: configured ? [] : s.missing,
      hint: s.hint,
      lastSyncAt: last,
      localRows: count,
      lastSuccess: latestSuccesses.get(`ads:${p.id}`) ?? null,
      lastError: latestEvents.get(`ads:${p.id}`) ?? null,
      powers: ["/admin/revenue 的 Ad Revenue", "/admin 首页 Ad Revenue"],
    };
  });

  const supabaseState: DataSourceState = !supabaseConfigured
    ? "not-configured"
    : supabaseProbe.ok
      ? "connected-no-data" // 权威表行数不在本页统计，连接成功与否由探针决定
      : "unreachable";

  return [
    {
      id: "turso",
      label: "Turso（站内事件与经营快照）",
      configured: tursoConfigured(),
      state: deriveState({
        configured: tursoConfigured(),
        count: analyticsCount,
        lastError: latestEvents.get("turso") ?? null,
        lastSuccess: latestSuccesses.get("turso") ?? null,
      }),
      missing: tursoConfigured() ? [] : ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"],
      hint: tursoConfigured()
        ? "已连接，analytics_events / gsc_* / ad_revenue_daily / creem_* 均在此。"
        : "缺少 Turso 凭据，所有站内事件与快照无法读写。",
      lastSyncAt: analyticsLast,
      localRows: analyticsCount,
      lastSuccess: latestSuccesses.get("turso") ?? null,
      lastError: latestEvents.get("turso") ?? null,
      powers: ["Visitors / 漏斗 Visit、Activation", "GSC 本地快照", "广告收入日表", "Creem 快照"],
    },
    {
      id: "analytics",
      label: "站内行为分析（B 阶段事件层）",
      configured: analyticsRead.count !== null,
      state: deriveState({
        configured: analyticsRead.count !== null,
        count: analyticsRead.count,
        lastError: latestEvents.get("analytics") ?? null,
        lastSuccess: latestSuccesses.get("analytics") ?? null,
      }),
      missing:
        analyticsRead.count !== null
          ? []
          : ["TURSO_READONLY_DATABASE_URL / TURSO_READONLY_AUTH_TOKEN（或本地库凭据）"],
      hint:
        analyticsRead.count !== null && analyticsRead.count > 0
          ? `已收到事件（数据来源：${ANALYTICS_READ_SOURCE_LABELS[analyticsReadSource]}）；仅「已同意 Cookie」的访客会被记录。`
          : analyticsRead.count !== null
            ? `连接正常但尚无任何事件（数据来源：${ANALYTICS_READ_SOURCE_LABELS[analyticsReadSource]}）。`
            : "只读探测失败 —— 无法统计事件数（unreachable，而非 0）。",
      lastSyncAt: analyticsRead.latest,
      localRows: analyticsRead.count,
      lastSuccess: latestSuccesses.get("analytics") ?? null,
      lastError: latestEvents.get("analytics") ?? null,
      powers: ["/admin 首页 Visitors", "漏斗 Visit / Activation", "/admin/customers 的 last active 与功能使用"],
    },
    {
      id: "supabase-admin",
      label: "Supabase Admin（profiles / orders 权威表）",
      configured: supabaseConfigured,
      state: supabaseState,
      missing: supabaseConfigured ? [] : ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"],
      hint: !supabaseConfigured
        ? "缺少 service_role，注册数、Checkout、Paid、MRR、订阅收入都会显示 unavailable。"
        : supabaseProbe.ok
          ? "service_role 已配置且探针读取成功（profiles 可读）。"
          : `service_role 已配置但读取失败：${supabaseProbe.error ?? "未知错误"}`,
      lastSyncAt: null,
      localRows: null,
      lastSuccess: null,
      lastError: supabaseProbe.ok
        ? null
        : { event: "error", message: supabaseProbe.error ?? "探针读取失败", createdAt: "" },
      powers: ["Signup / Checkout / Paid 节点", "MRR", "订阅收入与退款", "/admin/customers 列表"],
    },
    {
      id: "creem-api",
      label: "Creem API（下单）",
      configured: creemConfig !== null,
      state: creemConfig ? "connected-no-data" : "not-configured",
      missing: creemConfig ? [] : ["CREEM_API_KEY"],
      hint: creemConfig
        ? `已配置（模式：${creemConfig.mode}）。`
        : "未配置，无法创建 Checkout。",
      lastSyncAt: null,
      localRows: null,
      lastSuccess: null,
      lastError: null,
      powers: ["Pricing 页购买按钮", "checkout_started 事件"],
    },
    {
      id: "creem-webhook",
      label: "Creem Webhook（支付事实 + 本地快照）",
      configured: Boolean(webhookSecret),
      state: deriveState({
        configured: Boolean(webhookSecret),
        count: webhookCount,
        lastError: latestEvents.get("creem-webhook") ?? null,
        lastSuccess: latestSuccesses.get("creem-webhook") ?? null,
      }),
      missing: webhookSecret ? [] : ["CREEM_WEBHOOK_SECRET"],
      hint: webhookSecret
        ? `已配置签名密钥。已接收 ${webhookCount ?? 0} 个事件（本地快照 ${creemTxnCount ?? 0} 条交易）。`
        : "缺少 webhook secret，webhook 会 fail-closed 拒绝所有请求 → 支付成功也不会开通会员。",
      lastSyncAt: webhookLast,
      localRows: webhookCount,
      lastSuccess: latestSuccesses.get("creem-webhook") ?? null,
      lastError: latestEvents.get("creem-webhook") ?? null,
      powers: ["Creem 客户/订阅/交易 本地快照", "客户详情页的 Creem ID 排查", "收入对账"],
    },
    {
      id: "gsc-oauth",
      label: "Google Search Console（站点级）",
      // 手动导入是一等接入方式：本地日表已有真实行数即视为可用
      configured: (gscOAuth && gscConnection !== null) || (gscDailyCount ?? 0) > 0,
      state: deriveState({
        configured: (gscOAuth && gscConnection !== null) || (gscDailyCount ?? 0) > 0,
        count: gscDailyCount,
        lastError: latestEvents.get("gsc") ?? null,
        lastSuccess: latestSuccesses.get("gsc") ?? null,
      }),
      missing: [
        ...(gscOAuth ? [] : ["GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GSC_TOKEN_ENCRYPTION_KEY"]),
        ...(gscConnection ? [] : ["尚未绑定 GSC 属性（OAuth 路径）"]),
        ...((gscDailyCount ?? 0) > 0 ? [] : ["或用 /admin/growth 的 CSV / ZIP 导入"]),
      ],
      hint:
        (gscDailyCount ?? 0) > 0
          ? `已有真实搜索数据（${gscDailyCount} 行日指标，最近同步 ${gscDailyLast ?? "未知"}）。`
          : gscOAuth && gscConnection
            ? `已绑定属性 ${gscConnection.property_url}，等待首次同步。`
            : "未接入：/admin/growth 的 GSC 指标显示 unavailable。可走 OAuth 绑定或 CSV / ZIP 导入。",
      lastSyncAt: await getGscLastSync().catch(() => null),
      localRows: gscDailyCount,
      lastSuccess: latestSuccesses.get("gsc") ?? null,
      lastError: latestEvents.get("gsc") ?? null,
      powers: ["/admin/growth 全部 GSC 指标", "漏斗的 Impression / Click 节点", "SERP CTR 瓶颈判断"],
    },
    ...adsStatuses,
    {
      id: "admin-allowlist",
      label: "Owner 白名单（ADMIN_EMAILS）",
      configured: adminAllowlist,
      state: adminAllowlist ? "connected-no-data" : "not-configured",
      missing: adminAllowlist ? [] : ["ADMIN_EMAILS"],
      hint: adminAllowlist
        ? "已配置。非白名单账号访问 /admin 会被拒绝。"
        : "未配置 → Owner Console 完全关闭（fail-closed）。请设置逗号分隔的 owner 邮箱。",
      lastSyncAt: null,
      localRows: null,
      lastSuccess: null,
      lastError: null,
      powers: ["/admin 全站访问控制"],
    },
    {
      id: "cron-secret",
      label: "CRON_SECRET（定时同步）",
      configured: Boolean(process.env.CRON_SECRET),
      state: process.env.CRON_SECRET ? "connected-no-data" : "not-configured",
      missing: process.env.CRON_SECRET ? [] : ["CRON_SECRET"],
      hint: process.env.CRON_SECRET
        ? "已配置；可用它调用 /api/admin/sync/gsc 与 /api/admin/import/ads 做无人值守同步。"
        : "未配置；同步只能由已登录 owner 在页面上手动触发。",
      lastSyncAt: null,
      localRows: null,
      lastSuccess: null,
      lastError: null,
      powers: ["GSC 定时同步", "广告收入定时导入"],
    },
    {
      id: "ads-local",
      label: "广告收入本地日表（ad_revenue_daily）",
      configured: tursoConfigured(),
      state: deriveState({
        configured: tursoConfigured(),
        count: adsenseRows,
        lastError: latestEvents.get("ads:adsense") ?? null,
        lastSuccess: latestSuccesses.get("ads:adsense") ?? null,
      }),
      missing: tursoConfigured() ? [] : ["TURSO_DATABASE_URL"],
      hint: "AdSense API 未配置时，用 /admin/revenue 的 CSV 文件 / 粘贴导入写入此表（不做 scraping）。",
      lastSyncAt: adsImportedAt,
      localRows: adsenseRows,
      lastSuccess: latestSuccesses.get("ads:adsense") ?? null,
      lastError: latestEvents.get("ads:adsense") ?? null,
      powers: ["/admin/revenue 的 Ad Revenue", "Total Revenue 的广告部分"],
    },
  ];
}
