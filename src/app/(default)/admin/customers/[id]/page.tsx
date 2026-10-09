// ===== /admin/customers/[id]：客户详情 + 完整 activity timeline =====

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  DataTable,
  Empty,
  MetricCard,
  Section,
  Unavailable,
  formatInt,
  formatMoney,
  formatUsd,
  formatWhen,
  type Column,
} from "@/components/admin/ui";
import { listCustomers, getCustomerTimeline, type TimelineEntry } from "@/lib/admin/customers";
import { listCreemRecordsForUser } from "@/lib/creem/snapshot";

export const dynamic = "force-dynamic";

function kindTone(kind: string): "neutral" | "info" | "good" | "warn" {
  if (kind === "order") return "info";
  if (kind === "creem") return "warn";
  return "neutral";
}

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = decodeURIComponent(id);

  const snapshot = await listCustomers();
  const customer = snapshot.rows.find((r) => r.userId === userId);

  if (!customer) {
    if (!snapshot.available) {
      return (
        <Unavailable
          reason={snapshot.error ?? "profiles 权威表不可读，无法确认该客户"}
        />
      );
    }
    notFound();
  }

  const [timeline, creem, orders] = await Promise.all([
    getCustomerTimeline(userId),
    listCreemRecordsForUser(userId),
    Promise.resolve(snapshot.orders.filter((o) => o.user_id === userId)),
  ]);

  const usdRevenue = customer.revenue.find((c) => c.currency === "USD")?.cents ?? 0;

  const timelineColumns: Array<Column<TimelineEntry>> = [
    {
      key: "at",
      title: "时间",
      render: (e) => <span className="font-mono text-xs">{formatWhen(e.at)}</span>,
    },
    {
      key: "event",
      title: "事件",
      render: (e) => (
        <div className="min-w-[220px]">
          <div className="text-ink">{e.label}</div>
          {e.detail ? (
            <div className="font-mono text-xs text-ink-40">{e.detail}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "kind",
      title: "来源",
      render: (e) => <Badge tone={kindTone(e.kind)}>{e.kind}</Badge>,
    },
    {
      key: "path",
      title: "Path / Ref",
      render: (e) => (
        <div className="text-xs">
          <div className="font-mono">{e.path ?? "—"}</div>
          {e.refId ? <div className="text-xs text-ink-40">ref: {e.refId}</div> : null}
        </div>
      ),
    },
    {
      key: "attribution",
      title: "Attribution",
      render: (e) => (
        <div className="text-xs">
          <div>{[e.source, e.medium, e.campaign].filter(Boolean).join(" / ") || "—"}</div>
          {e.referrer ? (
            <div className="text-xs text-ink-40">ref host: {e.referrer}</div>
          ) : null}
        </div>
      ),
    },
  ];

  const orderColumns: Array<Column<(typeof orders)[number]>> = [
    { key: "no", title: "Out trade no", render: (o) => <span className="font-mono text-xs">{o.out_trade_no}</span> },
    { key: "plan", title: "Plan", render: (o) => o.plan },
    {
      key: "amount",
      title: "Amount",
      align: "right",
      render: (o) => formatMoney(Math.round(Number(o.amount) * 100), String(o.currency).toUpperCase()),
    },
    { key: "status", title: "Status", render: (o) => <Badge tone={o.payment_status === "paid" ? "good" : o.payment_status === "failed" ? "bad" : "neutral"}>{o.payment_status}</Badge> },
    { key: "channel", title: "Channel", render: (o) => o.payment_channel ?? "—" },
    { key: "created", title: "Created", render: (o) => <span className="font-mono text-xs">{formatWhen(o.created_at)}</span> },
    { key: "paid", title: "Paid at", render: (o) => <span className="font-mono text-xs">{formatWhen(o.paid_at)}</span> },
    {
      key: "refund",
      title: "Refund",
      align: "right",
      render: (o) =>
        o.refund_amount
          ? formatMoney(Math.round(Number(o.refund_amount) * 100), String(o.currency).toUpperCase())
          : "—",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/customers" className="text-xs text-accent hover:underline">
            ← 返回客户列表
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-ink">{customer.email}</h1>
          <div className="text-xs text-ink-40">
            {customer.displayName ? `${customer.displayName} · ` : ""}
            <span className="font-mono">{customer.userId}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={customer.status === "paying" ? "good" : customer.status === "canceled" ? "bad" : "neutral"}>
            {customer.status}
          </Badge>
          <Badge tone="neutral">{customer.subscriptionStatus}</Badge>
          <Badge tone="info">{customer.effectivePlan}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <MetricCard label="注册时间" value={formatWhen(customer.signupAt).slice(0, 10)} hint="profiles.created_at" />
        <MetricCard label="最近活跃" value={formatWhen(customer.lastActiveAt).slice(0, 10)} hint="最后一条站内事件" />
        <MetricCard label="来源" value={customer.source ?? "—"} hint={[customer.medium, customer.campaign].filter(Boolean).join(" / ") || "无 UTM"} source="first touch 归因" />
        <MetricCard label="项目数" value={formatInt(customer.projects)} hint="projects 表" />
        <MetricCard label="审计次数" value={formatInt(customer.audits)} hint="audits 表" />
        <MetricCard
          label="累计收入（USD）"
          value={formatUsd(usdRevenue)}
          hint={`${customer.paidOrders} paid orders`}
          source={customer.revenue.length > 1 ? `另有 ${customer.revenue.filter((c) => c.currency !== "USD").map((c) => formatMoney(c.cents, c.currency)).join(" / ")}` : "orders 权威表"}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Section title="订阅与账号状态" description="profiles（权威）" className="lg:col-span-2">
          <dl className="grid gap-2 text-xs md:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">存储 plan</dt>
              <dd className="font-mono text-ink-60">{customer.plan}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">effective plan</dt>
              <dd className="font-mono text-ink-60">{customer.effectivePlan}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">subscription_status</dt>
              <dd className="font-mono text-ink-60">{customer.subscriptionStatus}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">current_period_end</dt>
              <dd className="font-mono text-ink-60">{formatWhen(customer.currentPeriodEnd)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">first landing page</dt>
              <dd className="font-mono text-ink-60">{customer.landingPage ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-40">功能使用</dt>
              <dd className="font-mono text-ink-60">
                {customer.featureUses}
                {customer.features.length > 0 ? ` (${customer.features.join(", ")})` : ""}
              </dd>
            </div>
          </dl>
        </Section>

        <Section
          title="Creem 支付标识"
          description="排查支付问题用的外部 ID"
        >
          {creem.customers.length === 0 &&
          creem.subscriptions.length === 0 &&
          creem.transactions.length === 0 ? (
            <Empty>该客户在本地 Creem 快照中暂无记录（可能未走 Creem 支付，或 webhook 尚未到达）。</Empty>
          ) : (
            <div className="space-y-2 text-xs">
              {creem.customers.map((c) => (
                <div key={String(c.creem_customer_id)} className="rounded-md border border-line-soft px-2 py-1.5">
                  <div className="text-ink-40">customer</div>
                  <div className="font-mono text-ink-60">{String(c.creem_customer_id)}</div>
                </div>
              ))}
              {creem.subscriptions.map((s) => (
                <div key={String(s.creem_subscription_id)} className="rounded-md border border-line-soft px-2 py-1.5">
                  <div className="text-ink-40">subscription</div>
                  <div className="font-mono text-ink-60">{String(s.creem_subscription_id)}</div>
                  <div className="text-xs text-ink-40">
                    status={String(s.status)} · period_end={formatWhen(s.current_period_end as string)}
                  </div>
                </div>
              ))}
              {creem.transactions.map((t) => (
                <div key={String(t.creem_transaction_id)} className="rounded-md border border-line-soft px-2 py-1.5">
                  <div className="text-ink-40">
                    {String(t.type) === "refund" ? "refund" : "transaction"}
                  </div>
                  <div className="font-mono text-ink-60">{String(t.creem_transaction_id)}</div>
                  <div className="text-xs text-ink-40">
                    {String(t.amount_cents)} 分 {String(t.currency)} · {String(t.status)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section
        title="订单"
        description="SeeO 权威订单表（订阅收入与权益的唯一来源）"
        meta={snapshot.ordersAvailable ? `${orders.length} 笔` : "orders 不可读"}
      >
        {snapshot.ordersAvailable ? (
          <DataTable columns={orderColumns} rows={orders} rowKey={(o) => o.id} compact emptyText="该客户暂无订单" />
        ) : (
          <Unavailable reason="Supabase service_role 未配置" />
        )}
      </Section>

      <Section
        title="活动时间线"
        description="visit → signup → audit → pricing → checkout → subscription（含注册前的匿名行为与 Creem 记录）"
        meta={timeline.truncated ? "已截断至最近 500 条" : `${timeline.entries.length} 条`}
      >
        {timeline.entries.length === 0 ? (
          <Empty>
            暂无任何事件。注意：站内事件仅在访客同意 Cookie 后被记录；订单/Creem 记录不受此限制。
          </Empty>
        ) : (
          <DataTable
            columns={timelineColumns}
            rows={timeline.entries}
            rowKey={(e, i) => `${e.at}-${e.key}-${i}`}
            compact
          />
        )}
      </Section>
    </div>
  );
}
