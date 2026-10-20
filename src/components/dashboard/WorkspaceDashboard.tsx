"use client";

// ===== 工作台首页可视化主体（/app 第二~四层）=====
//
// 信息顺序：关键指标卡 → 数据可视化（趋势 / 优先级分布 / 验证状态分布）→ 优先处理事项表。
// 数据全部来自服务端只读聚合（getWorkspaceOverview，复用既有队列与审计表）：
//   —— 不新增表 / 不新增优先级算法 / 不新增机会类型 / 不新增外部数据源。
// 任何无法得出的口径显示诚实空状态 + 可执行入口，绝不填 0 / 假曲线 / 假百分比。

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_COLORS,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
} from "@/components/dashboard/chart-theme";
import MetricCard from "@/components/viz/MetricCard";
import ChartFrame from "@/components/viz/ChartFrame";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { TONE_COLOR, unifiedStatusTone } from "@/components/viz/tokens";
import type { WorkspaceOverviewData } from "@/lib/seo/workspace-overview";

type LocalizedText = string | { en: string; zh: string };

function textOf(v: LocalizedText | null, locale: string): string {
  if (v === null) return "";
  return typeof v === "string" ? v : locale === "zh" ? v.zh : v.en;
}

function formatDay(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

/** 缺口 → 可执行入口（真实存在的功能，不造假链接） */
const GAP_ACTION: Record<string, string> = {
  no_completed_audit: "/app/audit",
  quick_audit_only_homepage: "/app/audit",
  audit_partial: "/app/audit",
  no_dashboard_snapshot: "/app/audit",
  no_tracked_keywords: "/app/position-tracking",
  no_project_selected: "/app",
  no_growth_opportunities: "/app/opportunities",
  backlink_source_unavailable: "/admin/data-sources",
};

export default function WorkspaceDashboard({ data }: { data: WorkspaceOverviewData }) {
  const tw = useTranslations("dashboard.workspace");
  const tv = useTranslations("dashboard.viz");
  const ta = useTranslations("dashboard.actions");
  const tAudit = useTranslations("dashboard.audit");
  const locale = useLocale() as "en" | "zh";

  const audit = data.audit;
  const hasAudit = data.hasAudit && audit !== null;

  // 「当前未解决问题」= **技术问题**中未被验证解决、也未被忽略的数量
  //（待处理 + 进行中 + 已标记修复但未验证）。增长机会不计入"问题"口径。
  const unresolved =
    data.auditCounts.open + data.auditCounts.in_progress + data.auditCounts.fixed_claimed;
  const verified = data.auditCounts.verified_resolved;

  const priorityData = (["P0", "P1", "P2"] as const).map((level) => ({
    level,
    value: data.auditPriority[level],
    color: level === "P0" ? TONE_COLOR.neg : level === "P1" ? TONE_COLOR.warn : TONE_COLOR.info,
  }));
  const priorityTotal = priorityData.reduce((a, p) => a + p.value, 0);

  const verificationData = [
    { key: "pending", label: tv("verifyPending"), value: data.verification.pending, color: TONE_COLOR.warn },
    { key: "fail", label: tv("verifyFail"), value: data.verification.fail, color: TONE_COLOR.neg },
    { key: "pass", label: tv("verifyPass"), value: data.verification.pass, color: TONE_COLOR.pos },
    { key: "inconclusive", label: tv("verifyInconclusive"), value: data.verification.inconclusive, color: TONE_COLOR.neutral },
  ];
  const verificationTotal = verificationData.reduce((a, v) => a + v.value, 0);

  const trendPoints =
    data.trend?.points.map((p) => ({
      day: formatDay(p.date, locale),
      score: p.score,
      issues: p.issues,
    })) ?? [];

  const runAudit = (
    <Link href="/app/audit" className="btn-secondary px-3 py-1.5 text-xs">
      {tw("todo.emptyAction")}
    </Link>
  );

  return (
    <div className="space-y-4">
      {/* ===== 第二层：关键指标卡 ===== */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={tw("metrics.healthScore")}
          value={hasAudit ? (audit!.healthScore ?? null) : null}
          unit={hasAudit && audit!.healthScore !== null ? "/ 100" : undefined}
          tone={
            audit?.healthScore == null
              ? undefined
              : audit.healthScore >= 80
                ? "pos"
                : audit.healthScore >= 60
                  ? "warn"
                  : "neg"
          }
          caption={
            hasAudit
              ? `${audit!.domain} · ${formatDay(audit!.finishedAt, locale)}`
              : tw("metrics.noAuditReason")
          }
          hint={tw("metrics.healthScoreHint")}
          unavailableLabel={tw("metrics.noAudit")}
          status={
            hasAudit && audit!.pagesCrawled !== null
              ? {
                  label: audit!.depth === "full" ? tAudit("depthFull") : tAudit("depthQuick"),
                  tone: audit!.partial ? "warn" : "info",
                }
              : null
          }
        />
        <MetricCard
          label={tw("metrics.pagesCrawled")}
          value={hasAudit ? (audit!.pagesCrawled ?? null) : null}
          caption={hasAudit ? tw("metrics.pagesCrawledHint") : tw("metrics.noAuditReason")}
          hint={tw("metrics.pagesCrawledHint")}
          unavailableLabel={tw("metrics.noAudit")}
        />
        <MetricCard
          label={tw("metrics.openIssues")}
          value={hasAudit ? unresolved : null}
          tone={unresolved > 0 ? "warn" : "pos"}
          caption={
            hasAudit
              ? tw("metrics.openBreakdown", { wip: data.auditCounts.in_progress, fixed: data.auditCounts.fixed_claimed })
              : tw("metrics.noAuditReason")
          }
          hint={tw("metrics.openIssuesHint")}
          unavailableLabel={tw("metrics.noAudit")}
        />
        <MetricCard
          label={tw("metrics.verifiedResolved")}
          value={hasAudit ? verified : null}
          tone={verified > 0 ? "pos" : undefined}
          caption={hasAudit ? tw("metrics.verifiedBreakdown", { pending: data.verification.pending }) : tw("metrics.noAuditReason")}
          hint={tw("metrics.verifiedResolvedHint")}
          unavailableLabel={tw("metrics.noAudit")}
        />
      </div>

      {/* ===== 第三层：数据可视化 ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 健康分 / 检出数趋势 —— 只有同一域名 ≥2 次已完成审计才算可比较 */}
        <ChartFrame
          className="lg:col-span-7"
          title={tw("trend.title")}
          subtitle={data.trend ? tw("trend.subtitle", { domain: data.trend.domain }) : undefined}
          isEmpty={!data.trend}
          emptyTitle={tw("trend.emptyTitle")}
          emptyHint={tw("trend.emptyHint")}
          emptyAction={runAudit}
          legend={[
            { label: tw("trend.seriesScore"), tone: "accent" },
            { label: tw("trend.seriesIssues"), tone: "warn" },
          ]}
          height={data.trend ? 220 : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendPoints} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
              <CartesianGrid {...COMMON_GRID_PROPS} />
              <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
              <YAxis yAxisId="score" domain={[0, 100]} {...COMMON_YAXIS_PROPS} />
              <YAxis yAxisId="issues" orientation="right" allowDecimals={false} {...COMMON_YAXIS_PROPS} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                formatter={(v, name) => [`${v}`, name === "score" ? tw("trend.seriesScore") : tw("trend.seriesIssues")]}
              />
              <Line
                yAxisId="score"
                type="monotone"
                dataKey="score"
                stroke={CHART_COLORS.accent}
                strokeWidth={2.5}
                dot={{ r: 3, fill: CHART_COLORS.accent, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                yAxisId="issues"
                type="monotone"
                dataKey="issues"
                stroke={CHART_COLORS.warn}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 3, fill: CHART_COLORS.warn, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>

        {/* 待处理事项优先级分布 */}
        <ChartFrame
          className="lg:col-span-5"
          title={tw("priority.title")}
          subtitle={tw("priority.subtitle")}
          legend={priorityData.map((p) => ({
            label: p.level,
            tone: p.level === "P0" ? "neg" : p.level === "P1" ? "warn" : "info",
            value: p.value,
          }))}
          isEmpty={priorityTotal === 0}
          emptyTitle={tw("priority.emptyTitle")}
          emptyHint={tw("priority.emptyHint")}
          height={priorityTotal === 0 ? undefined : 220}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={priorityData} margin={{ top: 8, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid {...COMMON_GRID_PROPS} />
              <XAxis dataKey="level" {...COMMON_XAXIS_PROPS} />
              <YAxis allowDecimals={false} {...COMMON_YAXIS_PROPS} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                formatter={(v) => [`${v}`, ta("tasksCount", { n: Number(v) })]}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {priorityData.map((p) => (
                  <Cell key={p.level} fill={p.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 处理 / 验证状态分布 */}
        <ChartFrame
          className="lg:col-span-5"
          title={tw("verification.title")}
          subtitle={tw("verification.subtitle")}
          legend={verificationData.map((v) => ({
            label: v.label,
            tone: v.key === "pass" ? "pos" : v.key === "fail" ? "neg" : v.key === "inconclusive" ? "neutral" : "warn",
            value: v.value,
          }))}
          isEmpty={verificationTotal === 0}
          emptyTitle={tw("verification.emptyTitle")}
          emptyHint={tw("verification.emptyHint")}
          chartHeight={verificationTotal === 0 ? undefined : 200}
          chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={verificationData} margin={{ top: 8, right: 8, bottom: 28, left: -20 }}>
              <CartesianGrid {...COMMON_GRID_PROPS} />
              <XAxis
                dataKey="label"
                interval={0}
                angle={-14}
                textAnchor="end"
                height={48}
                {...COMMON_XAXIS_PROPS}
                tick={{ ...CHART_TICK_STYLE, fontSize: 10 }}
              />
              <YAxis allowDecimals={false} {...COMMON_YAXIS_PROPS} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                formatter={(v) => [`${v}`, ta("tasksCount", { n: Number(v) })]}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {verificationData.map((v) => (
                  <Cell key={v.key} fill={v.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          }
        >
          <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
            {tw("verification.note")}
          </p>
        </ChartFrame>

        {/* 数据缺口：如实解释缺什么、点哪里补 */}
        <section className="card-a p-5 lg:col-span-7">
          <h3 className="font-display text-lg font-semibold text-ink">{tw("gaps.title")}</h3>
          <p className="mt-0.5 font-sans text-xs text-ink-40">{tw("gaps.subtitle")}</p>
          {data.gaps.length === 0 ? (
            <p className="mt-4 font-sans text-sm text-pos">{tw("gaps.none")}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.gaps.map((g) => (
                <li
                  key={g}
                  className="flex flex-col gap-2 rounded-md border border-line bg-paper px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-sans text-xs text-ink-60">{ta(`gap.${g}` as "gap.no_completed_audit")}</span>
                  {GAP_ACTION[g] ? (
                    <Link href={GAP_ACTION[g]} className="font-mono text-xs font-semibold text-brand hover:underline">
                      {tv("openAction")} →
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ===== 第四层：优先处理事项 ===== */}
      <section className="card-a p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-ink">{tw("todo.title")}</h3>
            <p className="mt-0.5 font-sans text-xs text-ink-40">{tw("todo.subtitle")}</p>
          </div>
          <Link href="/app/actions" className="btn-secondary px-3 py-1.5 text-xs">
            {ta("panel.cta")}
          </Link>
        </header>

        <div className="mt-4">
          {!hasAudit && data.tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-4 py-8 text-center">
              <div className="font-sans text-sm font-medium text-ink-60">{tw("todo.noAuditTitle")}</div>
              <p className="mt-1 max-w-md font-sans text-xs text-ink-40">{tw("todo.noAuditHint")}</p>
              <div className="mt-3">
                <Link href="/app/audit" className="btn-primary px-3 py-1.5 text-xs">
                  {tw("todo.emptyAction")}
                </Link>
              </div>
            </div>
          ) : data.tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-4 py-8 text-center">
              <div className="font-sans text-sm font-medium text-ink-60">{tw("todo.emptyTitle")}</div>
              <p className="mt-1 max-w-md font-sans text-xs text-ink-40">{tw("todo.emptyHint")}</p>
            </div>
          ) : (
            <>
              {/* 桌面端：紧凑数据表格 */}
              <div className="hidden md:block">
                <DataTable minWidthRem={48} ariaLabel={tw("todo.title")}>
                  <THead>
                    <Th width="7rem">{tv("thPriority")}</Th>
                    <Th>{tv("thIssue")}</Th>
                    <Th align="right" width="7.5rem">{tv("thScope")}</Th>
                    <Th width="10rem">{tv("thStatus")}</Th>
                    <Th align="right" width="6rem">{tv("thAction")}</Th>
                  </THead>
                  <TBody>
                    {data.tasks.map((task) => (
                      <TR key={task.key}>
                        <TD>
                          <span className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              label={task.level}
                              tone={task.level === "P0" ? "neg" : task.level === "P1" ? "warn" : "info"}
                            />
                            <span className="badge-info">{ta(`source.${task.source}` as "source.audit")}</span>
                          </span>
                        </TD>
                        <TD>
                          <div className="font-sans text-sm font-medium text-ink">
                            {textOf(task.title, locale) ||
                              task.fallbackTitle ||
                              ta(`status.${task.status}` as "status.open")}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-40">
                            <span>{task.domain}</span>
                            {task.target ? (
                              <>
                                <span>·</span>
                                <span className="max-w-[22rem] truncate">{task.target.replace(/^https?:\/\//, "")}</span>
                              </>
                            ) : null}
                          </div>
                        </TD>
                        <TD align="right" numeric>
                          {task.affectedPages !== null ? (
                            <>
                              <div className="text-sm font-semibold text-ink">{task.affectedPages}</div>
                              <div className="text-xs text-ink-40">
                                {task.findings !== null ? `${task.findings} findings` : ""}
                              </div>
                            </>
                          ) : (
                            <span className="font-sans text-xs text-ink-40">{tv("scopeUnknown")}</span>
                          )}
                        </TD>
                        <TD>
                          <StatusBadge
                            label={ta(`status.${task.status}` as "status.open")}
                            tone={unifiedStatusTone(task.status)}
                            title={ta(`status.${task.status}_hint` as "status.open_hint")}
                          />
                        </TD>
                        <TD align="right">
                          {task.href ? (
                            <Link href={task.href} className="font-mono text-xs font-semibold text-brand hover:underline">
                              {task.labelKey ? ta(task.labelKey as "act.openIssue") : tv("openAction")} →
                            </Link>
                          ) : (
                            <span className="font-sans text-xs text-ink-40">
                              {task.unavailableReason
                                ? ta(`act.${task.unavailableReason}` as "act.executionUnavailable")
                                : ta("act.executionUnavailable")}
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </DataTable>
              </div>

              {/* 移动端：紧凑卡片列表（不横向溢出） */}
              <div className="md:hidden">
                {data.tasks.map((task) => (
                  <div key={task.key} className="flex flex-col gap-1.5 border-b border-line-soft py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        label={task.level}
                        tone={task.level === "P0" ? "neg" : task.level === "P1" ? "warn" : "info"}
                      />
                      <StatusBadge
                        label={ta(`status.${task.status}` as "status.open")}
                        tone={unifiedStatusTone(task.status)}
                      />
                    </span>
                    <span className="font-sans text-sm font-medium text-ink">
                      {textOf(task.title, locale) || task.fallbackTitle || task.type}
                    </span>
                    <span className="font-mono text-xs text-ink-40">
                      {task.domain}
                      {task.affectedPages !== null ? ` · ${tv("scopePages", { n: task.affectedPages })}` : ""}
                    </span>
                    {task.href ? (
                      <Link href={task.href} className="font-mono text-xs font-semibold text-brand hover:underline">
                        {task.labelKey ? ta(task.labelKey as "act.openIssue") : tv("openAction")} →
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
