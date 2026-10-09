// ===== /admin/customers：客户列表（搜索 / 排序 / 筛选）=====

import Link from "next/link";
import {
  Badge,
  Card,
  DataTable,
  Unavailable,
  formatInt,
  formatMoney,
  formatWhen,
  formatUsd,
  type Column,
} from "@/components/admin/ui";
import {
  CUSTOMER_STATUS_FILTERS,
  CUSTOMER_STATUS_LABELS,
  filterCustomers,
  listCustomers,
  INACTIVE_AFTER_DAYS,
  type CustomerRow,
  type CustomerSortKey,
  type CustomerStatusFilter,
} from "@/lib/admin/customers";

import { checkAdmin } from "@/lib/admin/auth";
import AdminGuardMessage from "@/components/admin/guard-message";

export const dynamic = "force-dynamic";

const SORTS: Array<{ key: CustomerSortKey; label: string }> = [
  { key: "signup", label: "注册时间" },
  { key: "lastActive", label: "最近活跃" },
  { key: "revenue", label: "收入" },
];

function statusTone(status: CustomerRow["status"]): "good" | "warn" | "bad" | "neutral" | "info" {
  switch (status) {
    case "paying":
      return "good";
    case "trial":
      return "info";
    case "canceled":
      return "bad";
    case "inactive":
      return "warn";
    default:
      return "neutral";
  }
}

function normalizeStatus(raw: string | undefined): CustomerStatusFilter {
  return (CUSTOMER_STATUS_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as CustomerStatusFilter)
    : "all";
}

function normalizeSort(raw: string | undefined): CustomerSortKey {
  return ["signup", "lastActive", "revenue"].includes(raw ?? "")
    ? (raw as CustomerSortKey)
    : "signup";
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sort?: string }>;
}) {
  // 页面级 fail-closed 守卫：layout 与 page 并行渲染，layout 正常 return 不阻止本页
  // RSC payload 流式输出（官方 authentication 指南），因此取数前必须自行鉴权。
  const guard = await checkAdmin();
  if (!guard.ok) return <AdminGuardMessage code={guard.code} error={guard.error} />;
  const sp = await searchParams;
  const status = normalizeStatus(sp.status);
  const sort = normalizeSort(sp.sort);
  const search = (sp.q ?? "").trim();

  const snapshot = await listCustomers();
  const rows = filterCustomers(snapshot.rows, { status, search, sort });

  const counts = new Map<CustomerStatusFilter, number>([["all", snapshot.rows.length]]);
  for (const r of snapshot.rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  const buildHref = (patch: Partial<{ status: string; q: string; sort: string }>) => {
    const params = new URLSearchParams({
      status: patch.status ?? status,
      ...(patch.q !== undefined ? { q: patch.q } : search ? { q: search } : {}),
      sort: patch.sort ?? sort,
    });
    return `/admin/customers?${params.toString()}`;
  };

  const columns: Array<Column<CustomerRow>> = [
    {
      key: "email",
      title: "Customer",
      render: (r) => (
        <div className="min-w-[200px]">
          <Link
            href={`/admin/customers/${encodeURIComponent(r.userId)}`}
            className="font-medium text-ink hover:text-accent"
          >
            {r.email}
          </Link>
          <div className="text-xs text-ink-40">
            {r.displayName ? `${r.displayName} · ` : ""}
            <span className="font-mono">{r.userId.slice(0, 8)}…</span>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      title: "Status",
      render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
    },
    {
      key: "signup",
      title: "Signup",
      render: (r) => <span className="font-mono text-xs">{formatWhen(r.signupAt)}</span>,
    },
    {
      key: "source",
      title: "Source / UTM",
      render: (r) => (
        <div className="min-w-[150px] text-xs">
          <div className="text-ink">{r.source ?? "—"}</div>
          <div className="text-xs text-ink-40">
            {[r.medium, r.campaign].filter(Boolean).join(" / ") || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "lastActive",
      title: "Last active",
      render: (r) => <span className="font-mono text-xs">{formatWhen(r.lastActiveAt)}</span>,
    },
    { key: "projects", title: "Projects", align: "right", render: (r) => formatInt(r.projects) },
    { key: "audits", title: "Audits", align: "right", render: (r) => formatInt(r.audits) },
    {
      key: "features",
      title: "Feature usage",
      align: "right",
      render: (r) => (
        <span title={r.features.join(", ")}>
          {formatInt(r.featureUses)}
          {r.features.length > 0 ? (
            <span className="ml-1 text-xs text-ink-40">{r.features.join("/")}</span>
          ) : null}
        </span>
      ),
    },
    { key: "plan", title: "Plan", render: (r) => <span className="text-xs">{r.effectivePlan}</span> },
    {
      key: "subscription",
      title: "Subscription",
      render: (r) => (
        <div className="min-w-[130px] text-xs">
          <div>{r.subscriptionStatus}</div>
          <div className="text-xs text-ink-40">
            {r.currentPeriodEnd ? `至 ${formatWhen(r.currentPeriodEnd)}` : "—"}
          </div>
        </div>
      ),
    },
    {
      key: "revenue",
      title: "Revenue",
      align: "right",
      render: (r) =>
        r.revenue.length === 0 ? (
          <span className="text-ink-40">—</span>
        ) : (
          <div className="text-xs">
            {r.revenue.map((c) => (
              <div key={c.currency}>{formatMoney(c.cents, c.currency)}</div>
            ))}
            <div className="text-xs text-ink-40">{r.paidOrders} paid orders</div>
          </div>
        ),
    },
  ];

  const totalUsdCents = snapshot.rows.reduce(
    (sum, r) => sum + (r.revenue.find((c) => c.currency === "USD")?.cents ?? 0),
    0
  );

  return (
    <div className="space-y-4">
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-60">
            共 <span className="font-mono text-ink">{formatInt(snapshot.rows.length)}</span> 位客户 ·
            USD 累计收入 <span className="font-mono text-ink">{formatUsd(totalUsdCents)}</span>
            {snapshot.truncated ? (
              <span className="ml-2 text-warn">（profiles 超过 5000 行已截断）</span>
            ) : null}
          </div>
          <form method="get" action="/admin/customers" className="flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="sort" value={sort} />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="搜索 email / 姓名 / user id"
              className="w-64 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-40"
            />
            <button
              type="submit"
              className="rounded-md border border-line bg-line-soft px-3 py-1.5 text-sm text-ink-60 hover:bg-line"
            >
              搜索
            </button>
            {search ? (
              <Link
                href={buildHref({ q: "" })}
                className="text-xs text-accent hover:underline"
              >
                清除
              </Link>
            ) : null}
          </form>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {CUSTOMER_STATUS_FILTERS.map((s) => (
            <Link
              key={s}
              href={buildHref({ status: s })}
              className={`rounded-md border px-3 py-1 text-xs ${
                status === s
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-card text-ink-60 hover:bg-line-soft"
              }`}
            >
              {CUSTOMER_STATUS_LABELS[s]}
              <span className="ml-1 text-xs opacity-70">{counts.get(s) ?? 0}</span>
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={buildHref({ sort: s.key })}
              className={`rounded-md border px-3 py-1 text-xs ${
                sort === s.key
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line bg-card text-ink-60 hover:bg-line-soft"
              }`}
            >
              按{s.label}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-40">
          状态口径：Trial（试用中）→ Paying（订阅生效且非 free）→ Canceled（canceled/expired）→
          Inactive（超过 {INACTIVE_AFTER_DAYS} 天无站内活动）→ Free。来源/UTM 取自该客户首次访问的归因。
        </p>
      </Card>

      {!snapshot.available ? (
        <Unavailable
          reason={snapshot.error ?? "profiles 权威表不可读（需 SUPABASE_SERVICE_ROLE_KEY）"}
        />
      ) : null}

      <Card className="p-0">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.userId}
          compact
          emptyText={
            snapshot.rows.length === 0
              ? "还没有任何注册客户（profiles 为空）"
              : "没有符合当前筛选条件的客户"
          }
        />
      </Card>
    </div>
  );
}
