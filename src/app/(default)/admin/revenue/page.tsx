// ===== /admin/revenue：订阅收入 + 广告收入（两个独立 source，最后统一汇总）=====

import {
  Badge,
  Card,
  DataTable,
  MetricCard,
  Section,
  Unavailable,
  WindowSwitcher,
  formatInt,
  formatMoney,
  formatPct,
  formatUsd,
  formatWhen,
  type Column,
} from "@/components/admin/ui";
import { getRevenueSummary } from "@/lib/admin/revenue";
import {
  getRecentPayments,
  type PaymentNotifyStatus,
  type RecentPaymentRow,
} from "@/lib/admin/recent-payments";
import { getAdProvider } from "@/lib/admin/ads";
import { normalizeWindow, ADMIN_WINDOW_LABELS } from "@/lib/admin/funnel";
import { NotifyRetryButton } from "./notify-retry-button";

import { checkAdmin } from "@/lib/admin/auth";
import AdminGuardMessage from "@/components/admin/guard-message";

export const dynamic = "force-dynamic";

interface CurrencyRow {
  currency: string;
  grossCents: number;
  refundCents: number;
  netCents: number;
}

/** 通知状态 → 徽章（诚实规则：历史订单无通知记录 ≠ 已发送） */
function notifyBadge(status: PaymentNotifyStatus): {
  tone: "neutral" | "good" | "warn" | "bad";
  label: string;
} {
  switch (status) {
    case "sent":
      return { tone: "good", label: "已发送" };
    case "failed":
      return { tone: "bad", label: "发送失败" };
    case "pending":
      return { tone: "warn", label: "待发送" };
    case "none":
      return { tone: "neutral", label: "历史记录" };
  }
}

export default async function AdminRevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; import?: string; imported?: string; errors?: string }>;
}) {
  // 页面级 fail-closed 守卫：layout 与 page 并行渲染，layout 正常 return 不阻止本页
  // RSC payload 流式输出（官方 authentication 指南），因此取数前必须自行鉴权。
  const guard = await checkAdmin();
  if (!guard.ok) return <AdminGuardMessage code={guard.code} error={guard.error} />;
  const sp = await searchParams;
  const days = normalizeWindow(sp.days);
  const summary = await getRevenueSummary(days);
  const recentPayments = await getRecentPayments(15);
  const adsense = getAdProvider("adsense");
  const adsenseStatus = adsense?.configStatus();

  const currencyColumns: Array<Column<CurrencyRow>> = [
    { key: "currency", title: "Currency", render: (r) => r.currency },
    { key: "gross", title: "Gross", align: "right", render: (r) => formatMoney(r.grossCents, r.currency) },
    { key: "refund", title: "Refunds", align: "right", render: (r) => formatMoney(r.refundCents, r.currency) },
    { key: "net", title: "Net", align: "right", render: (r) => formatMoney(r.netCents, r.currency) },
  ];

  const paymentColumns: Array<Column<RecentPaymentRow>> = [
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
      key: "channel",
      title: "渠道",
      render: (r) => <span className="text-xs text-ink-40">{r.channel ?? "—"}</span>,
    },
    {
      key: "notify",
      title: "邮件通知",
      render: (r) => {
        const v = notifyBadge(r.notifyStatus);
        return (
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={v.tone}>{v.label}</Badge>
              {r.notifyStatus === "failed" ? (
                <span className="text-xs text-neg">付款已确认，邮件通知发送失败</span>
              ) : null}
            </div>
            {r.notifyLastError ? (
              <div className="text-xs text-ink-40">{r.notifyLastError}</div>
            ) : null}
            {r.notifyStatus === "pending" ? (
              <div className="text-xs text-ink-40">将自动重试，也可立即发送</div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "action",
      title: "操作",
      render: (r) =>
        r.notifyId && (r.notifyStatus === "failed" || r.notifyStatus === "pending") ? (
          <NotifyRetryButton notificationId={r.notifyId} />
        ) : (
          <span className="text-ink-40">—</span>
        ),
    },
  ];

  const sub = summary.subscription;
  const lifecycle = summary.lifecycle;
  const rec = summary.reconciliation;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WindowSwitcher current={days} basePath="/admin/revenue" />
        <div className="text-xs text-ink-40">
          窗口：{ADMIN_WINDOW_LABELS[days]} · 订阅收入与广告收入分别统计，最后统一汇总（不跨币种换算）
        </div>
      </div>

      {sp.import === "ok" ? (
        <Card className="border-pos/40 bg-pos/5 px-4 py-2 text-sm text-ink-60">
          已导入 {sp.imported ?? 0} 行广告收入
          {sp.errors && Number(sp.errors) > 0 ? `，${sp.errors} 行被拒绝` : ""}。
        </Card>
      ) : sp.import === "error" ? (
        <Card className="border-neg/40 bg-neg/5 px-4 py-2 text-sm text-ink-60">
          导入失败：所有行都被拒绝（{sp.errors ?? 0} 行）。请检查 CSV 表头与数值格式。
        </Card>
      ) : null}

      {/* 汇总 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="订阅收入（总额）"
          value={sub.available ? formatMoney(sub.breakdown.find((b) => b.currency === "USD")?.grossCents ?? 0, "USD") : "—"}
          hint="USD 口径（窗口内成功支付）"
          source={sub.available ? "orders（权威）" : sub.error ?? "orders 不可读"}
          tone={sub.available ? "default" : "muted"}
        />
        <MetricCard
          label="退款"
          value={sub.available ? formatUsd(sub.breakdown.find((b) => b.currency === "USD")?.refundCents ?? 0) : "—"}
          hint={`${sub.refundedOrders} 笔退款`}
          source="orders.refund_amount"
          tone={sub.available ? "default" : "muted"}
        />
        <MetricCard
          label="订阅收入（净额）"
          value={sub.available ? formatUsd(sub.breakdown.find((b) => b.currency === "USD")?.netCents ?? 0) : "—"}
          hint="总额 − 退款"
          source="orders"
        />
        <MetricCard
          label="广告收入"
          value={summary.ads.hasData ? formatMoney(summary.ads.revenueCents, "USD") : "—"}
          hint={
            summary.ads.hasData
              ? `${formatInt(summary.ads.impressions)} 次展示 · ${formatInt(summary.ads.clicks)} 次点击${
                  summary.ads.nonUsd.length > 0
                    ? ` · 非 USD ${summary.ads.nonUsd.map((n) => `${(n.cents / 100).toFixed(2)} ${n.currency}`).join("、")}（未换算）`
                    : ""
                }`
              : "尚未导入"
          }
          source={summary.ads.hasData ? "ad_revenue_daily（USD 口径）" : "无数据"}
          tone={summary.ads.hasData ? "default" : "muted"}
        />
        <MetricCard
          label="总收入"
          value={formatUsd(summary.totalNetCents)}
          hint={
            summary.otherCurrencyNet.length > 0
              ? `USD 口径：订阅净额 + 广告收入；非 USD（${summary.otherCurrencyNet
                  .map((o) => `${(o.cents / 100).toFixed(2)} ${o.currency}`)
                  .join("、")}）未换算、未计入`
              : "订阅净额 + 广告收入（USD 口径）"
          }
          source="汇总口径"
          tone="good"
        />
        <MetricCard
          label="每月订阅收入"
          value={summary.mrr.available ? formatUsd(summary.mrr.mrrCents) : "—"}
          hint={`${lifecycle.counts.active + lifecycle.counts.trialing} 活跃订阅`}
          source="profiles.plan"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="活跃订阅"
          value={formatInt(lifecycle.counts.active + lifecycle.counts.trialing)}
          hint={`活跃 ${lifecycle.counts.active} · 试用中 ${lifecycle.counts.trialing}`}
          source="creem_subscriptions（本地快照）"
        />
        <MetricCard
          label="新增订阅"
          value={formatInt(lifecycle.newInWindow)}
          hint={`窗口 ${days}D 内创建`}
          source="creem_subscriptions.created_at"
        />
        <MetricCard
          label="取消订阅"
          value={formatInt(lifecycle.canceledInWindow)}
          hint={`窗口 ${days}D 内取消`}
          source="creem_subscriptions.canceled_at"
        />
        <MetricCard
          label="每付费用户收入"
          value={summary.arpu.value === null ? "—" : formatUsd(Math.round(summary.arpu.value))}
          hint={summary.arpu.basis}
          source="真实数据足够时才计算"
          tone={summary.arpu.value === null ? "muted" : "default"}
        />
        <MetricCard
          label="付费客户"
          value={formatInt(sub.payingCustomers)}
          hint={`${sub.checkoutOrders} 次开始付款`}
          source="orders"
        />
      </div>

      <Section
        title="按币种的订阅收入"
        description="按币种分开统计（历史 Yaolipay 订单为 CNY，保留不换算）"
        meta={sub.truncated ? "orders 超过 5000 行已截断" : undefined}
      >
        {sub.available ? (
          <DataTable
            columns={currencyColumns}
            rows={sub.breakdown}
            rowKey={(r) => r.currency}
            compact
            emptyText="窗口内没有订阅收入记录"
          />
        ) : (
          <Unavailable reason={sub.error ?? "orders 不可读"} />
        )}
      </Section>

      <Section
        title="付款明细（最近成功付款）"
        description="金额按订单自身币种展示，不跨币种换算；「邮件通知」为付款成功后发给老板邮箱的通知投递结果"
      >
        {recentPayments.ordersAvailable ? (
          recentPayments.rows.length === 0 ? (
            <Unavailable reason="还没有任何成功付款记录" />
          ) : (
            <DataTable
              columns={paymentColumns}
              rows={recentPayments.rows}
              rowKey={(r) => r.outTradeNo}
              compact
            />
          )
        ) : (
          <Unavailable reason={recentPayments.ordersError ?? "orders 不可读"} />
        )}
        <p className="mt-2 text-xs text-ink-40">
          「历史记录」= 通知功能上线前的订单：当时没有通知机制，不补发、也不伪装成已发送。
          发送失败的通知可点「重试发送」，或等待每小时自动重试（同一笔支付最多尝试 5 次，已发送的通知不会重复发）。
        </p>
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section
          title="每月订阅收入口径"
          description="月经常性收入（不含一次性 Custom 服务）"
        >
          {summary.mrr.available ? (
            <>
              <DataTable
                columns={[
                  { key: "plan", title: "套餐", render: (r: (typeof summary.mrr.byPlan)[number]) => r.plan },
                  { key: "users", title: "用户数", align: "right", render: (r) => formatInt(r.users) },
                  { key: "unit", title: "月费", align: "right", render: (r) => formatUsd(r.unitCents) },
                  { key: "mrr", title: "每月收入", align: "right", render: (r) => formatUsd(r.mrrCents) },
                ]}
                rows={summary.mrr.byPlan}
                rowKey={(r) => r.plan}
                compact
              />
              <p className="mt-2 text-xs text-ink-40">{summary.mrr.basis}</p>
              {summary.mrr.hasLegacyNonUsd ? (
                <p className="mt-1 text-xs text-warn">
                  检测到非 USD 历史订单（Yaolipay 时代 CNY）。每月订阅收入只覆盖当前 USD 订阅期，历史一次性订单不计入。
                </p>
              ) : null}
            </>
          ) : (
            <Unavailable reason={summary.mrr.error ?? "profiles 不可读"} />
          )}
        </Section>

        <Section
          title="广告收入来源"
          description="平台能力与本地数据状态（不做 scraping）"
        >
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={adsenseStatus?.configured ? "good" : "neutral"}>
                {adsenseStatus?.configured ? "API configured" : "API not configured"}
              </Badge>
              <span className="text-ink-60">{adsense?.label ?? "AdSense"}</span>
            </div>
            <p className="text-ink-40">{adsenseStatus?.hint}</p>
            <dl className="grid gap-1">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-40">本地日表最近导入</dt>
                <dd className="font-mono text-ink-60">{formatWhen(summary.ads.lastImportedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-40">窗口收入（{days}D，USD 口径）</dt>
                <dd className="font-mono text-ink-60">
                  {summary.ads.hasData ? formatMoney(summary.ads.revenueCents, "USD") : "无数据"}
                </dd>
              </div>
              {summary.ads.nonUsd.length > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-40">非 USD 广告收入（未换算）</dt>
                  <dd className="font-mono text-ink-60">
                    {summary.ads.nonUsd
                      .map((n) => `${(n.cents / 100).toFixed(2)} ${n.currency}`)
                      .join("、")}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-40">窗口展示 / 点击</dt>
                <dd className="font-mono text-ink-60">
                  {formatInt(summary.ads.impressions)} / {formatInt(summary.ads.clicks)}
                  {summary.ads.impressions > 0
                    ? ` · CTR ${formatPct(summary.ads.clicks / summary.ads.impressions)}`
                    : ""}
                </dd>
              </div>
              {summary.ads.mixedCurrency ? (
                <div className="text-warn">
                  检测到多种币种：{summary.ads.currencies.join(", ")} —— 汇总时不换算，请人工判断。
                </div>
              ) : null}
            </dl>
          </div>
        </Section>
      </div>

      <Section
        title="导入广告收入（CSV / 手工）"
        description="平台无 API 或未授权时的唯一合法途径；不做 scraping。可直接上传 AdSense 导出的 CSV 文件，或粘贴：date,revenue,impressions,clicks,currency"
      >
        <form
          method="post"
          action="/api/admin/import/ads"
          encType="multipart/form-data"
          className="space-y-2"
        >
          <input type="hidden" name="provider" value="adsense" />
          <input type="hidden" name="days" value={String(days)} />
          <input
            type="file"
            name="file"
            accept=".csv"
            className="block rounded-md border border-line bg-card px-2 py-1 text-xs text-ink-60"
          />
          <textarea
            name="csv"
            rows={5}
            placeholder={"date,revenue,impressions,clicks,currency\n2026-10-01,12.34,12000,45,USD"}
            className="w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-40"
          />
          <button
            type="submit"
            className="rounded-md border border-brand bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-deep"
          >
            导入
          </button>
          <span className="ml-2 text-xs text-ink-40">
            按 (日期, provider) 覆盖写入，重复导入同一天不会重复计收入。
          </span>
        </form>
      </Section>

      <Section
        title="Creem 快照 ↔ orders 对账"
        description="仅用于排查，不参与收入口径（避免同一笔钱被计算两次）"
      >
        <div className="grid gap-2 text-xs md:grid-cols-2">
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">Creem 快照毛收入</dt>
              <dd className="font-mono text-ink-60">{formatUsd(rec.creemGrossCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">Creem 快照退款</dt>
              <dd className="font-mono text-ink-60">{formatUsd(rec.creemRefundCents)}</dd>
            </div>
          </dl>
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">orders（creem 渠道，USD）毛收入</dt>
              <dd className="font-mono text-ink-60">{formatUsd(rec.ordersGrossCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">orders 退款</dt>
              <dd className="font-mono text-ink-60">{formatUsd(rec.ordersRefundCents)}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-2 text-xs">
          {!rec.hasCreemData ? (
            <span className="text-ink-40">
              本地 Creem 快照暂无数据（webhook 尚未到达或未配置）—— 无法对账，不代表收入为 0。
            </span>
          ) : rec.deltaGrossCents === 0 && rec.deltaRefundCents === 0 ? (
            <span className="text-pos">两侧一致（Δgross=0, Δrefund=0）。</span>
          ) : (
            <span className="text-warn">
              存在差额：Δgross={formatUsd(rec.deltaGrossCents)}，Δrefund={formatUsd(rec.deltaRefundCents)}
              —— 说明有事件未到达或历史数据早于本地快照上线，需人工核对。
            </span>
          )}
        </div>

        {/* 逐单对账缺口：orders 为权威，快照缺失可据此人工核对或等待 Creem 导出回补 */}
        <div className="mt-3 border-t border-line pt-2 text-xs">
          <div className="mb-1 font-medium text-ink-60">逐单对账（orders 为权威）</div>
          {!summary.snapshotGap.ordersAvailable ? (
            <span className="text-ink-40">orders 权威表不可读，无法逐单对账。</span>
          ) : !summary.snapshotGap.hasCreemData ? (
            <span className="text-ink-40">
              Creem 快照无数据：无法逐单比对。历史快照缺失属正常（快照晚于订单上线），
              可用 Creem 后台导出核对 orders，orders 数字即收入口径。
            </span>
          ) : (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-4">
                <span className={summary.snapshotGap.missingSnapshot.length > 0 ? "text-warn" : "text-ink-40"}>
                  快照缺失订单：{summary.snapshotGap.missingSnapshot.length} 笔
                </span>
                <span className={summary.snapshotGap.orphan.length > 0 ? "text-warn" : "text-ink-40"}>
                  孤立快照：{summary.snapshotGap.orphan.length} 笔
                </span>
                <span className={summary.snapshotGap.mismatch.length > 0 ? "text-neg" : "text-ink-40"}>
                  金额不一致：{summary.snapshotGap.mismatch.length} 笔
                </span>
              </div>
              {summary.snapshotGap.missingSnapshot.slice(0, 5).map((m) => (
                <div key={m.outTradeNo} className="font-mono text-ink-40">
                  快照缺失 · {m.outTradeNo} · {(m.cents / 100).toFixed(2)} {m.currency} · paid_at {m.paidAt ?? "—"}
                </div>
              ))}
              {summary.snapshotGap.orphan.slice(0, 5).map((o) => (
                <div key={o.creemTransactionId} className="font-mono text-ink-40">
                  孤立快照 · {o.creemTransactionId} · order={o.outTradeNo ?? "—"} · {(o.cents / 100).toFixed(2)} {o.currency}
                </div>
              ))}
              {summary.snapshotGap.mismatch.slice(0, 5).map((m) => (
                <div key={m.outTradeNo} className="font-mono text-neg">
                  金额不一致 · {m.outTradeNo} · orders {(m.orderCents / 100).toFixed(2)} vs 快照 {(m.snapshotCents / 100).toFixed(2)} {m.currency}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
