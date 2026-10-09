// ===== /admin/data-sources：数据源接入状态 + GSC 授权入口 =====

import Link from "next/link";
import {
  Badge,
  Card,
  DataTable,
  Section,
  formatInt,
  formatWhen,
  type Column,
} from "@/components/admin/ui";
import { getDataSourceStatuses, DATA_SOURCE_STATE_LABELS, type DataSourceStatus, type DataSourceState } from "@/lib/admin/data-sources";
import { getOwnerGscConnection, isOwnerGscOAuthConfigured } from "@/lib/admin/gsc-connection";

import { checkAdmin } from "@/lib/admin/auth";
import AdminGuardMessage from "@/components/admin/guard-message";

export const dynamic = "force-dynamic";

/** 五态徽章配色（如实例示，不用统一绿色冒充全部已接通） */
function stateTone(state: DataSourceState): "good" | "warn" | "bad" | "neutral" {
  switch (state) {
    case "synced":
      return "good";
    case "connected-no-data":
    case "not-configured":
      return "warn";
    case "unreachable":
    case "sync-error":
      return "bad";
  }
}

export default async function AdminDataSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ gsc?: string; reason?: string; missing?: string }>;
}) {
  // 页面级 fail-closed 守卫：layout 与 page 并行渲染，layout 正常 return 不阻止本页
  // RSC payload 流式输出（官方 authentication 指南），因此取数前必须自行鉴权。
  const guard = await checkAdmin();
  if (!guard.ok) return <AdminGuardMessage code={guard.code} error={guard.error} />;
  const sp = await searchParams;
  const [sources, gscConnection] = await Promise.all([
    getDataSourceStatuses(),
    getOwnerGscConnection().catch(() => null),
  ]);

  const columns: Array<Column<DataSourceStatus>> = [
    {
      key: "source",
      title: "数据源",
      render: (s) => (
        <div className="min-w-[240px]">
          <div className="font-medium text-ink">{s.label}</div>
          <div className="text-xs text-ink-40">{s.powers.join(" · ")}</div>
        </div>
      ),
    },
    {
      key: "status",
      title: "状态",
      render: (s) => (
        <div className="space-y-1">
          <Badge tone={stateTone(s.state)}>{DATA_SOURCE_STATE_LABELS[s.state]}</Badge>
          {s.lastError ? (
            <div className="max-w-[260px] text-xs text-neg" title={s.lastError.message}>
              最近错误（{formatWhen(s.lastError.createdAt || null)}）：
              {s.lastError.message.slice(0, 120)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "missing",
      title: "缺少 / 待办",
      render: (s) =>
        s.missing.length === 0 ? (
          <span className="text-ink-40">—</span>
        ) : (
          <ul className="space-y-0.5">
            {s.missing.map((m) => (
              <li key={m} className="font-mono text-xs text-warn">
                {m}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: "lastSync",
      title: "最近成功同步",
      render: (s) => (
        <div className="space-y-0.5">
          <span className="font-mono text-xs">{formatWhen(s.lastSyncAt)}</span>
          {s.lastSuccess ? (
            <div className="max-w-[220px] text-xs text-ink-40" title={s.lastSuccess.message}>
              {s.lastSuccess.message.slice(0, 100)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "rows",
      title: "本地行数",
      align: "right",
      render: (s) => (s.localRows === null ? "—" : formatInt(s.localRows)),
    },
    {
      key: "hint",
      title: "说明",
      render: (s) => <span className="text-xs text-ink-40">{s.hint}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {sp.gsc === "connected" ? (
        <Card className="border-pos/40 bg-pos/5 px-4 py-2 text-sm text-ink-60">
          Search Console 已绑定。返回{" "}
          <Link className="text-accent hover:underline" href="/admin/growth">
            流量分析
          </Link>{" "}
          点击「立即同步 GSC」拉取指标。
        </Card>
      ) : sp.gsc === "error" ? (
        <Card className="border-neg/40 bg-neg/5 px-4 py-2 text-sm text-ink-60">
          GSC 授权失败：{sp.reason ?? "未知原因"}
          {sp.missing ? `（缺少：${sp.missing}）` : ""}
        </Card>
      ) : sp.gsc === "not_configured" ? (
        <Card className="border-warn/40 bg-warn/5 px-4 py-2 text-sm text-ink-60">
          GSC 尚未配置：需要 {sp.missing ?? "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GSC_TOKEN_ENCRYPTION_KEY"}。
        </Card>
      ) : sp.gsc === "disconnected" ? (
        <Card className="px-4 py-2 text-sm text-ink-60">
          已解除 GSC 绑定（历史指标快照保留）。若曾给 Google 账号授权，可另行在 Google 账号设置中撤销。
        </Card>
      ) : null}

      <Section
        title="Google Search Console（站点级）"
        description="经营后台的曝光 / 点击 / 点击率 / 排名机会都来自这里；未绑定 OAuth 时可在「流量分析」页用 CSV 报表导入，全部显示「暂不可用」而不是 0"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={gscConnection ? "good" : "warn"}>
            {gscConnection ? "已绑定" : "未绑定"}
          </Badge>
          {gscConnection ? (
            <>
              <span className="font-mono text-xs text-ink-60">{gscConnection.property_url}</span>
              <span className="text-xs text-ink-40">
                {gscConnection.google_email ?? "未知 Google 账号"} · 绑定于{" "}
                {formatWhen(gscConnection.connected_at)}
              </span>
              <form method="post" action="/api/admin/gsc/disconnect">
                <button
                  type="submit"
                  className="rounded-md border border-line bg-line-soft px-3 py-1 text-xs text-ink-60 hover:bg-line"
                >
                  解除绑定
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/api/admin/gsc/auth/start"
                prefetch={false}
                className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-deep"
              >
                连接 Search Console
              </Link>
              <span className="text-xs text-ink-40">
                OAuth 需要 {isOwnerGscOAuthConfigured() ? "已配置" : "未配置"}（GOOGLE_CLIENT_ID /
                GOOGLE_CLIENT_SECRET / GSC_TOKEN_ENCRYPTION_KEY）。回调地址：
                <span className="font-mono">/api/admin/gsc/auth/callback</span>
              </span>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-40">
          若授权下存在多个属性，设置 <span className="font-mono">GSC_ADMIN_PROPERTY</span>
          （如 <span className="font-mono">sc-domain:seeo.asia</span>）以显式指定。
        </p>
      </Section>

      <Section
        title="全部数据源"
        description="五态：凭据未配置 / 已配置但无法连接 / 已连接尚无数据 / 已同步真实数据 / 上一次同步失败；手动导入成功同样计入真实可用状态"
        meta={`共 ${sources.length} 项`}
      >
        <DataTable columns={columns} rows={sources} rowKey={(s) => s.id} compact />
      </Section>

      <Section title="需要你提供的凭据" description="按优先级排列（配置后无需改代码）">
        <ol className="space-y-2 text-xs text-ink-60">
          <li>
            <span className="font-mono text-ink">ADMIN_EMAILS</span> — owner 邮箱白名单（逗号分隔）。
            未配置时 Owner Console 完全关闭（fail-closed）。
          </li>
          <li>
            <span className="font-mono text-ink">SUPABASE_SERVICE_ROLE_KEY</span> — 读取 profiles / orders
            权威表；缺失时注册 / 开始付款 / 支付成功 / 每月订阅收入 / 收入数据全部「暂不可用」。
          </li>
          <li>
            <span className="font-mono text-ink">TURSO_READONLY_DATABASE_URL</span> /{" "}
            <span className="font-mono text-ink">TURSO_READONLY_AUTH_TOKEN</span> — 本地开发查看**生产**
            访客 / 激活 / 趋势数据的只读通道（Turso 控制台创建只读 token；绝不注入生产可写凭据）。
          </li>
          <li>
            <span className="font-mono text-ink">GOOGLE_CLIENT_ID</span> /{" "}
            <span className="font-mono text-ink">GOOGLE_CLIENT_SECRET</span> /{" "}
            <span className="font-mono text-ink">GSC_TOKEN_ENCRYPTION_KEY</span> — GSC 站点级同步（可选，
            CSV / ZIP 导入已是独立可用路径）。需要新建 OAuth 客户端并登记回调{" "}
            <span className="font-mono">https://www.seeo.asia/api/admin/gsc/auth/callback</span>。
          </li>
          <li>
            <span className="font-mono text-ink">ADSENSE_REFRESH_TOKEN</span>（+ adsense.readonly scope）
            — 自动同步广告收入（可选）；未配置时用 CSV 文件 / 粘贴导入（不做 scraping）。
          </li>
          <li>
            <span className="font-mono text-ink">CRON_SECRET</span> — 已由既有 cron 使用；可用它定时触发
            <span className="font-mono"> /api/admin/sync/gsc</span>。
          </li>
        </ol>
      </Section>
    </div>
  );
}
