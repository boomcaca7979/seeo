// ===== /admin/growth：GSC 运营表 + 转化率 =====
// 回答三个问题：① 流量从哪里来 ② 用户在哪一步流失 ③ 哪些 SEO 页面最值得优化

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
  formatPct,
  formatWhen,
  type Column,
} from "@/components/admin/ui";
import {
  deriveCtrOpportunities,
  derivePositionOpportunities,
  deriveTopQueries,
  getGscBreakdown,
  getGscDaily,
  getGscPages,
  getGscQueries,
  getGscTotals,
  POSITION_OPPORTUNITY_RANGE,
  type CtrOpportunity,
  type GscDimensionRow,
} from "@/lib/admin/gsc-metrics";
import { getAdminOverview } from "@/lib/admin/funnel";

import { checkAdmin } from "@/lib/admin/auth";
import AdminGuardMessage from "@/components/admin/guard-message";

export const dynamic = "force-dynamic";

const GSC_WINDOWS = [
  { days: 7, label: "7D" },
  { days: 28, label: "28D" },
  { days: 90, label: "90D" },
];

function normalizeGscWindow(raw: string | undefined): number {
  const n = Number(raw ?? "28");
  return GSC_WINDOWS.some((w) => w.days === n) ? n : 28;
}

function dimColumns(label: string): Array<Column<GscDimensionRow>> {
  return [
    {
      key: "key",
      title: label,
      render: (r) => <span className="font-mono text-xs text-ink">{r.key}</span>,
    },
    { key: "clicks", title: "Clicks", align: "right", render: (r) => formatInt(r.clicks) },
    { key: "impressions", title: "Impressions", align: "right", render: (r) => formatInt(r.impressions) },
    { key: "ctr", title: "CTR", align: "right", render: (r) => formatPct(r.ctr) },
    {
      key: "position",
      title: "Avg position",
      align: "right",
      render: (r) => (r.position === null ? "—" : r.position.toFixed(1)),
    },
  ];
}

export default async function AdminGrowthPage({
  searchParams,
}: {
  searchParams: Promise<{
    days?: string;
    sync?: string;
    rows?: string;
    error?: string;
    gsc_import?: string;
    gsc_kind?: string;
    gsc_written?: string;
    gsc_errors?: string;
    gsc_reason?: string;
  }>;
}) {
  // 页面级 fail-closed 守卫：layout 与 page 并行渲染，layout 正常 return 不阻止本页
  // RSC payload 流式输出（官方 authentication 指南），因此取数前必须自行鉴权。
  const guard = await checkAdmin();
  if (!guard.ok) return <AdminGuardMessage code={guard.code} error={guard.error} />;
  const sp = await searchParams;
  const days = normalizeGscWindow(sp.days);

  const [totals, daily, queries, pages, countries, devices, overview] = await Promise.all([
    getGscTotals(days).catch(() => null),
    getGscDaily(days).catch(() => []),
    getGscQueries(days).catch(() => []),
    getGscPages(days).catch(() => []),
    getGscBreakdown(days, "country").catch(() => []),
    getGscBreakdown(days, "device").catch(() => []),
    getAdminOverview(days),
  ]);

  const gscConnected = overview.availability.gscConnected;
  const ctrOpp = deriveCtrOpportunities(queries);
  const ctrOppPages = deriveCtrOpportunities(pages);
  const posOpp = derivePositionOpportunities(queries);
  const posOppPages = derivePositionOpportunities(pages);
  const topQueries = deriveTopQueries(queries);
  const topPages = deriveTopQueries(pages);

  const funnel = overview.funnel;
  const step = (key: string) => funnel.find((f) => f.key === key);
  const visit = step("visit");
  const signup = step("signup");
  const activation = step("activation");
  const checkout = step("checkout");
  const paid = step("paid");

  const rate = (from?: number, to?: number) =>
    from && from > 0 && to !== undefined ? to / from : null;

  const ctrOppColumns: Array<Column<CtrOpportunity>> = [
    ...dimColumns("Query").slice(0, 1),
    { key: "clicks", title: "Clicks", align: "right", render: (r) => formatInt(r.clicks) },
    { key: "impressions", title: "Impressions", align: "right", render: (r) => formatInt(r.impressions) },
    { key: "ctr", title: "CTR", align: "right", render: (r) => formatPct(r.ctr) },
    { key: "gap", title: "CTR 差距", align: "right", render: (r) => `${r.ctrGapPct.toFixed(2)}pp` },
    {
      key: "potential",
      title: "可增点击（估算）",
      align: "right",
      render: (r) => <span className="font-mono text-ink">+{formatInt(r.potentialClicks)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WindowSwitcher current={days} basePath="/admin/growth" windows={GSC_WINDOWS} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={gscConnected ? "good" : "neutral"}>
            {gscConnected ? "Google 搜索数据已接入" : "尚未连接"}
          </Badge>
          <span className="text-xs text-ink-40">
            最近同步：{formatWhen(overview.gscLastSyncAt)}
          </span>
          <form method="post" action="/api/admin/sync/gsc">
            <input type="hidden" name="days" value={String(days)} />
            <button
              type="submit"
              className="rounded-md border border-line bg-line-soft px-3 py-1 text-xs text-ink-60 hover:bg-line"
            >
              立即同步 GSC
            </button>
          </form>
        </div>
      </div>

      {sp.sync === "ok" ? (
        <Card className="border-pos/40 bg-pos/5 px-4 py-2 text-sm text-ink-60">
          同步完成：日序列 {sp.rows ?? 0} 行。
        </Card>
      ) : sp.sync === "error" ? (
        <Card className="border-neg/40 bg-neg/5 px-4 py-2 text-sm text-ink-60">
          同步失败：{sp.error ?? "未知错误"}
        </Card>
      ) : null}

      {sp.gsc_import ? (
        <Card
          className={`px-4 py-2 text-sm ${
            sp.gsc_import === "ok"
              ? "border-pos/40 bg-pos/5 text-ink-60"
              : "border-neg/40 bg-neg/5 text-ink-60"
          }`}
        >
          {sp.gsc_import === "ok" ? (
            <>
              导入成功：写入 {sp.gsc_written ?? 0} 行
              {Number(sp.gsc_errors ?? 0) > 0 ? `，${sp.gsc_errors} 行被拒绝` : ""}。
              经营总览与下方各表已按导入数据更新。
            </>
          ) : (
            <>
              导入失败：{sp.gsc_reason ?? `共 ${sp.gsc_errors ?? 0} 个错误`}。请检查 CSV 表头与数值格式，
              未写入任何数据。
            </>
          )}
        </Card>
      ) : null}

      <Card className="px-4 py-3">
        <div className="text-sm font-semibold text-ink">导入 Google 搜索报表（CSV）</div>
        <p className="mt-0.5 text-xs text-ink-40">
          无需 OAuth：在 Google Search Console「效果报告 → 导出」后，直接上传下载的 ZIP
          （自动识别其中 Dates / Queries / Pages 等文件并全部导入），或单独粘贴某个 CSV 内容。
          重复导入同一份报表不会重复累计；导入后本页与经营总览立即更新。
        </p>
        <form method="post" action="/api/admin/import/gsc" encType="multipart/form-data" className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="file"
              name="file"
              accept=".zip,.csv"
              className="rounded-md border border-line bg-card px-2 py-1 text-ink-60"
            />
            <select
              name="kind"
              className="rounded-md border border-line bg-card px-2 py-1 text-ink-60"
              defaultValue="queries"
            >
              <option value="queries">搜索词报告（Queries.csv）</option>
              <option value="pages">页面报告（Pages.csv）</option>
              <option value="dates">日期报告（Dates.csv）</option>
            </select>
            <select
              name="windowDays"
              className="rounded-md border border-line bg-card px-2 py-1 text-ink-60"
              defaultValue="28"
            >
              <option value="28">窗口 28 天</option>
              <option value="7">窗口 7 天</option>
              <option value="90">窗口 90 天</option>
            </select>
            <input
              name="propertyUrl"
              defaultValue="sc-domain:seeo.asia"
              className="w-56 rounded-md border border-line bg-card px-2 py-1 font-mono text-ink-60"
              aria-label="站点属性"
            />
          </div>
          <textarea
            name="csv"
            rows={5}
            placeholder="粘贴 CSV 内容（含表头行，GSC 原样导出即可）"
            className="w-full rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink-60"
          />
          <button
            type="submit"
            className="rounded-md border border-line bg-line-soft px-3 py-1 text-xs text-ink-60 hover:bg-line"
          >
            导入报表
          </button>
        </form>
      </Card>

      {!gscConnected ? (
        <Unavailable reason="尚未连接 Google Search Console（或尚未同步）。请在 /admin/data-sources 查看需要补哪些凭据；在配置前，本页所有 GSC 指标均为暂不可用，而不是 0。" />
      ) : null}

      {/* 站内行为数据来源标注（只读通道 or 本地隔离库） */}
      <p className="text-xs text-ink-40">
        站内行为数据来源：
        <span
          className={
            overview.analyticsSource === "production-readonly"
              ? "text-green-500"
              : "text-amber-600 dark:text-amber-400"
          }
        >
          {overview.analyticsSource === "production-readonly"
            ? "生产库（只读通道）"
            : "本地隔离库（非生产数据）"}
        </span>
        —— {overview.analyticsSourceNote}
      </p>

      {/* GSC 总览 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="搜索点击"
          value={gscConnected ? formatInt(totals?.clicks ?? 0) : "—"}
          hint={`窗口 ${days}D`}
          source="gsc_daily_metrics"
          tone={gscConnected ? "default" : "muted"}
        />
        <MetricCard
          label="搜索曝光"
          value={gscConnected ? formatInt(totals?.impressions ?? 0) : "—"}
          hint={`窗口 ${days}D`}
          source="gsc_daily_metrics"
          tone={gscConnected ? "default" : "muted"}
        />
        <MetricCard
          label="点击率"
          value={gscConnected ? formatPct(totals?.ctr ?? 0) : "—"}
          hint="点击数 / 曝光数"
          source="GSC 原生口径"
          tone={gscConnected ? "default" : "muted"}
        />
        <MetricCard
          label="平均排名"
          value={gscConnected && totals?.position !== null ? (totals?.position ?? 0).toFixed(1) : "—"}
          hint="按 impressions 加权"
          source="GSC 平均位置（非整数排名）"
          tone={gscConnected ? "default" : "muted"}
        />
      </div>

      {/* 转化率链 */}
      <Section
        title="流量 → 注册 → 首次使用 → 开始付款 → 支付成功"
        description="每一步的绝对数与转化率（网站访问 / 首次使用依赖站内事件；注册 / 付款 / 支付来自权威表）"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <MetricCard
            label="搜索点击"
            value={gscConnected ? formatInt(totals?.clicks ?? 0) : "—"}
            hint="自然搜索点击"
            tone={gscConnected ? "default" : "muted"}
          />
          <MetricCard
            label="网站访问"
            value={overview.availability.analytics ? formatInt(visit?.count ?? 0) : "—"}
            hint="站内去重访客"
            tone={overview.availability.analytics ? "default" : "muted"}
          />
          <MetricCard
            label="注册转化率"
            value={formatPct(rate(visit?.count, signup?.count))}
            hint={`${formatInt(signup?.count ?? 0)} 个注册`}
          />
          <MetricCard
            label="首次使用率"
            value={formatPct(rate(signup?.count, activation?.count))}
            hint={`${formatInt(activation?.count ?? 0)} 人完成首次使用`}
          />
          <MetricCard
            label="付款发起率"
            value={formatPct(rate(activation?.count, checkout?.count))}
            hint={`${formatInt(checkout?.count ?? 0)} 次开始付款`}
          />
          <MetricCard
            label="支付成功率"
            value={formatPct(rate(checkout?.count, paid?.count))}
            hint={`${formatInt(paid?.count ?? 0)} 位付费客户`}
          />
          <MetricCard
            label="当前瓶颈"
            value={overview.diagnosis.label}
            hint={overview.diagnosis.detail}
            tone={overview.diagnosis.code === "HEALTHY" ? "good" : "warn"}
          />
        </div>
      </Section>

      {/* 趋势 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="搜索点击趋势" description="按日自然搜索点击">
          {gscConnected ? (
            <TrendBars
              values={daily.map((d) => d.clicks)}
              labels={daily.map((d) => d.date)}
              formatValue={(v) => formatInt(v)}
            />
          ) : (
            <Unavailable reason="GSC 未接入" />
          )}
        </Section>
        <Section title="搜索曝光趋势" description="按日自然搜索曝光">
          {gscConnected ? (
            <TrendBars
              values={daily.map((d) => d.impressions)}
              labels={daily.map((d) => d.date)}
              color="var(--color-accent)"
              formatValue={(v) => formatInt(v)}
            />
          ) : (
            <Unavailable reason="GSC 未接入" />
          )}
        </Section>
      </div>

      {/* 三张运营表 */}
      <Section
        title="1 · High Impression / Low CTR"
        description="曝光高但点击率低的词 —— 优先改标题/描述与 SERP 呈现"
        meta={
          ctrOpp.basis
            ? `门槛：impressions ≥ ${ctrOpp.basis.impressionFloor} · CTR 基准 ${(ctrOpp.basis.ctrCeiling * 100).toFixed(2)}%（来源：本站 position ≤ 3 的${ctrOpp.basis.ctrBasis === "position-1-3" ? "中位 CTR" : "全体中位 CTR"}，样本 ${ctrOpp.basis.sampleSize}）`
            : "样本不足，暂不产出机会（避免用少量数据编造结论）"
        }
      >
        {ctrOpp.items.length > 0 ? (
          <DataTable columns={ctrOppColumns} rows={ctrOpp.items} rowKey={(r) => r.key} compact />
        ) : (
          <Empty>{gscConnected ? "当前没有「高曝光低 CTR」的关键词" : "GSC 未接入"}</Empty>
        )}
      </Section>

      <Section
        title="2 · Position 5–20 Opportunities"
        description={`已进入 ${POSITION_OPPORTUNITY_RANGE.min}–${POSITION_OPPORTUNITY_RANGE.max} 名、最值得继续优化的词（按曝光排序）`}
      >
        {posOpp.length > 0 ? (
          <DataTable columns={dimColumns("Query")} rows={posOpp} rowKey={(r) => r.key} compact />
        ) : (
          <Empty>{gscConnected ? "当前没有位于 5–20 名的关键词" : "GSC 未接入"}</Empty>
        )}
      </Section>

      <Section title="3 · Top Search Queries" description="带来实际点击的搜索词">
        {topQueries.length > 0 ? (
          <DataTable columns={dimColumns("Query")} rows={topQueries} rowKey={(r) => r.key} compact />
        ) : (
          <Empty>{gscConnected ? "窗口内没有产生点击的关键词" : "GSC 未接入"}</Empty>
        )}
      </Section>

      <Section title="热门落地页" description="按点击排序的自然搜索落地页">
        {topPages.length > 0 ? (
          <DataTable columns={dimColumns("Page")} rows={topPages} rowKey={(r) => r.key} compact />
        ) : (
          <Empty>{gscConnected ? "窗口内没有页面数据" : "GSC 未接入"}</Empty>
        )}
      </Section>

      <Section
        title="页面机会：高曝光 / 低点击率 + 排名 5–20 位"
        description="同一套判定应用到页面维度 —— 最值得优化的具体 URL"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-ink-40">高曝光 / 低点击率</div>
            {ctrOppPages.items.length > 0 ? (
              <DataTable
                columns={[
                  { key: "key", title: "页面", render: (r: CtrOpportunity) => <span className="font-mono text-xs">{r.key}</span> },
                  { key: "impr", title: "曝光", align: "right", render: (r) => formatInt(r.impressions) },
                  { key: "ctr", title: "点击率", align: "right", render: (r) => formatPct(r.ctr) },
                  { key: "pot", title: "可增点击", align: "right", render: (r) => `+${formatInt(r.potentialClicks)}` },
                ]}
                rows={ctrOppPages.items}
                rowKey={(r) => r.key}
                compact
              />
            ) : (
              <Empty>无</Empty>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-40">排名 5–20 位</div>
            {posOppPages.length > 0 ? (
              <DataTable columns={dimColumns("Page")} rows={posOppPages} rowKey={(r) => r.key} compact />
            ) : (
              <Empty>无</Empty>
            )}
          </div>
        </div>
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="按国家 / 地区" description="流量来自哪里（窗口快照）">
          {countries.length > 0 ? (
            <DataTable columns={dimColumns("Country")} rows={countries} rowKey={(r) => r.key} compact />
          ) : (
            <Empty>{gscConnected ? "无 country 数据" : "GSC 未接入"}</Empty>
          )}
        </Section>
        <Section title="按设备" description="设备分布（窗口快照）">
          {devices.length > 0 ? (
            <DataTable columns={dimColumns("Device")} rows={devices} rowKey={(r) => r.key} compact />
          ) : (
            <Empty>{gscConnected ? "无 device 数据" : "GSC 未接入"}</Empty>
          )}
        </Section>
      </div>

      <Card className="px-4 py-3 text-xs text-ink-40">
        GSC 数据按日持久化于本地（gsc_daily_metrics / gsc_query_metrics / gsc_page_metrics），
        打开页面**不会**请求 Google API；只有点击「立即同步 GSC」或由 CRON_SECRET 触发时才拉取。
        窗口快照的「机会」判定基准全部来自本站自身数据（见各表 meta）。
      </Card>
    </div>
  );
}
