// ===== /admin：Owner Console 首页（全中文经营视图）=====
// 目标：老板打开后 10 秒内回答 —— 访客/搜索点击/注册/真正使用/开始付款/
// 付费/每月订阅收入/广告收入/总收入，加上环比与当前最大瓶颈。
// 诚实规则：已确认 0 ≠ 尚未接通 ≠ 本周期无记录；数据源不可用绝不显示 0 冒充。

import Link from "next/link";
import {
  Badge,
  Card,
  DataTable,
  Empty,
  MetricCard,
  Section,
  TrendBars,
  Unavailable,
  WindowSwitcher,
  formatInt,
  formatMoney,
  formatPct,
  formatUsd,
  formatWhen,
  type Column,
} from "@/components/admin/ui";
import { normalizeWindow, ADMIN_WINDOW_LABELS, type FunnelStep } from "@/lib/admin/funnel";
import {
  getAdminOverviewWithPrevious,
  deltaBadge,
  type DeltaBadge,
  type WindowMetrics,
} from "@/lib/admin/previous-window";
import { getRecentPayments, type RecentPaymentRow } from "@/lib/admin/recent-payments";

export const dynamic = "force-dynamic";

/** 诊断码 → 自然中文（内部代码不外露） */
const DIAGNOSIS_LABELS: Record<string, string> = {
  NO_DATA: "暂无数据",
  INSUFFICIENT_DATA: "数据不足",
  SERP_CTR: "搜索点击率",
  TRAFFIC_TO_VISIT: "搜索点击 → 到站访问",
  VISIT_TO_SIGNUP: "访客 → 注册",
  SIGNUP_TO_ACTIVATION: "注册 → 首次使用",
  SIGNUP_TO_CHECKOUT: "注册 → 开始付款",
  CHECKOUT_TO_PAID: "开始付款 → 支付成功",
  PAID_NO_REVENUE: "收入记账",
  HEALTHY: "全链路健康",
};

function diagnosisTone(code: string): "good" | "warn" | "muted" {
  if (code === "HEALTHY") return "good";
  if (code === "NO_DATA" || code === "INSUFFICIENT_DATA") return "muted";
  return "warn";
}

/** 漏斗节点不可用时的说明（按节点给出缺什么，绝不冒充 0） */
function funnelUnavailableText(key: FunnelStep["key"]): string {
  switch (key) {
    case "impression":
    case "click":
      return "尚未连接 Google 搜索数据";
    case "signup":
      return "注册数据未接通（Supabase 未配置）";
    case "checkout":
    case "paid":
      return "订单数据未接通（Supabase 未配置）";
    default:
      return "暂无站内事件数据";
  }
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = normalizeWindow(sp.days);
  const overview = await getAdminOverviewWithPrevious(days);
  const { metrics, diagnosis, availability, series, previous } = overview;
  const recentPayments = await getRecentPayments(8);

  const recentPaymentColumns: Array<Column<RecentPaymentRow>> = [
    {
      key: "paidAt",
      title: "付款时间",
      render: (r) => <span className="font-mono text-ink-60">{formatWhen(r.paidAt)}</span>,
    },
    {
      key: "customer",
      title: "客户",
      render: (r) => r.customerEmail ?? <span className="text-ink-40">—</span>,
    },
    { key: "plan", title: "套餐", render: (r) => r.plan },
    {
      key: "amount",
      title: "金额",
      align: "right",
      render: (r) => (
        <span className="font-mono text-ink">{formatMoney(r.amountCents, r.currency)}</span>
      ),
    },
    {
      key: "notify",
      title: "邮件通知",
      render: (r) => (
        <Badge
          tone={
            r.notifyStatus === "sent"
              ? "good"
              : r.notifyStatus === "failed"
                ? "bad"
                : r.notifyStatus === "pending"
                  ? "warn"
                  : "neutral"
          }
        >
          {r.notifyStatus === "sent"
            ? "已发送"
            : r.notifyStatus === "failed"
              ? "发送失败"
              : r.notifyStatus === "pending"
                ? "待发送"
                : "历史记录"}
        </Badge>
      ),
    },
  ];

  const adHasData = availability.ads;
  const subAvailable = availability.orders;

  /** 仅当当前与上一周期数据都可信时才给环比徽章 */
  const delta = (
    current: number,
    currentOk: boolean,
    prevKey: keyof typeof previous.available
  ) => {
    if (!currentOk || !previous.available[prevKey]) return undefined;
    // available 的键与数值字段名不完全一致（adRevenue → adRevenueCents），此处统一映射
    const map: Record<
      keyof typeof previous.available,
      Exclude<keyof WindowMetrics, "available">
    > = {
      visitors: "visitors",
      activated: "activated",
      signups: "signups",
      checkouts: "checkouts",
      paid: "paid",
      searchClicks: "searchClicks",
      adRevenue: "adRevenueCents",
    };
    return deltaBadge(current, previous[map[prevKey]]);
  };

  // ---- 总收入的诚实口径：两个收入源分别判断，未接通的源不冒充 0 ----
  const subscriptionNetCents =
    metrics.subscriptionGrossCents - metrics.refundCents;
  const totalValue = (() => {
    if (subAvailable && adHasData) return formatUsd(metrics.totalRevenueCents);
    if (subAvailable) return formatUsd(subscriptionNetCents);
    if (adHasData) return formatUsd(metrics.adRevenueCents);
    return "尚未接通";
  })();
  const nonUsdNote =
    metrics.otherCurrencyNet.length > 0
      ? `；非 USD（${metrics.otherCurrencyNet
          .map((o) => `${(o.cents / 100).toFixed(2)} ${o.currency}`)
          .join("、")}）未换算、未计入`
      : "";
  const totalHint = (() => {
    if (subAvailable && adHasData) return `订阅净额 + 广告收入（USD 口径）${nonUsdNote}`;
    if (subAvailable) return `广告收入尚未接入，未计入总收入${nonUsdNote}`;
    if (adHasData) return `订阅数据未接通，未计入总收入${nonUsdNote}`;
    return "订阅与广告数据源均未接通";
  })();
  // 总收入环比：暂不显示。上一周期同口径模块（WindowMetrics）尚未包含订阅净额分项，
  // 两个收入源不能只用广告一侧拼出可比的上一周期总收入 —— 宁可不显示，不伪造数字。
  const totalDelta: DeltaBadge | undefined = undefined;

  // ---- 漏斗 5 列 ----
  const stepIndex = new Map<string, number>(overview.funnel.map((s, i) => [s.key, i]));
  const funnelColumns: Array<Column<FunnelStep>> = [
    {
      key: "step",
      title: "漏斗步骤",
      render: (r) => <div className="font-medium text-ink">{r.label}</div>,
    },
    {
      key: "source",
      title: "数据来源",
      render: (r) => <span className="text-xs text-ink-40">{r.source}</span>,
    },
    {
      key: "count",
      title: "实际数量",
      align: "right",
      render: (r) =>
        r.available ? (
          <span className="font-mono text-ink">{formatInt(r.count)}</span>
        ) : (
          <span className="text-xs text-ink-40">{funnelUnavailableText(r.key)}</span>
        ),
    },
    {
      key: "conv",
      title: "环节转化率",
      align: "right",
      render: (r) => {
        const i = stepIndex.get(r.key) ?? 0;
        const prevStep = i > 0 ? overview.funnel[i - 1] : null;
        if (i === 0) return <span className="text-ink-40">—</span>; // 首节点无上游
        if (!r.available || (prevStep && !prevStep.available)) {
          return <span className="text-xs text-ink-40">暂不可用</span>;
        }
        if (r.conversionFromPrevious === null) return <span className="text-ink-40">—</span>;
        return (
          <span className="font-mono text-ink">{formatPct(r.conversionFromPrevious)}</span>
        );
      },
    },
    {
      key: "measure",
      title: "统计说明",
      render: (r) => <span className="text-xs text-ink-40">{r.measure}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {/* 窗口切换 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WindowSwitcher current={days} basePath="/admin" />
        <div className="text-xs text-ink-40">
          统计窗口：{ADMIN_WINDOW_LABELS[days]}（按滚动时间统计，非自然日） · 趋势按 UTC 日 ·
          Google 搜索数据止于昨日（Google 有 2–3 天延迟）
        </div>
      </div>

      {/* 经营状态判断（不只给数字） */}
      <Card
        className={`px-4 py-3 ${
          diagnosisTone(diagnosis.code) === "warn"
            ? "border-warn/40 bg-warn/5"
            : diagnosisTone(diagnosis.code) === "good"
              ? "border-pos/40 bg-pos/5"
              : ""
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              diagnosisTone(diagnosis.code) === "warn"
                ? "warn"
                : diagnosisTone(diagnosis.code) === "good"
                  ? "good"
                  : "neutral"
            }
          >
            {DIAGNOSIS_LABELS[diagnosis.code] ?? diagnosis.code}
          </Badge>
          <span className="text-sm font-semibold text-ink">{diagnosis.label}</span>
          {!diagnosis.conclusive ? (
            <Badge tone="neutral">数据不足，暂时无法判断</Badge>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-ink-60">{diagnosis.detail}</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-ink-40">判断依据（真实数据）</div>
            <ul className="mt-1 space-y-0.5">
              {diagnosis.evidence.map((e) => (
                <li key={e} className="text-xs text-ink-60">
                  {e}
                </li>
              ))}
            </ul>
          </div>
          {diagnosis.missingData.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-ink-40">缺少的数据</div>
              <ul className="mt-1 space-y-0.5">
                {diagnosis.missingData.map((m) => (
                  <li key={m} className="text-xs text-warn">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      {/* 9 个核心指标（含环比） */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="网站访客"
          value={availability.analytics ? formatInt(metrics.visitors) : "暂无数据"}
          hint="去重访客（同一人只算一次）"
          source={availability.analytics ? "站内行为统计" : "尚未有站内事件"}
          tone={availability.analytics ? "default" : "muted"}
          delta={delta(metrics.visitors, availability.analytics, "visitors")}
        />
        <MetricCard
          label="Google 搜索点击"
          value={availability.gscConnected ? formatInt(metrics.searchClicks) : "尚未连接"}
          hint="从 Google 搜索结果点进网站"
          source={availability.gscConnected ? "Google 搜索数据" : "尚未连接 Google 搜索数据"}
          tone={availability.gscConnected ? "default" : "muted"}
          delta={delta(metrics.searchClicks, availability.gscConnected, "searchClicks")}
        />
        <MetricCard
          label="新注册用户"
          value={availability.profiles ? formatInt(metrics.signups) : "尚未接通"}
          hint="窗口内新注册的账号"
          source={availability.profiles ? "Supabase 注册表" : "Supabase service_role 未配置"}
          tone={availability.profiles ? "default" : "muted"}
          delta={delta(metrics.signups, availability.profiles, "signups")}
        />
        <MetricCard
          label="实际使用产品的用户"
          value={availability.analytics ? formatInt(metrics.activatedUsers) : "暂无数据"}
          hint="完成过一次完整 SEO 审计"
          source={availability.analytics ? "站内行为统计" : "尚未有站内事件"}
          tone={availability.analytics ? "default" : "muted"}
          delta={delta(metrics.activatedUsers, availability.analytics, "activated")}
        />
        <MetricCard
          label="开始付款人数"
          value={availability.orders ? formatInt(metrics.checkoutStarted) : "尚未接通"}
          hint="发起了付款流程的订单"
          source={availability.orders ? "Supabase 订单表" : "Supabase service_role 未配置"}
          tone={availability.orders ? "default" : "muted"}
          delta={delta(metrics.checkoutStarted, availability.orders, "checkouts")}
        />
        <MetricCard
          label="付费客户"
          value={availability.orders ? formatInt(metrics.paidCustomers) : "尚未接通"}
          hint="窗口内成功支付（按用户去重）"
          source={availability.orders ? "Supabase 订单表" : "Supabase service_role 未配置"}
          tone={
            availability.orders ? (metrics.paidCustomers > 0 ? "good" : "default") : "muted"
          }
          delta={delta(metrics.paidCustomers, availability.orders, "paid")}
        />
        <MetricCard
          label="每月订阅收入"
          value={availability.mrr ? formatUsd(metrics.mrrCents) : "尚未接通"}
          hint="活跃订阅 × 套餐月费（当前时点值，不做环比）"
          source={availability.mrr ? "Supabase 注册表（一次性买断不计入）" : "Supabase service_role 未配置"}
          tone={availability.mrr ? "default" : "muted"}
        />
        <MetricCard
          label="广告收入"
          value={adHasData ? formatUsd(metrics.adRevenueCents) : "尚未接通"}
          hint={adHasData ? "广告平台收入（本地日表）" : "尚未导入任何广告收入数据"}
          source={adHasData ? "广告收入本地日表（可用 CSV 导入）" : "尚未接入"}
          tone={adHasData ? "default" : "muted"}
          delta={delta(metrics.adRevenueCents, adHasData, "adRevenue")}
        />
        <MetricCard
          label="总收入"
          value={totalValue}
          hint={totalHint}
          source={
            metrics.otherCurrencyNet.length > 0
              ? `另有非美元历史订阅净额：${metrics.otherCurrencyNet
                  .map((c) => formatMoney(c.cents, c.currency))
                  .join(" / ")}`
              : "订阅与广告两个独立来源，未接通的源不计入"
          }
          delta={totalDelta}
        />
      </div>

      {/* 经营漏斗（5 列） */}
      <Section
        title="经营漏斗"
        description="搜索曝光 → 搜索点击 → 进入网站 → 注册账号 → 使用工具 → 开始付款 → 支付成功"
        meta={
          availability.gscConnected
            ? "Google 搜索数据已接入"
            : "Google 搜索数据未连接：曝光 / 点击节点暂不可用（不是 0）"
        }
      >
        <DataTable
          columns={funnelColumns}
          rows={[...overview.funnel]}
          rowKey={(r) => r.key}
          compact
        />
        <p className="mt-2 text-xs text-ink-40">
          进入网站与使用工具依赖站内事件（需访客同意 Cookie）；注册 / 付款直接来自权威表，
          因此历史数据不会显示为 0。任一环节数据不可用时，其转化率显示「暂不可用」，不做计算。
        </p>
      </Section>

      {/* 最近成功付款（老板最关心：谁付了钱、通知发出去没有） */}
      <Section
        title="最近成功付款"
        description="金额按订单自身币种展示（不混算）；通知状态 = 付款成功邮件的投递结果"
        meta={
          recentPayments.ordersAvailable ? undefined : "orders 不可读，无法展示付款记录"
        }
      >
        {recentPayments.ordersAvailable && recentPayments.rows.length > 0 ? (
          <DataTable
            columns={recentPaymentColumns}
            rows={recentPayments.rows}
            rowKey={(r) => r.outTradeNo}
            compact
          />
        ) : recentPayments.ordersAvailable ? (
          <Empty>
            暂无成功付款记录。有真实付款后，这里会显示付款时间、客户、套餐、金额与通知发送状态。
          </Empty>
        ) : (
          <Unavailable reason={recentPayments.ordersError ?? "orders 不可读"} />
        )}
        <div className="mt-2 text-xs">
          <Link href="/admin/revenue" className="text-accent hover:underline">
            查看完整付款明细与通知重试 →
          </Link>
        </div>
      </Section>

      {/* 趋势 */}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <Section
          title="访客趋势"
          description="按日去重访客（UTC；与总览同口径：登录前后算同一人）"
        >
          {availability.analytics ? (
            <TrendBars
              values={series.map((p) => p.visitors)}
              labels={series.map((p) => p.day)}
              formatValue={(v) => formatInt(v)}
            />
          ) : (
            <Unavailable reason="尚无任何站内事件" />
          )}
        </Section>
        <Section title="注册趋势" description="按日新增注册（权威表）">
          {availability.profiles ? (
            <TrendBars
              values={series.map((p) => p.signups)}
              labels={series.map((p) => p.day)}
              formatValue={(v) => formatInt(v)}
            />
          ) : (
            <Unavailable reason="Supabase service_role 未配置" />
          )}
        </Section>
        <Section title="付款趋势" description="按日付款流程发起与支付成功">
          {availability.orders ? (
            <div className="space-y-2">
              <TrendBars
                values={series.map((p) => p.checkout)}
                labels={series.map((p) => p.day)}
                formatValue={(v) => formatInt(v)}
              />
              <TrendBars
                values={series.map((p) => p.paid)}
                labels={series.map((p) => p.day)}
                color="var(--color-pos)"
                formatValue={(v) => formatInt(v)}
              />
              <div className="text-xs text-ink-40">
                上图 = 发起付款；下图（绿）= 支付成功
              </div>
            </div>
          ) : (
            <Unavailable reason="Supabase service_role 未配置" />
          )}
        </Section>
        <Section title="广告收入趋势" description="按日广告收入（本地日表）">
          {adHasData ? (
            <TrendBars
              values={series.map((p) => p.adRevenueCents)}
              labels={series.map((p) => p.day)}
              formatValue={(v) => formatUsd(v)}
            />
          ) : (
            <Unavailable reason="尚未导入广告收入（可用 CSV / 手工导入）" />
          )}
        </Section>
        <Section title="状态快照" description="最近同步 / 导入时间">
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">访客数据来源</dt>
              <dd className="text-right">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    overview.analyticsSource === "production-readonly"
                      ? "bg-green-500/10 text-green-500"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                  title={overview.analyticsSourceNote}
                >
                  {overview.analyticsSource === "production-readonly"
                    ? "生产库（只读）"
                    : "本地隔离库（非生产数据）"}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">Google 搜索数据最近同步</dt>
              <dd className="font-mono text-ink-60">{formatWhen(overview.gscLastSyncAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">广告收入最近导入</dt>
              <dd className="font-mono text-ink-60">{formatWhen(overview.adsLastImportedAt)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-ink-40">{overview.analyticsSourceNote}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Link href="/admin/data-sources" className="text-accent hover:underline">
              查看数据源接入状态 →
            </Link>
          </div>
        </Section>
        <Section title="快速入口" description="按问题找页面">
          <div className="space-y-1.5 text-sm">
            <Link href="/admin/customers" className="block text-accent hover:underline">
              客户管理 — 谁注册了、从哪来、付了多少钱
            </Link>
            <Link href="/admin/revenue" className="block text-accent hover:underline">
              收入分析 — 订阅 / 退款 / 净收入 / 广告收入
            </Link>
            <Link href="/admin/growth" className="block text-accent hover:underline">
              流量分析 — 搜索趋势、热门页面与关键词、排名机会
            </Link>
          </div>
          {series.every((p) => p.visitors === 0 && p.signups === 0 && p.checkout === 0) ? (
            <div className="mt-3">
              <Empty>
                当前窗口没有任何流量 / 注册 / 订单记录。若数据源已接通但仍是空白，说明本周期确实没有记录；
                若尚未接通，请先查看数据来源页面。
              </Empty>
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
